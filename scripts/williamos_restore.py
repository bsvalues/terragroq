"""WilliamOS restore drill engine.

Extracts a backup archive to a temporary location, runs health checks
on the restored copy, generates a restore drill report, and cleans up.

Local-first. Never overwrites the live repo. Never modifies source notes.
"""
from __future__ import annotations

import datetime as dt
import hashlib
import os
import shutil
import subprocess
import zipfile
from fnmatch import fnmatch
from pathlib import Path
from typing import Any
from zoneinfo import ZoneInfo

VAULT = Path(os.environ.get("WILLIAMOS_VAULT", "WilliamOS"))
RESTORE_DIR = VAULT / "93_RestoreDrill"
REPORTS_DIR = RESTORE_DIR / "reports"
MANIFEST_PATH = RESTORE_DIR / "RESTORE_MANIFEST.md"

RESTORE_REQUIRED_DOCS = [
    "93_RestoreDrill/README.md",
    "93_RestoreDrill/RESTORE_DRILL_POLICY.md",
    "93_RestoreDrill/RESTORE_CHECKS.md",
    "93_RestoreDrill/DISASTER_RECOVERY_PLAYBOOK.md",
]

REQUIRED_RESTORED_FILES = [
    "README.md",
    "PACKAGE_MANIFEST.md",
    "scripts/william.py",
    ".gitignore",
]

REQUIRED_RESTORED_DIRS = [
    "WilliamOS",
    ".git",
]

FORBIDDEN_PATTERNS = [
    ".env", "*.env", ".env.*",
    "*.pem", "*.key", "*.p12", "*.pfx",
    "id_rsa", "id_ed25519",
    "secrets.*", "token.*", "credentials.*",
]

FORBIDDEN_DIR_PREFIXES = [
    ".venv/", "venv/", "node_modules/",
    ".obsidian/cache/",
    "WilliamOS/40_Search/generated/vectors.npy",
    "WilliamOS/40_Search/generated/tfidf.joblib",
]

FORBIDDEN_WORKSPACE_PREFIXES = [
    ".obsidian/workspace",
]

SUSPICIOUS_NAME_PARTS = [
    "secret", "token", "credential", "password",
    "apikey", "api_key", "private_key",
]

HEALTH_CHECK_COMMANDS = [
    ("check", ["python", "scripts/william.py", "check"]),
    ("git-status", ["python", "scripts/william.py", "git-status"]),
    ("backup-status", ["python", "scripts/william.py", "backup-status"]),
    ("cockpit-status", ["python", "scripts/william.py", "cockpit-status"]),
]


def _local_now() -> dt.datetime:
    tz_name = os.environ.get("WILLIAMOS_TZ", "America/Los_Angeles")
    return dt.datetime.now(ZoneInfo(tz_name))


def _local_today() -> dt.date:
    return _local_now().date()


def _is_forbidden_name(name: str) -> bool:
    for pat in FORBIDDEN_PATTERNS:
        if fnmatch(name, pat):
            return True
    return False


def _is_forbidden_path(rel: str) -> bool:
    norm = rel.replace("\\", "/")
    name = Path(norm).name

    if _is_forbidden_name(name):
        return True

    for prefix in FORBIDDEN_DIR_PREFIXES:
        if norm == prefix.rstrip("/") or norm.startswith(prefix):
            return True

    for wp in FORBIDDEN_WORKSPACE_PREFIXES:
        if norm == wp or norm.startswith(wp):
            return True

    return False


def _is_suspicious_name(name: str) -> bool:
    lower = name.lower()
    for part in SUSPICIOUS_NAME_PARTS:
        if part in lower:
            return True
    return False


def detect_live_repo_path() -> Path:
    return Path.cwd().resolve()


