"""Small MCP stdio request helper for isolated macOS acceptance scripts."""

import json
import select
import time


def request(process, request_id, method, params):
    message = {"jsonrpc": "2.0", "id": request_id, "method": method, "params": params}
    process.stdin.write((json.dumps(message) + "\n").encode())
    process.stdin.flush()
    deadline = time.monotonic() + 30
    while time.monotonic() < deadline:
        ready, _, _ = select.select([process.stdout], [], [], min(1, deadline - time.monotonic()))
        if not ready:
            continue
        line = process.stdout.readline()
        if not line:
            raise RuntimeError(f"{method}: host exited before responding")
        response = json.loads(line)
        if response.get("id") == request_id:
            if "error" in response:
                raise RuntimeError(f"{method}: {response['error']}")
            return response["result"]
    raise TimeoutError(f"{method}: host did not respond within 30 seconds")
