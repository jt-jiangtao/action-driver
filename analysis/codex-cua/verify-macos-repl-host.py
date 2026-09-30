#!/usr/bin/env python3
"""Compare original and candidate CUA REPL launch/reset in an isolated macOS host.

Run after building packages/cua, packages/sky, and packages/cua-repl:
  python3 analysis/codex-cua/verify-macos-repl-host.py --plugin-config /path/to/.mcp.json

The configured trusted Sky service is used for both variants. No installed plugin
configuration is modified, and no application names or state are printed.
"""

import argparse
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


def stage_candidate_modules(directory):
    for package in ("cua", "sky", "browser-runtime"):
        source = ROOT / "packages" / package
        target = directory / "node_modules" / "@action-driver" / package
        target.mkdir(parents=True)
        shutil.copy2(source / "package.json", target / "package.json")
        shutil.copytree(source / "dist", target / "dist")
        if (source / "resources").is_dir():
            shutil.copytree(source / "resources", target / "resources")


def run_variant(config, variant, stage):
    environment = os.environ.copy()
    environment.update(config["env"])
    environment["CUA_REPL_ENABLED_SURFACES"] = "computer"
    launcher = config["args"][0]
    if variant == "candidate":
        launcher = str(ROOT / "packages" / "cua-repl" / "bin" / "cua-repl.mjs")
        environment["NODE_REPL_NODE_MODULE_DIRS"] = os.pathsep.join(
            [str(stage / "node_modules"), environment["NODE_REPL_NODE_MODULE_DIRS"]]
        )
        environment["NODE_REPL_JS_BANNER"] = 'await import("@action-driver/cua/tinysky-alt");'
    process = subprocess.Popen(
        [config["command"], launcher],
        stdin=subprocess.PIPE,
        stdout=subprocess.PIPE,
        stderr=subprocess.DEVNULL,
        env=environment,
        start_new_session=True,
        bufsize=0,
    )
    try:
        initialized = request(
            process,
            1,
            "initialize",
            {"protocolVersion": "2025-06-18", "capabilities": {},
             "clientInfo": {"name": "repl-host-acceptance", "version": "1"}},
        )
        process.stdin.write(b'{"jsonrpc":"2.0","method":"notifications/initialized"}\n')
        process.stdin.flush()
        if initialized.get("serverInfo", {}).get("name") != "rmcp":
            raise RuntimeError("Unexpected MCP supervisor")
        globals_result = None
        for step, request_id in (("first_state", 2), ("globals", 3),
                                 ("reset", 4), ("second_state", 5)):
            name = "js_reset" if step == "reset" else "js"
            code = ("nodeRepl.write({processGlobal: typeof process, bufferGlobal: typeof Buffer})"
                    if step == "globals" else "await cua.getState()")
            arguments = {} if name == "js_reset" else {"code": code}
            result = request(process, request_id, "tools/call", {"name": name, "arguments": arguments})
            if result.get("isError"):
                detail = next((item.get("text", "") for item in result.get("content", [])
                               if item.get("type") == "text"), "")
                raise RuntimeError(f"{step}: {detail[:160]}")
            if step == "globals":
                globals_result = [item.get("text", "") for item in result.get("content", [])
                                  if item.get("type") == "text"]
        return {"initialized": True, "first_state": True, "reset": True,
                "second_state": True, "runtime_globals": globals_result}
    finally:
        if process.poll() is None:
            os.killpg(process.pid, signal.SIGKILL)
        process.wait()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--plugin-config", required=True, type=Path)
    args = parser.parse_args()
    if sys.platform != "darwin":
        raise SystemExit("macOS required")
    config = json.loads(args.plugin_config.read_text())["mcpServers"]["cua_repl"]
    with tempfile.TemporaryDirectory(prefix="candidate-repl-acceptance-", dir=Path.home() / ".codex") as temporary:
        stage = Path(temporary)
        stage_candidate_modules(stage)
        results = {variant: run_variant(config, variant, stage)
                   for variant in ("original", "candidate")}
    print(json.dumps(results, sort_keys=True))


if __name__ == "__main__":
    main()
