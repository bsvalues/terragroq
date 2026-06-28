"""WilliamOS Post-Acceptance Closure Engine.

Reads acceptance logs, refreshes review queues and cockpit,
runs global check, and generates closure reports and checklists.
Never commits, backs up, pushes, or moves files.
"""

import json
import os
import re
import subprocess
import sys
from datetime import datetime
from pathlib import Path

VAULT = Path(os.environ.get("WILLIAMOS_VAULT", "WilliamOS"))
TZ_NAME = os.environ.get("WILLIAMOS_TZ", "America/Los_Angeles")

CLOSURE_DIR = VAULT / "99_PostAcceptanceClosure"
REPORTS_DIR = CLOSURE_DIR / "reports"
CHECKLISTS_DIR = CLOSURE_DIR / "checklists"
DATA_DIR = CLOSURE_DIR / "data"

GOVERNANCE_DOCS = [
    "README.md",
    "CLOSURE_POLICY.md",
    "POST_ACCEPTANCE_WORKFLOW.md",
    "SNAPSHOT_RECOMMENDATION_POLICY.md",
    "CLOSURE_CHECKLIST_POLICY.md",
]

ACCEPTANCE_LOG = VAULT / "98_OfficialAcceptance" / "logs" / "ACCEPTANCE_LOG.md"

OFFICIAL_FOLDERS = {
    "02_Decisions": "Decisions",
    "03_Doctrine": "Doctrine",
    "10_Ideas": "Ideas / Concepts",
    "11_Projects": "Projects",
}


def _now():
    try:
        from zoneinfo import ZoneInfo
        return datetime.now(ZoneInfo(TZ_NAME))
    except Exception:
        return datetime.now()


def _ensure_dirs():
    for d in [REPORTS_DIR, CHECKLISTS_DIR, DATA_DIR]:
        d.mkdir(parents=True, exist_ok=True)


def _run_cmd(args, timeout=30):
    try:
        r = subprocess.run(
            args, capture_output=True, text=True, timeout=timeout,
            cwd=str(Path.cwd()),
        )
        return r.returncode, r.stdout.strip(), r.stderr.strip()
    except Exception as e:
        return -1, "", str(e)


def _find_latest(folder, pattern):
    if not folder.exists():
        return None
    matches = sorted(folder.glob(pattern))
    return matches[-1].name if matches else None


def read_acceptance_log():
    if not ACCEPTANCE_LOG.exists():
        return {"exists": False, "entries": []}
    text = ACCEPTANCE_LOG.read_text(encoding="utf-8", errors="ignore")
    entries = []
    current = None
    for line in text.split("\n"):
        if line.startswith("## "):
            if current:
                entries.append(current)
            current = {"timestamp": line[3:].strip(), "details": {}}
        elif current and line.startswith("- "):
            parts = line[2:].split(": ", 1)
            if len(parts) == 2:
                current["details"][parts[0].strip()] = parts[1].strip()
    if current:
        entries.append(current)
    return {"exists": True, "entries": entries}


def extract_recent_acceptances(limit=5):
    log = read_acceptance_log()
    return log["entries"][-limit:]


def _official_folder_counts():
    counts = {}
    for folder in OFFICIAL_FOLDERS:
        fp = VAULT / folder
        if fp.exists():
            counts[folder] = len(list(fp.glob("*.md")))
        else:
            counts[folder] = 0
    return counts


def _git_status_summary():
    code, out, _ = _run_cmd(["git", "status", "--porcelain"])
    if code != 0:
        return {"available": False}
    lines = [l for l in out.split("\n") if l.strip()] if out else []
    return {
        "available": True,
        "clean": len(lines) == 0,
        "changed_count": len(lines),
    }


def _snapshot_dry_run():
    code, out, err = _run_cmd(
        [sys.executable, "scripts/william.py", "snapshot", "--dry-run"]
    )
    return {"exit_code": code, "output": out, "error": err}


def _run_check():
    code, out, err = _run_cmd(
        [sys.executable, "scripts/william.py", "check"]
    )
    return {"passed": code == 0, "output": out, "error": err}


