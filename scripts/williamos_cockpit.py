"""WilliamOS review cockpit / command dashboard.

Collects status from all WilliamOS lanes, identifies review queues,
stale artifacts, and system health. Generates cockpit reports,
dashboard JSON, and optional standalone HTML.

Local-first, deterministic. Never modifies source notes.
"""
from __future__ import annotations

import datetime as dt
import json
import os
import re
from pathlib import Path
from typing import Any
from zoneinfo import ZoneInfo

VAULT = Path(os.environ.get("WILLIAMOS_VAULT", "WilliamOS"))
COCKPIT_DIR = VAULT / "89_ReviewCockpit"
REPORTS_DIR = COCKPIT_DIR / "reports"
DATA_DIR = COCKPIT_DIR / "data"
HTML_DIR = COCKPIT_DIR / "html"

COCKPIT_REQUIRED_DOCS = [
    "89_ReviewCockpit/README.md",
    "89_ReviewCockpit/COCKPIT_POLICY.md",
    "89_ReviewCockpit/DASHBOARD_MODEL.md",
    "89_ReviewCockpit/REVIEW_WORKFLOW.md",
]

REQUIRED_DIRS = [
    "00_Inbox", "01_Daily", "02_Decisions", "03_Doctrine", "04_Appraisal",
    "05_Assessor_Office", "06_TerraFusion_Strategy", "07_Learning", "08_People",
    "09_Cases", "10_Ideas", "11_Projects", "12_Maps", "13_Templates",
    "20_Graphify", "30_MCP", "40_Scripts", "40_Search", "50_Dashboards",
    "60_Synthesis", "70_InboxProcessor", "80_DoctrinePromotion",
    "85_DecisionPromotion", "86_ConceptPromotion", "87_ProjectPromotion",
    "88_CortexMap", "89_ReviewCockpit", "90_Exports", "99_Archive",
]

ALL_DOC_SETS: dict[str, list[str]] = {
    "mcp": [
        "30_MCP/AI_ACCESS_RULES.md",
        "30_MCP/MCP_WRITE_POLICY.md",
        "30_MCP/READ_ONLY_SCOPE_POLICY.md",
        "30_MCP/SAFE_AI_PROMPTS.md",
    ],
    "search": [
        "40_Search/README.md",
        "40_Search/SEARCH_POLICY.md",
        "40_Search/SEMANTIC_SEARCH_SETUP.md",
        "40_Search/QUERY_EXAMPLES.md",
    ],
    "synthesis": [
        "60_Synthesis/README.md",
        "60_Synthesis/WEEKLY_SYNTHESIS_POLICY.md",
        "60_Synthesis/WEEKLY_SYNTHESIS_TEMPLATE.md",
        "60_Synthesis/QUERY_STRATEGY.md",
    ],
    "inbox": [
        "70_InboxProcessor/README.md",
        "70_InboxProcessor/INBOX_PROCESSING_POLICY.md",
        "70_InboxProcessor/CLASSIFICATION_RULES.md",
        "70_InboxProcessor/PROMOTION_WORKFLOW.md",
    ],
    "doctrine": [
        "80_DoctrinePromotion/README.md",
        "80_DoctrinePromotion/DOCTRINE_PROMOTION_POLICY.md",
        "80_DoctrinePromotion/DETECTION_RULES.md",
        "80_DoctrinePromotion/REVIEW_WORKFLOW.md",
    ],
    "decision": [
        "85_DecisionPromotion/README.md",
        "85_DecisionPromotion/DECISION_PROMOTION_POLICY.md",
        "85_DecisionPromotion/DETECTION_RULES.md",
        "85_DecisionPromotion/REVIEW_WORKFLOW.md",
    ],
    "concept": [
        "86_ConceptPromotion/README.md",
        "86_ConceptPromotion/CONCEPT_PROMOTION_POLICY.md",
        "86_ConceptPromotion/DETECTION_RULES.md",
        "86_ConceptPromotion/REVIEW_WORKFLOW.md",
    ],
    "project": [
        "87_ProjectPromotion/README.md",
        "87_ProjectPromotion/PROJECT_PROMOTION_POLICY.md",
        "87_ProjectPromotion/DETECTION_RULES.md",
        "87_ProjectPromotion/REVIEW_WORKFLOW.md",
    ],
    "cortex": [
        "88_CortexMap/README.md",
        "88_CortexMap/CORTEX_MAP_POLICY.md",
        "88_CortexMap/GRAPH_MODEL.md",
        "88_CortexMap/REVIEW_WORKFLOW.md",
    ],
    "cockpit": COCKPIT_REQUIRED_DOCS,
}


