#!/usr/bin/env python3
"""Compare original/candidate Sky setup and native list_apps in isolated App hosts.

Run after building packages/sky:
  python3 analysis/codex-cua/verify-macos-sky-service.py --plugin-config /path/to/.mcp.json
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


def run_variant(config, candidate_service=None, app_state=None):
    environment = os.environ.copy()
    environment.update(config["env"])
    environment["CUA_REPL_ENABLED_SURFACES"] = "computer"
    if candidate_service is not None:
        services = json.loads(environment["NODE_REPL_TRUSTED_SERVICES"])
        services["sky"] = str(candidate_service)
        environment["NODE_REPL_TRUSTED_SERVICES"] = json.dumps(services)
    process = subprocess.Popen(
        [config["command"], *config["args"]], stdin=subprocess.PIPE,
        stdout=subprocess.PIPE, stderr=subprocess.DEVNULL,
        env=environment, start_new_session=True, bufsize=0,
    )
    try:
        request(process, 1, "initialize", {
            "protocolVersion": "2025-06-18", "capabilities": {},
            "clientInfo": {"name": "sky-service-acceptance", "version": "1"},
        })
        process.stdin.write(b'{"jsonrpc":"2.0","method":"notifications/initialized"}\n')
        process.stdin.flush()
        state = request(process, 2, "tools/call", {
            "name": "js", "arguments": {"code": "await cua.getState()"},
        })
        if state.get("isError"):
            raise RuntimeError("Initial CUA state failed")
        code = (
            "const setup=await nodeRepl.rpc('sky',{type:'setup'});"
            "const apps=await nodeRepl.rpc('sky',{type:'execute',method:'list_apps',args:[]});"
            "let invalidMethod;try{await nodeRepl.rpc('sky',{type:'execute',"
            "method:'__missing_method__',args:[]})}catch(error){invalidMethod=String(error)};"
            "nodeRepl.write(JSON.stringify({target:setup.target,methods:setup.methods,"
            "apps:apps.map(app=>[app.id,app.isRunning]),invalidMethod}));"
        )
        response = request(process, 3, "tools/call", {"name": "js", "arguments": {"code": code}})
        if response.get("isError"):
            detail = next((item.get("text", "") for item in response.get("content", [])
                           if item.get("type") == "text"), "")
            raise RuntimeError(f"Sky service call failed: {detail[:160]}")
        text = next((item.get("text", "") for item in response.get("content", [])
                     if item.get("type") == "text" and item.get("text", "").startswith("{")), None)
        if text is None:
            raise RuntimeError("Sky service did not return a structured comparison payload")
        result = json.loads(text)
        if app_state is not None:
            # Do not emit or persist AX text, window titles, screenshots or native app data.
            state_code = (
                "let status;try{const value=await nodeRepl.rpc('sky',"
                "{type:'execute',method:'get_app_state',args:[{app:"
                + json.dumps(app_state)
                + "}]});status={ok:true,keys:Object.keys(value).sort(),"
                "hasState:typeof value.state==='string'};}"
                "catch(error){const message=String(error);"
                "status={ok:false,errorName:error?.name??'Error',"
                "errorClass:/nodeRepl\\.createElicitation/.test(message)?'missing-elicitation':"
                "/nodeRepl\\.withSuspendedTimeout/.test(message)?'missing-timeout':"
                "/permission|approval|authorize/i.test(message)?'approval':"
                "/policy/i.test(message)?'policy':'other'};}"
                "nodeRepl.write(JSON.stringify(status));"
            )
            state_response = request(process, 4, "tools/call", {
                "name": "js", "arguments": {"code": state_code},
            })
            if state_response.get("isError"):
                result["appState"] = {"ok": False, "errorName": "MCPToolError"}
            else:
                state_text = next((item.get("text", "") for item in state_response.get("content", [])
                                   if item.get("type") == "text" and item.get("text", "").startswith("{")), None)
                result["appState"] = json.loads(state_text) if state_text else {"ok": False, "errorName": "MissingResult"}
        return result
    finally:
        if process.poll() is None:
            os.killpg(process.pid, signal.SIGKILL)
        process.wait()


def digest(pairs):
    return hashlib.sha256(json.dumps(pairs, ensure_ascii=False, separators=(",", ":")).encode()).digest()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--plugin-config", required=True, type=Path)
    parser.add_argument("--read-app-state", help="Optional running app ID for read-only native AX acceptance")
    args = parser.parse_args()
    if sys.platform != "darwin":
        raise SystemExit("macOS required")
    config = json.loads(args.plugin_config.read_text())["mcpServers"]["cua_repl"]
    with tempfile.TemporaryDirectory(prefix="sky-service-acceptance-", dir=Path.home() / ".codex") as temporary:
        stage = Path(temporary)
        source = ROOT / "packages" / "sky"
        shutil.copy2(source / "package.json", stage / "package.json")
        shutil.copytree(source / "dist", stage / "dist")
        (stage / "node_modules").symlink_to(source / "node_modules", target_is_directory=True)
        original = run_variant(config, app_state=args.read_app_state)
        candidate = run_variant(config, stage / "dist" / "service.js", app_state=args.read_app_state)
    methods_equal = sorted(original["methods"]) == sorted(candidate["methods"])
    result = {
        "target_equal_mac": original["target"] == candidate["target"] == "mac",
        "method_count": len(candidate["methods"]),
        "methods_equal": methods_equal,
        "app_count": len(candidate["apps"]),
        "app_count_equal": len(original["apps"]) == len(candidate["apps"]),
        "app_records_typed": all(isinstance(row[0], str) and isinstance(row[1], bool)
                                 for row in candidate["apps"]),
        "ordered_app_state_equal": digest(original["apps"]) == digest(candidate["apps"]),
        "invalid_method_rejected_equally": (
            original.get("invalidMethod") == candidate.get("invalidMethod") and
            "__missing_method__" in str(candidate.get("invalidMethod"))
        ),
    }
    if args.read_app_state is not None:
        result["app_state_original_ok"] = original["appState"]["ok"]
        result["app_state_candidate_ok"] = candidate["appState"]["ok"]
        result["app_state_shape_equal"] = original["appState"] == candidate["appState"]
        if not original["appState"]["ok"]:
            result["app_state_original_error_class"] = original["appState"].get("errorClass", "unknown")
        if not candidate["appState"]["ok"]:
            result["app_state_candidate_error_class"] = candidate["appState"].get("errorClass", "unknown")
    print(json.dumps(result, sort_keys=True))
    if not all(value for key, value in result.items() if isinstance(value, bool)):
        raise SystemExit(1)


if __name__ == "__main__":
    main()
