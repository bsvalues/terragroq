import base64
import os
import re
import subprocess
import sys


def main():
    encoded = os.environ.get("WILLIAMOS_QUERY_B64", "")
    if not encoded or len(encoded) > 100_000:
        raise SystemExit("HERMES_FREE_AGENT_QUERY_WALL")
    try:
        query = base64.b64decode(encoded, validate=True).decode("utf-8")
    except (ValueError, UnicodeDecodeError):
        raise SystemExit("HERMES_FREE_AGENT_QUERY_WALL")

    turns = os.environ.get("WILLIAMOS_MAX_TURNS", "")
    if not turns.isdigit() or not 1 <= int(turns) <= 20:
        raise SystemExit("HERMES_FREE_AGENT_TURN_WALL")

    command = [
        "hermes",
        "chat",
        "--query",
        query,
        "--model",
        "williamos-qwen3-4b:64k",
        "--toolsets",
        "file,terminal",
        "--max-turns",
        turns,
    ]

    # Owned-worktree mode only: continue the thread's previous kernel session (its state dir
    # is mounted as HERMES_HOME by the agent-owned service). The id was captured by WilliamOS
    # from the previous run's "Session:" line and validated by the invoker; re-validate here.
    resume = os.environ.get("WILLIAMOS_RESUME_SESSION", "")
    if resume:
        if not re.fullmatch(r"[A-Za-z0-9_-]{4,64}", resume):
            raise SystemExit("HERMES_FREE_AGENT_SESSION_ID_WALL")
        command.extend(["--resume", resume])
    raise SystemExit(subprocess.run(command, check=False).returncode)


if __name__ == "__main__":
    main()
