"""WilliamOS Control Center — Command Runner.

Every CLI command goes through here. Checks safety first, then runs.
"""

import subprocess
import os
from pathlib import Path
from safety import check_command

PROJECT_ROOT = Path(__file__).resolve().parent.parent.parent
WILLIAM_PY = PROJECT_ROOT / "scripts" / "william.py"


def run_command(command: str, args: list[str] | None = None, confirmed: bool = False) -> dict:
    args = args or []
    safety = check_command(command, args)

    if not safety["allowed"]:
        return {"ok": False, "error": "blocked", "reason": safety["reason"]}

    if safety.get("confirm") and not confirmed:
        return {
            "ok": False,
            "error": "confirm_required",
            "reason": safety["confirm_reason"],
            "command": command,
            "args": args,
        }

    cmd = ["python", str(WILLIAM_PY), command] + args

    try:
        result = subprocess.run(
            cmd,
            capture_output=True,
            text=True,
            timeout=120,
            cwd=str(PROJECT_ROOT),
            env={**os.environ, "WILLIAMOS_VAULT": "WilliamOS"},
        )
        return {
            "ok": result.returncode == 0,
            "command": command,
            "args": args,
            "stdout": result.stdout.strip(),
            "stderr": result.stderr.strip(),
            "returncode": result.returncode,
        }
    except subprocess.TimeoutExpired:
        return {"ok": False, "error": "timeout", "command": command}
    except Exception as e:
        return {"ok": False, "error": "exception", "message": str(e)}


def run_safe(command: str, args: list[str] | None = None) -> dict:
    return run_command(command, args, confirmed=False)


def run_confirmed(command: str, args: list[str] | None = None) -> dict:
    return run_command(command, args, confirmed=True)


def run_snapshot_dry_run() -> dict:
    cmd = [
        "python", str(WILLIAM_PY),
        "snapshot", "--dry-run",
    ]
    try:
        result = subprocess.run(
            cmd,
            capture_output=True,
            text=True,
            timeout=30,
            cwd=str(PROJECT_ROOT),
            env={**os.environ, "WILLIAMOS_VAULT": "WilliamOS"},
        )
        return {
            "ok": result.returncode == 0,
            "stdout": result.stdout.strip(),
            "stderr": result.stderr.strip(),
            "returncode": result.returncode,
        }
    except subprocess.TimeoutExpired:
        return {"ok": False, "error": "timeout"}
    except Exception as e:
        return {"ok": False, "error": str(e)}


def run_acceptance(draft_path: str, dest: str) -> dict:
    cmd = [
        "python", str(WILLIAM_PY),
        "accept-draft",
        "--draft", draft_path,
        "--dest", dest,
        "--confirm",
    ]
    try:
        result = subprocess.run(
            cmd,
            capture_output=True,
            text=True,
            timeout=30,
            cwd=str(PROJECT_ROOT),
            env={**os.environ, "WILLIAMOS_VAULT": "WilliamOS"},
        )
        return {
            "ok": result.returncode == 0,
            "stdout": result.stdout.strip(),
            "stderr": result.stderr.strip(),
            "returncode": result.returncode,
        }
    except subprocess.TimeoutExpired:
        return {"ok": False, "error": "timeout"}
    except Exception as e:
        return {"ok": False, "error": str(e)}
