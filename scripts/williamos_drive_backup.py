"""WilliamOS External Drive Backup Engine.

Validates user-provided backup destinations, generates plans,
runs backups to explicit destinations, verifies archives, and logs runs.
Reuses the existing backup engine for archive creation and verification.
Never guesses destinations. Never deletes from destination. Never pushes.
"""

import json
import os
import shutil
import sys
from datetime import datetime
from pathlib import Path

VAULT = Path(os.environ.get("WILLIAMOS_VAULT", "WilliamOS"))
TZ_NAME = os.environ.get("WILLIAMOS_TZ", "America/Los_Angeles")

DRIVE_DIR = VAULT / "101_ExternalDriveBackup"
PLANS_DIR = DRIVE_DIR / "plans"
LOGS_DIR = DRIVE_DIR / "logs"
LOG_PATH = LOGS_DIR / "DRIVE_BACKUP_LOG.md"

GOVERNANCE_DOCS = [
    "README.md",
    "EXTERNAL_DRIVE_BACKUP_POLICY.md",
    "DESTINATION_READINESS.md",
    "BACKUP_RUNBOOK.md",
    "RESTORE_DRILL_CADENCE.md",
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
    for d in [PLANS_DIR, LOGS_DIR]:
        d.mkdir(parents=True, exist_ok=True)


def _repo_root():
    return Path.cwd().resolve()


def validate_destination(dest_str):
    issues = []
    warnings = []

    if not dest_str or not dest_str.strip():
        return {
            "valid": False,
            "issues": ["No destination provided. You must pass --dest explicitly."],
            "warnings": [],
            "dest": None,
        }

    dest = Path(dest_str).resolve()

    if not dest.exists():
        issues.append(f"Destination does not exist: {dest}")
        return {"valid": False, "issues": issues, "warnings": warnings, "dest": str(dest)}

    if not dest.is_dir():
        issues.append(f"Destination is not a directory: {dest}")
        return {"valid": False, "issues": issues, "warnings": warnings, "dest": str(dest)}

    repo_root = _repo_root()
    try:
        dest.relative_to(repo_root)
        issues.append(f"Destination is inside the live repo ({repo_root}). Use a path outside the repo.")
    except ValueError:
        pass

    vault_abs = (repo_root / VAULT).resolve()
    try:
        dest.relative_to(vault_abs)
        issues.append(f"Destination is inside the WilliamOS vault ({vault_abs}). Use a path outside the vault.")
    except ValueError:
        pass

    if "generated" in str(dest).lower() and "cache" in str(dest).lower():
        warnings.append("Destination path contains 'generated/cache' — this looks like an ignored cache folder.")

    writable = check_writable(dest)
    if not writable["writable"]:
        issues.append(f"Destination is not writable: {writable.get('error', 'unknown')}")

    space = check_free_space(dest)

    return {
        "valid": len(issues) == 0,
        "issues": issues,
        "warnings": warnings,
        "dest": str(dest),
        "writable": writable["writable"],
        "free_space_bytes": space.get("free_bytes"),
        "free_space_human": space.get("free_human"),
        "space_available": space.get("available"),
    }


def check_writable(dest):
    dest = Path(dest)
    test_file = dest / ".williamos_write_test"
    try:
        test_file.write_text("test", encoding="utf-8")
        test_file.unlink()
        return {"writable": True}
    except Exception as e:
        return {"writable": False, "error": str(e)}


def check_free_space(dest):
    try:
        usage = shutil.disk_usage(str(dest))
        free_gb = usage.free / (1024 ** 3)
        free_mb = usage.free / (1024 ** 2)
        if free_gb >= 1:
            human = f"{free_gb:.1f} GB"
        else:
            human = f"{free_mb:.0f} MB"
        return {
            "available": True,
            "free_bytes": usage.free,
            "total_bytes": usage.total,
            "free_human": human,
        }
    except Exception:
        return {"available": False, "free_bytes": None, "free_human": "unknown"}


def estimate_backup_size():
    try:
        from williamos_backup import scan_backup_sources, estimate_backup_size as _est
        sources = scan_backup_sources()
        size_bytes = _est(sources["included"])
        size_mb = size_bytes / (1024 ** 2)
        return {
            "bytes": size_bytes,
            "human": f"{size_mb:.1f} MB",
            "included_count": len(sources["included"]),
            "excluded_count": len(sources["excluded"]),
            "forbidden_count": len(sources.get("forbidden", [])),
        }
    except Exception as e:
        return {"bytes": 0, "human": "unknown", "error": str(e)}


def drive_backup_status():
    docs_exist = all((DRIVE_DIR / d).exists() for d in GOVERNANCE_DOCS)
    log_exists = LOG_PATH.exists()
    latest_log_entry = None
    if log_exists:
        log_data = read_drive_backup_log()
        if log_data["entries"]:
            latest_log_entry = log_data["entries"][-1].get("timestamp")

    from williamos_backup import backup_status as _backup_status
    backup = _backup_status()

    import subprocess
    try:
        r = subprocess.run(["git", "status", "--porcelain"], capture_output=True, text=True, timeout=15)
        lines = [l for l in (r.stdout or "").split("\n") if l.strip()]
        git_clean = len(lines) == 0
    except Exception:
        git_clean = None

    try:
        r = subprocess.run(
            ["git", "describe", "--tags", "--abbrev=0"],
            capture_output=True, text=True, timeout=10,
        )
        latest_tag = r.stdout.strip() if r.returncode == 0 else None
    except Exception:
        latest_tag = None

    return {
        "drive_dir_exists": DRIVE_DIR.exists(),
        "docs_exist": docs_exist,
        "log_exists": log_exists,
        "latest_log_entry": latest_log_entry,
        "backup_governance_exists": backup.get("backup_dir_exists"),
        "backup_docs_exist": backup.get("docs_exist"),
        "backup_archives": backup.get("archive_count", 0),
        "latest_archive": backup.get("latest_archive"),
        "git_clean": git_clean,
        "latest_tag": latest_tag,
    }


def generate_backup_plan(dest_str, dry_run=False):
    date_str = _today_iso()
    validation = validate_destination(dest_str)
    size = estimate_backup_size()

    now = _now()
    archive_name = f"WilliamOS-backup-{now.strftime('%Y%m%d-%H%M%S')}.zip"

    result = {
        "date": date_str,
        "dest": validation.get("dest", dest_str),
        "valid": validation["valid"],
        "issues": validation["issues"],
        "warnings": validation.get("warnings", []),
        "free_space": validation.get("free_space_human"),
        "estimated_size": size.get("human", "unknown"),
        "estimated_bytes": size.get("bytes", 0),
        "included_files": size.get("included_count", 0),
        "excluded_files": size.get("excluded_count", 0),
        "forbidden_files": size.get("forbidden_count", 0),
        "archive_name": archive_name,
        "backup_command": f'python scripts/william.py drive-backup --dest "{validation.get("dest", dest_str)}"',
        "verify_command": f'python scripts/william.py backup-verify "{validation.get("dest", dest_str)}/{archive_name}"',
        "restore_drill_command": f'python scripts/william.py restore-drill --archive "{validation.get("dest", dest_str)}/{archive_name}" --dest "<restore-test-folder>"',
    }

    if dry_run:
        result["dry_run"] = True
        return result

    lines = []
    lines.append("---")
    lines.append("type: drive-backup-plan")
    lines.append("status: draft")
    lines.append(f"generated: \"{_now_iso()}\"")
    lines.append("tags:")
    lines.append("  - backup")
    lines.append("  - external-drive")
    lines.append("  - generated")
    lines.append("---")
    lines.append("")
    lines.append(f"# External Drive Backup Plan - {date_str}")
    lines.append("")

    lines.append("## Destination")
    lines.append("")
    lines.append(f"- Path: `{validation.get('dest', dest_str)}`")
    lines.append("")

    lines.append("## Destination Readiness")
    lines.append("")
    lines.append(f"- Valid: {'yes' if validation['valid'] else 'NO'}")
    if validation["issues"]:
        for issue in validation["issues"]:
            lines.append(f"- Issue: {issue}")
    if validation.get("warnings"):
        for w in validation["warnings"]:
            lines.append(f"- Warning: {w}")
    lines.append(f"- Writable: {'yes' if validation.get('writable') else 'no' if validation.get('writable') is False else '?'}")
    lines.append(f"- Free space: {validation.get('free_space_human', 'unknown')}")
    lines.append("")

    lines.append("## Estimated Backup Size")
    lines.append("")
    lines.append(f"- Estimated: {size.get('human', 'unknown')}")
    lines.append(f"- Files included: {size.get('included_count', '?')}")
    lines.append(f"- Files excluded: {size.get('excluded_count', '?')}")
    lines.append(f"- Forbidden files: {size.get('forbidden_count', '?')}")
    if size.get("forbidden_count", 0) > 0:
        lines.append("- **WARNING: Forbidden files detected. Backup will refuse to create archive.**")
    lines.append("")

    lines.append("## Backup Command")
    lines.append("")
    lines.append("```bash")
    lines.append(result["backup_command"])
    lines.append("```")
    lines.append("")

    lines.append("## Expected Archive Name")
    lines.append("")
    lines.append(f"- `{archive_name}` (timestamp will vary)")
    lines.append("")

    lines.append("## Verification Command")
    lines.append("")
    lines.append("```bash")
    lines.append(result["verify_command"])
    lines.append("```")
    lines.append("")

    lines.append("## Restore Drill Recommendation")
    lines.append("")
    lines.append("After verifying the archive, run a restore drill to a temporary folder:")
    lines.append("")
    lines.append("```bash")
    lines.append(result["restore_drill_command"])
    lines.append("```")
    lines.append("")

    lines.append("## Risks / Warnings")
    lines.append("")
    if not validation["valid"]:
        lines.append("- **Destination validation failed. Do not proceed until issues are resolved.**")
    free_bytes = validation.get("free_space_bytes")
    est_bytes = size.get("bytes", 0)
    if free_bytes and est_bytes and free_bytes < est_bytes * 2:
        lines.append("- **Warning: Free space is less than 2x estimated backup size.**")
    if not validation.get("warnings") and validation["valid"]:
        lines.append("No warnings.")
    for w in validation.get("warnings", []):
        lines.append(f"- {w}")
    lines.append("")

    lines.append("## Generator Notes")
    lines.append("")
    lines.append("This plan was generated by WilliamOS. No backup was created unless explicitly run.")
    lines.append("")

    _ensure_dirs()
    content = "\n".join(lines)
    plan_path = PLANS_DIR / f"Drive Backup Plan - {date_str}.md"
    plan_path.write_text(content, encoding="utf-8")
    result["plan_path"] = str(plan_path)
    result["dry_run"] = False

    return result


def run_drive_backup(dest_str):
    validation = validate_destination(dest_str)
    if not validation["valid"]:
        return {
            "success": False,
            "error": "destination_invalid",
            "issues": validation["issues"],
        }

    from williamos_backup import create_backup_archive, verify_backup_archive

    backup_result = create_backup_archive(dest=validation["dest"])
    if backup_result.get("error"):
        return {
            "success": False,
            "error": backup_result["error"],
            "detail": backup_result.get("detail", ""),
        }

    archive_path = backup_result["archive_path"]
    verify_result = verify_backup_archive(archive_path)

    _ensure_dirs()
    _write_log_entry(
        dest=validation["dest"],
        archive_path=archive_path,
        checksum=backup_result.get("checksum", "unknown"),
        verified=verify_result.get("passed", False),
    )

    restore_cmd = f'python scripts/william.py restore-drill --archive "{archive_path}" --dest "<restore-test-folder>"'

    return {
        "success": True,
        "archive_path": archive_path,
        "archive_name": backup_result.get("archive_name"),
        "checksum": backup_result.get("checksum"),
        "files_included": backup_result.get("files_included", 0),
        "archive_size": backup_result.get("archive_size", 0),
        "verified": verify_result.get("passed", False),
        "verification_issues": verify_result.get("issues", []),
        "restore_drill_command": restore_cmd,
        "log_written": True,
    }


def _write_log_entry(dest, archive_path, checksum, verified):
    _ensure_dirs()
    now = _now_iso()

    import subprocess
    try:
        r = subprocess.run(
            ["git", "log", "-1", "--oneline"],
            capture_output=True, text=True, timeout=10,
        )
        commit = r.stdout.strip() if r.returncode == 0 else "unknown"
    except Exception:
        commit = "unknown"

    entry = []
    entry.append(f"## {now}")
    entry.append("")
    entry.append(f"- Destination: {dest}")
    entry.append(f"- Archive: {archive_path}")
    entry.append(f"- Checksum: {checksum}")
    entry.append(f"- Verification: {'PASS' if verified else 'FAIL'}")
    entry.append(f"- Git commit: {commit}")
    entry.append(f"- Restore drill recommended: yes")
    entry.append("")

    if not LOG_PATH.exists():
        header = "# WilliamOS External Drive Backup Log\n\n"
        LOG_PATH.write_text(header + "\n".join(entry), encoding="utf-8")
    else:
        with open(LOG_PATH, "a", encoding="utf-8") as f:
            f.write("\n".join(entry))


def read_drive_backup_log():
    if not LOG_PATH.exists():
        return {"exists": False, "entries": [], "path": str(LOG_PATH)}

    text = LOG_PATH.read_text(encoding="utf-8", errors="ignore")
    entries = []
    current = None
    for line in text.split("\n"):
        if line.startswith("## "):
            if current:
                entries.append(current)
            current = {"timestamp": line[3:].strip(), "details": []}
        elif current and line.startswith("- "):
            current["details"].append(line[2:].strip())
    if current:
        entries.append(current)

    return {
        "exists": True,
        "entries": entries,
        "total": len(entries),
        "path": str(LOG_PATH),
    }
