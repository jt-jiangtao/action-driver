#!/usr/bin/env python3
"""Check explicit file-level macOS mappings; existence is not behavior parity."""

from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
VENDOR = ROOT / "apps/agent-runtime/vendor/codex-cua/@oai"
PACKAGES = ROOT / "packages"

sky = {
    "core/cli.js": "core/command.ts",
    "core/package_bin.js": "core/package-bin.ts",
    "core/uint8.js": "core/bytes.ts",
    "create_client.js": "mac/computer.ts",
    "index.js": "index.ts",
    "load_options.js": "service.ts",
    "service.js": "service.ts",
    "sky.js": "sky-proxy.ts",
    "targets/mac/audio_recording.js": "mac/computer.ts",
    "targets/mac/click.js": "mac/computer.ts",
    "targets/mac/client.js": "mac/client.ts",
    "targets/mac/computer-use-policy.js": "mac/policy.ts",
    "targets/mac/computer-use-telemetry.js": "mac/telemetry.ts",
    "targets/mac/create_client.js": "mac/computer.ts",
    "targets/mac/drag.js": "mac/computer.ts",
    "targets/mac/errors.js": "mac/errors.ts",
    "targets/mac/get_app_state.js": "mac/computer.ts",
    "targets/mac/lazy-client.js": "mac/computer.ts",
    "targets/mac/list_apps.js": "mac/computer.ts",
    "targets/mac/native-pipe.js": "mac/native-pipe.ts",
    "targets/mac/paste.js": "mac/computer.ts",
    "targets/mac/perform_secondary_action.js": "mac/computer.ts",
    "targets/mac/press_key.js": "mac/computer.ts",
    "targets/mac/scroll.js": "mac/computer.ts",
    "targets/mac/select_text.js": "mac/computer.ts",
    "targets/mac/set_value.js": "mac/computer.ts",
    "targets/mac/type_text.js": "mac/computer.ts",
    "targets/mac/window_result.js": "mac/window-result.ts",
}
cua = {
    "oai_js_core/src/UnreachableCaseError.js": "core/unreachable-case-error.ts",
    "oai_js_core/src/mirror_map.js": "core/mirror-map.ts",
    "oai_js_cua/src/cua.js": "legacy-facade.ts",
    "oai_js_cua/src/get_apps.js": "discovery.ts",
    "oai_js_cua/src/get_browser_tabs.js": "discovery.ts",
    "oai_js_cua/src/get_state.js": "discovery.ts",
    "oai_js_cua/src/index.js": "index.ts",
    "oai_js_cua/src/tinysky_alt/create_tinysky_alt.js": "runtime-factory.ts",
    "oai_js_cua/src/tinysky_alt/documentation.js": "documentation.ts",
    "oai_js_cua/src/tinysky_alt/globals.js": "global-registration.ts",
    "oai_js_cua/src/tinysky_alt/tab_reference.js": "tab-reference.ts",
}
repl = {
    "oai_js_cua_repl/src/index.js": "index.ts",
    "oai_js_cua_repl/src/instructions.js": "instructions.ts",
    "oai_js_cua_repl/src/launch.js": "launch.ts",
}


def check(source: Path, mapped: dict[str, str], candidate: Path, skip_service=False):
    files = {str(path.relative_to(source)) for path in source.rglob("*.js")}
    deferred = {name for name in files if name.startswith(("targets/linux/", "targets/windows/"))}
    expected = set(mapped) - ({"service.js"} if skip_service else set())
    assert files - deferred == expected, {
        "unmapped": sorted(files - deferred - expected),
        "missing": sorted(expected - files),
    }
    for name in expected:
        assert (candidate / mapped[name]).is_file(), f"Candidate source missing: {mapped[name]}"
    return len(expected), len(deferred)


sky_source = VENDOR / "sky/dist/project/cua/sky_js/src"
cua_sky = VENDOR / "cua/dist/project/cua/sky_js/src"
sky_count, deferred = check(sky_source, sky, PACKAGES / "sky/src")
cua_sky_count, cua_deferred = check(cua_sky, sky, PACKAGES / "sky/src", skip_service=True)
assert (sky_count, deferred) == (28, 27)
assert (cua_sky_count, cua_deferred) == (27, 27)

cua_root = VENDOR / "cua/dist/lib/js"
cua_files = {str(path.relative_to(cua_root)) for folder in ("oai_js_core", "oai_js_cua")
             for path in (cua_root / folder).rglob("*.js")}
assert cua_files == set(cua), {"unmapped": sorted(cua_files - set(cua))}
for name, target in cua.items():
    assert (PACKAGES / "cua/src" / target).is_file(), target
sky_core = VENDOR / "sky/dist/lib/js/oai_js_core/src"
for name in ("UnreachableCaseError.js", "mirror_map.js"):
    assert (sky_core / name).read_bytes() == (
        cua_root / "oai_js_core/src" / name
    ).read_bytes(), f"Sky core duplicate differs: {name}"

repl_root = VENDOR / "cua-repl/dist/lib/js"
repl_files = {str(path.relative_to(repl_root)) for path in
              (repl_root / "oai_js_cua_repl").rglob("*.js")}
assert repl_files == set(repl), {"unmapped": sorted(repl_files - set(repl))}
for name, target in repl.items():
    assert (PACKAGES / "cua-repl/src" / target).is_file(), target

print(f"macOS source mappings verified: Sky {sky_count} + 2 shared core, "
      f"CUA Sky copy {cua_sky_count}, CUA own {len(cua)}, REPL {len(repl)}; "
      f"deferred platform paths {deferred}")
