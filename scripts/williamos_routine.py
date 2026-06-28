"""WilliamOS operating routine engine.

Generates daily, weekly, and monthly review notes from existing system state.
Reads cockpit data, promotion queues, synthesis reports, cortex maps, and
Git/backup/release status to produce actionable review checklists.

Never modifies source notes. Never commits. Never pushes. Never deletes.
All generated reviews are status: draft until the human acts on them.
"""
from __future__ import annotations

import datetime as dt
import json
import os
import subprocess
import sys
from pathlib import Path
from typing import Any
from zoneinfo import ZoneInfo

VAULT = Path(os.environ.get("WILLIAMOS_VAULT", "WilliamOS"))
ROUTINE_DIR = VAULT / "96_OperatingRoutine"
DAILY_DIR = ROUTINE_DIR / "daily"
WEEKLY_DIR = ROUTINE_DIR / "weekly"
MONTHLY_DIR = ROUTINE_DIR / "monthly"
REPORTS_DIR = ROUTINE_DIR / "reports"

ROUTINE_REQUIRED_DOCS = [
    "96_OperatingRoutine/README.md",
    "96_OperatingRoutine/DAILY_ROUTINE.md",
    "96_OperatingRoutine/WEEKLY_ROUTINE.md",
    "96_OperatingRoutine/MONTHLY_ROUTINE.md",
    "96_OperatingRoutine/ROUTINE_POLICY.md",
]


def _tz() -> ZoneInfo:
    return ZoneInfo(os.environ.get("WILLIAMOS_TZ", "America/Los_Angeles"))


def _now_iso() -> str:
    return dt.datetime.now(_tz()).strftime("%Y-%m-%d %H:%M:%S %Z")


def _today_iso() -> str:
    return dt.datetime.now(_tz()).date().isoformat()


def _week_id() -> str:
    d = dt.datetime.now(_tz()).date()
    y, w, _ = d.isocalendar()
    return f"{y}-W{w:02d}"


def _month_id() -> str:
    return dt.datetime.now(_tz()).date().strftime("%Y-%m")


def _run_cmd(args: list[str]) -> dict[str, Any]:
    """Run a william.py subcommand and capture output."""
    full = [sys.executable, "scripts/william.py"] + args
    try:
        r = subprocess.run(full, capture_output=True, text=True, timeout=60)
        return {"exit_code": r.returncode, "stdout": r.stdout.strip(), "stderr": r.stderr.strip()}
    except Exception as e:
        return {"exit_code": -1, "stdout": "", "stderr": str(e)}


def _count_md(folder: Path) -> int:
    if not folder.exists():
        return 0
    return sum(1 for _ in folder.glob("*.md"))


def _latest_file(folder: Path, pattern: str) -> str | None:
    if not folder.exists():
        return None
    files = sorted(folder.glob(pattern))
    return files[-1].name if files else None


def _load_cockpit_json() -> dict[str, Any] | None:
    data_dir = VAULT / "89_ReviewCockpit" / "data"
    if not data_dir.exists():
        return None
    files = sorted(data_dir.glob("cockpit-status-*.json"))
    if not files:
        return None
    try:
        return json.loads(files[-1].read_text(encoding="utf-8"))
    except Exception:
        return None


def _load_cortex_json() -> dict[str, Any] | None:
    graph_dir = VAULT / "88_CortexMap" / "graphs"
    if not graph_dir.exists():
        return None
    files = sorted(graph_dir.glob("cortex-graph-*.json"))
    if not files:
        return None
    try:
        return json.loads(files[-1].read_text(encoding="utf-8"))
    except Exception:
        return None


def collect_cockpit_summary() -> dict[str, Any]:
    """Extract lane health summary from cockpit data."""
    cj = _load_cockpit_json()
    if not cj:
        return {"available": False, "lanes": [], "green": 0, "yellow": 0, "red": 0}
    lanes = cj.get("lanes", [])
    green = sum(1 for l in lanes if l.get("status") == "green")
    yellow = sum(1 for l in lanes if l.get("status") == "yellow")
    red = sum(1 for l in lanes if l.get("status") == "red")
    return {
        "available": True,
        "lanes": lanes,
        "green": green,
        "yellow": yellow,
        "red": red,
        "total": len(lanes),
    }


