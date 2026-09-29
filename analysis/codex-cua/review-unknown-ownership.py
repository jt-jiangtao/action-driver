#!/usr/bin/env python3
"""Reproduce the byte-checked ownership review of inventory's 132 unknown files."""

import hashlib
import json
import posixpath
import sys
from collections import Counter, defaultdict
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[1]
VENDOR = ROOT / "thirdparty/backup/codex-cua"
BACKUP = ROOT / "thirdparty/backup/codex-cua"
OUTPUT = HERE / "ownership-review.json"


def read_json(path):
    return json.loads(path.read_text())


inventory = read_json(HERE / "inventory.json")
baseline = {item["path"]: item for item in read_json(HERE / "baseline.json")["files"]}
unknown = sorted((item for item in inventory if item["classification"] == "unknown"), key=lambda item: item["path"])
assert len(unknown) == 132

callers = defaultdict(list)
for item in inventory:
    for imported in item.get("imports", []):
        if imported.startswith("."):
            resolved = posixpath.normpath(posixpath.join(posixpath.dirname(item["path"]), imported))
            callers[resolved].append(item["path"])

classic_package = read_json(VENDOR / "@oai/cua/dist/lib/js/oai_js_browser/dist/skill/node_modules/classic-level/package.json")
assert classic_package["name"] == "classic-level" and classic_package["version"] == "3.0.0"

entries = []
for item in unknown:
    path = item["path"]
    data = (VENDOR / path).read_bytes()
    digest = hashlib.sha256(data).hexdigest()
    assert (BACKUP / path).read_bytes() == data, f"backup differs: {path}"
    assert baseline[path]["kind"] == "file"
    assert baseline[path]["sha256"] == digest and baseline[path]["bytes"] == len(data), f"baseline differs: {path}"

    if "/node_modules/.pnpm/@statsig_client-core@3.32.6/node_modules/@statsig/client-core/src/" in path:
        group, owner, version = "statsig-client-core", "third-party", "@statsig/client-core@3.32.6"
        assert b"__require" in data and b"__exports" in data and b"import" in data
        evidence = ["固定 .pnpm 包路径及版本", "文件包含 CommonJS 转换后的 __require/__exports 与 import"]
    elif "/node_modules/.pnpm/@statsig_js-client@3.32.6/node_modules/@statsig/js-client/src/" in path:
        group, owner, version = "statsig-js-client", "third-party", "@statsig/js-client@3.32.6"
        assert b"__require" in data and b"__exports" in data and b"import" in data
        evidence = ["固定 .pnpm 包路径及版本", "文件包含 CommonJS 转换后的 __require/__exports 与 import"]
    elif path.startswith("@oai/cua/dist/_virtual/"):
        group, owner, version = "statsig-build-glue", "generated-third-party-glue", "Statsig 3.32.6 构建输出；Rollup helper 无独立版本"
        if path.endswith("/index.js"):
            assert b"@statsig_js-client@3.32.6" in data and b"__require" in data
            evidence = ["内容直接导入 @statsig/js-client@3.32.6 并调用 __require"]
        elif path.endswith("/_commonjsHelpers.js"):
            assert b"commonjsGlobal" in data and b"globalThis" in data
            evidence = ["CommonJS 构建 helper；被 Statsig __StatsigGlobal.js 导入"]
        else:
            assert b"__exports" in data and b"export" in data
            evidence = ["CommonJS 构建 __exports 容器；被 Statsig 包源导入"]
        assert callers[path], f"unreferenced virtual module: {path}"
        assert all("/@statsig_" in caller for caller in callers[path]) or path.endswith("/index.js"), path
        evidence.append("反向 import: " + ", ".join(callers[path]))
    elif path.endswith("/node_modules/tslib/tslib.es6.js"):
        group, owner, version = "tslib-helpers", "third-party-generated-helper", None
        assert b"export" in data and (b"SuppressedError" in data or b"__awaiter" in data)
        evidence = ["固定 node_modules/tslib 路径", "内容为压缩后的 TypeScript tslib 辅助函数；原包未附 package.json，确切版本未证实"]
    elif path.endswith("/node_modules/classic-level.mjs"):
        group, owner, version = "classic-level-entry", "third-party", "classic-level@3.0.0"
        assert b'createRequire(import.meta.url)' in data and b'./classic-level/index.js' in data
        evidence = ["内容仅经 createRequire 重导出 ./classic-level/index.js", "同目录 classic-level/package.json 指明版本 3.0.0"]
    elif path == "@oai/cua-repl/instructions/banner.js":
        group, owner, version = "cua-banner", "first-party", "@oai/cua-repl@0.1.0"
        assert data == b'await import("@oai/cua/tinyskyAlt");\n'
        evidence = ["内容仅动态导入自有 @oai/cua/tinyskyAlt 入口", "cua-repl 包版本来自 baseline.json；非第三方模块"]
    elif path.endswith(("/browser-client.js", "/browser-client.mjs", "/browser-service.mjs")):
        group, owner, version = "browser-mixed-bundle", "mixed-first-and-third-party", None
        assert b"tab_screenshot" in data and b"navigate_tab_url" in data and b"playwright" in data
        evidence = ["字节内同时包含自有 tab_screenshot/navigate_tab_url 命令与 Playwright 代码；须继续拆分归属", "浏览器 bundle 无独立 package.json 版本证据"]
        if path.endswith("/browser-service.mjs"):
            assert b"Statsig" in data and b"Sentry" in data and b"classic-level" in data
            evidence.append("service bundle 同时包含 Statsig、Sentry、classic-level 标记")
    else:
        raise AssertionError(f"unreviewed unknown: {path}")

    entries.append({"path": path, "group": group, "ownership": owner, "versionEvidence": version,
                    "bytes": len(data), "sha256": digest, "evidence": evidence})

counts = dict(sorted(Counter(item["group"] for item in entries).items()))
assert counts == {"browser-mixed-bundle": 3, "classic-level-entry": 1, "cua-banner": 1,
                  "statsig-build-glue": 63, "statsig-client-core": 52, "statsig-js-client": 9,
                  "tslib-helpers": 3}
group_digests = {}
for group in counts:
    manifest = "".join(f'{item["path"]}\0{item["sha256"]}\n' for item in entries if item["group"] == group)
    group_digests[group] = hashlib.sha256(manifest.encode()).hexdigest()
report = {"schemaVersion": 1, "source": "inventory.json unknown + baseline.json + fixed vendor/backup bytes",
          "counts": counts, "groupManifestSha256": group_digests,
          "unreviewedFiles": [],
          "unresolved": {"mixedBundleInternalBoundaries": [item["path"] for item in entries if item["group"] == "browser-mixed-bundle"],
                         "tslibExactVersions": [item["path"] for item in entries if item["group"] == "tslib-helpers"]},
          "entries": entries}
serialized = json.dumps(report, ensure_ascii=False, indent=2) + "\n"
if "--check" in sys.argv:
    assert OUTPUT.read_text() == serialized, "ownership-review.json is stale"
    print(f"ownership review verified: {len(entries)} files; {counts}")
else:
    OUTPUT.write_text(serialized)
    print(f"ownership review written: {len(entries)} files; {counts}")