def refresh_review_queues():
    try:
        from williamos_review import generate_review_queue_report
        result = generate_review_queue_report(dry_run=False)
        return {
            "refreshed": True,
            "total_pending": result.get("total_pending", 0),
            "path": result.get("path"),
        }
    except Exception as e:
        return {"refreshed": False, "error": str(e)}


def refresh_cockpit():
    code, out, err = _run_cmd(
        [sys.executable, "scripts/william.py", "cockpit"]
    )
    return {
        "refreshed": code == 0,
        "output": out[:500] if out else "",
        "error": err[:200] if err else "",
    }


def refresh_cortex():
    code, out, err = _run_cmd(
        [sys.executable, "scripts/william.py", "cortex-map"],
        timeout=60,
    )
    return {
        "refreshed": code == 0,
        "output": out[:500] if out else "",
        "error": err[:200] if err else "",
    }


def recommend_snapshot_message(recent_acceptances):
    if not recent_acceptances:
        return "Post-acceptance closure (no new acceptances)"
    latest = recent_acceptances[-1]
    detail = latest.get("details", {})
    lane = detail.get("Lane", "unknown")
    official = detail.get("Official path", "")
    name = Path(official).stem if official else "draft"
    return f"Post-acceptance closure: accepted {lane} — {name}"


def closure_status():
    docs_exist = all((CLOSURE_DIR / d).exists() for d in GOVERNANCE_DOCS)
    log = read_acceptance_log()
    latest_entry = None
    if log["entries"]:
        latest_entry = log["entries"][-1]["timestamp"]

    latest_report = _find_latest(REPORTS_DIR, "Post-Acceptance Closure - *.md")
    latest_checklist = _find_latest(CHECKLISTS_DIR, "Post-Acceptance Checklist - *.md")

    rq_dir = VAULT / "97_HumanReviewQueues" / "reports"
    latest_rq = _find_latest(rq_dir, "Review Queues - *.md")

    cockpit_dir = VAULT / "89_ReviewCockpit" / "reports"
    latest_cockpit = _find_latest(cockpit_dir, "Review Cockpit - *.md")

    git = _git_status_summary()

    return {
        "closure_dir_exists": CLOSURE_DIR.exists(),
        "docs_exist": docs_exist,
        "acceptance_log_exists": log["exists"],
        "latest_acceptance_entry": latest_entry,
        "acceptance_count": len(log["entries"]),
        "latest_closure_report": latest_report,
        "latest_closure_checklist": latest_checklist,
        "latest_review_queue_report": latest_rq,
        "latest_cockpit_report": latest_cockpit,
        "git_clean": git.get("clean"),
        "snapshot_recommended": not git.get("clean", True),
    }