def verify_archive_checksum(archive_path: Path) -> dict[str, Any]:
    checksum_path = archive_path.parent / f"{archive_path.name}.sha256"
    if not checksum_path.exists():
        return {"verified": None, "message": "No .sha256 file found"}

    expected_line = checksum_path.read_text(encoding="utf-8").strip()
    expected_hash = expected_line.split()[0] if expected_line else ""

    sha256 = hashlib.sha256()
    with open(archive_path, "rb") as fh:
        for chunk in iter(lambda: fh.read(8192), b""):
            sha256.update(chunk)
    actual_hash = sha256.hexdigest()

    if actual_hash == expected_hash:
        return {"verified": True, "message": "Checksum matches", "hash": actual_hash}
    return {"verified": False, "message": f"Checksum mismatch: expected {expected_hash}, got {actual_hash}"}


VAULT_SCAFFOLD_DIRS = [
    "00_Inbox", "01_Daily", "02_Decisions", "03_Doctrine", "04_Appraisal",
    "05_Assessor_Office", "06_TerraFusion_Strategy", "07_Learning", "08_People",
    "09_Cases", "10_Ideas", "11_Projects", "12_Maps", "13_Templates",
    "20_Graphify", "30_MCP", "40_Scripts", "40_Search", "50_Dashboards",
    "60_Synthesis", "70_InboxProcessor", "80_DoctrinePromotion",
    "85_DecisionPromotion", "86_ConceptPromotion", "87_ProjectPromotion",
    "88_CortexMap", "89_ReviewCockpit", "91_GitGovernance",
    "92_BackupGovernance", "93_RestoreDrill", "94_PrivateRemoteStrategy",
    "95_ReleaseGovernance", "96_OperatingRoutine", "97_HumanReviewQueues",
    "98_OfficialAcceptance", "99_PostAcceptanceClosure", "100_MaintenanceRelease",
    "101_ExternalDriveBackup", "102_ObsidianWorkspace", "103_SchemaRegistry",
    "104_CommandRegistry", "105_RuntimeSmoke", "106_ProductionReadiness",
    "90_Exports", "99_Archive",
]


def safe_extract_archive(archive_path: Path, dest: Path) -> dict[str, Any]:
    try:
        with zipfile.ZipFile(archive_path, "r") as zf:
            zf.extractall(dest)
            file_count = len(zf.namelist())
    except zipfile.BadZipFile:
        return {"extracted": False, "error": "bad_zip", "message": "Corrupt or unreadable zip"}
    except Exception as e:
        return {"extracted": False, "error": "extract_failed", "message": str(e)}

    vault_name = os.environ.get("WILLIAMOS_VAULT", "WilliamOS")
    vault_dir = dest / vault_name
    if vault_dir.exists():
        for d in VAULT_SCAFFOLD_DIRS:
            (vault_dir / d).mkdir(parents=True, exist_ok=True)

    return {"extracted": True, "file_count": file_count}


def check_required_files(dest: Path) -> dict[str, Any]:
    missing_files = []
    for f in REQUIRED_RESTORED_FILES:
        if not (dest / f).exists():
            missing_files.append(f)

    missing_dirs = []
    for d in REQUIRED_RESTORED_DIRS:
        if not (dest / d).exists():
            missing_dirs.append(d)

    return {
        "passed": len(missing_files) == 0 and len(missing_dirs) == 0,
        "missing_files": missing_files,
        "missing_dirs": missing_dirs,
    }


def check_forbidden_files(dest: Path) -> dict[str, Any]:
    forbidden = []
    suspicious = []

    for p in sorted(dest.rglob("*")):
        if not p.is_file():
            continue
        rel = str(p.relative_to(dest)).replace("\\", "/")
        name = Path(rel).name

        if _is_forbidden_path(rel):
            forbidden.append(rel)
        elif _is_suspicious_name(name):
            suspicious.append(rel)

    return {
        "passed": len(forbidden) == 0,
        "forbidden": forbidden,
        "suspicious": suspicious,
    }


def verify_git_history(dest: Path) -> dict[str, Any]:
    git_dir = dest / ".git"
    if not git_dir.exists():
        return {"present": False, "message": "No .git directory found"}

    r = subprocess.run(
        ["git", "log", "--oneline", "-1"],
        capture_output=True, text=True, cwd=str(dest),
    )
    if r.returncode == 0 and r.stdout.strip():
        return {"present": True, "latest_commit": r.stdout.strip()}
    return {"present": True, "latest_commit": "(unable to read log)"}