def _local_today() -> dt.date:
    tz_name = os.environ.get("WILLIAMOS_TZ", "America/Los_Angeles")
    return dt.datetime.now(ZoneInfo(tz_name)).date()


def _count_md(directory: Path) -> int:
    if not directory.exists():
        return 0
    return len(list(directory.glob("*.md")))


def _count_json(directory: Path) -> int:
    if not directory.exists():
        return 0
    return len(list(directory.glob("*.json")))


def _count_html(directory: Path) -> int:
    if not directory.exists():
        return 0
    return len(list(directory.glob("*.html")))


def _latest_file(directory: Path, pattern: str = "*.md") -> str | None:
    if not directory.exists():
        return None
    files = sorted(directory.glob(pattern), reverse=True)
    return files[0].name if files else None


def _docs_exist(doc_set: str) -> bool:
    docs = ALL_DOC_SETS.get(doc_set, [])
    return all((VAULT / d).exists() for d in docs)


def _frontmatter_field(text: str, field: str) -> str | None:
    if not text.startswith("---"):
        return None
    parts = text.split("---", 2)
    if len(parts) < 3:
        return None
    for line in parts[1].splitlines():
        if line.strip().startswith(field + ":"):
            return line.split(":", 1)[1].strip().strip('"')
    return None


def check_required_docs() -> dict[str, bool]:
    return {name: _docs_exist(name) for name in ALL_DOC_SETS}


def _check_dirs() -> list[str]:
    missing = []
    for d in REQUIRED_DIRS:
        if not (VAULT / d).exists():
            missing.append(d)
    return missing


def _read_semantic_status() -> dict[str, Any]:
    status_path = VAULT / "40_Search" / "generated" / "status.json"
    if not status_path.exists():
        return {"available": False, "index_exists": False}
    try:
        data = json.loads(status_path.read_text(encoding="utf-8"))
        return {
            "available": True,
            "index_exists": True,
            "mode": data.get("mode", "unknown"),
            "files_indexed": data.get("files_indexed", 0),
            "created_at": data.get("created_at", ""),
        }
    except (json.JSONDecodeError, OSError):
        return {"available": False, "index_exists": False}


def _read_stale_decisions() -> list[str]:
    dec_dir = VAULT / "02_Decisions"
    if not dec_dir.exists():
        return []
    today = _local_today()
    stale = []
    for p in dec_dir.glob("*.md"):
        text = p.read_text(encoding="utf-8", errors="ignore")
        status = _frontmatter_field(text, "status")
        review = _frontmatter_field(text, "review")
        if status == "closed" or not review:
            continue
        try:
            review_date = dt.date.fromisoformat(review)
        except ValueError:
            continue
        if review_date <= today:
            stale.append(p.name)
    return stale


def _read_orphan_notes() -> list[str]:
    link_re = re.compile(r"\[\[([^\]|#]+)")
    exclude_dirs = {
        "13_Templates", "20_Graphify", "30_MCP", "40_Scripts", "40_Search",
        "50_Dashboards", "60_Synthesis", "70_InboxProcessor",
        "80_DoctrinePromotion", "85_DecisionPromotion", "86_ConceptPromotion",
        "87_ProjectPromotion", "88_CortexMap", "89_ReviewCockpit",
        "90_Exports", "99_Archive",
    }
    if not VAULT.exists():
        return []
    files = list(VAULT.rglob("*.md"))
    linked_names: set[str] = set()
    for p in files:
        text = p.read_text(encoding="utf-8", errors="ignore")
        linked_names.update(m.group(1).strip() for m in link_re.finditer(text))
    orphans = []
    for p in files:
        try:
            rel = p.relative_to(VAULT)
        except ValueError:
            continue
        parts = rel.parts
        if not parts or parts[0] in exclude_dirs:
            continue
        if p.stem.startswith("MOC -"):
            continue
        if p.stem not in linked_names:
            orphans.append(str(rel).replace("\\", "/"))
    return sorted(orphans)


