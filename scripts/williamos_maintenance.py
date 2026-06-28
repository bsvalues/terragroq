"""WilliamOS Maintenance Release Engine.

Validates post-v1 additions, generates maintenance reports/manifests,
and optionally creates local annotated tags.
Reuses helpers from williamos_release and williamos_git.
Never pushes, never creates remotes, never modifies source notes.
"""

import json
import os
import subprocess
import sys
from datetime import datetime
from pathlib import Path

VAULT = Path(os.environ.get("WILLIAMOS_VAULT", "WilliamOS"))
TZ_NAME = os.environ.get("WILLIAMOS_TZ", "America/Los_Angeles")

MAINT_DIR = VAULT / "100_MaintenanceRelease"
REPORTS_DIR = MAINT_DIR / "reports"
DATA_DIR = MAINT_DIR / "data"
MANIFEST_PATH = MAINT_DIR / "MAINTENANCE_MANIFEST.md"

GOVERNANCE_DOCS = [
    "README.md",
    "MAINTENANCE_POLICY.md",
    "V1_1_CHECKLIST.md",
    "TAGGING_POLICY.md",
    "POST_MAINTENANCE_ROUTINE.md",
]

POST_V1_LAYERS = [
    {
        "wo": "WO-017",
        "name": "Daily / Weekly / Monthly Operating Routine",
        "dir": "96_OperatingRoutine",
        "check_cmd": "routine-status",
    },
    {
        "wo": "WO-018",
        "name": "Human Review Queues",
        "dir": "97_HumanReviewQueues",
        "check_cmd": "review-status",
    },
    {
        "wo": "WO-019",
        "name": "Official Acceptance Assistant",
        "dir": "98_OfficialAcceptance",
        "check_cmd": "accept-status",
    },
    {
        "wo": "WO-020",
        "name": "Post-Acceptance Closure Workflow",
        "dir": "99_PostAcceptanceClosure",
        "check_cmd": "closure-status",
    },
]