def collect_review_queues() -> dict[str, Any]:
    """Count pending drafts across promotion lanes."""
    queues = {}
    draft_dirs = [
        ("doctrine", VAULT / "80_DoctrinePromotion" / "drafts"),
        ("decision", VAULT / "85_DecisionPromotion" / "drafts"),
        ("concept", VAULT / "86_ConceptPromotion" / "drafts"),
        ("project", VAULT / "87_ProjectPromotion" / "project_drafts"),
        ("work_order", VAULT / "87_ProjectPromotion" / "work_order_drafts"),
    ]
    total = 0
    for name, ddir in draft_dirs:
        count = _count_md(ddir)
        queues[name] = count
        total += count
    return {"queues": queues, "total": total}


def collect_git_backup_release_status() -> dict[str, Any]:
    """Gather Git, backup, and release state."""
    info: dict[str, Any] = {
        "git_repo": False, "branch": None, "commit": None,
        "clean": False, "tag": None, "remotes": 0,
        "archives": 0, "latest_archive": None,
        "restore_reports": 0, "latest_restore": None,
        "acceptance_report": None,
    }
    try:
        r = subprocess.run(["git", "rev-parse", "--is-inside-work-tree"],
                           capture_output=True, text=True, timeout=10)
        info["git_repo"] = r.returncode == 0
        if info["git_repo"]:
            r = subprocess.run(["git", "branch", "--show-current"],
                               capture_output=True, text=True, timeout=10)
            info["branch"] = r.stdout.strip() or None
            r = subprocess.run(["git", "log", "-1", "--format=%h %s"],
                               capture_output=True, text=True, timeout=10)
            info["commit"] = r.stdout.strip() or None
            r = subprocess.run(["git", "status", "--porcelain"],
                               capture_output=True, text=True, timeout=10)
            info["clean"] = len(r.stdout.strip()) == 0
            r = subprocess.run(["git", "describe", "--tags", "--abbrev=0"],
                               capture_output=True, text=True, timeout=10)
            if r.returncode == 0:
                info["tag"] = r.stdout.strip() or None
            r = subprocess.run(["git", "remote"],
                               capture_output=True, text=True, timeout=10)
            info["remotes"] = len([l for l in r.stdout.strip().splitlines() if l.strip()])
    except Exception:
        pass

    archive_dir = VAULT / "92_BackupGovernance" / "local_archives"
    if archive_dir.exists():
        archives = sorted(archive_dir.glob("WilliamOS-backup-*.zip"))
        info["archives"] = len(archives)
        info["latest_archive"] = archives[-1].name if archives else None

    restore_dir = VAULT / "93_RestoreDrill" / "reports"
    if restore_dir.exists():
        reports = sorted(restore_dir.glob("Restore Drill - *.md"))
        info["restore_reports"] = len(reports)
        info["latest_restore"] = reports[-1].name if reports else None

    acc_dir = VAULT / "95_ReleaseGovernance" / "reports"
    if acc_dir.exists():
        acc = sorted(acc_dir.glob("Acceptance Review - *.md"))
        info["acceptance_report"] = acc[-1].name if acc else None

    return info


def routine_status() -> dict[str, Any]:
    """Gather operating routine status."""
    docs_exist = all((VAULT / d).exists() for d in ROUTINE_REQUIRED_DOCS)
    cockpit = collect_cockpit_summary()
    queues = collect_review_queues()
    gbr = collect_git_backup_release_status()

    return {
        "routine_dir_exists": ROUTINE_DIR.exists(),
        "docs_exist": docs_exist,
        "latest_daily": _latest_file(DAILY_DIR, "Daily Review - *.md"),
        "latest_weekly": _latest_file(WEEKLY_DIR, "Weekly Operating Review - *.md"),
        "latest_monthly": _latest_file(MONTHLY_DIR, "Monthly Cortex Review - *.md"),
        "cockpit_available": cockpit["available"],
        "cockpit_green": cockpit.get("green", 0),
        "cockpit_yellow": cockpit.get("yellow", 0),
        "cockpit_red": cockpit.get("red", 0),
        "draft_queue_total": queues["total"],
        "draft_queues": queues["queues"],
        "git_clean": gbr["clean"],
        "latest_tag": gbr["tag"],
        "archives": gbr["archives"],
        "latest_archive": gbr["latest_archive"],
        "acceptance_report": gbr["acceptance_report"],
        "recommended_action": _recommend_next(cockpit, queues, gbr),
    }


