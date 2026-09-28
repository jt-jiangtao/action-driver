#!/usr/bin/env python3
"""Check the two copied Sky source trees before sharing the candidate implementation."""

from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
VENDOR = ROOT / "packages/back/codex-cua/@oai"
CUA = VENDOR / "cua/dist/project/cua/sky_js/src"
SKY = VENDOR / "sky/dist/project/cua/sky_js/src"

cua_files = {path.relative_to(CUA): path for path in CUA.rglob("*.js")}
sky_files = {path.relative_to(SKY): path for path in SKY.rglob("*.js")}
shared = set(cua_files) & set(sky_files)
assert len(shared) == 54, f"Expected 54 shared Sky modules, found {len(shared)}"
assert set(sky_files) - shared == {Path("service.js")}
assert set(cua_files) - shared == set()

different = {path for path in shared if cua_files[path].read_bytes() != sky_files[path].read_bytes()}
assert different == {Path("targets/mac/computer-use-telemetry.js")}, different
telemetry = Path("targets/mac/computer-use-telemetry.js")
cua_source = cua_files[telemetry].read_text()
sky_source = sky_files[telemetry].read_text()
assert 'from"@statsig/js-client"' in sky_source
assert 'from"../../../../../../_virtual/index.js"' in cua_source
assert "StatsigClient" in sky_source and "StatsigClient" in cua_source
print("Sky duplicates verified: 54 shared JS modules, 53 byte-identical, 1 Statsig import packaging difference")