def collect_lane_statuses() -> list[dict[str, Any]]:
    lanes = []

    lanes.append(_lane_system_check())
    lanes.append(_lane_mcp_guardrails())
    lanes.append(_lane_semantic_search())
    lanes.append(_lane_weekly_synthesis())
    lanes.append(_lane_inbox_processor())
    lanes.append(_lane_doctrine_promotion())
    lanes.append(_lane_decision_promotion())
    lanes.append(_lane_concept_promotion())
    lanes.append(_lane_project_promotion())
    lanes.append(_lane_cortex_map())
    lanes.append(_lane_orphan_notes())
    lanes.append(_lane_stale_decisions())

    return lanes


def _lane_system_check() -> dict[str, Any]:
    missing_dirs = _check_dirs()
    doc_status = check_required_docs()
    missing_docs = [k for k, v in doc_status.items() if not v]

    if not missing_dirs and not missing_docs:
        status = "green"
        summary = "All directories and docs present"
    elif missing_dirs:
        status = "red"
        summary = f"{len(missing_dirs)} missing dirs"
    else:
        status = "yellow"
        summary = f"{len(missing_docs)} doc sets incomplete"

    return {
        "name": "system_check",
        "status": status,
        "summary": summary,
        "artifact_count": len(REQUIRED_DIRS) - len(missing_dirs),
        "draft_count": 0,
        "review_needed": bool(missing_dirs or missing_docs),
        "latest_artifact": "",
        "recommended_action": "Run `python scripts/william.py init` to fix missing dirs" if missing_dirs else "",
        "source_paths": [f"missing dir: {d}" for d in missing_dirs],
    }


def _lane_mcp_guardrails() -> dict[str, Any]:
    docs_ok = _docs_exist("mcp")
    mcp_dir = VAULT / "30_MCP"
    if docs_ok and mcp_dir.exists():
        status = "green"
        summary = "MCP docs present, guardrails configured"
    elif mcp_dir.exists():
        status = "yellow"
        summary = "MCP dir exists but docs incomplete"
    else:
        status = "red"
        summary = "MCP directory missing"

    return {
        "name": "mcp_guardrails",
        "status": status,
        "summary": summary,
        "artifact_count": _count_md(mcp_dir),
        "draft_count": 0,
        "review_needed": not docs_ok,
        "latest_artifact": "",
        "recommended_action": "Run `python scripts/william.py mcp-check`" if not docs_ok else "",
        "source_paths": [],
    }


def _lane_semantic_search() -> dict[str, Any]:
    sem = _read_semantic_status()
    docs_ok = _docs_exist("search")
    if sem.get("index_exists") and docs_ok:
        status = "green"
        summary = f"Index: {sem.get('mode', '?')}, {sem.get('files_indexed', 0)} files"
    elif docs_ok and not sem.get("index_exists"):
        status = "yellow"
        summary = "Docs present but no index built"
    elif not docs_ok:
        status = "red"
        summary = "Search docs missing"
    else:
        status = "unknown"
        summary = "Status unavailable"

    return {
        "name": "semantic_search",
        "status": status,
        "summary": summary,
        "artifact_count": 1 if sem.get("index_exists") else 0,
        "draft_count": 0,
        "review_needed": not sem.get("index_exists"),
        "latest_artifact": sem.get("created_at", ""),
        "recommended_action": "Run `python scripts/william.py semantic-index`" if not sem.get("index_exists") else "",
        "source_paths": [],
    }


def _lane_weekly_synthesis() -> dict[str, Any]:
    docs_ok = _docs_exist("synthesis")
    synth_dir = VAULT / "60_Synthesis"
    reports = sorted(synth_dir.glob("Weekly Synthesis*.md"), reverse=True) if synth_dir.exists() else []
    latest = reports[0].name if reports else None

    if docs_ok and reports:
        status = "green"
        summary = f"{len(reports)} synthesis reports"
    elif docs_ok and not reports:
        status = "yellow"
        summary = "Docs present but no synthesis reports"
    else:
        status = "red"
        summary = "Synthesis docs missing"

    return {
        "name": "weekly_synthesis",
        "status": status,
        "summary": summary,
        "artifact_count": len(reports),
        "draft_count": 0,
        "review_needed": not reports,
        "latest_artifact": latest or "",
        "recommended_action": "Run `python scripts/william.py synth-week`" if not reports else "",
        "source_paths": [],
    }