def _recommend_next(cockpit: dict, queues: dict, gbr: dict) -> str:
    """Suggest the single most valuable next action."""
    if cockpit.get("red", 0) > 0:
        return "Review cockpit red lanes — run: python scripts/william.py cockpit"
    if queues["total"] > 5:
        return f"Review {queues['total']} pending promotion drafts"
    inbox_count = _count_md(VAULT / "00_Inbox")
    if inbox_count > 10:
        return f"Process inbox ({inbox_count} notes) — run: python scripts/william.py process-inbox --dry-run"
    if not gbr["clean"]:
        return "Snapshot uncommitted changes — run: python scripts/william.py snapshot --dry-run"
    return "System is healthy — capture a thought or review a draft"


def generate_daily_review(dry_run: bool = False) -> dict[str, Any]:
    """Generate a daily review note."""
    today = _today_iso()
    cockpit = collect_cockpit_summary()
    queues = collect_review_queues()
    gbr = collect_git_backup_release_status()
    inbox_count = _count_md(VAULT / "00_Inbox")

    lane_lines = []
    if cockpit["available"]:
        for lane in cockpit["lanes"]:
            status = lane.get("status", "unknown")
            icon = {"green": "OK", "yellow": "WARN", "red": "ACTION"}.get(status, "?")
            lane_lines.append(f"| {lane.get('name', '?')} | {icon} | {lane.get('detail', '')} |")

    queue_lines = []
    for qname, qcount in queues["queues"].items():
        if qcount > 0:
            queue_lines.append(f"- **{qname}**: {qcount} draft(s) awaiting review")

    top3 = []
    if cockpit.get("red", 0) > 0:
        top3.append("Address cockpit red lanes")
    if queues["total"] > 0:
        top3.append(f"Review {queues['total']} pending promotion drafts")
    if inbox_count > 5:
        top3.append(f"Process inbox ({inbox_count} unprocessed notes)")
    if not gbr["clean"]:
        top3.append("Snapshot uncommitted changes")
    if len(top3) == 0:
        top3.append("Capture a new thought or review a doctrine note")
    top3 = top3[:3]

    content = f"""---
type: daily-review
status: draft
generated: {_now_iso()}
date: {today}
tags:
  - routine
  - daily
  - generated
---

# Daily Review - {today}

## Start Here

Open this note at the start of your day. Review the summary, pick your top actions, and capture any thoughts.

## Cockpit Summary

"""
    if cockpit["available"]:
        content += f"Lanes: {cockpit['total']} | Green: {cockpit['green']} | Yellow: {cockpit['yellow']} | Red: {cockpit['red']}\n\n"
        content += "| Lane | Status | Detail |\n|---|---|---|\n"
        content += "\n".join(lane_lines) + "\n"
    else:
        content += "Cockpit data not available. Run: `python scripts/william.py cockpit`\n"

    content += f"""
## Inbox / Capture

- Inbox notes: {inbox_count}
- Quick capture: `python scripts/william.py inbox "your thought"`
- Process inbox: `python scripts/william.py process-inbox --dry-run`

## Review Queues

- Total drafts awaiting review: {queues['total']}
"""
    if queue_lines:
        content += "\n".join(queue_lines) + "\n"
    else:
        content += "- No pending promotion drafts\n"

    content += "\n## Today's Top 3\n\n"
    for i, t in enumerate(top3, 1):
        content += f"{i}. {t}\n"

    content += f"""
## Open Loops

Review the Open Loops dashboard: `WilliamOS/50_Dashboards/Open Loops.md`

## Quick Capture

Use this space for thoughts during the day:

-

## End-of-Day Truth

Before closing for the day:

- [ ] Did I capture at least one thought?
- [ ] Did I review any drafts?
- [ ] Is there anything I need to decide this week?

## Source Paths

- Cockpit: WilliamOS/89_ReviewCockpit/
- Inbox: WilliamOS/00_Inbox/
- Promotion drafts: 80-87 folders
- Git status: `python scripts/william.py git-status`

## Generator Notes

This note was generated by WilliamOS. Review before acting.
"""

    result = {
        "date": today,
        "inbox_count": inbox_count,
        "cockpit": cockpit,
        "queues": queues,
        "top3": top3,
        "content": content,
    }

    if not dry_run:
        DAILY_DIR.mkdir(parents=True, exist_ok=True)
        path = DAILY_DIR / f"Daily Review - {today}.md"
        path.write_text(content, encoding="utf-8")
        result["path"] = str(path)

    return result


