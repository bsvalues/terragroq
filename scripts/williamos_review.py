"""WilliamOS Human Review Queue Engine.

Scans promotion draft folders and generated review folders,
builds review queue reports, and generates acceptance checklists.
Never moves, deletes, or modifies drafts or official notes.
"""

import json
import os
import re
from datetime import datetime, timedelta
from pathlib import Path

try:
    import frontmatter
except ImportError:
    frontmatter = None

VAULT = Path(os.environ.get("WILLIAMOS_VAULT", "WilliamOS"))
TZ_NAME = os.environ.get("WILLIAMOS_TZ", "America/Los_Angeles")

REVIEW_DIR = VAULT / "97_HumanReviewQueues"
REPORTS_DIR = REVIEW_DIR / "reports"
CHECKLISTS_DIR = REVIEW_DIR / "checklists"
DATA_DIR = REVIEW_DIR / "data"

GOVERNANCE_DOCS = [
    "README.md",
    "REVIEW_QUEUE_POLICY.md",
    "ACCEPTANCE_WORKFLOW.md",
    "LANE_REVIEW_GUIDE.md",
    "MANUAL_MOVE_POLICY.md",
]

REVIEW_LANES = [
    {
        "key": "inbox_promoted_drafts",
        "label": "Inbox Promoted Drafts",
        "source_folder": "70_InboxProcessor/promoted_drafts",
        "official_destination": None,
        "stale_days": 14,
    },
    {
        "key": "doctrine_drafts",
        "label": "Doctrine Drafts",
        "source_folder": "80_DoctrinePromotion/drafts",
        "official_destination": "03_Doctrine",
        "stale_days": 30,
    },
    {
        "key": "decision_drafts",
        "label": "Decision Drafts",
        "source_folder": "85_DecisionPromotion/drafts",
        "official_destination": "02_Decisions",
        "stale_days": 30,
    },
    {
        "key": "concept_drafts",
        "label": "Concept Drafts",
        "source_folder": "86_ConceptPromotion/drafts",
        "official_destination": "10_Ideas",
        "stale_days": 30,
    },
    {
        "key": "project_drafts",
        "label": "Project Drafts",
        "source_folder": "87_ProjectPromotion/project_drafts",
        "official_destination": "11_Projects",
        "stale_days": 30,
    },
    {
        "key": "work_order_drafts",
        "label": "Work Order Drafts",
        "source_folder": "87_ProjectPromotion/work_order_drafts",
        "official_destination": "11_Projects",
        "stale_days": 30,
    },
    {
        "key": "suggested_links",
        "label": "Suggested Links",
        "source_folder": "88_CortexMap/suggested_links",
        "official_destination": None,
        "stale_days": 30,
    },
    {
        "key": "daily_reviews",
        "label": "Daily Reviews",
        "source_folder": "96_OperatingRoutine/daily",
        "official_destination": None,
        "stale_days": 14,
    },
    {
        "key": "weekly_reviews",
        "label": "Weekly Reviews",
        "source_folder": "96_OperatingRoutine/weekly",
        "official_destination": None,
        "stale_days": 14,
    },
    {
        "key": "monthly_reviews",
        "label": "Monthly Reviews",
        "source_folder": "96_OperatingRoutine/monthly",
        "official_destination": None,
        "stale_days": 14,
    },
]