MAINTENANCE_CHECKS = [
    {"name": "Vault governance (check)", "cmd": "check", "category": "required"},
    {"name": "Routine status", "cmd": "routine-status", "category": "warning"},
    {"name": "Daily review dry-run", "cmd": "daily-review --dry-run", "category": "warning"},
    {"name": "Weekly review dry-run", "cmd": "weekly-review --dry-run", "category": "warning"},
    {"name": "Monthly review dry-run", "cmd": "monthly-review --dry-run", "category": "warning"},
    {"name": "Review queue status", "cmd": "review-status", "category": "warning"},
    {"name": "Review queues dry-run", "cmd": "review-queues --dry-run", "category": "warning"},
    {"name": "Acceptance checklist (all)", "cmd": "acceptance-checklist --lane all", "category": "warning"},
    {"name": "Accept status", "cmd": "accept-status", "category": "warning"},
    {"name": "Closure status", "cmd": "closure-status", "category": "warning"},
    {"name": "Post-acceptance dry-run", "cmd": "post-acceptance --dry-run", "category": "warning"},
    {"name": "Cockpit status", "cmd": "cockpit-status", "category": "warning"},
    {"name": "Git governance status", "cmd": "git-status", "category": "required"},
    {"name": "Backup status", "cmd": "backup-status", "category": "warning"},
    {"name": "Restore status", "cmd": "restore-status", "category": "warning"},
    {"name": "Remote status", "cmd": "remote-status", "category": "required"},
    {"name": "Orphan check", "cmd": "orphans", "category": "warning"},
    {"name": "Stale decisions", "cmd": "stale-decisions", "category": "warning"},
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
    for d in [REPORTS_DIR, DATA_DIR]:
        d.mkdir(parents=True, exist_ok=True)


def _run_command(cmd_str):
    args = [sys.executable, "scripts/william.py"] + cmd_str.split()
    try:
        r = subprocess.run(args, capture_output=True, text=True, timeout=60)
        return {
            "exit_code": r.returncode,
            "stdout": r.stdout.strip(),
            "stderr": r.stderr.strip(),
            "passed": r.returncode == 0,
        }
    except Exception as e:
        return {"exit_code": -1, "stdout": "", "stderr": str(e), "passed": False}


def _run_git(*args):
    try:
        r = subprocess.run(["git"] + list(args), capture_output=True, text=True, timeout=30)
        return r
    except Exception:
        return None


def _git_info():
    info = {"repo_exists": False}
    r = _run_git("rev-parse", "--is-inside-work-tree")
    if not r or r.returncode != 0:
        return info
    info["repo_exists"] = True

    r = _run_git("rev-parse", "--abbrev-ref", "HEAD")
    info["branch"] = r.stdout.strip() if r and r.returncode == 0 else "unknown"

    r = _run_git("log", "-1", "--oneline")
    info["latest_commit"] = r.stdout.strip() if r and r.returncode == 0 else "none"

    r = _run_git("status", "--porcelain")
    lines = [l for l in (r.stdout or "").split("\n") if l.strip()] if r else []
    info["clean"] = len(lines) == 0
    info["changed_count"] = len(lines)

    info["latest_tag"] = get_latest_tag()
    return info


def get_latest_tag():
    r = _run_git("describe", "--tags", "--abbrev=0")
    if r and r.returncode == 0:
        return r.stdout.strip()
    return None


def check_forbidden_files():
    from williamos_release import check_forbidden_files as _release_check
    return _release_check()


def check_remote_state():
    from williamos_release import check_remote_state as _release_check
    return _release_check()


def check_source_note_integrity():
    from williamos_release import check_source_note_integrity as _release_check
    return _release_check()


def _layer_status():
    results = []
    for layer in POST_V1_LAYERS:
        d = VAULT / layer["dir"]
        exists = d.exists()
        cmd_result = _run_command(layer["check_cmd"]) if exists else None
        results.append({
            "wo": layer["wo"],
            "name": layer["name"],
            "dir": layer["dir"],
            "exists": exists,
            "check_passed": cmd_result["passed"] if cmd_result else False,
            "output": cmd_result["stdout"][:300] if cmd_result else "",
        })
    return results


def run_maintenance_checks(dry_run=False):
    results = []

    for chk in MAINTENANCE_CHECKS:
        if dry_run:
            results.append({
                "name": chk["name"],
                "cmd": chk["cmd"],
                "category": chk["category"],
                "passed": None,
                "skipped": True,
            })
        else:
            r = _run_command(chk["cmd"])
            results.append({
                "name": chk["name"],
                "cmd": chk["cmd"],
                "category": chk["category"],
                "passed": r["passed"],
                "exit_code": r["exit_code"],
                "stdout": r["stdout"][:500],
                "stderr": r["stderr"][:200],
                "skipped": False,
            })

    if not dry_run:
        forbidden = check_forbidden_files()
        results.append({
            "name": "Forbidden file scan",
            "cmd": "(direct scan)",
            "category": "required",
            "passed": forbidden["passed"],
            "detail": f"{len(forbidden['forbidden'])} forbidden" if forbidden.get("forbidden") else "clean",
            "skipped": False,
        })

        remote = check_remote_state()
        results.append({
            "name": "Remote scan",
            "cmd": "(direct scan)",
            "category": "required",
            "passed": remote["passed"],
            "detail": f"{remote['count']} remotes" if not remote["passed"] else "none",
            "skipped": False,
        })
    else:
        results.append({
            "name": "Forbidden file scan", "cmd": "(direct scan)",
            "category": "required", "passed": None, "skipped": True,
        })
        results.append({
            "name": "Remote scan", "cmd": "(direct scan)",
            "category": "required", "passed": None, "skipped": True,
        })

    required = [r for r in results if r["category"] == "required"]
    warnings = [r for r in results if r["category"] == "warning"]
    blocking = [r for r in required if r.get("passed") is False]
    warning_fails = [r for r in warnings if r.get("passed") is False]

    if dry_run:
        overall = "DRY_RUN"
    elif blocking:
        overall = "FAIL"
    elif warning_fails:
        overall = "PASS_WITH_WARNINGS"
    else:
        overall = "PASS"

    return {
        "checks": results,
        "required_checks": required,
        "warnings": warnings,
        "blocking_failures": blocking,
        "warning_failures": warning_fails,
        "overall": overall,
        "all_required_pass": len(blocking) == 0 and not dry_run,
        "total": len(results),
        "passed_count": len([r for r in results if r.get("passed") is True]),
        "failed_count": len([r for r in results if r.get("passed") is False]),
        "timestamp": _now_iso(),
    }


def maintenance_status():
    docs_exist = all((MAINT_DIR / d).exists() for d in GOVERNANCE_DOCS)
    git = _git_info()
    latest_report = None
    if REPORTS_DIR.exists():
        reports = sorted(REPORTS_DIR.glob("Maintenance Review - *.md"))
        if reports:
            latest_report = reports[-1].name
    manifest_exists = MANIFEST_PATH.exists()

    return {
        "maint_dir_exists": MAINT_DIR.exists(),
        "docs_exist": docs_exist,
        "latest_report": latest_report,
        "manifest_exists": manifest_exists,
        "latest_tag": git.get("latest_tag"),
        "branch": git.get("branch"),
        "latest_commit": git.get("latest_commit"),
        "clean": git.get("clean"),
        "remote_count": check_remote_state().get("count", 0),
    }


def generate_maintenance_report(dry_run=False):
    date_str = _today_iso()
    checks = run_maintenance_checks(dry_run=dry_run)
    git = _git_info()
    layers = _layer_status()
    source_integrity = check_source_note_integrity() if not dry_run else {"passed": None}

    if dry_run:
        return {
            "date": date_str,
            "overall": checks["overall"],
            "total_checks": checks["total"],
            "layers": [{
                "wo": l["wo"], "name": l["name"], "exists": l["exists"],
            } for l in layers],
            "git": git,
            "dry_run": True,
        }

    lines = []
    lines.append("---")
    lines.append("type: maintenance-review")
    lines.append("status: draft")
    lines.append(f"generated: \"{_now_iso()}\"")
    lines.append("tags:")
    lines.append("  - maintenance")
    lines.append("  - release")
    lines.append("  - governance")
    lines.append("---")
    lines.append("")
    lines.append(f"# WilliamOS v1.1 Maintenance Review - {date_str}")
    lines.append("")

    lines.append("## Executive Summary")
    lines.append("")
    lines.append(f"Maintenance review ran **{checks['total']}** checks.")
    lines.append(f"Result: **{checks['overall']}** ({checks['passed_count']} passed, {checks['failed_count']} failed)")
    lines.append("")

    lines.append("## Overall Result")
    lines.append("")
    lines.append(f"- Overall: **{checks['overall']}**")
    lines.append(f"- Required checks passed: {len(checks['required_checks']) - len(checks['blocking_failures'])}/{len(checks['required_checks'])}")
    lines.append(f"- Warning checks passed: {len(checks['warnings']) - len(checks['warning_failures'])}/{len(checks['warnings'])}")
    lines.append(f"- Blocking failures: {len(checks['blocking_failures'])}")
    lines.append("")

    lines.append("## Post-v1 Layer Status")
    lines.append("")
    lines.append("| WO | Layer | Dir Exists | Check |")
    lines.append("|-----|-------|-----------|-------|")
    for l in layers:
        check_str = "PASS" if l["check_passed"] else ("MISSING" if not l["exists"] else "FAIL")
        lines.append(f"| {l['wo']} | {l['name']} | {'yes' if l['exists'] else 'NO'} | {check_str} |")
    lines.append("")

    lines.append("## Command Verification")
    lines.append("")
    lines.append("| # | Check | Category | Result |")
    lines.append("|---|-------|----------|--------|")
    for i, chk in enumerate(checks["checks"], 1):
        result_str = "PASS" if chk.get("passed") else ("FAIL" if chk.get("passed") is False else "SKIPPED")
        lines.append(f"| {i} | {chk['name']} | {chk['category']} | {result_str} |")
    lines.append("")

    lines.append("## Git / Snapshot Status")
    lines.append("")
    lines.append(f"- Repository: {'yes' if git.get('repo_exists') else 'no'}")
    lines.append(f"- Branch: {git.get('branch', '?')}")
    lines.append(f"- Latest commit: {git.get('latest_commit', '?')}")
    lines.append(f"- Working tree clean: {'yes' if git.get('clean') else 'no'}")
    lines.append(f"- Latest tag: {git.get('latest_tag', 'none')}")
    lines.append("")

    backup_r = _run_command("backup-status")
    restore_r = _run_command("restore-status")
    lines.append("## Backup / Restore Status")
    lines.append("")
    lines.append(f"- Backup status: {'PASS' if backup_r['passed'] else 'FAIL'}")
    lines.append(f"- Restore status: {'PASS' if restore_r['passed'] else 'FAIL'}")
    lines.append("")

    remote = check_remote_state()
    lines.append("## Remote Status")
    lines.append("")
    lines.append(f"- Remotes configured: {remote.get('count', 0)}")
    lines.append(f"- Remote check: {'PASS (none)' if remote['passed'] else 'FAIL — remotes found'}")
    lines.append("")

    forbidden = check_forbidden_files()
    lines.append("## Forbidden File Scan")
    lines.append("")
    lines.append(f"- Forbidden files: {'none' if forbidden['passed'] else len(forbidden['forbidden'])}")
    if not forbidden["passed"]:
        for f in forbidden["forbidden"][:10]:
            lines.append(f"  - `{f}`")
    lines.append("")

    lines.append("## Warnings")
    lines.append("")
    if checks["warning_failures"]:
        for w in checks["warning_failures"]:
            lines.append(f"- {w['name']}: FAIL")
    else:
        lines.append("No warnings.")
    lines.append("")

    lines.append("## Blocking Failures")
    lines.append("")
    if checks["blocking_failures"]:
        for b in checks["blocking_failures"]:
            lines.append(f"- **{b['name']}**: FAIL")
    else:
        lines.append("No blocking failures.")
    lines.append("")

    if checks["overall"] == "PASS":
        recommendation = "All checks passed. Safe to create maintenance snapshot and tag."
    elif checks["overall"] == "PASS_WITH_WARNINGS":
        recommendation = "Required checks passed. Warnings present — review before tagging."
    else:
        recommendation = "Blocking failures present. Fix required checks before tagging."

    lines.append("## Maintenance Recommendation")
    lines.append("")
    lines.append(f"**{recommendation}**")
    lines.append("")
    if checks["overall"] in ("PASS", "PASS_WITH_WARNINGS"):
        lines.append("Suggested next steps:")
        lines.append("```bash")
        lines.append('python scripts/william.py snapshot --message "WilliamOS v1.1 maintenance baseline"')
        lines.append("python scripts/william.py maintenance-manifest")
        lines.append('python scripts/william.py maintenance-tag --name v1.1.0 --dry-run')
        lines.append('python scripts/william.py maintenance-tag --name v1.1.0')
        lines.append("```")
    lines.append("")

    lines.append("## Source Paths")
    lines.append("")
    lines.append(f"- Maintenance dir: `{MAINT_DIR}`")
    lines.append(f"- Reports: `{REPORTS_DIR}`")
    lines.append(f"- Manifest: `{MANIFEST_PATH}`")
    lines.append("")

    lines.append("## Generator Notes")
    lines.append("")
    lines.append("This note was generated by WilliamOS. No remote was created and no push was performed.")
    lines.append("")

    _ensure_dirs()
    content = "\n".join(lines)
    report_path = REPORTS_DIR / f"Maintenance Review - {date_str}.md"
    report_path.write_text(content, encoding="utf-8")

    json_data = {
        "date": date_str,
        "generated": _now_iso(),
        "overall": checks["overall"],
        "total_checks": checks["total"],
        "passed": checks["passed_count"],
        "failed": checks["failed_count"],
        "blocking_failures": [b["name"] for b in checks["blocking_failures"]],
        "warning_failures": [w["name"] for w in checks["warning_failures"]],
        "layers": [{
            "wo": l["wo"], "name": l["name"], "exists": l["exists"], "passed": l["check_passed"],
        } for l in layers],
        "git": {
            "branch": git.get("branch"),
            "commit": git.get("latest_commit"),
            "clean": git.get("clean"),
            "tag": git.get("latest_tag"),
        },
        "remote_count": remote.get("count", 0),
        "forbidden_count": len(forbidden.get("forbidden", [])),
    }
    json_path = DATA_DIR / f"maintenance-{date_str}.json"
    json_path.write_text(json.dumps(json_data, indent=2), encoding="utf-8")

    return {
        "date": date_str,
        "overall": checks["overall"],
        "total_checks": checks["total"],
        "passed_count": checks["passed_count"],
        "failed_count": checks["failed_count"],
        "blocking_failures": checks["blocking_failures"],
        "warning_failures": checks["warning_failures"],
        "report_path": str(report_path),
        "json_path": str(json_path),
        "dry_run": False,
    }


def write_maintenance_manifest():
    git = _git_info()
    layers = _layer_status()
    remote = check_remote_state()
    forbidden = check_forbidden_files()
    backup_r = _run_command("backup-status")
    restore_r = _run_command("restore-status")

    latest_report = None
    if REPORTS_DIR.exists():
        reports = sorted(REPORTS_DIR.glob("Maintenance Review - *.md"))
        if reports:
            latest_report = reports[-1].name

    latest_json = None
    overall_from_report = "unknown"
    if DATA_DIR.exists():
        jsons = sorted(DATA_DIR.glob("maintenance-*.json"))
        if jsons:
            latest_json = jsons[-1].name
            try:
                data = json.loads(jsons[-1].read_text(encoding="utf-8"))
                overall_from_report = data.get("overall", "unknown")
            except Exception:
                pass

    lines = []
    lines.append("---")
    lines.append("type: maintenance-manifest")
    lines.append("status: active")
    lines.append(f"generated: \"{_now_iso()}\"")
    lines.append("tags:")
    lines.append("  - maintenance")
    lines.append("  - release")
    lines.append("  - governance")
    lines.append("---")
    lines.append("")
    lines.append("# WilliamOS Maintenance Manifest")
    lines.append("")

    lines.append("## Generated")
    lines.append("")
    lines.append(f"- Timestamp: {_now_iso()}")
    lines.append("")

    lines.append("## Maintenance Candidate")
    lines.append("")
    lines.append(f"- Version: v1.1.0")
    lines.append(f"- Scope: WO-017 through WO-020 (post-v1 operating governance)")
    lines.append("")

    lines.append("## Current Commit")
    lines.append("")
    lines.append(f"- Commit: {git.get('latest_commit', 'none')}")
    lines.append("")

    lines.append("## Current Branch")
    lines.append("")
    lines.append(f"- Branch: {git.get('branch', 'unknown')}")
    lines.append("")

    lines.append("## Latest Tag")
    lines.append("")
    lines.append(f"- Tag: {git.get('latest_tag', 'none')}")
    lines.append("")

    lines.append("## Maintenance Result")
    lines.append("")
    lines.append(f"- Latest report: {latest_report or 'none'}")
    lines.append(f"- Overall result: {overall_from_report}")
    lines.append("")

    lines.append("## Post-v1 Layer Summary")
    lines.append("")
    for l in layers:
        status = "PRESENT" if l["exists"] else "MISSING"
        check = "PASS" if l["check_passed"] else "FAIL"
        lines.append(f"- {l['wo']} {l['name']}: {status}, check: {check}")
    lines.append("")

    lines.append("## Backup / Restore Confidence")
    lines.append("")
    lines.append(f"- Backup status: {'PASS' if backup_r['passed'] else 'FAIL'}")
    lines.append(f"- Restore status: {'PASS' if restore_r['passed'] else 'FAIL'}")
    lines.append("")

    lines.append("## Remote Status")
    lines.append("")
    lines.append(f"- Remotes: {remote.get('count', 0)}")
    lines.append(f"- Remote check: {'PASS (none)' if remote['passed'] else 'FAIL'}")
    lines.append("")

    lines.append("## Tagging Status")
    lines.append("")
    existing_tags = _run_git("tag", "-l")
    tag_list = [t for t in (existing_tags.stdout or "").split("\n") if t.strip()] if existing_tags else []
    if tag_list:
        for t in tag_list:
            lines.append(f"- {t}")
    else:
        lines.append("- No tags")
    lines.append("")

    lines.append("## Recommended Next Step")
    lines.append("")
    if overall_from_report == "PASS":
        lines.append("All checks passed. Safe to snapshot and tag v1.1.0.")
    elif overall_from_report == "PASS_WITH_WARNINGS":
        lines.append("Required checks passed with warnings. Review warnings before tagging.")
    elif overall_from_report == "FAIL":
        lines.append("Maintenance checks failed. Fix blocking issues before tagging.")
    else:
        lines.append("Run `maintenance-review` first to generate a maintenance report.")
    lines.append("")

    lines.append("## Generator Notes")
    lines.append("")
    lines.append("This manifest was generated by WilliamOS. It does not push or publish anything.")
    lines.append("")

    MAINT_DIR.mkdir(parents=True, exist_ok=True)
    content = "\n".join(lines)
    MANIFEST_PATH.write_text(content, encoding="utf-8")

    return {"path": str(MANIFEST_PATH), "overall": overall_from_report}


def maintenance_tag_dry_run(name):
    git = _git_info()
    issues = []

    if not git.get("repo_exists"):
        issues.append("No Git repository found")

    if not git.get("clean"):
        issues.append(f"Working tree not clean ({git.get('changed_count', '?')} changes)")

    forbidden = check_forbidden_files()
    if not forbidden["passed"]:
        issues.append(f"Forbidden files found: {len(forbidden['forbidden'])}")

    remote = check_remote_state()
    if not remote["passed"]:
        issues.append(f"Unexpected remotes: {remote.get('count', 0)}")

    existing_tags = _run_git("tag", "-l")
    tag_list = [t.strip() for t in (existing_tags.stdout or "").split("\n") if t.strip()] if existing_tags else []
    if name in tag_list:
        issues.append(f"Tag '{name}' already exists")

    latest_json = None
    overall = "unknown"
    if DATA_DIR.exists():
        jsons = sorted(DATA_DIR.glob("maintenance-*.json"))
        if jsons:
            latest_json = jsons[-1].name
            try:
                data = json.loads(jsons[-1].read_text(encoding="utf-8"))
                overall = data.get("overall", "unknown")
            except Exception:
                pass

    if overall not in ("PASS", "PASS_WITH_WARNINGS"):
        issues.append(f"Maintenance review not passing (overall: {overall}). Run maintenance-review first.")

    return {
        "name": name,
        "can_tag": len(issues) == 0,
        "issues": issues,
        "git": git,
        "latest_maintenance_report": latest_json,
        "maintenance_overall": overall,
        "existing_tags": tag_list,
    }


def create_maintenance_tag(name):
    preflight = maintenance_tag_dry_run(name)
    if not preflight["can_tag"]:
        return {
            "created": False,
            "name": name,
            "issues": preflight["issues"],
        }

    message = f"WilliamOS {name} — maintenance release (WO-017 through WO-020)"
    r = _run_git("tag", "-a", name, "-m", message)
    if not r or r.returncode != 0:
        return {
            "created": False,
            "name": name,
            "issues": [f"git tag failed: {r.stderr.strip() if r else 'unknown error'}"],
        }

    r2 = _run_git("rev-parse", name)
    tag_hash = r2.stdout.strip() if r2 and r2.returncode == 0 else "unknown"

    return {
        "created": True,
        "name": name,
        "hash": tag_hash,
        "message": message,
        "issues": [],
    }