def _lane_inbox_processor() -> dict[str, Any]:
    docs_ok = _docs_exist("inbox")
    inbox_dir = VAULT / "00_Inbox"
    inbox_count = _count_md(inbox_dir)
    reports_dir = VAULT / "70_InboxProcessor" / "reports"
    report_count = _count_md(reports_dir)
    drafts_dir = VAULT / "70_InboxProcessor" / "promoted_drafts"
    draft_count = _count_md(drafts_dir)
    latest = _latest_file(reports_dir)

    if docs_ok and inbox_count == 0:
        status = "green"
        summary = "Inbox empty, processor ready"
    elif docs_ok and inbox_count > 0:
        status = "yellow"
        summary = f"{inbox_count} inbox notes waiting"
    else:
        status = "red"
        summary = "Inbox processor docs missing"

    return {
        "name": "inbox_processor",
        "status": status,
        "summary": summary,
        "artifact_count": report_count,
        "draft_count": draft_count,
        "review_needed": inbox_count > 0 or draft_count > 0,
        "latest_artifact": latest or "",
        "recommended_action": f"Process {inbox_count} inbox notes" if inbox_count > 0 else "",
        "source_paths": [],
    }


def _lane_doctrine_promotion() -> dict[str, Any]:
    docs_ok = _docs_exist("doctrine")
    official_count = _count_md(VAULT / "03_Doctrine")
    reports_dir = VAULT / "80_DoctrinePromotion" / "reports"
    drafts_dir = VAULT / "80_DoctrinePromotion" / "drafts"
    report_count = _count_md(reports_dir)
    draft_count = _count_md(drafts_dir)
    latest = _latest_file(reports_dir)

    if docs_ok and draft_count == 0:
        status = "green"
        summary = f"{official_count} official, no pending drafts"
    elif docs_ok and draft_count > 0:
        status = "yellow"
        summary = f"{official_count} official, {draft_count} drafts waiting"
    else:
        status = "red"
        summary = "Doctrine promotion docs missing"

    return {
        "name": "doctrine_promotion",
        "status": status,
        "summary": summary,
        "artifact_count": report_count,
        "draft_count": draft_count,
        "review_needed": draft_count > 0,
        "latest_artifact": latest or "",
        "recommended_action": f"Review {draft_count} doctrine drafts" if draft_count > 0 else "",
        "source_paths": [],
    }


def _lane_decision_promotion() -> dict[str, Any]:
    docs_ok = _docs_exist("decision")
    official_count = _count_md(VAULT / "02_Decisions")
    reports_dir = VAULT / "85_DecisionPromotion" / "reports"
    drafts_dir = VAULT / "85_DecisionPromotion" / "drafts"
    report_count = _count_md(reports_dir)
    draft_count = _count_md(drafts_dir)
    latest = _latest_file(reports_dir)

    if docs_ok and draft_count == 0:
        status = "green"
        summary = f"{official_count} official, no pending drafts"
    elif docs_ok and draft_count > 0:
        status = "yellow"
        summary = f"{official_count} official, {draft_count} drafts waiting"
    else:
        status = "red"
        summary = "Decision promotion docs missing"

    return {
        "name": "decision_promotion",
        "status": status,
        "summary": summary,
        "artifact_count": report_count,
        "draft_count": draft_count,
        "review_needed": draft_count > 0,
        "latest_artifact": latest or "",
        "recommended_action": f"Review {draft_count} decision drafts" if draft_count > 0 else "",
        "source_paths": [],
    }


def _lane_concept_promotion() -> dict[str, Any]:
    docs_ok = _docs_exist("concept")
    official_count = _count_md(VAULT / "10_Ideas")
    reports_dir = VAULT / "86_ConceptPromotion" / "reports"
    drafts_dir = VAULT / "86_ConceptPromotion" / "drafts"
    report_count = _count_md(reports_dir)
    draft_count = _count_md(drafts_dir)
    latest = _latest_file(reports_dir)

    if docs_ok and draft_count == 0:
        status = "green"
        summary = f"{official_count} official, no pending drafts"
    elif docs_ok and draft_count > 0:
        status = "yellow"
        summary = f"{official_count} official, {draft_count} drafts waiting"
    else:
        status = "red"
        summary = "Concept promotion docs missing"

    return {
        "name": "concept_promotion",
        "status": status,
        "summary": summary,
        "artifact_count": report_count,
        "draft_count": draft_count,
        "review_needed": draft_count > 0,
        "latest_artifact": latest or "",
        "recommended_action": f"Review {draft_count} concept drafts" if draft_count > 0 else "",
        "source_paths": [],
    }