LANE_KEY_ALIASES = {
    "doctrine": "doctrine_drafts",
    "decisions": "decision_drafts",
    "concepts": "concept_drafts",
    "projects": "project_drafts",
    "work-orders": "work_order_drafts",
    "work_orders": "work_order_drafts",
    "inbox": "inbox_promoted_drafts",
    "links": "suggested_links",
    "daily": "daily_reviews",
    "weekly": "weekly_reviews",
    "monthly": "monthly_reviews",
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


def _normalize_title(title: str) -> str:
    t = title.lower().strip()
    t = re.sub(r"[^a-z0-9\s]", "", t)
    return re.sub(r"\s+", " ", t).strip()


def _title_tokens(title: str) -> set:
    stop = {"the", "a", "an", "and", "or", "of", "in", "to", "for", "is", "on", "at", "by", "with"}
    words = _normalize_title(title).split()
    return {w for w in words if w not in stop and len(w) > 2}


def parse_draft_metadata(path: Path) -> dict:
    meta = {
        "path": str(path),
        "filename": path.name,
        "title": path.stem,
        "modified": None,
        "created": None,
        "status": None,
        "type": None,
        "source_path": None,
        "first_heading": None,
    }
    try:
        stat = path.stat()
        meta["modified"] = datetime.fromtimestamp(stat.st_mtime)
        meta["created"] = datetime.fromtimestamp(stat.st_ctime)
    except OSError:
        pass

    try:
        text = path.read_text(encoding="utf-8", errors="ignore")
    except OSError:
        return meta

    if frontmatter and text.startswith("---"):
        try:
            post = frontmatter.loads(text)
            fm = post.metadata
            meta["status"] = fm.get("status")
            meta["type"] = fm.get("type")
            meta["source_path"] = fm.get("source_path") or fm.get("source")
            if fm.get("generated"):
                gen = fm["generated"]
                if isinstance(gen, datetime):
                    meta["created"] = gen
                elif isinstance(gen, str):
                    for fmt in ("%Y-%m-%d %H:%M", "%Y-%m-%d"):
                        try:
                            meta["created"] = datetime.strptime(gen, fmt)
                            break
                        except ValueError:
                            pass
        except Exception:
            pass

    for line in text.split("\n"):
        stripped = line.strip()
        if stripped.startswith("# ") and not stripped.startswith("# ---"):
            meta["first_heading"] = stripped[2:].strip()
            break

    return meta


def scan_lane_items(lane: dict) -> list:
    folder = VAULT / lane["source_folder"]
    if not folder.exists():
        return []
    items = []
    for p in sorted(folder.glob("*.md")):
        if p.name.startswith("."):
            continue
        items.append(parse_draft_metadata(p))
    return items


def detect_stale_items(items: list, stale_days: int) -> list:
    cutoff = _now().replace(tzinfo=None) - timedelta(days=stale_days)
    stale = []
    for item in items:
        mod = item.get("modified")
        if mod and mod < cutoff:
            stale.append(item)
    return stale


def detect_possible_duplicates(items: list) -> list:
    duplicates = []
    seen_titles = {}
    seen_sources = {}
    seen_headings = {}

    for item in items:
        norm = _normalize_title(item["title"])
        if norm in seen_titles:
            duplicates.append({
                "item_a": seen_titles[norm]["filename"],
                "item_b": item["filename"],
                "reason": "same normalized title",
            })
        else:
            seen_titles[norm] = item

        sp = item.get("source_path")
        if sp:
            if sp in seen_sources:
                duplicates.append({
                    "item_a": seen_sources[sp]["filename"],
                    "item_b": item["filename"],
                    "reason": "same source_path",
                })
            else:
                seen_sources[sp] = item

        heading = item.get("first_heading")
        if heading:
            nh = _normalize_title(heading)
            if nh in seen_headings:
                duplicates.append({
                    "item_a": seen_headings[nh]["filename"],
                    "item_b": item["filename"],
                    "reason": "same first heading",
                })
            else:
                seen_headings[nh] = item

    tokens_list = [(item, _title_tokens(item["title"])) for item in items]
    for i in range(len(tokens_list)):
        for j in range(i + 1, len(tokens_list)):
            a_item, a_tok = tokens_list[i]
            b_item, b_tok = tokens_list[j]
            if not a_tok or not b_tok:
                continue
            overlap = a_tok & b_tok
            union = a_tok | b_tok
            if len(union) > 0 and len(overlap) / len(union) >= 0.7:
                pair_key = (a_item["filename"], b_item["filename"])
                already = any(
                    (d["item_a"], d["item_b"]) == pair_key or
                    (d["item_b"], d["item_a"]) == pair_key
                    for d in duplicates
                )
                if not already:
                    duplicates.append({
                        "item_a": a_item["filename"],
                        "item_b": b_item["filename"],
                        "reason": "similar title tokens",
                    })

    return duplicates


def rank_review_priority(lane_key: str, item_count: int, stale_count: int, has_destination: bool) -> str:
    if item_count == 0:
        return "none"
    if stale_count > 0 and has_destination:
        return "high"
    if item_count >= 5 and has_destination:
        return "high"
    if stale_count > 0:
        return "medium"
    if item_count >= 3:
        return "medium"
    return "low"


def scan_review_lanes(lane_filter=None):
    results = []
    for lane in REVIEW_LANES:
        if lane_filter and lane["key"] != lane_filter:
            continue
        items = scan_lane_items(lane)
        stale = detect_stale_items(items, lane["stale_days"])
        duplicates = detect_possible_duplicates(items)
        oldest = min((i["modified"] for i in items if i.get("modified")), default=None)
        newest = max((i["modified"] for i in items if i.get("modified")), default=None)
        has_dest = lane["official_destination"] is not None
        priority = rank_review_priority(lane["key"], len(items), len(stale), has_dest)
        results.append({
            "key": lane["key"],
            "label": lane["label"],
            "source_folder": lane["source_folder"],
            "official_destination": lane["official_destination"],
            "item_count": len(items),
            "items": items,
            "oldest_item": oldest.strftime("%Y-%m-%d") if oldest else None,
            "newest_item": newest.strftime("%Y-%m-%d") if newest else None,
            "stale_count": len(stale),
            "stale_items": stale,
            "stale_days_threshold": lane["stale_days"],
            "duplicates": duplicates,
            "priority": priority,
        })
    return results


def review_status():
    docs_exist = all((REVIEW_DIR / d).exists() for d in GOVERNANCE_DOCS)
    lanes = scan_review_lanes()
    total = sum(l["item_count"] for l in lanes)
    stale_total = sum(l["stale_count"] for l in lanes)
    oldest = None
    newest = None
    for l in lanes:
        if l["oldest_item"]:
            if oldest is None or l["oldest_item"] < oldest:
                oldest = l["oldest_item"]
        if l["newest_item"]:
            if newest is None or l["newest_item"] > newest:
                newest = l["newest_item"]

    latest_report = None
    if REPORTS_DIR.exists():
        reps = sorted(REPORTS_DIR.glob("Review Queues - *.md"))
        if reps:
            latest_report = reps[-1].name

    latest_checklist = None
    if CHECKLISTS_DIR.exists():
        chks = sorted(CHECKLISTS_DIR.glob("Acceptance Checklist - *.md"))
        if chks:
            latest_checklist = chks[-1].name

    return {
        "review_dir_exists": REVIEW_DIR.exists(),
        "docs_exist": docs_exist,
        "lanes": {l["key"]: l["item_count"] for l in lanes},
        "total_pending": total,
        "stale_total": stale_total,
        "oldest_pending": oldest,
        "newest_pending": newest,
        "latest_report": latest_report,
        "latest_checklist": latest_checklist,
        "priority_lanes": [l["key"] for l in lanes if l["priority"] in ("high", "medium")],
    }


def _recommended_review_order(lanes):
    priority_order = {"high": 0, "medium": 1, "low": 2, "none": 3}
    active = [l for l in lanes if l["item_count"] > 0]
    return sorted(active, key=lambda l: (priority_order.get(l["priority"], 3), -l["item_count"]))


def _manual_acceptance_steps(lane):
    dest = lane.get("official_destination")
    if not dest:
        return [
            "Read the generated review note",
            "Take any actions it suggests (manually)",
            "Archive or keep for reference",
        ]
    return [
        f"Read the draft in {lane['source_folder']}/",
        "Confirm the content is accurate and worth promoting",
        "Check for duplicate in " + dest + "/",
        "Edit the draft manually if needed",
        f"Move the file manually to WilliamOS/{dest}/",
        "Re-run cockpit-status and check after move",
        "Snapshot if meaningful",
    ]


def generate_review_queue_report(lane_filter=None, dry_run=False):
    now = _now()
    date_str = now.strftime("%Y-%m-%d")
    lanes = scan_review_lanes(lane_filter)
    total = sum(l["item_count"] for l in lanes)
    stale_total = sum(l["stale_count"] for l in lanes)
    all_duplicates = []
    for l in lanes:
        for d in l["duplicates"]:
            all_duplicates.append({**d, "lane": l["label"]})

    ordered = _recommended_review_order(lanes)
    high_priority = [l for l in lanes if l["priority"] in ("high", "medium")]

    if dry_run:
        return {
            "date": date_str,
            "total_pending": total,
            "stale_total": stale_total,
            "duplicate_count": len(all_duplicates),
            "lane_count": len(lanes),
            "lanes": [{
                "key": l["key"],
                "label": l["label"],
                "item_count": l["item_count"],
                "stale_count": l["stale_count"],
                "priority": l["priority"],
            } for l in lanes],
            "high_priority": [l["label"] for l in high_priority],
        }

    lines = []
    lines.append("---")
    lines.append("type: review-queue-report")
    lines.append("status: draft")
    lines.append(f"generated: \"{now.strftime('%Y-%m-%d %H:%M')}\"")
    lines.append("tags:")
    lines.append("  - review")
    lines.append("  - queue")
    lines.append("  - generated")
    lines.append("---")
    lines.append("")
    lines.append(f"# Human Review Queues - {date_str}")
    lines.append("")

    lines.append("## Executive Summary")
    lines.append("")
    lines.append(f"**{total}** items pending across **{len([l for l in lanes if l['item_count'] > 0])}** active lanes.")
    if stale_total:
        lines.append(f"**{stale_total}** items are stale and need attention.")
    if all_duplicates:
        lines.append(f"**{len(all_duplicates)}** possible duplicates detected.")
    lines.append("")

    lines.append("## Queue Totals")
    lines.append("")
    lines.append("| Lane | Count | Stale | Priority |")
    lines.append("|------|-------|-------|----------|")
    for l in lanes:
        lines.append(f"| {l['label']} | {l['item_count']} | {l['stale_count']} | {l['priority']} |")
    lines.append(f"| **Total** | **{total}** | **{stale_total}** | |")
    lines.append("")

    if high_priority:
        lines.append("## Highest Priority Reviews")
        lines.append("")
        for l in high_priority:
            lines.append(f"- **{l['label']}**: {l['item_count']} items ({l['stale_count']} stale)")
        lines.append("")

    lines.append("## Lane Status")
    lines.append("")
    for l in lanes:
        lines.append(f"### {l['label']}")
        lines.append("")
        lines.append(f"- Source: `WilliamOS/{l['source_folder']}/`")
        if l["official_destination"]:
            lines.append(f"- Destination: `WilliamOS/{l['official_destination']}/`")
        else:
            lines.append("- Destination: (review only, no move)")
        lines.append(f"- Items: {l['item_count']}")
        lines.append(f"- Stale (>{l['stale_days_threshold']}d): {l['stale_count']}")
        lines.append(f"- Oldest: {l['oldest_item'] or '(none)'}")
        lines.append(f"- Newest: {l['newest_item'] or '(none)'}")
        lines.append(f"- Priority: {l['priority']}")
        if l["items"]:
            lines.append("")
            lines.append("Items:")
            for item in l["items"]:
                mod = item["modified"].strftime("%Y-%m-%d") if item.get("modified") else "?"
                lines.append(f"  - `{item['filename']}` (modified: {mod})")
        lines.append("")
        steps = _manual_acceptance_steps(l)
        lines.append("Manual acceptance:")
        for s in steps:
            lines.append(f"  1. {s}")
        lines.append("")

    if any(l["stale_items"] for l in lanes):
        lines.append("## Stale Items")
        lines.append("")
        for l in lanes:
            if not l["stale_items"]:
                continue
            lines.append(f"### {l['label']} (>{l['stale_days_threshold']} days)")
            lines.append("")
            for item in l["stale_items"]:
                mod = item["modified"].strftime("%Y-%m-%d") if item.get("modified") else "?"
                lines.append(f"- `{item['filename']}` — last modified {mod}")
            lines.append("")

    if all_duplicates:
        lines.append("## Possible Duplicates")
        lines.append("")
        for d in all_duplicates:
            lines.append(f"- [{d['lane']}] `{d['item_a']}` <-> `{d['item_b']}` ({d['reason']})")
        lines.append("")

    if ordered:
        lines.append("## Recommended Review Order")
        lines.append("")
        for i, l in enumerate(ordered, 1):
            lines.append(f"{i}. **{l['label']}** — {l['item_count']} items, priority: {l['priority']}")
        lines.append("")

    lines.append("## Manual Acceptance Reminder")
    lines.append("")
    lines.append("- Every acceptance is a human act")
    lines.append("- Read each draft before deciding")
    lines.append("- Move files manually to official folders")
    lines.append("- Never auto-accept, auto-move, or auto-delete")
    lines.append("- Re-run cockpit-status after any manual moves")
    lines.append("- Snapshot after meaningful changes")
    lines.append("")

    lines.append("## Source Paths")
    lines.append("")
    for l in lanes:
        if l["item_count"] > 0:
            lines.append(f"- {l['label']}: `WilliamOS/{l['source_folder']}/`")
    lines.append("")

    lines.append("## Generator Notes")
    lines.append("")
    lines.append("This note was generated by WilliamOS. No drafts or official notes were moved, accepted, or modified.")
    lines.append("")

    _ensure_dirs()
    content = "\n".join(lines)
    lane_suffix = f"-{lane_filter}" if lane_filter else ""
    report_path = REPORTS_DIR / f"Review Queues - {date_str}{lane_suffix}.md"
    report_path.write_text(content, encoding="utf-8")

    json_data = {
        "date": date_str,
        "generated": now.strftime("%Y-%m-%d %H:%M"),
        "total_pending": total,
        "stale_total": stale_total,
        "duplicate_count": len(all_duplicates),
        "lanes": [{
            "key": l["key"],
            "label": l["label"],
            "source_folder": l["source_folder"],
            "official_destination": l["official_destination"],
            "item_count": l["item_count"],
            "stale_count": l["stale_count"],
            "priority": l["priority"],
            "oldest_item": l["oldest_item"],
            "newest_item": l["newest_item"],
            "items": [{"filename": i["filename"], "title": i["title"]} for i in l["items"]],
        } for l in lanes],
        "duplicates": all_duplicates,
        "review_order": [l["key"] for l in ordered],
    }
    json_path = DATA_DIR / f"review-queues-{date_str}{lane_suffix}.json"
    json_path.write_text(json.dumps(json_data, indent=2), encoding="utf-8")

    return {
        "date": date_str,
        "total_pending": total,
        "stale_total": stale_total,
        "duplicate_count": len(all_duplicates),
        "path": str(report_path),
        "json_path": str(json_path),
        "lane_count": len(lanes),
    }


def generate_acceptance_checklist(lane_filter=None, dry_run=False):
    now = _now()
    date_str = now.strftime("%Y-%m-%d")
    lanes = scan_review_lanes(lane_filter)
    active = [l for l in lanes if l["item_count"] > 0]

    if dry_run:
        return {
            "date": date_str,
            "lanes_with_items": len(active),
            "total_items": sum(l["item_count"] for l in active),
            "lanes": [{
                "key": l["key"],
                "label": l["label"],
                "item_count": l["item_count"],
            } for l in active],
        }

    lines = []
    lines.append("---")
    lines.append("type: acceptance-checklist")
    lines.append("status: draft")
    lines.append(f"generated: \"{now.strftime('%Y-%m-%d %H:%M')}\"")
    if lane_filter:
        lines.append(f"lane: {lane_filter}")
    else:
        lines.append("lane: all")
    lines.append("tags:")
    lines.append("  - review")
    lines.append("  - acceptance")
    lines.append("  - generated")
    lines.append("---")
    lines.append("")
    lines.append(f"# Acceptance Checklist - {date_str}")
    lines.append("")

    if lane_filter:
        matching = [l for l in REVIEW_LANES if l["key"] == lane_filter]
        lane_label = matching[0]["label"] if matching else lane_filter
        lines.append(f"## Lane: {lane_label}")
    else:
        lines.append("## Lane: All Lanes")
    lines.append("")

    lines.append("## Purpose")
    lines.append("")
    lines.append("Review each pending draft. Accept, revise, defer, or archive — every decision is manual.")
    lines.append("")

    for l in active:
        lines.append(f"## {l['label']}")
        lines.append("")
        lines.append(f"Source: `WilliamOS/{l['source_folder']}/`")
        if l["official_destination"]:
            lines.append(f"Official destination: `WilliamOS/{l['official_destination']}/`")
        else:
            lines.append("Official destination: (review only)")
        lines.append("")

        lines.append("### Items to Review")
        lines.append("")
        for item in l["items"]:
            mod = item["modified"].strftime("%Y-%m-%d") if item.get("modified") else "?"
            lines.append(f"- [ ] `{item['filename']}` (modified: {mod})")
        lines.append("")

        lines.append("### Review Steps")
        lines.append("")
        lines.append("For each item:")
        lines.append("")
        lines.append("- [ ] Read source draft")
        lines.append("- [ ] Confirm it is worth promoting")
        lines.append("- [ ] Check source evidence")
        if l["official_destination"]:
            lines.append(f"- [ ] Check for duplicate in `WilliamOS/{l['official_destination']}/`")
        lines.append("- [ ] Rename if needed")
        lines.append("- [ ] Edit draft manually if needed")
        if l["official_destination"]:
            lines.append(f"- [ ] Move manually to `WilliamOS/{l['official_destination']}/` only if accepted")
        lines.append("- [ ] Re-run cockpit/status after manual move")
        lines.append("- [ ] Snapshot if meaningful")
        lines.append("")

        if l["official_destination"]:
            lines.append(f"### Official Destination: `WilliamOS/{l['official_destination']}/`")
            lines.append("")

        if l["stale_items"]:
            lines.append(f"### Stale Items (>{l['stale_days_threshold']}d)")
            lines.append("")
            for item in l["stale_items"]:
                mod = item["modified"].strftime("%Y-%m-%d") if item.get("modified") else "?"
                lines.append(f"- `{item['filename']}` — last modified {mod}")
            lines.append("")

        if l["duplicates"]:
            lines.append("### Possible Duplicates")
            lines.append("")
            for d in l["duplicates"]:
                lines.append(f"- `{d['item_a']}` <-> `{d['item_b']}` ({d['reason']})")
            lines.append("")

    lines.append("## Do Not Do Automatically")
    lines.append("")
    lines.append("- [ ] Do not auto-move")
    lines.append("- [ ] Do not auto-delete")
    lines.append("- [ ] Do not mark accepted without review")
    lines.append("- [ ] Do not push")
    lines.append("")

    lines.append("## Source Paths")
    lines.append("")
    for l in active:
        lines.append(f"- {l['label']}: `WilliamOS/{l['source_folder']}/`")
    lines.append("")

    lines.append("## Generator Notes")
    lines.append("")
    lines.append("This checklist was generated by WilliamOS. Human review is required.")
    lines.append("")

    _ensure_dirs()
    content = "\n".join(lines)
    lane_suffix = f"-{lane_filter}" if lane_filter else ""
    checklist_path = CHECKLISTS_DIR / f"Acceptance Checklist - {date_str}{lane_suffix}.md"
    checklist_path.write_text(content, encoding="utf-8")

    return {
        "date": date_str,
        "path": str(checklist_path),
        "lanes_with_items": len(active),
        "total_items": sum(l["item_count"] for l in active),
    }


def resolve_lane_key(alias: str):
    if alias in LANE_KEY_ALIASES:
        return LANE_KEY_ALIASES[alias]
    for lane in REVIEW_LANES:
        if lane["key"] == alias:
            return alias
    return None
