"""WilliamOS Runtime Smoke Suite.

Runs safe versions of all status/check commands to prove the runtime works.
No destructive actions. Never modifies source notes.
"""

import json
import os
import subprocess
import sys
from datetime import datetime
from pathlib import Path

VAULT = Path(os.environ.get("WILLIAMOS_VAULT", "WilliamOS"))
TZ_NAME = os.environ.get("WILLIAMOS_TZ", "America/Los_Angeles")

SMOKE_DIR = VAULT / "105_RuntimeSmoke"
REPORTS_DIR = SMOKE_DIR / "reports"
DATA_DIR = SMOKE_DIR / "data"

SMOKE_COMMANDS = [
    {"name": "check", "cmd": ["python", "scripts/william.py", "check"], "critical": True},
    {"name": "mcp-check", "cmd": ["python", "scripts/william.py", "mcp-check"], "critical": False},
    {"name": "git-status", "cmd": ["python", "scripts/william.py", "git-status"], "critical": True},
    {"name": "semantic-status", "cmd": ["python", "scripts/william.py", "semantic-status"], "critical": False},
    {"name": "synth-status", "cmd": ["python", "scripts/william.py", "synth-status"], "critical": False},
    {"name": "inbox-status", "cmd": ["python", "scripts/william.py", "inbox-status"], "critical": False},
    {"name": "doctrine-status", "cmd": ["python", "scripts/william.py", "doctrine-status"], "critical": False},
    {"name": "decision-status", "cmd": ["python", "scripts/william.py", "decision-status"], "critical": False},
    {"name": "concept-status", "cmd": ["python", "scripts/william.py", "concept-status"], "critical": False},
    {"name": "project-status", "cmd": ["python", "scripts/william.py", "project-status"], "critical": False},
    {"name": "cortex-status", "cmd": ["python", "scripts/william.py", "cortex-status"], "critical": False},
    {"name": "cockpit-status", "cmd": ["python", "scripts/william.py", "cockpit-status"], "critical": False},
    {"name": "routine-status", "cmd": ["python", "scripts/william.py", "routine-status"], "critical": False},
    {"name": "review-status", "cmd": ["python", "scripts/william.py", "review-status"], "critical": False},
    {"name": "accept-status", "cmd": ["python", "scripts/william.py", "accept-status"], "critical": False},
    {"name": "closure-status", "cmd": ["python", "scripts/william.py", "closure-status"], "critical": False},
    {"name": "maintenance-status", "cmd": ["python", "scripts/william.py", "maintenance-status"], "critical": False},
    {"name": "backup-status", "cmd": ["python", "scripts/william.py", "backup-status"], "critical": True},
    {"name": "restore-status", "cmd": ["python", "scripts/william.py", "restore-status"], "critical": False},
    {"name": "remote-status", "cmd": ["python", "scripts/william.py", "remote-status"], "critical": False},
    {"name": "release-status", "cmd": ["python", "scripts/william.py", "release-status"], "critical": False},
    {"name": "drive-backup-status", "cmd": ["python", "scripts/william.py", "drive-backup-status"], "critical": False},
    {"name": "obsidian-status", "cmd": ["python", "scripts/william.py", "obsidian-status"], "critical": False},
    {"name": "schema-status", "cmd": ["python", "scripts/william.py", "schema-status"], "critical": False},
    {"name": "schema-check", "cmd": ["python", "scripts/william.py", "schema-check"], "critical": True},
    {"name": "command-status", "cmd": ["python", "scripts/william.py", "command-status"], "critical": False},
    {"name": "orphans", "cmd": ["python", "scripts/william.py", "orphans"], "critical": False},
    {"name": "stale-decisions", "cmd": ["python", "scripts/william.py", "stale-decisions"], "critical": False},
    {"name": "copilot-health", "cmd": None, "critical": False, "info": True},
]


def _tz():
    try:
        from zoneinfo import ZoneInfo
        return ZoneInfo(TZ_NAME)
    except Exception:
        return None


def _now():
    tz = _tz()
    return datetime.now(tz) if tz else datetime.now()


def _now_iso():
    return _now().strftime("%Y-%m-%d %H:%M:%S")


def _today_iso():
    return _now().strftime("%Y-%m-%d")


def _ensure_dirs():
    REPORTS_DIR.mkdir(parents=True, exist_ok=True)
    DATA_DIR.mkdir(parents=True, exist_ok=True)


def _run_copilot_health() -> tuple[bool, str]:
    """Inline check: import llm.health() from the copilot backend and call it.

    Adds the backend dir to sys.path temporarily (scoped to this function) so
    the import works regardless of cwd.  Never raises — all exceptions are
    caught and reported as a non-critical failure.
    """
    backend_dir = str(Path(__file__).resolve().parent.parent / "control-center" / "backend")
    _inserted = False
    try:
        if backend_dir not in sys.path:
            sys.path.insert(0, backend_dir)
            _inserted = True
        from copilot import llm  # noqa: PLC0415
        result = llm.health()
        ok: bool = bool(result.get("ok", False))
        detail: str = result.get("detail", "")
        runtime = result.get("runtime_label") or result.get("runtime") or "local runtime"
        policy = result.get("policy", "explicit-runtime-only")
        return ok, f"runtime={runtime} model={result.get('model', '?')} policy={policy} detail={detail}"
    except Exception as exc:  # network down, import error, anything
        return False, str(exc)[:300]
    finally:
        if _inserted and backend_dir in sys.path:
            sys.path.remove(backend_dir)