def _lane_project_promotion() -> dict[str, Any]:
    docs_ok = _docs_exist("project")
    official_count = _count_md(VAULT / "11_Projects")
    reports_dir = VAULT / "87_ProjectPromotion" / "reports"
    proj_drafts = VAULT / "87_ProjectPromotion" / "project_drafts"
    wo_drafts = VAULT / "87_ProjectPromotion" / "work_order_drafts"
    report_count = _count_md(reports_dir)
    proj_count = _count_md(proj_drafts)
    wo_count = _count_md(wo_drafts)
    total_drafts = proj_count + wo_count
    latest = _latest_file(reports_dir)

    if docs_ok and total_drafts == 0:
        status = "green"
        summary = f"{official_count} official, no pending drafts"
    elif docs_ok and total_drafts > 0:
        status = "yellow"
        summary = f"{official_count} official, {proj_count} project + {wo_count} WO drafts"
    else:
        status = "red"
        summary = "Project promotion docs missing"

    return {
        "name": "project_promotion",
        "status": status,
        "summary": summary,
        "artifact_count": report_count,
        "draft_count": total_drafts,
        "review_needed": total_drafts > 0,
        "latest_artifact": latest or "",
        "recommended_action": f"Review {total_drafts} project/WO drafts" if total_drafts > 0 else "",
        "source_paths": [],
    }


def _lane_cortex_map() -> dict[str, Any]:
    docs_ok = _docs_exist("cortex")
    reports_dir = VAULT / "88_CortexMap" / "reports"
    graphs_dir = VAULT / "88_CortexMap" / "graphs"
    report_count = _count_md(reports_dir)
    graph_count = _count_json(graphs_dir)
    latest = _latest_file(reports_dir)

    if docs_ok and report_count > 0:
        status = "green"
        summary = f"{report_count} cortex reviews, {graph_count} graphs"
    elif docs_ok and report_count == 0:
        status = "yellow"
        summary = "Docs present but no cortex review yet"
    else:
        status = "red"
        summary = "Cortex map docs missing"

    return {
        "name": "cortex_map",
        "status": status,
        "summary": summary,
        "artifact_count": report_count + graph_count,
        "draft_count": 0,
        "review_needed": report_count == 0,
        "latest_artifact": latest or "",
        "recommended_action": "Run `python scripts/william.py cortex-map`" if report_count == 0 else "",
        "source_paths": [],
    }


def _lane_orphan_notes() -> dict[str, Any]:
    orphans = _read_orphan_notes()
    if not orphans:
        status = "green"
        summary = "No orphan notes"
    elif len(orphans) <= 5:
        status = "yellow"
        summary = f"{len(orphans)} orphan notes"
    else:
        status = "yellow"
        summary = f"{len(orphans)} orphan notes"

    return {
        "name": "orphan_notes",
        "status": status,
        "summary": summary,
        "artifact_count": len(orphans),
        "draft_count": 0,
        "review_needed": len(orphans) > 0,
        "latest_artifact": "",
        "recommended_action": f"Link or archive {len(orphans)} orphan notes" if orphans else "",
        "source_paths": orphans[:20],
    }


def _lane_stale_decisions() -> dict[str, Any]:
    stale = _read_stale_decisions()
    if not stale:
        status = "green"
        summary = "No stale decisions"
    else:
        status = "yellow"
        summary = f"{len(stale)} decisions past review date"

    return {
        "name": "stale_decisions",
        "status": status,
        "summary": summary,
        "artifact_count": len(stale),
        "draft_count": 0,
        "review_needed": len(stale) > 0,
        "latest_artifact": "",
        "recommended_action": f"Review {len(stale)} stale decisions" if stale else "",
        "source_paths": stale[:20],
    }


def _overall_status(lanes: list[dict[str, Any]]) -> str:
    statuses = [l["status"] for l in lanes]
    if "red" in statuses:
        return "red"
    if "yellow" in statuses:
        return "yellow"
    if all(s == "green" for s in statuses):
        return "green"
    return "unknown"