def generate_weekly_operating_review(dry_run: bool = False) -> dict[str, Any]:
    """Generate a weekly operating review note."""
    week = _week_id()
    today = _today_iso()
    cockpit = collect_cockpit_summary()
    queues = collect_review_queues()
    gbr = collect_git_backup_release_status()
    inbox_count = _count_md(VAULT / "00_Inbox")

    synth_status = _run_cmd(["synth-status"])
    inbox_status = _run_cmd(["inbox-status"])

    snap_dry = _run_cmd(["snapshot", "--dry-run"])
    backup_dry = _run_cmd(["backup", "--dry-run"])

    review_order = [
        "1. Run synthesis: `python scripts/william.py synth-week`",
        "2. Process inbox: `python scripts/william.py process-inbox`",
        "3. Review promotion drafts (doctrine, decision, concept, project)",
        "4. Check cortex: `python scripts/william.py cortex-status`",
        "5. Snapshot: `python scripts/william.py snapshot --message \"Weekly snapshot\"`",
        "6. Backup: `python scripts/william.py backup --dry-run`",
    ]

    decisions_needed = []
    if queues["total"] > 0:
        decisions_needed.append(f"Review and accept/reject {queues['total']} promotion drafts")
    if not gbr["clean"]:
        decisions_needed.append("Decide whether to snapshot current changes")
    if cockpit.get("red", 0) > 0:
        decisions_needed.append("Address cockpit red lanes")

    content = f"""---
type: weekly-operating-review
status: draft
generated: {_now_iso()}
week: {week}
tags:
  - routine
  - weekly
  - generated
---

# Weekly Operating Review - {week}

## Executive Summary

Weekly review for {week} (generated {today}).
Cockpit: {cockpit.get('green', 0)} green / {cockpit.get('yellow', 0)} yellow / {cockpit.get('red', 0)} red.
Pending drafts: {queues['total']}.
Inbox: {inbox_count} notes.

## Weekly Synthesis

```
{synth_status['stdout'][:500] if synth_status['stdout'] else '(run synth-status to check)'}
```

## Inbox Processing

```
{inbox_status['stdout'][:500] if inbox_status['stdout'] else '(run inbox-status to check)'}
```

- Inbox count: {inbox_count}

## Promotion Draft Queues

| Lane | Pending Drafts |
|---|---|
"""
    for qname, qcount in queues["queues"].items():
        content += f"| {qname} | {qcount} |\n"

    content += f"""
Total: {queues['total']} drafts awaiting human review.

## Cortex / Graph Review

Run: `python scripts/william.py cortex-status`

## Git Snapshot Readiness

- Git repo: {'yes' if gbr['git_repo'] else 'no'}
- Branch: {gbr['branch'] or '(none)'}
- Latest commit: {gbr['commit'] or '(none)'}
- Clean tree: {'yes' if gbr['clean'] else 'no'}
- Latest tag: {gbr['tag'] or '(none)'}

```
{snap_dry['stdout'][:300] if snap_dry['stdout'] else '(snapshot dry-run output)'}
```

## Backup Readiness

- Archives: {gbr['archives']}
- Latest: {gbr['latest_archive'] or '(none)'}
- Restore reports: {gbr['restore_reports']}

```
{backup_dry['stdout'][:300] if backup_dry['stdout'] else '(backup dry-run output)'}
```

## Recommended Review Order

"""
    for step in review_order:
        content += f"{step}\n"

    content += "\n## Decisions Needed\n\n"
    if decisions_needed:
        for d in decisions_needed:
            content += f"- {d}\n"
    else:
        content += "- No immediate decisions required\n"

    content += f"""
## Candidate Next Work Orders

Review whether any promotion drafts suggest a new work order or project.

## Source Paths

- Cockpit: WilliamOS/89_ReviewCockpit/
- Synthesis: WilliamOS/60_Synthesis/
- Inbox: WilliamOS/00_Inbox/
- Promotions: WilliamOS/80-87 folders
- Git governance: WilliamOS/91_GitGovernance/
- Backup: WilliamOS/92_BackupGovernance/

## Generator Notes

This note was generated by WilliamOS. Review before acting.
"""

    result = {
        "week": week,
        "date": today,
        "cockpit": cockpit,
        "queues": queues,
        "inbox_count": inbox_count,
        "content": content,
    }

    if not dry_run:
        WEEKLY_DIR.mkdir(parents=True, exist_ok=True)
        path = WEEKLY_DIR / f"Weekly Operating Review - {week}.md"
        path.write_text(content, encoding="utf-8")
        result["path"] = str(path)

    return result