def run_smoke(dry_run=False):
    results = []
    pass_count = 0
    fail_count = 0
    critical_fail = 0

    for sc in SMOKE_COMMANDS:
        if dry_run:
            results.append({
                "name": sc["name"],
                "critical": sc["critical"],
                "status": "skip (dry run)",
                "exit_code": None,
                "output": "",
            })
            pass_count += 1
            continue

        # --- inline (Python-native) checks ---
        if sc["cmd"] is None:
            if sc["name"] == "copilot-health":
                passed, output = _run_copilot_health()
            else:
                passed, output = False, f"no handler for inline check '{sc['name']}'"
            is_info = sc.get("info", False)
            results.append({
                "name": sc["name"],
                "critical": sc["critical"],
                "info": is_info,
                "status": ("ok" if passed else "offline") + " (informational)" if is_info else ("PASS" if passed else "FAIL"),
                "exit_code": 0 if passed else 1,
                "output": output,
            })
            if not is_info:
                if passed:
                    pass_count += 1
                else:
                    fail_count += 1
                    if sc["critical"]:
                        critical_fail += 1
            continue

        try:
            proc = subprocess.run(
                sc["cmd"],
                capture_output=True, text=True, timeout=60,
            )
            passed = proc.returncode == 0
            results.append({
                "name": sc["name"],
                "critical": sc["critical"],
                "status": "PASS" if passed else "FAIL",
                "exit_code": proc.returncode,
                "output": (proc.stdout[:500] if proc.stdout else "") + (proc.stderr[:200] if proc.stderr else ""),
            })
            if passed:
                pass_count += 1
            else:
                fail_count += 1
                if sc["critical"]:
                    critical_fail += 1
        except subprocess.TimeoutExpired:
            results.append({
                "name": sc["name"],
                "critical": sc["critical"],
                "status": "TIMEOUT",
                "exit_code": -1,
                "output": "Command timed out after 60s",
            })
            fail_count += 1
            if sc["critical"]:
                critical_fail += 1
        except Exception as e:
            results.append({
                "name": sc["name"],
                "critical": sc["critical"],
                "status": "ERROR",
                "exit_code": -1,
                "output": str(e)[:200],
            })
            fail_count += 1
            if sc["critical"]:
                critical_fail += 1

    overall = "PASS" if critical_fail == 0 and fail_count == 0 else ("WARN" if critical_fail == 0 else "FAIL")

    core_count = sum(1 for sc in SMOKE_COMMANDS if not sc.get("info", False))
    summary = {
        "date": _today_iso(),
        "total": core_count,
        "pass": pass_count,
        "fail": fail_count,
        "critical_fail": critical_fail,
        "overall": overall,
        "results": results,
        "dry_run": dry_run,
    }

    if not dry_run:
        _ensure_dirs()

        lines = []
        lines.append("---")
        lines.append("type: smoke-report")
        lines.append("status: draft")
        lines.append(f"generated: \"{_now_iso()}\"")
        lines.append("tags:")
        lines.append("  - smoke")
        lines.append("  - runtime")
        lines.append("  - generated")
        lines.append("---")
        lines.append("")
        lines.append(f"# Runtime Smoke Report - {_today_iso()}")
        lines.append("")
        lines.append(f"## Result: {overall}")
        lines.append("")
        lines.append(f"- Commands tested: {core_count} (core) + {len(SMOKE_COMMANDS) - core_count} informational")
        lines.append(f"- Pass: {pass_count}")
        lines.append(f"- Fail: {fail_count}")
        lines.append(f"- Critical failures: {critical_fail}")
        lines.append("")
        lines.append("## Results")
        lines.append("")
        lines.append("| Command | Critical | Status |")
        lines.append("|---------|----------|--------|")
        for r in results:
            crit = "YES" if r["critical"] else "—"
            lines.append(f"| {r['name']} | {crit} | {r['status']} |")
        lines.append("")

        if fail_count > 0:
            lines.append("## Failures")
            lines.append("")
            for r in results:
                if r["status"] not in ("PASS", "skip (dry run)"):
                    lines.append(f"### {r['name']}")
                    lines.append(f"```\n{r['output'][:300]}\n```")
                    lines.append("")

        lines.append("## Generator Notes")
        lines.append("")
        lines.append("This report was generated by WilliamOS. No notes were modified.")
        lines.append("")

        report_path = REPORTS_DIR / f"Runtime Smoke - {_today_iso()}.md"
        report_path.write_text("\n".join(lines), encoding="utf-8")
        summary["report_path"] = str(report_path)

        json_path = DATA_DIR / f"smoke-{_today_iso()}.json"
        json_path.write_text(json.dumps(summary, indent=2, default=str), encoding="utf-8")
        summary["json_path"] = str(json_path)

    return summary


def runtime_status():
    latest_report = None
    if REPORTS_DIR.exists():
        reports = sorted(REPORTS_DIR.glob("Runtime Smoke - *.md"))
        if reports:
            latest_report = reports[-1].name
    return {
        "smoke_dir_exists": SMOKE_DIR.exists(),
        "docs_exist": all((SMOKE_DIR / d).exists() for d in ["README.md", "SMOKE_POLICY.md"]),
        "smoke_commands": sum(1 for c in SMOKE_COMMANDS if not c.get("info", False)),
        "critical_commands": sum(1 for c in SMOKE_COMMANDS if c["critical"] and not c.get("info", False)),
        "latest_report": latest_report,
    }