def _build_queues(lanes: list[dict[str, Any]]) -> dict[str, int]:
    lane_map = {l["name"]: l for l in lanes}
    inbox_lane = lane_map.get("inbox_processor", {})
    inbox_dir = VAULT / "00_Inbox"

    return {
        "inbox_items": _count_md(inbox_dir),
        "doctrine_drafts": lane_map.get("doctrine_promotion", {}).get("draft_count", 0),
        "decision_drafts": lane_map.get("decision_promotion", {}).get("draft_count", 0),
        "concept_drafts": lane_map.get("concept_promotion", {}).get("draft_count", 0),
        "project_drafts": _count_md(VAULT / "87_ProjectPromotion" / "project_drafts"),
        "work_order_drafts": _count_md(VAULT / "87_ProjectPromotion" / "work_order_drafts"),
        "suggested_links": _count_md(VAULT / "88_CortexMap" / "suggested_links"),
    }


def _build_latest() -> dict[str, str]:
    return {
        "weekly_synthesis": _latest_file(VAULT / "60_Synthesis", "Weekly Synthesis*.md") or "",
        "cortex_review": _latest_file(VAULT / "88_CortexMap" / "reports") or "",
        "semantic_index": _read_semantic_status().get("created_at", ""),
        "cockpit_report": _latest_file(REPORTS_DIR) or "",
    }


def recommend_actions(lanes: list[dict[str, Any]]) -> list[str]:
    actions = []
    for lane in lanes:
        if lane["review_needed"] and lane["recommended_action"]:
            actions.append(lane["recommended_action"])
    return actions


def generate_cockpit_report(
    lanes: list[dict[str, Any]],
    queues: dict[str, int],
    latest: dict[str, str],
) -> str:
    today = _local_today().isoformat()
    overall = _overall_status(lanes)
    actions = recommend_actions(lanes)
    total_review = sum(1 for l in lanes if l["review_needed"])

    lines = [
        "---",
        "type: review-cockpit",
        "status: draft",
        f"generated: {today}",
        "tags:",
        "  - cockpit",
        "  - review",
        "  - generated",
        "---",
        "",
        f"# Review Cockpit - {today}",
        "",
        "## Executive Summary",
        "",
        f"Overall status: **{overall.upper()}**",
        f"Lanes needing review: **{total_review}** of {len(lanes)}",
        "",
        f"Total draft queue: {sum(queues.values())} items",
        "",
    ]

    lines.append("## Overall Status")
    lines.append("")
    status_icon = {"green": "OK", "yellow": "REVIEW", "red": "ACTION", "unknown": "?"}
    for lane in lanes:
        icon = status_icon.get(lane["status"], "?")
        lines.append(f"- [{icon}] **{lane['name']}**: {lane['summary']}")
    lines.append("")

    lines.append("## Review Queues")
    lines.append("")
    lines.append("| Queue | Count |")
    lines.append("|-------|-------|")
    for k, v in queues.items():
        lines.append(f"| {k.replace('_', ' ').title()} | {v} |")
    lines.append("")

    lines.append("## Lane Status")
    lines.append("")
    for lane in lanes:
        title = lane["name"].replace("_", " ").title()
        lines.append(f"### {title}")
        lines.append("")
        lines.append(f"Status: **{lane['status'].upper()}**")
        lines.append(f"Summary: {lane['summary']}")
        if lane["artifact_count"]:
            lines.append(f"Artifacts: {lane['artifact_count']}")
        if lane["draft_count"]:
            lines.append(f"Drafts: {lane['draft_count']}")
        if lane["latest_artifact"]:
            lines.append(f"Latest: {lane['latest_artifact']}")
        if lane["review_needed"]:
            lines.append(f"Review needed: yes")
        if lane["recommended_action"]:
            lines.append(f"Action: {lane['recommended_action']}")
        if lane["source_paths"]:
            lines.append("Files:")
            for sp in lane["source_paths"][:10]:
                lines.append(f"- `{sp}`")
        lines.append("")

    lines.append("## Recommended Review Order")
    lines.append("")
    if actions:
        for i, action in enumerate(actions, 1):
            lines.append(f"{i}. {action}")
    else:
        lines.append("No actions needed. All lanes are green.")
    lines.append("")

    lines.append("## Latest Artifacts")
    lines.append("")
    for k, v in latest.items():
        label = k.replace("_", " ").title()
        lines.append(f"- **{label}**: {v or 'none'}")
    lines.append("")

    lines.append("## Risks / Warnings")
    lines.append("")
    reds = [l for l in lanes if l["status"] == "red"]
    if reds:
        for l in reds:
            lines.append(f"- **{l['name']}**: {l['summary']}")
    else:
        lines.append("No critical issues.")
    lines.append("")

    source_notes = []
    for lane in lanes:
        source_notes.extend(lane.get("source_paths", []))

    lines.append("## Source Paths")
    lines.append("")
    if source_notes:
        for sp in sorted(set(source_notes)):
            lines.append(f"- `{sp}`")
    else:
        lines.append("No source paths to report.")
    lines.append("")

    lines.append("## Generator Notes")
    lines.append("")
    lines.append("This note was generated by WilliamOS. Review before acting. No source notes were modified.")
    lines.append("")

    return "\n".join(lines)