def generate_monthly_cortex_review(dry_run: bool = False) -> dict[str, Any]:
    """Generate a monthly cortex review note."""
    month = _month_id()
    today = _today_iso()
    cockpit = collect_cockpit_summary()
    queues = collect_review_queues()
    gbr = collect_git_backup_release_status()

    cortex = _load_cortex_json()
    cortex_available = cortex is not None

    central_nodes = []
    bridge_nodes = []
    orphan_nodes = []
    suggested_links = []

    if cortex:
        nodes = cortex.get("nodes", [])
        for n in sorted(nodes, key=lambda x: x.get("degree", 0), reverse=True)[:10]:
            central_nodes.append(f"- {n.get('name', '?')} (degree: {n.get('degree', 0)})")
        for n in nodes:
            if n.get("is_bridge"):
                bridge_nodes.append(f"- {n.get('name', '?')}")
        for n in nodes:
            if n.get("degree", 0) == 0:
                orphan_nodes.append(f"- {n.get('name', '?')}")
        slinks = cortex.get("suggested_links", [])
        for sl in slinks[:10]:
            suggested_links.append(f"- {sl.get('from', '?')} → {sl.get('to', '?')} ({sl.get('reason', '')})")

    content = f"""---
type: monthly-cortex-review
status: draft
generated: {_now_iso()}
month: {month}
tags:
  - routine
  - monthly
  - cortex
  - generated
---

# Monthly Cortex Review - {month}

## Executive Summary

Monthly cortex and system review for {month} (generated {today}).
Cortex data: {'available' if cortex_available else 'not available — run cortex-map first'}.
Cockpit: {cockpit.get('green', 0)} green / {cockpit.get('yellow', 0)} yellow / {cockpit.get('red', 0)} red.

## Cortex Map Status

{'Cortex graph loaded.' if cortex_available else 'No cortex graph found. Run: `python scripts/william.py cortex-map`'}
"""
    if cortex:
        content += f"- Nodes: {len(cortex.get('nodes', []))}\n"
        content += f"- Edges: {len(cortex.get('edges', []))}\n"

    content += "\n## Central Nodes\n\n"
    if central_nodes:
        content += "\n".join(central_nodes) + "\n"
    else:
        content += "- No cortex data available\n"

    content += "\n## Bridge Nodes\n\n"
    if bridge_nodes:
        content += "\n".join(bridge_nodes[:10]) + "\n"
    else:
        content += "- No bridge nodes identified\n"

    content += "\n## Orphan / Weak Notes\n\n"
    if orphan_nodes:
        content += "\n".join(orphan_nodes[:15]) + "\n"
    else:
        content += "- No orphan nodes\n"

    content += "\n## Suggested Links\n\n"
    if suggested_links:
        content += "\n".join(suggested_links) + "\n"
    else:
        content += "- No suggested links available\n"

    content += f"""
## Doctrine / Decision / Concept / Project Health

| Lane | Pending Drafts |
|---|---|
"""
    for qname, qcount in queues["queues"].items():
        content += f"| {qname} | {qcount} |\n"

    content += f"""
Total drafts: {queues['total']}

## Backup / Restore Confidence

- Archives: {gbr['archives']}
- Latest archive: {gbr['latest_archive'] or '(none)'}
- Restore reports: {gbr['restore_reports']}
- Latest restore: {gbr['latest_restore'] or '(none)'}

## Release State

- Latest tag: {gbr['tag'] or '(none)'}
- Acceptance report: {gbr['acceptance_report'] or '(none)'}
- Remotes: {gbr['remotes']}

## Monthly Questions

- Are there doctrine notes that should be updated or retired?
- Are there decisions past their review date?
- Are there concepts that have matured into projects?
- Is the cortex map showing the connections you expect?
- Should you create a new backup before next month?
- Is there a work order or project that needs starting?

## Recommended Next Month Focus

Review the cortex map and cockpit to identify the highest-value area to invest in next month.

## Source Paths

- Cortex: WilliamOS/88_CortexMap/
- Cockpit: WilliamOS/89_ReviewCockpit/
- Promotions: WilliamOS/80-87 folders
- Backup: WilliamOS/92_BackupGovernance/
- Release: WilliamOS/95_ReleaseGovernance/

## Generator Notes

This note was generated by WilliamOS. Review before acting.
"""

    result = {
        "month": month,
        "date": today,
        "cortex_available": cortex_available,
        "cockpit": cockpit,
        "queues": queues,
        "content": content,
    }

    if not dry_run:
        MONTHLY_DIR.mkdir(parents=True, exist_ok=True)
        path = MONTHLY_DIR / f"Monthly Cortex Review - {month}.md"
        path.write_text(content, encoding="utf-8")
        result["path"] = str(path)

    return result