def run_restored_command(dest: Path, label: str, cmd: list[str]) -> dict[str, Any]:
    try:
        r = subprocess.run(
            cmd, capture_output=True, text=True, cwd=str(dest), timeout=30,
        )
        return {
            "label": label,
            "passed": r.returncode == 0,
            "returncode": r.returncode,
            "stdout": r.stdout.strip()[:500],
            "stderr": r.stderr.strip()[:500],
        }
    except subprocess.TimeoutExpired:
        return {"label": label, "passed": False, "returncode": -1, "stdout": "", "stderr": "Timeout after 30s"}
    except FileNotFoundError:
        return {"label": label, "passed": False, "returncode": -1, "stdout": "", "stderr": "Python not found"}


def run_restore_health_checks(dest: Path) -> list[dict[str, Any]]:
    results = []
    for label, cmd in HEALTH_CHECK_COMMANDS:
        results.append(run_restored_command(dest, label, cmd))
    return results


def run_restored_smoke_suite(dest: Path) -> dict[str, Any]:
    """Run the full runtime smoke suite inside a restored copy."""
    from williamos_smoke import SMOKE_COMMANDS

    results = []
    pass_count = 0
    fail_count = 0
    critical_fail = 0

    for sc in SMOKE_COMMANDS:
        try:
            r = subprocess.run(
                sc["cmd"], capture_output=True, text=True,
                cwd=str(dest), timeout=60,
            )
            passed = r.returncode == 0
            results.append({
                "name": sc["name"],
                "critical": sc["critical"],
                "status": "PASS" if passed else "FAIL",
                "exit_code": r.returncode,
                "output": (r.stdout[:300] if r.stdout else "") + (r.stderr[:200] if r.stderr else ""),
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
                "output": "Timed out after 60s",
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

    return {
        "total": len(SMOKE_COMMANDS),
        "pass": pass_count,
        "fail": fail_count,
        "critical_fail": critical_fail,
        "overall": overall,
        "results": results,
    }


def cleanup_restore_folder(dest: Path) -> dict[str, Any]:
    if not dest.exists():
        return {"cleaned": True, "message": "Destination already removed"}
    try:
        shutil.rmtree(dest)
        return {"cleaned": True, "message": f"Removed {dest}"}
    except Exception as e:
        return {"cleaned": False, "message": f"Cleanup failed: {e}"}


def run_restore_drill(
    archive_path: str,
    dest: str,
    keep: bool = False,
) -> dict[str, Any]:
    ap = Path(archive_path).resolve()
    dp = Path(dest).resolve()
    live = detect_live_repo_path()

    if not ap.exists():
        return {"error": "archive_not_found", "message": f"Archive not found: {archive_path}"}

    if not ap.suffix == ".zip":
        return {"error": "not_zip", "message": f"Not a zip file: {archive_path}"}

    if dp == live or str(dp).startswith(str(live) + os.sep):
        return {"error": "dest_is_live", "message": f"Destination is inside the live repo: {dest}. Use a path outside the project."}

    if dp.exists() and any(dp.iterdir()):
        return {"error": "dest_not_empty", "message": f"Destination is not empty: {dest}. Use an empty or non-existent folder."}

    dp.mkdir(parents=True, exist_ok=True)

    checksum_result = verify_archive_checksum(ap)
    extract_result = safe_extract_archive(ap, dp)

    if not extract_result.get("extracted"):
        cleanup_restore_folder(dp)
        return {
            "error": "extract_failed",
            "message": extract_result.get("message", "Extraction failed"),
            "checksum": checksum_result,
        }

    required_result = check_required_files(dp)
    forbidden_result = check_forbidden_files(dp)
    git_result = verify_git_history(dp)
    health_results = run_restore_health_checks(dp)

    health_all_passed = all(h["passed"] for h in health_results)

    overall_passed = (
        required_result["passed"]
        and forbidden_result["passed"]
        and git_result["present"]
        and health_all_passed
        and (checksum_result.get("verified") is None or checksum_result["verified"])
    )

    if overall_passed:
        confidence = "HIGH"
    elif required_result["passed"] and git_result["present"]:
        confidence = "MEDIUM"
    else:
        confidence = "LOW"

    cleanup_result = {"cleaned": False, "message": "Kept for inspection"} if keep else cleanup_restore_folder(dp)

    today = _local_today().isoformat()
    report = _generate_restore_report(
        today=today,
        archive_name=ap.name,
        archive_path=str(ap),
        dest_path=str(dp),
        checksum=checksum_result,
        extract=extract_result,
        required=required_result,
        forbidden=forbidden_result,
        git=git_result,
        health=health_results,
        cleanup=cleanup_result,
        confidence=confidence,
        keep=keep,
    )

    REPORTS_DIR.mkdir(parents=True, exist_ok=True)
    report_path = REPORTS_DIR / f"Restore Drill - {today}.md"
    report_path.write_text(report, encoding="utf-8")

    write_restore_manifest(
        archive_name=ap.name,
        dest_path=str(dp),
        checksum=checksum_result,
        git=git_result,
        health=health_results,
        forbidden=forbidden_result,
        cleanup=cleanup_result,
        confidence=confidence,
    )

    return {
        "passed": overall_passed,
        "confidence": confidence,
        "archive": str(ap),
        "dest": str(dp),
        "checksum": checksum_result,
        "extracted_files": extract_result.get("file_count", 0),
        "required_files": required_result,
        "forbidden_files": forbidden_result,
        "git_history": git_result,
        "health_checks": health_results,
        "cleanup": cleanup_result,
        "report_path": str(report_path),
        "manifest_path": str(MANIFEST_PATH),
        "keep": keep,
    }


PROOF_DIR = RESTORE_DIR / "proofs"


def run_runtime_proof(
    archive_path: str,
    dest: str,
    keep: bool = False,
) -> dict[str, Any]:
    """Full runtime proof: restore + smoke suite + verification."""
    ap = Path(archive_path).resolve()
    dp = Path(dest).resolve()
    live = detect_live_repo_path()

    if not ap.exists():
        return {"error": "archive_not_found", "message": f"Archive not found: {archive_path}"}
    if not ap.suffix == ".zip":
        return {"error": "not_zip", "message": f"Not a zip file: {archive_path}"}
    if dp == live or str(dp).startswith(str(live) + os.sep):
        return {"error": "dest_is_live", "message": f"Destination is inside the live repo: {dest}. Use a path outside the project."}
    if dp.exists() and any(dp.iterdir()):
        return {"error": "dest_not_empty", "message": f"Destination is not empty: {dest}. Use an empty or non-existent folder."}

    dp.mkdir(parents=True, exist_ok=True)

    checksum_result = verify_archive_checksum(ap)
    extract_result = safe_extract_archive(ap, dp)

    if not extract_result.get("extracted"):
        cleanup_restore_folder(dp)
        return {
            "error": "extract_failed",
            "message": extract_result.get("message", "Extraction failed"),
            "checksum": checksum_result,
        }

    required_result = check_required_files(dp)
    forbidden_result = check_forbidden_files(dp)
    git_result = verify_git_history(dp)
    smoke_result = run_restored_smoke_suite(dp)

    smoke_pass = smoke_result["critical_fail"] == 0

    overall_passed = (
        required_result["passed"]
        and forbidden_result["passed"]
        and git_result["present"]
        and smoke_pass
        and (checksum_result.get("verified") is None or checksum_result["verified"])
    )

    if overall_passed and smoke_result["overall"] == "PASS":
        confidence = "HIGH"
    elif overall_passed:
        confidence = "MEDIUM"
    elif required_result["passed"] and git_result["present"]:
        confidence = "LOW"
    else:
        confidence = "CRITICAL"

    cleanup_result = {"cleaned": False, "message": "Kept for inspection"} if keep else cleanup_restore_folder(dp)

    today = _local_today().isoformat()
    report = _generate_runtime_proof_report(
        today=today,
        archive_name=ap.name,
        archive_path=str(ap),
        dest_path=str(dp),
        checksum=checksum_result,
        extract=extract_result,
        required=required_result,
        forbidden=forbidden_result,
        git=git_result,
        smoke=smoke_result,
        cleanup=cleanup_result,
        confidence=confidence,
        keep=keep,
    )

    PROOF_DIR.mkdir(parents=True, exist_ok=True)
    report_path = PROOF_DIR / f"Runtime Proof - {today}.md"
    report_path.write_text(report, encoding="utf-8")

    return {
        "passed": overall_passed,
        "confidence": confidence,
        "archive": str(ap),
        "dest": str(dp),
        "checksum": checksum_result,
        "extracted_files": extract_result.get("file_count", 0),
        "required_files": required_result,
        "forbidden_files": forbidden_result,
        "git_history": git_result,
        "smoke_suite": smoke_result,
        "cleanup": cleanup_result,
        "report_path": str(report_path),
        "keep": keep,
    }


def _generate_runtime_proof_report(
    today: str,
    archive_name: str,
    archive_path: str,
    dest_path: str,
    checksum: dict,
    extract: dict,
    required: dict,
    forbidden: dict,
    git: dict,
    smoke: dict,
    cleanup: dict,
    confidence: str,
    keep: bool,
) -> str:
    lines = [
        "---",
        "type: runtime-proof",
        "status: draft",
        f"generated: {today}",
        "tags:",
        "  - runtime-proof",
        "  - restore",
        "  - production",
        "  - generated",
        "---",
        "",
        f"# Runtime Proof - {today}",
        "",
        "## Result",
        "",
        f"**Confidence: {confidence}**",
        "",
        f"- Archive: `{archive_name}`",
        f"- Smoke suite: **{smoke['overall']}** ({smoke['pass']}/{smoke['total']} passed, {smoke['critical_fail']} critical failures)",
        f"- Required files: {'all present' if required['passed'] else 'MISSING'}",
        f"- Forbidden files: {'none' if forbidden['passed'] else str(len(forbidden['forbidden'])) + ' detected'}",
        f"- Git history: {'present' if git['present'] else 'MISSING'}",
        "",
    ]

    if checksum.get("verified") is True:
        lines.append(f"- Checksum: verified (`{checksum.get('hash', '')[:16]}...`)")
    elif checksum.get("verified") is False:
        lines.append(f"- Checksum: **MISMATCH**")
    else:
        lines.append("- Checksum: not available (no .sha256 file)")
    lines.append("")

    lines.append("## Smoke Suite Results")
    lines.append("")
    lines.append("| Command | Critical | Status |")
    lines.append("|---------|----------|--------|")
    for r in smoke["results"]:
        crit = "YES" if r["critical"] else "—"
        lines.append(f"| {r['name']} | {crit} | {r['status']} |")
    lines.append("")

    failures = [r for r in smoke["results"] if r["status"] not in ("PASS",)]
    if failures:
        lines.append("## Smoke Failures")
        lines.append("")
        for r in failures:
            lines.append(f"### {r['name']} ({r['status']})")
            lines.append(f"```\n{r['output'][:300]}\n```")
            lines.append("")

    if not required["passed"]:
        lines.append("## Missing Required Files")
        lines.append("")
        for f in required.get("missing_files", []):
            lines.append(f"- `{f}`")
        for d in required.get("missing_dirs", []):
            lines.append(f"- `{d}/`")
        lines.append("")

    if not forbidden["passed"]:
        lines.append("## Forbidden Files Detected")
        lines.append("")
        for f in forbidden["forbidden"]:
            lines.append(f"- `{f}`")
        lines.append("")

    if git["present"]:
        lines.append("## Git History")
        lines.append("")
        lines.append(f"Latest commit: `{git.get('latest_commit', 'N/A')}`")
        lines.append("")

    lines.append("## Extraction")
    lines.append("")
    lines.append(f"- Files extracted: {extract.get('file_count', 0)}")
    lines.append(f"- Destination: `{dest_path}`")
    lines.append(f"- Kept: {'yes' if keep else 'no (cleaned up)'}")
    lines.append("")

    lines.append("## Cleanup")
    lines.append("")
    lines.append(cleanup.get("message", ""))
    lines.append("")

    lines.append("## Production Proof Statement")
    lines.append("")
    if confidence in ("HIGH", "MEDIUM"):
        lines.append(f"This archive has been verified as restore-ready with **{confidence}** confidence.")
        lines.append("WilliamOS can be reconstructed from this backup to a working state.")
    else:
        lines.append(f"This archive has **{confidence}** confidence and should not be relied upon for disaster recovery.")
    lines.append("")

    lines.append("## Generator Notes")
    lines.append("")
    lines.append("This proof was generated by WilliamOS. No source notes were modified.")
    lines.append("")

    return "\n".join(lines)


def _generate_restore_report(
    today: str,
    archive_name: str,
    archive_path: str,
    dest_path: str,
    checksum: dict,
    extract: dict,
    required: dict,
    forbidden: dict,
    git: dict,
    health: list,
    cleanup: dict,
    confidence: str,
    keep: bool,
) -> str:
    lines = [
        "---",
        "type: restore-drill-report",
        "status: draft",
        f"generated: {today}",
        "tags:",
        "  - restore",
        "  - disaster-recovery",
        "  - generated",
        "---",
        "",
        f"# Restore Drill - {today}",
        "",
        "## Executive Summary",
        "",
    ]

    health_passed = sum(1 for h in health if h["passed"])
    health_total = len(health)

    if confidence == "HIGH":
        lines.append(f"Restore drill **PASSED** with HIGH confidence. All {health_total} health checks passed.")
    elif confidence == "MEDIUM":
        lines.append(f"Restore drill completed with MEDIUM confidence. {health_passed}/{health_total} health checks passed.")
    else:
        lines.append(f"Restore drill completed with LOW confidence. {health_passed}/{health_total} health checks passed. Review required.")
    lines.append("")

    lines.append("## Archive Tested")
    lines.append("")
    lines.append(f"- Name: `{archive_name}`")
    lines.append(f"- Path: `{archive_path}`")
    lines.append("")

    lines.append("## Destination")
    lines.append("")
    lines.append(f"- Path: `{dest_path}`")
    lines.append(f"- Kept: {'yes' if keep else 'no (cleaned up)'}")
    lines.append("")

    lines.append("## Checksum Verification")
    lines.append("")
    if checksum.get("verified") is True:
        lines.append(f"Checksum verified: `{checksum.get('hash', 'N/A')}`")
    elif checksum.get("verified") is False:
        lines.append(f"**CHECKSUM MISMATCH**: {checksum.get('message', '')}")
    else:
        lines.append("No .sha256 file found. Checksum not verified.")
    lines.append("")

    lines.append("## Extraction Result")
    lines.append("")
    if extract.get("extracted"):
        lines.append(f"Extracted {extract.get('file_count', 0)} files successfully.")
    else:
        lines.append(f"**EXTRACTION FAILED**: {extract.get('message', '')}")
    lines.append("")

    lines.append("## Required Files Check")
    lines.append("")
    if required["passed"]:
        lines.append("All required files present.")
    else:
        if required["missing_files"]:
            lines.append("**Missing files:**")
            for f in required["missing_files"]:
                lines.append(f"- `{f}`")
        if required["missing_dirs"]:
            lines.append("**Missing directories:**")
            for d in required["missing_dirs"]:
                lines.append(f"- `{d}/`")
    lines.append("")

    lines.append("## Forbidden Files Check")
    lines.append("")
    if forbidden["passed"]:
        lines.append("No forbidden files detected.")
    else:
        lines.append(f"**{len(forbidden['forbidden'])} forbidden files detected:**")
        for f in forbidden["forbidden"]:
            lines.append(f"- `{f}`")
    if forbidden["suspicious"]:
        lines.append("")
        lines.append(f"Suspicious filenames ({len(forbidden['suspicious'])}):")
        for f in forbidden["suspicious"]:
            lines.append(f"- `{f}` (warning)")
    lines.append("")

    lines.append("## Git History Check")
    lines.append("")
    if git["present"]:
        lines.append(f"Git history present. Latest commit: `{git.get('latest_commit', 'N/A')}`")
    else:
        lines.append(f"**Git history missing**: {git.get('message', '')}")
    lines.append("")

    lines.append("## Restored Health Checks")
    lines.append("")
    lines.append("| Check | Result | Notes |")
    lines.append("|-------|--------|-------|")
    for h in health:
        status = "PASS" if h["passed"] else "FAIL"
        notes = ""
        if not h["passed"] and h.get("stderr"):
            notes = h["stderr"][:80]
        lines.append(f"| {h['label']} | {status} | {notes} |")
    lines.append("")

    lines.append("## Cleanup Result")
    lines.append("")
    lines.append(cleanup.get("message", ""))
    lines.append("")

    lines.append("## Restore Confidence")
    lines.append("")
    lines.append(f"**{confidence}**")
    lines.append("")

    lines.append("## Risks / Warnings")
    lines.append("")
    risks = []
    if checksum.get("verified") is False:
        risks.append("Checksum mismatch — archive may be corrupted")
    if not required["passed"]:
        risks.append("Missing required files — incomplete backup")
    if not forbidden["passed"]:
        risks.append("Forbidden files in archive — secrets may have leaked")
    if not git["present"]:
        risks.append("No Git history — version tracking lost")
    failed_health = [h["label"] for h in health if not h["passed"]]
    if failed_health:
        risks.append(f"Health check failures: {', '.join(failed_health)}")
    if not risks:
        lines.append("None identified.")
    else:
        for r in risks:
            lines.append(f"- {r}")
    lines.append("")

    lines.append("## Recommended Next Actions")
    lines.append("")
    if confidence == "HIGH":
        lines.append("- Archive is restore-ready. Continue normal operations.")
        lines.append("- Schedule next restore drill after the next major WO.")
    elif confidence == "MEDIUM":
        lines.append("- Investigate failed health checks.")
        lines.append("- Re-run backup and restore drill after fixes.")
    else:
        lines.append("- Do not rely on this backup for disaster recovery.")
        lines.append("- Create a fresh backup and re-run restore drill.")
    lines.append("")

    lines.append("## Generator Notes")
    lines.append("")
    lines.append("This note was generated by WilliamOS. Review before relying on it.")
    lines.append("")

    return "\n".join(lines)


def generate_restore_manifest(
    archive_name: str = "",
    dest_path: str = "",
    checksum: dict | None = None,
    git: dict | None = None,
    health: list | None = None,
    forbidden: dict | None = None,
    cleanup: dict | None = None,
    confidence: str = "UNKNOWN",
) -> str:
    today = _local_today().isoformat()

    from williamos_backup import backup_status as _backup_status
    bstatus = _backup_status()

    latest_report = ""
    if REPORTS_DIR.exists():
        reports = sorted(REPORTS_DIR.glob("Restore Drill - *.md"), reverse=True)
        if reports:
            latest_report = reports[0].name

    lines = [
        "---",
        "type: restore-manifest",
        "status: active",
        f"generated: {today}",
        "tags:",
        "  - restore",
        "  - disaster-recovery",
        "  - governance",
        "---",
        "",
        "# WilliamOS Restore Manifest",
        "",
        "## Generated",
        "",
        f"{today}",
        "",
        "## Last Restore Drill",
        "",
        latest_report or "No restore drill has been run yet.",
        "",
        "## Archive Tested",
        "",
        archive_name or "N/A",
        "",
        "## Destination Used",
        "",
        dest_path or "N/A",
        "",
        "## Checksum Status",
        "",
    ]

    if checksum and checksum.get("verified") is True:
        lines.append(f"Verified: `{checksum.get('hash', 'N/A')}`")
    elif checksum and checksum.get("verified") is False:
        lines.append(f"**MISMATCH**: {checksum.get('message', '')}")
    else:
        lines.append("Not yet verified.")
    lines.append("")

    lines.append("## Git History Status")
    lines.append("")
    if git and git.get("present"):
        lines.append(f"Present. Latest commit: `{git.get('latest_commit', 'N/A')}`")
    elif git:
        lines.append("**Missing**")
    else:
        lines.append("Not yet checked.")
    lines.append("")

    lines.append("## Health Checks")
    lines.append("")
    if health:
        for h in health:
            status = "PASS" if h["passed"] else "FAIL"
            lines.append(f"- {h['label']}: {status}")
    else:
        lines.append("Not yet run.")
    lines.append("")

    lines.append("## Forbidden File Check")
    lines.append("")
    if forbidden:
        if forbidden["passed"]:
            lines.append("No forbidden files detected.")
        else:
            lines.append(f"**{len(forbidden['forbidden'])} forbidden files detected.**")
    else:
        lines.append("Not yet checked.")
    lines.append("")

    lines.append("## Cleanup Status")
    lines.append("")
    if cleanup:
        lines.append(cleanup.get("message", "N/A"))
    else:
        lines.append("N/A")
    lines.append("")

    lines.append("## Restore Confidence")
    lines.append("")
    lines.append(f"**{confidence}**")
    lines.append("")

    lines.append("## Backup Governance Status")
    lines.append("")
    lines.append(f"- Backup dir exists: {'yes' if bstatus['backup_dir_exists'] else 'no'}")
    lines.append(f"- Governance docs: {'yes' if bstatus['docs_exist'] else 'MISSING'}")
    lines.append(f"- Local archives: {bstatus['archive_count']}")
    if bstatus["latest_archive"]:
        lines.append(f"- Latest archive: {bstatus['latest_archive']}")
    lines.append("")

    lines.append("## Manual Recovery Notes")
    lines.append("")
    lines.append("1. Extract the archive to a clean folder")
    lines.append("2. `cd` into the extracted folder")
    lines.append("3. `pip install -r requirements.txt`")
    lines.append("4. `python scripts/william.py check`")
    lines.append("5. `python scripts/william.py semantic-index` (optional)")
    lines.append("6. `python scripts/william.py cockpit --dry-run`")
    lines.append("")

    lines.append("## Generator Notes")
    lines.append("")
    lines.append("This manifest was generated by WilliamOS. It does not contain secrets by design.")
    lines.append("")

    return "\n".join(lines)


def write_restore_manifest(**kwargs: Any) -> Path:
    RESTORE_DIR.mkdir(parents=True, exist_ok=True)
    text = generate_restore_manifest(**kwargs)
    MANIFEST_PATH.write_text(text, encoding="utf-8")
    return MANIFEST_PATH


def restore_status() -> dict[str, Any]:
    restore_exists = RESTORE_DIR.exists()
    docs_ok = all((VAULT / d).exists() for d in RESTORE_REQUIRED_DOCS)
    manifest_exists = MANIFEST_PATH.exists()

    latest_report = ""
    if REPORTS_DIR.exists():
        reports = sorted(REPORTS_DIR.glob("Restore Drill - *.md"), reverse=True)
        if reports:
            latest_report = reports[0].name

    from williamos_backup import backup_status as _backup_status
    bstatus = _backup_status()

    return {
        "restore_dir_exists": restore_exists,
        "docs_exist": docs_ok,
        "manifest_exists": manifest_exists,
        "latest_report": latest_report,
        "backup_dir_exists": bstatus["backup_dir_exists"],
        "backup_docs_exist": bstatus["docs_exist"],
        "latest_archive": bstatus["latest_archive"],
        "archive_count": bstatus["archive_count"],
    }


def find_latest_archive() -> str | None:
    from williamos_backup import BACKUP_DIR
    local_archives = BACKUP_DIR / "local_archives"
    if not local_archives.exists():
        return None
    zips = sorted(local_archives.glob("WilliamOS-backup-*.zip"), reverse=True)
    return str(zips[0]) if zips else None