def write_cockpit_json(
    lanes: list[dict[str, Any]],
    queues: dict[str, int],
    latest: dict[str, str],
) -> Path:
    today = _local_today().isoformat()
    DATA_DIR.mkdir(parents=True, exist_ok=True)

    data = {
        "generated": today,
        "status": _overall_status(lanes),
        "lanes": lanes,
        "queues": queues,
        "latest": latest,
    }

    path = DATA_DIR / f"cockpit-status-{today}.json"
    path.write_text(
        json.dumps(data, indent=2, ensure_ascii=False),
        encoding="utf-8",
    )
    return path


def write_cockpit_html(
    lanes: list[dict[str, Any]],
    queues: dict[str, int],
    latest: dict[str, str],
) -> Path:
    today = _local_today().isoformat()
    HTML_DIR.mkdir(parents=True, exist_ok=True)

    overall = _overall_status(lanes)
    actions = recommend_actions(lanes)
    total_review = sum(1 for l in lanes if l["review_needed"])
    total_queue = sum(queues.values())

    status_colors = {
        "green": "#7ee787",
        "yellow": "#ffd166",
        "red": "#ff7b72",
        "unknown": "#9aa7b2",
    }

    lane_rows = ""
    for lane in lanes:
        color = status_colors.get(lane["status"], "#9aa7b2")
        lane_rows += f"""
        <tr>
          <td><span style="display:inline-block;width:12px;height:12px;border-radius:50%;background:{color};margin-right:8px;"></span>{lane['name'].replace('_', ' ').title()}</td>
          <td style="color:{color};font-weight:600;">{lane['status'].upper()}</td>
          <td>{lane['summary']}</td>
          <td>{lane['draft_count'] if lane['draft_count'] else '-'}</td>
          <td>{lane['recommended_action'] or '-'}</td>
        </tr>"""

    queue_rows = ""
    for k, v in queues.items():
        label = k.replace("_", " ").title()
        queue_rows += f"<tr><td>{label}</td><td>{v}</td></tr>\n"

    latest_rows = ""
    for k, v in latest.items():
        label = k.replace("_", " ").title()
        latest_rows += f"<tr><td>{label}</td><td>{v or 'none'}</td></tr>\n"

    action_list = ""
    if actions:
        for i, a in enumerate(actions, 1):
            action_list += f"<li>{a}</li>\n"
    else:
        action_list = "<li>No actions needed. All lanes are green.</li>"

    overall_color = status_colors.get(overall, "#9aa7b2")

    html = f"""<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>WilliamOS Review Cockpit - {today}</title>
  <style>
    :root {{
      --bg: #0d1117;
      --panel: rgba(22, 27, 34, 0.92);
      --text: #e6edf3;
      --muted: #9aa7b2;
      --line: rgba(139, 148, 158, 0.28);
      --accent: #70e1c8;
      --green: #7ee787;
      --yellow: #ffd166;
      --red: #ff7b72;
      --mono: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
      --sans: Inter, ui-sans-serif, system-ui, sans-serif;
    }}
    * {{ box-sizing: border-box; margin: 0; }}
    body {{ font-family: var(--sans); color: var(--text); background: var(--bg); padding: 24px; line-height: 1.55; }}
    .shell {{ max-width: 1100px; margin: 0 auto; }}
    h1 {{ font-size: 1.8rem; margin-bottom: 8px; }}
    h2 {{ font-size: 1.2rem; margin: 24px 0 12px; color: var(--accent); }}
    .card {{ background: var(--panel); border-radius: 14px; padding: 20px; margin-bottom: 16px; }}
    .status-badge {{ display: inline-block; padding: 6px 18px; border-radius: 8px; font-weight: 700; font-size: 1.1rem; color: #0d1117; }}
    .grid {{ display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 12px; }}
    .metric {{ background: var(--panel); border-radius: 10px; padding: 14px; text-align: center; }}
    .metric .num {{ font-size: 1.6rem; font-weight: 700; font-family: var(--mono); }}
    .metric .label {{ font-size: 0.85rem; color: var(--muted); }}
    table {{ width: 100%; border-collapse: collapse; }}
    th, td {{ text-align: left; padding: 8px 12px; border-bottom: 1px solid var(--line); font-size: 0.9rem; }}
    th {{ color: var(--muted); font-weight: 600; }}
    ol {{ padding-left: 20px; }}
    li {{ margin: 4px 0; }}
    .footer {{ margin-top: 32px; padding-top: 16px; border-top: 1px solid var(--line); color: var(--muted); font-size: 0.8rem; }}
  </style>
</head>
<body>
  <div class="shell">
    <h1>WilliamOS Review Cockpit</h1>
    <p style="color:var(--muted);">Generated: {today}</p>

    <div class="card" style="margin-top:16px;">
      <span class="status-badge" style="background:{overall_color};">{overall.upper()}</span>
      <span style="margin-left:16px;">{total_review} of {len(lanes)} lanes need review &middot; {total_queue} items in queue</span>
    </div>

    <h2>Review Queues</h2>
    <div class="grid">
      {"".join(f'<div class="metric"><div class="num">{v}</div><div class="label">{k.replace("_", " ").title()}</div></div>' for k, v in queues.items())}
    </div>

    <h2>Lane Status</h2>
    <div class="card">
      <table>
        <thead><tr><th>Lane</th><th>Status</th><th>Summary</th><th>Drafts</th><th>Action</th></tr></thead>
        <tbody>{lane_rows}</tbody>
      </table>
    </div>

    <h2>Recommended Review Order</h2>
    <div class="card">
      <ol>{action_list}</ol>
    </div>

    <h2>Latest Artifacts</h2>
    <div class="card">
      <table>
        <thead><tr><th>Artifact</th><th>Value</th></tr></thead>
        <tbody>{latest_rows}</tbody>
      </table>
    </div>

    <div class="footer">
      Generated by WilliamOS. Review before acting. No source notes were modified.
    </div>
  </div>
</body>
</html>"""

    path = HTML_DIR / f"Review Cockpit - {today}.html"
    path.write_text(html, encoding="utf-8")
    return path