def generate_closure_report(dry_run=False, refresh_cortex_flag=False):
    now = _now()
    date_str = now.strftime("%Y-%m-%d")
    recent = extract_recent_acceptances()

    if dry_run:
        git = _git_status_summary()
        return {
            "date": date_str,
            "accepted_items": len(recent),
            "recent_acceptances": [
                {"timestamp": e["timestamp"], "lane": e.get("details", {}).get("Lane", "?")}
                for e in recent
            ],
            "would_refresh": ["review_queues", "cockpit"] + (["cortex"] if refresh_cortex_flag else []),
            "git_clean": git.get("clean"),
        }

    check_result = _run_check()
    rq_result = refresh_review_queues()
    cockpit_result = refresh_cockpit()
    cortex_result = None
    if refresh_cortex_flag:
        cortex_result = refresh_cortex()
    snapshot_dry = _snapshot_dry_run()
    git = _git_status_summary()
    official = _official_folder_counts()
    snap_msg = recommend_snapshot_message(recent)

    lines = []
    lines.append("---")
    lines.append("type: post-acceptance-closure")
    lines.append("status: draft")
    lines.append(f"generated: \"{now.strftime('%Y-%m-%d %H:%M')}\"")
    lines.append("tags:")
    lines.append("  - acceptance")
    lines.append("  - closure")
    lines.append("  - generated")
    lines.append("---")
    lines.append("")
    lines.append(f"# Post-Acceptance Closure - {date_str}")
    lines.append("")

    lines.append("## Executive Summary")
    lines.append("")
    if recent:
        lines.append(f"**{len(recent)}** acceptance log entries found. Queues and cockpit refreshed.")
    else:
        lines.append("No accepted items found. Closure report generated as readiness check.")
    lines.append(f"Global check: **{'PASSED' if check_result['passed'] else 'FAILED'}**")
    lines.append("")

    lines.append("## Acceptance Log Summary")
    lines.append("")
    if recent:
        for entry in recent:
            d = entry.get("details", {})
            lines.append(f"- **{entry['timestamp']}**: {d.get('Lane', '?')} → `{d.get('Official path', '?')}`")
    else:
        lines.append("No acceptance log entries found.")
    lines.append("")

    lines.append("## Official Folder Check")
    lines.append("")
    lines.append("| Folder | Notes |")
    lines.append("|--------|-------|")
    for folder, count in official.items():
        lines.append(f"| {folder}/ | {count} |")
    lines.append("")

    lines.append("## Review Queue Refresh")
    lines.append("")
    if rq_result["refreshed"]:
        lines.append(f"- Refreshed: yes")
        lines.append(f"- Pending: {rq_result.get('total_pending', '?')}")
        lines.append(f"- Report: `{rq_result.get('path', '?')}`")
    else:
        lines.append(f"- Refreshed: no — {rq_result.get('error', 'unknown error')}")
    lines.append("")

    lines.append("## Cockpit Refresh")
    lines.append("")
    if cockpit_result["refreshed"]:
        lines.append("- Refreshed: yes")
    else:
        lines.append(f"- Refreshed: no — {cockpit_result.get('error', '')}")
    lines.append("")

    lines.append("## Cortex Refresh")
    lines.append("")
    if cortex_result is None:
        lines.append("- Skipped (use `--refresh-cortex` to include)")
    elif cortex_result["refreshed"]:
        lines.append("- Refreshed: yes")
    else:
        lines.append(f"- Refreshed: no — {cortex_result.get('error', '')}")
    lines.append("")

    lines.append("## Global Check Result")
    lines.append("")
    lines.append(f"- Passed: {'yes' if check_result['passed'] else 'NO'}")
    if not check_result["passed"] and check_result["output"]:
        for line in check_result["output"].split("\n")[:10]:
            lines.append(f"  {line}")
    lines.append("")

    lines.append("## Snapshot Dry Run")
    lines.append("")
    lines.append(f"- Exit code: {snapshot_dry['exit_code']}")
    if snapshot_dry["output"]:
        for line in snapshot_dry["output"].split("\n")[:5]:
            lines.append(f"  {line}")
    lines.append("")

    lines.append("## Recommended Snapshot Message")
    lines.append("")
    lines.append(f"```")
    lines.append(f'python scripts/william.py snapshot --message "{snap_msg}"')
    lines.append(f"```")
    lines.append("")

    lines.append("## Manual Next Steps")
    lines.append("")
    lines.append("1. Review this closure report")
    lines.append("2. Run the recommended snapshot if meaningful")
    lines.append("3. Optionally archive accepted source drafts")
    lines.append("4. Optionally run backup dry-run")
    lines.append("5. Do not push unless explicitly intended")
    lines.append("")

    warnings = []
    if not check_result["passed"]:
        warnings.append("Global check FAILED — fix issues before snapshot")
    if not rq_result["refreshed"]:
        warnings.append("Review queue refresh failed")
    if not cockpit_result["refreshed"]:
        warnings.append("Cockpit refresh failed")
    if cortex_result and not cortex_result["refreshed"]:
        warnings.append("Cortex refresh failed")

    lines.append("## Warnings")
    lines.append("")
    if warnings:
        for w in warnings:
            lines.append(f"- **{w}**")
    else:
        lines.append("No warnings.")
    lines.append("")

    lines.append("## Source Paths")
    lines.append("")
    lines.append(f"- Acceptance log: `{ACCEPTANCE_LOG}`")
    lines.append(f"- Review queues: `WilliamOS/97_HumanReviewQueues/reports/`")
    lines.append(f"- Cockpit: `WilliamOS/89_ReviewCockpit/reports/`")
    if refresh_cortex_flag:
        lines.append(f"- Cortex: `WilliamOS/88_CortexMap/reports/`")
    lines.append("")

    lines.append("## Generator Notes")
    lines.append("")
    lines.append("This note was generated by WilliamOS. No commit, backup, remote, or push was performed.")
    lines.append("")

    _ensure_dirs()
    content = "\n".join(lines)
    report_path = REPORTS_DIR / f"Post-Acceptance Closure - {date_str}.md"
    report_path.write_text(content, encoding="utf-8")

    json_data = {
        "date": date_str,
        "generated": now.strftime("%Y-%m-%d %H:%M"),
        "accepted_items": len(recent),
        "check_passed": check_result["passed"],
        "review_queues_refreshed": rq_result["refreshed"],
        "cockpit_refreshed": cockpit_result["refreshed"],
        "cortex_refreshed": cortex_result["refreshed"] if cortex_result else None,
        "git_clean": git.get("clean"),
        "official_counts": official,
        "snapshot_message": snap_msg,
    }
    json_path = DATA_DIR / f"post-acceptance-closure-{date_str}.json"
    json_path.write_text(json.dumps(json_data, indent=2), encoding="utf-8")

    return {
        "date": date_str,
        "accepted_items": len(recent),
        "check_passed": check_result["passed"],
        "review_queues_refreshed": rq_result["refreshed"],
        "cockpit_refreshed": cockpit_result["refreshed"],
        "cortex_refreshed": cortex_result["refreshed"] if cortex_result else None,
        "snapshot_message": snap_msg,
        "path": str(report_path),
        "json_path": str(json_path),
    }


