#!/usr/bin/env python3
"""Compare copied browser service and candidate in isolated Codex macOS hosts.

This deliberately has no authentic Codex turn metadata. It can verify setup and
the metadata gate, not nativePipe, page commands or complete service acceptance.
"""

import argparse
import hashlib
import json
import os
import shutil
import signal
import subprocess
import sys
import tempfile
from pathlib import Path

from mcp_host_stdio import request

ROOT = Path(__file__).resolve().parents[2]
APP_MODULES = Path("/Applications/ChatGPT.app/Contents/Resources/cua_node/lib/node_modules")
COPIED = ROOT / "apps/agent-runtime/vendor/codex-cua/@oai/cua/dist/lib/js/oai_js_browser/dist/skill/scripts/browser-service.mjs"
APP_COPY = APP_MODULES / "@oai/cua/dist/lib/js/oai_js_browser/dist/skill/scripts/browser-service.mjs"


def run(config, service):
    environment = os.environ.copy()
    environment.update(config["env"])
    trusted = json.loads(environment["NODE_REPL_TRUSTED_SERVICES"])
    trusted["browser"] = str(service)
    environment["NODE_REPL_TRUSTED_SERVICES"] = json.dumps(trusted)
    process = subprocess.Popen(
        [config["command"], *config["args"]], stdin=subprocess.PIPE,
        stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, env=environment,
        start_new_session=True, bufsize=0,
    )
    try:
        request(process, 1, "initialize", {
            "protocolVersion": "2025-06-18", "capabilities": {},
            "clientInfo": {"name": "browser-service-boundary", "version": "1"},
        })
        process.stdin.write(b'{"jsonrpc":"2.0","method":"notifications/initialized"}\n')
        process.stdin.flush()
        code = (
            "const state=await cua.getState({emit:false});"
            "const setup=await nodeRepl.rpc('browser',"
            "{method:'setup',params:{environment:'codex-app'}});"
            "let gate;try{await nodeRepl.rpc('browser',"
            "{method:'execute',params:{type:'list_browsers'}});gate='allowed'}"
            "catch(error){gate=/Missing required Codex turn metadata: session_id, turn_id/.test(String(error))"
            "?'missing-turn-metadata':'other-error'}"
            "nodeRepl.write(JSON.stringify({manifest:setup.apiManifest,"
            "disabled:setup.disabledMemberIds,gate,"
            "stateGate:(state.errors??[]).some(error=>/Missing required Codex turn metadata/.test(error))}));"
        )
        response = request(process, 2, "tools/call", {"name": "js", "arguments": {"code": code}})
        if response.get("isError"):
            raise RuntimeError("Browser boundary probe failed in isolated host")
        output = next((item.get("text", "") for item in response.get("content", [])
                       if item.get("type") == "text" and item.get("text", "").startswith("{")), None)
        if output is None:
            raise RuntimeError("Browser boundary probe returned no structured summary")
        return json.loads(output)
    finally:
        if process.poll() is None:
            os.killpg(process.pid, signal.SIGKILL)
        process.wait()


def stage_candidate(stage):
    source = ROOT / "packages/browser-runtime"
    shutil.copy2(source / "package.json", stage / "package.json")
    shutil.copytree(source / "dist", stage / "dist")
    shutil.copytree(source / "resources", stage / "resources")
    modules = stage / "node_modules"
    modules.mkdir()
    dependencies = json.loads((source / "package.json").read_text())["dependencies"]
    for name in dependencies:
        target = APP_MODULES / "classic-level" if name == "classic-level" else source / "node_modules" / name
        assert target.exists(), f"Missing locked dependency {name}"
        link = modules / name
        link.parent.mkdir(parents=True, exist_ok=True)
        link.symlink_to(target, target_is_directory=True)
    return stage / "dist/service.js"


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--plugin-config", required=True, type=Path)
    args = parser.parse_args()
    if sys.platform != "darwin":
        raise SystemExit("macOS required")
    assert hashlib.sha256(COPIED.read_bytes()).digest() == hashlib.sha256(APP_COPY.read_bytes()).digest(), (
        "Installed @oai/cua baseline changed"
    )
    config = json.loads(args.plugin_config.read_text())["mcpServers"]["cua_repl"]
    with tempfile.TemporaryDirectory(prefix="browser-service-boundary-", dir=Path.home() / ".codex") as temporary:
        original = run(config, APP_COPY)
        candidate = run(config, stage_candidate(Path(temporary)))
    summary = {
        "copied_baseline_matches_installed_cua": True,
        "setup_structure_equal": original["manifest"] == candidate["manifest"] and
            original["disabled"] == candidate["disabled"],
        "original_gate": original["gate"],
        "candidate_gate": candidate["gate"],
        "gate_equal": original["gate"] == candidate["gate"] == "missing-turn-metadata",
        "state_gate_equal": original["stateGate"] == candidate["stateGate"],
    }
    print(json.dumps(summary, sort_keys=True))
    if not all(value for value in summary.values() if isinstance(value, bool)):
        raise SystemExit(1)


if __name__ == "__main__":
    main()