def cockpit(dry_run: bool = False, html: bool = False) -> dict[str, Any]:
    lanes = collect_lane_statuses()
    queues = _build_queues(lanes)
    latest = _build_latest()
    overall = _overall_status(lanes)
    actions = recommend_actions(lanes)

    result: dict[str, Any] = {
        "overall_status": overall,
        "lane_count": len(lanes),
        "review_needed": sum(1 for l in lanes if l["review_needed"]),
        "total_queue": sum(queues.values()),
        "queues": queues,
        "latest": latest,
        "lanes": lanes,
        "actions": actions,
    }

    if dry_run:
        result["dry_run"] = True
        return result

    REPORTS_DIR.mkdir(parents=True, exist_ok=True)
    today = _local_today().isoformat()

    report_text = generate_cockpit_report(lanes, queues, latest)
    report_path = REPORTS_DIR / f"Review Cockpit - {today}.md"
    report_path.write_text(report_text, encoding="utf-8")
    result["report_path"] = str(report_path)

    json_path = write_cockpit_json(lanes, queues, latest)
    result["json_path"] = str(json_path)

    if html:
        html_path = write_cockpit_html(lanes, queues, latest)
        result["html_path"] = str(html_path)

    return result


def get_cockpit_status() -> dict[str, Any]:
    cockpit_exists = COCKPIT_DIR.exists()
    docs_ok = all((VAULT / d).exists() for d in COCKPIT_REQUIRED_DOCS)
    latest_report = _latest_file(REPORTS_DIR)
    latest_json = _latest_file(DATA_DIR, "*.json")
    latest_html = _latest_file(HTML_DIR, "*.html")

    lanes = collect_lane_statuses()
    green = sum(1 for l in lanes if l["status"] == "green")
    yellow = sum(1 for l in lanes if l["status"] == "yellow")
    red = sum(1 for l in lanes if l["status"] == "red")

    return {
        "cockpit_dir_exists": cockpit_exists,
        "docs_exist": docs_ok,
        "latest_report": latest_report,
        "latest_json": latest_json,
        "latest_html": latest_html,
        "lane_count": len(lanes),
        "green_lanes": green,
        "yellow_lanes": yellow,
        "red_lanes": red,
    }