def generate_closure_checklist():
    now = _now()
    date_str = now.strftime("%Y-%m-%d")
    recent = extract_recent_acceptances()

    lines = []
    lines.append("---")
    lines.append("type: post-acceptance-checklist")
    lines.append("status: draft")
    lines.append(f"generated: \"{now.strftime('%Y-%m-%d %H:%M')}\"")
    lines.append("tags:")
    lines.append("  - acceptance")
    lines.append("  - closure")
    lines.append("  - checklist")
    lines.append("---")
    lines.append("")
    lines.append(f"# Post-Acceptance Checklist - {date_str}")
    lines.append("")

    lines.append("## Accepted Items")
    lines.append("")
    if recent:
        for entry in recent:
            d = entry.get("details", {})
            lines.append(f"- [{entry['timestamp']}] {d.get('Lane', '?')}: `{d.get('Official path', '?')}`")
    else:
        lines.append("No acceptance log entries found.")
    lines.append("")

    lines.append("## Closure Steps")
    lines.append("")
    lines.append("- [ ] Confirm accepted official note opens correctly")
    lines.append("- [ ] Confirm source evidence is preserved")
    lines.append("- [ ] Re-run review queues")
    lines.append("- [ ] Re-run cockpit")
    lines.append("- [ ] Optional: re-run cortex map")
    lines.append("- [ ] Run snapshot dry-run")
    lines.append("- [ ] Create snapshot if meaningful")
    lines.append("- [ ] Optional: run backup dry-run")
    lines.append("- [ ] Do not push unless explicitly intended")
    lines.append("")

    lines.append("## Suggested Commands")
    lines.append("")
    lines.append("```bash")
    lines.append("python scripts/william.py post-acceptance")
    lines.append("python scripts/william.py snapshot --dry-run")
    snap_msg = recommend_snapshot_message(recent)
    lines.append(f'python scripts/william.py snapshot --message "{snap_msg}"')
    lines.append("python scripts/william.py backup --dry-run")
    lines.append("```")
    lines.append("")

    lines.append("## Source Paths")
    lines.append("")
    lines.append(f"- Acceptance log: `{ACCEPTANCE_LOG}`")
    for entry in recent:
        d = entry.get("details", {})
        if d.get("Official path"):
            lines.append(f"- Official: `{d['Official path']}`")
        if d.get("Accepted draft"):
            lines.append(f"- Source draft: `{d['Accepted draft']}`")
    lines.append("")

    lines.append("## Generator Notes")
    lines.append("")
    lines.append("This checklist was generated by WilliamOS. Human review is required.")
    lines.append("")

    _ensure_dirs()
    content = "\n".join(lines)
    checklist_path = CHECKLISTS_DIR / f"Post-Acceptance Checklist - {date_str}.md"
    checklist_path.write_text(content, encoding="utf-8")

    return {
        "date": date_str,
        "path": str(checklist_path),
        "accepted_items": len(recent),
    }
