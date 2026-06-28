"""WilliamOS Production Readiness Gate.

Aggregates results from all subsystems into a single PASS/FAIL verdict.
Never modifies source notes. Read-only checks only.
"""

import json
import os
import subprocess
from datetime import datetime
from pathlib import Path

VAULT = Path(os.environ.get("WILLIAMOS_VAULT", "WilliamOS"))
TZ_NAME = os.environ.get("WILLIAMOS_TZ", "America/Los_Angeles")

PROD_DIR = VAULT / "106_ProductionReadiness"
REPORTS_DIR = PROD_DIR / "reports"
DATA_DIR = PROD_DIR / "data"

PROD_REQUIRED_DOCS = [
    "106_ProductionReadiness/README.md",
    "106_ProductionReadiness/PRODUCTION_POLICY.md",
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


def _run_cmd(cmd, timeout=60):
    try:
        r = subprocess.run(cmd, capture_output=True, text=True, timeout=timeout)
        return r.returncode == 0, r.stdout.strip()[:5000], r.stderr.strip()[:1000]
    except subprocess.TimeoutExpired:
        return False, "", "Timed out"
    except Exception as e:
        return False, "", str(e)[:200]


def check_global_governance():
    ok, out, err = _run_cmd(["python", "scripts/william.py", "check"])
    return {"name": "global-governance", "passed": ok, "detail": out if ok else err}


def check_smoke_suite():
    from williamos_smoke import run_smoke
    result = run_smoke()
    return {
        "name": "runtime-smoke",
        "passed": result["critical_fail"] == 0,
        "overall": result["overall"],
        "total": result["total"],
        "pass_count": result["pass"],
        "fail_count": result["fail"],
        "critical_fail": result["critical_fail"],
        "detail": f"{result['pass']}/{result['total']} pass, {result['critical_fail']} critical fail",
    }


def check_control_center_smoke():
    ok, out, err = _run_cmd(["python", "scripts/william.py", "control-center-smoke"], timeout=90)
    if ok and "Smoke: PASS (22/22)" in out:
        return {"name": "control-center-smoke", "passed": True, "detail": "22/22 PASS"}
    detail = out or err or "control-center-smoke did not report 22/22 PASS"
    if ok and "Smoke: PASS" in out:
        detail = f"expected 22/22 Control Center smoke including DevOps checks; got {out.splitlines()[-1].strip()}"
    return {"name": "control-center-smoke", "passed": False, "detail": detail[:200]}


def check_restore_proof():
    proof_dir = VAULT / "93_RestoreDrill" / "proofs"
    if not proof_dir.exists():
        return {"name": "restore-proof", "passed": False, "detail": "No proofs directory"}

    proofs = sorted(proof_dir.glob("Runtime Proof - *.md"), reverse=True)
    if not proofs:
        return {"name": "restore-proof", "passed": False, "detail": "No runtime proof reports found"}

    latest = proofs[0]
    content = latest.read_text(encoding="utf-8")
    has_high = "**Confidence: HIGH**" in content
    has_medium = "**Confidence: MEDIUM**" in content
    passed = has_high or has_medium
    confidence = "HIGH" if has_high else ("MEDIUM" if has_medium else "LOW/UNKNOWN")

    return {
        "name": "restore-proof",
        "passed": passed,
        "detail": f"Latest: {latest.name}, confidence: {confidence}",
    }


def check_schema_validation():
    from williamos_schema import schema_check
    result = schema_check()
    passed = result["pass"]
    issues = result.get("issues", [])
    detail = f"all valid ({result['schema_count']} schemas, {result['template_checks']} templates)" if passed else f"{len(issues)} issues"
    return {"name": "schema-check", "passed": passed, "detail": detail}


def check_command_registry():
    from williamos_commands import all_commands, count_cli_commands
    registry = len(all_commands())
    cli = count_cli_commands()
    passed = registry == cli and registry > 0
    return {
        "name": "command-registry",
        "passed": passed,
        "detail": f"registry={registry}, cli={cli}, match={'yes' if passed else 'NO'}",
    }


def check_backup_exists():
    backup_dir = VAULT / "92_BackupGovernance" / "local_archives"
    if not backup_dir.exists():
        return {"name": "backup-archive", "passed": False, "detail": "No local_archives directory"}

    zips = sorted(backup_dir.glob("WilliamOS-backup-*.zip"), reverse=True)
    if not zips:
        return {"name": "backup-archive", "passed": False, "detail": "No backup archives found"}

    return {
        "name": "backup-archive",
        "passed": True,
        "detail": f"{len(zips)} archives, latest: {zips[0].name}",
    }


def check_git_safety():
    ok, out, err = _run_cmd(["python", "scripts/william.py", "git-status"])
    has_remote = False
    if ok and out:
        for line in out.split("\n"):
            if "remote" in line.lower() and "none" not in line.lower():
                has_remote = True
    no_remote_check = not has_remote
    return {
        "name": "git-safety",
        "passed": ok and no_remote_check,
        "detail": "no remote, local only" if (ok and no_remote_check) else (err if not ok else "remote detected"),
    }


def check_required_docs():
    all_doc_lists = []
    try:
        # Import all doc lists from william.py constants
        import importlib.util
        spec = importlib.util.spec_from_file_location("william", "scripts/william.py")
        mod = importlib.util.module_from_spec(spec)
        # Don't fully execute william.py, just check the files directly
    except Exception:
        pass

    governance_folders = [
        "91_GitGovernance", "92_BackupGovernance", "93_RestoreDrill",
        "94_PrivateRemoteStrategy", "95_ReleaseGovernance", "96_OperatingRoutine",
        "97_HumanReviewQueues", "98_OfficialAcceptance", "99_PostAcceptanceClosure",
        "100_MaintenanceRelease", "101_ExternalDriveBackup", "102_ObsidianWorkspace",
        "103_SchemaRegistry", "104_CommandRegistry", "105_RuntimeSmoke",
        "106_ProductionReadiness",
    ]
    missing = []
    for folder in governance_folders:
        readme = VAULT / folder / "README.md"
        if not readme.exists():
            missing.append(f"{folder}/README.md")

    passed = len(missing) == 0
    detail = "all present" if passed else f"{len(missing)} missing: {', '.join(missing[:3])}"
    return {"name": "required-docs", "passed": passed, "detail": detail}


def check_no_forbidden_files():
    forbidden_patterns = [".env", "*.pem", "*.key", "*.p12", "*.pfx", "id_rsa", "id_ed25519"]
    # Tooling / git-ignored directories are not vault content; scanning them
    # surfaces false positives (e.g. certifi's bundled cacert.pem inside .venv).
    # This mirrors the git-level forbidden-file check, which only sees tracked files.
    IGNORED_DIR_PARTS = (".git", ".venv", "site-packages", "node_modules", "__pycache__")

    def _ignored(p):
        return any(part in IGNORED_DIR_PARTS for part in p.parts)

    found = []
    root = Path(".")
    for pat in [".env", ".env.*"]:
        for p in root.glob(pat):
            if p.is_file():
                found.append(str(p))
    for ext in ["*.pem", "*.key", "*.p12", "*.pfx"]:
        for p in root.rglob(ext):
            if p.is_file() and not _ignored(p):
                found.append(str(p))
    for name in ["id_rsa", "id_ed25519"]:
        p = root / name
        if p.exists():
            found.append(str(p))

    passed = len(found) == 0
    detail = "none found" if passed else f"{len(found)} forbidden: {', '.join(found[:3])}"
    return {"name": "no-forbidden-files", "passed": passed, "detail": detail}


def run_production_readiness():
    checks = [
        check_global_governance(),
        check_smoke_suite(),
        check_control_center_smoke(),
        check_restore_proof(),
        check_schema_validation(),
        check_command_registry(),
        check_backup_exists(),
        check_git_safety(),
        check_required_docs(),
        check_no_forbidden_files(),
    ]

    all_passed = all(c["passed"] for c in checks)

    if all_passed:
        verdict = "PASS"
    else:
        verdict = "FAIL"

    summary = {
        "date": _today_iso(),
        "verdict": verdict,
        "checks": checks,
        "total": len(checks),
        "passed": sum(1 for c in checks if c["passed"]),
        "failed": sum(1 for c in checks if not c["passed"]),
    }

    _ensure_dirs()

    lines = []
    lines.append("---")
    lines.append("type: production-readiness-report")
    lines.append("status: draft")
    lines.append(f"generated: \"{_now_iso()}\"")
    lines.append("tags:")
    lines.append("  - production")
    lines.append("  - readiness")
    lines.append("  - generated")
    lines.append("---")
    lines.append("")
    lines.append(f"# Production Readiness Report - {_today_iso()}")
    lines.append("")
    lines.append(f"## Verdict: {verdict}")
    lines.append("")
    lines.append(f"- Checks run: {len(checks)}")
    lines.append(f"- Passed: {summary['passed']}")
    lines.append(f"- Failed: {summary['failed']}")
    lines.append("")
    lines.append("## Gate Results")
    lines.append("")
    lines.append("| # | Check | Result | Detail |")
    lines.append("|---|-------|--------|--------|")
    for i, c in enumerate(checks, 1):
        status = "PASS" if c["passed"] else "FAIL"
        detail = c.get("detail", "")[:80]
        lines.append(f"| {i} | {c['name']} | {status} | {detail} |")
    lines.append("")

    failed_checks = [c for c in checks if not c["passed"]]
    if failed_checks:
        lines.append("## Failures")
        lines.append("")
        for c in failed_checks:
            lines.append(f"### {c['name']}")
            lines.append(f"{c.get('detail', 'No detail')}")
            lines.append("")

    lines.append("## Production Readiness Statement")
    lines.append("")
    if verdict == "PASS":
        lines.append("All gate criteria met. WilliamOS is ready for production tagging.")
    elif verdict == "WARN":
        lines.append("All blocking criteria met. Non-critical smoke failures present. Proceed with caution.")
    else:
        lines.append("Gate criteria NOT met. Do not proceed with production tagging until all failures are resolved.")
    lines.append("")

    lines.append("## Generator Notes")
    lines.append("")
    lines.append("This report was generated by WilliamOS. No notes were modified.")
    lines.append("")

    report_path = REPORTS_DIR / f"Production Readiness - {_today_iso()}.md"
    report_path.write_text("\n".join(lines), encoding="utf-8")
    summary["report_path"] = str(report_path)

    json_path = DATA_DIR / f"production-readiness-{_today_iso()}.json"
    json_path.write_text(json.dumps(summary, indent=2, default=str), encoding="utf-8")
    summary["json_path"] = str(json_path)

    return summary


def production_status():
    latest_report = None
    if REPORTS_DIR.exists():
        reports = sorted(REPORTS_DIR.glob("Production Readiness - *.md"))
        if reports:
            latest_report = reports[-1].name
    return {
        "prod_dir_exists": PROD_DIR.exists(),
        "docs_exist": all((VAULT / d).exists() for d in PROD_REQUIRED_DOCS),
        "latest_report": latest_report,
    }
