"""WilliamOS project / work-order promotion engine.

Scans synthesis reports, inbox triage, promoted drafts, ideas, learning notes,
case notes, project notes, and strategy notes for project and work-order
candidates. Generates promotion reports and draft notes for human review.
Local-first, deterministic heuristics. Optionally enhanced by semantic search.
Never modifies official project notes in 11_Projects/.
Never executes work orders, creates GitHub issues, or opens PRs.
"""
from __future__ import annotations

import datetime as dt
import os
import re
from pathlib import Path
from typing import Any
from zoneinfo import ZoneInfo

import frontmatter as fm

VAULT = Path(os.environ.get("WILLIAMOS_VAULT", "WilliamOS"))
PROJECTS_DIR = VAULT / "11_Projects"
PROMOTION_DIR = VAULT / "87_ProjectPromotion"
REPORTS_DIR = PROMOTION_DIR / "reports"
PROJECT_DRAFTS_DIR = PROMOTION_DIR / "project_drafts"
WO_DRAFTS_DIR = PROMOTION_DIR / "work_order_drafts"

SOURCE_DIRS: dict[str, list[str]] = {
    "synthesis": ["60_Synthesis"],
    "inbox": [
        "70_InboxProcessor/reports",
        "70_InboxProcessor/promoted_drafts",
    ],
    "ideas": [
        "10_Ideas",
        "11_Projects",
        "05_Assessor_Office",
        "06_TerraFusion_Strategy",
        "07_Learning",
        "09_Cases",
    ],
    "all": [
        "60_Synthesis",
        "70_InboxProcessor/reports",
        "70_InboxProcessor/promoted_drafts",
        "10_Ideas",
        "11_Projects",
        "05_Assessor_Office",
        "06_TerraFusion_Strategy",
        "07_Learning",
        "09_Cases",
        "01_Daily",
    ],
}

PROJECT_SIGNAL_PATTERNS = [
    re.compile(p, re.IGNORECASE) for p in [
        r"\bproject\b",
        r"\bbuild\b",
        r"\bimplement\b",
        r"\bcreate\b",
        r"\bdevelop\b",
        r"\bdesign\b",
        r"\broadmap\b",
        r"\bphase\b",
        r"\bmilestone\b",
        r"\binitiative\b",
        r"\bworkflow\b",
        r"\bsystem\b",
        r"\btool\b",
        r"\bpackage\b",
        r"\bstack\b",
        r"\bautomation\b",
        r"\bintegration\b",
        r"\bdashboard\b",
        r"\bprocessor\b",
        r"\bengine\b",
        r"\blayer\b",
        r"\bmodule\b",
        r"\bscreen\b",
        r"\bapp\b",
    ]
]

WO_SIGNAL_PATTERNS = [
    re.compile(p, re.IGNORECASE) for p in [
        r"\bWO\b",
        r"\bwork order\b",
        r"\bprompt\b",
        r"\bscope\b",
        r"\bacceptance criteria\b",
        r"\bdefinition of done\b",
        r"\btasks\b",
        r"\brequired outcome\b",
        r"\bnon-negotiable\b",
        r"\bconstraints\b",
        r"\bverification\b",
        r"\bcommands tested\b",
        r"\brecommended next WO\b",
        r"\bgap\b",
        r"\bfix\b",
        r"\bnext build\b",
        r"\bnext move\b",
    ]
]

ACTION_SIGNAL_PATTERNS = [
    re.compile(p, re.IGNORECASE) for p in [
        r"\btodo\b",
        r"\bnext\b",
        r"\bneeds\b",
        r"\bshould\b",
        r"\bmust\b",
        r"\bfollow up\b",
        r"\bblocked\b",
        r"\bwaiting\b",
        r"\binvestigate\b",
        r"\breview\b",
        r"\baudit\b",
        r"\bfinish\b",
        r"\bwire\b",
        r"\btest\b",
        r"\bverify\b",
        r"\bdocument\b",
    ]
]

DOMAIN_SIGNAL_PATTERNS = [
    re.compile(p, re.IGNORECASE) for p in [
        r"\bWilliamOS\b",
        r"\bGraphify\b",
        r"\bObsidian\b",
        r"\bMCP\b",
        r"\bsemantic search\b",
        r"\bsynthesis\b",
        r"\binbox processor\b",
        r"\bdoctrine promotion\b",
        r"\bdecision promotion\b",
        r"\bconcept promotion\b",
        r"\bTerraFusion\b",
        r"\bAcademy\b",
        r"\bassessor\b",
        r"\bappraisal\b",
        r"\bpublic trust\b",
        r"\bPACS\b",
        r"\bGIS\b",
        r"\bBOE\b",
        r"\blevy\b",
        r"\bnotice\b",
    ]
]

AREA_KEYWORDS: dict[str, list[str]] = {
    "assessor": ["assessor", "county", "levy", "taxpayer", "BOE", "appeal", "notice"],
    "appraisal": ["appraisal", "evidence", "defensible", "comp", "valuation", "PACS"],
    "terrafusion": ["terrafusion", "platform", "architecture", "academy", "adoption"],
    "williamos": ["williamos", "obsidian", "graphify", "semantic search", "MCP", "synthesis",
                  "inbox processor", "doctrine promotion", "decision promotion", "concept promotion"],
    "leadership": ["governance", "strategy", "budget", "hire", "policy"],
    "personal": [],
}


def _local_today() -> dt.date:
    tz_name = os.environ.get("WILLIAMOS_TZ", "America/Los_Angeles")
    return dt.datetime.now(ZoneInfo(tz_name)).date()


def _local_now_iso() -> str:
    tz_name = os.environ.get("WILLIAMOS_TZ", "America/Los_Angeles")
    return dt.datetime.now(ZoneInfo(tz_name)).isoformat(timespec="seconds")


def _slugify(text: str) -> str:
    text = text.strip().replace("/", "-")
    text = re.sub(r"[^A-Za-z0-9 _.-]+", "", text)
    text = re.sub(r"\s+", "-", text)
    return text[:100] or "untitled"


def _parse_note(path: Path) -> dict[str, Any]:
    text = path.read_text(encoding="utf-8", errors="ignore")
    try:
        post = fm.loads(text)
        meta = dict(post.metadata) if post.metadata else {}
        content = post.content
    except Exception:
        meta = {}
        content = text

    rel = str(path.relative_to(VAULT)).replace("\\", "/")
    title = ""
    for line in content.splitlines():
        stripped = line.strip()
        if stripped.startswith("# ") and not stripped.startswith("## "):
            title = stripped[2:].strip()
            break
    if not title:
        title = path.stem

    return {"path": path, "rel": rel, "meta": meta, "content": content, "title": title}


def scan_project_sources(source: str = "all") -> list[Path]:
    dirs = SOURCE_DIRS.get(source, SOURCE_DIRS["all"])
    files: list[Path] = []
    for d in dirs:
        folder = VAULT / d
        if folder.exists():
            if folder.is_file():
                if folder.suffix == ".md":
                    files.append(folder)
            else:
                files.extend(sorted(folder.rglob("*.md")))
    return files


def _score_signals(content: str) -> dict[str, Any]:
    project_score = 0
    wo_score = 0
    action_score = 0
    domain_score = 0
    matched: list[str] = []

    for pat in PROJECT_SIGNAL_PATTERNS:
        hits = pat.findall(content)
        if hits:
            project_score += len(hits)
            matched.append(hits[0])
    for pat in WO_SIGNAL_PATTERNS:
        hits = pat.findall(content)
        if hits:
            wo_score += len(hits)
            matched.append(hits[0])
    for pat in ACTION_SIGNAL_PATTERNS:
        hits = pat.findall(content)
        if hits:
            action_score += len(hits)
            matched.append(hits[0])
    for pat in DOMAIN_SIGNAL_PATTERNS:
        hits = pat.findall(content)
        if hits:
            domain_score += len(hits)
            matched.append(hits[0])

    total = project_score + wo_score + action_score + domain_score
    return {
        "total": total,
        "project": project_score,
        "wo": wo_score,
        "action": action_score,
        "domain": domain_score,
        "matched": matched,
    }


def _is_noise_line(stripped: str) -> bool:
    if not stripped or len(stripped) < 15 or stripped.startswith("#"):
        return True
    if stripped.startswith("- [ ]") or stripped.startswith("- [x]"):
        return True
    if stripped.startswith("|") or stripped.startswith("```"):
        return True
    if stripped.startswith("`") or stripped.startswith("- `") or stripped.startswith("- **"):
        return True
    if stripped.startswith("---") or stripped.startswith("tags:") or stripped.startswith("type:"):
        return True
    if re.match(r"^\d+\.\s", stripped):
        return True
    return False


def _extract_project_lines(content: str) -> list[str]:
    strong = [re.compile(p, re.IGNORECASE) for p in [
        r"\bproject\b", r"\bbuild\b", r"\bimplement\b", r"\bcreate\b",
        r"\bdevelop\b", r"\bdesign\b", r"\broadmap\b", r"\binitiative\b",
        r"\bautomation\b", r"\bintegration\b", r"\bdashboard\b",
        r"\bprocessor\b", r"\bengine\b", r"\blayer\b",
    ]]
    candidates: list[str] = []
    for line in content.splitlines():
        stripped = line.strip()
        if _is_noise_line(stripped):
            continue
        for pat in strong:
            if pat.search(stripped):
                candidates.append(stripped[:200])
                break
    return candidates


def _extract_wo_lines(content: str) -> list[str]:
    strong = [re.compile(p, re.IGNORECASE) for p in [
        r"\bwork order\b", r"\bWO\b", r"\bacceptance criteria\b",
        r"\bdefinition of done\b", r"\brequired outcome\b",
        r"\bnon-negotiable\b", r"\bverification\b", r"\bnext build\b",
    ]]
    candidates: list[str] = []
    for line in content.splitlines():
        stripped = line.strip()
        if _is_noise_line(stripped):
            continue
        for pat in strong:
            if pat.search(stripped):
                candidates.append(stripped[:200])
                break
    return candidates


def _extract_action_lines(content: str) -> list[str]:
    strong = [re.compile(p, re.IGNORECASE) for p in [
        r"\btodo\b", r"\bfollow up\b", r"\bblocked\b", r"\bwaiting\b",
        r"\binvestigate\b", r"\bfinish\b", r"\bwire\b",
    ]]
    actions: list[str] = []
    for line in content.splitlines():
        stripped = line.strip()
        if _is_noise_line(stripped):
            continue
        for pat in strong:
            if pat.search(stripped):
                actions.append(stripped[:200])
                break
    return actions[:10]


def _extract_scope(content: str) -> list[str]:
    scope_patterns = [re.compile(p, re.IGNORECASE) for p in [
        r"\bscope\b", r"\bin scope\b", r"\bout of scope\b",
        r"\bcovers\b", r"\bincludes\b", r"\bexcludes\b",
    ]]
    lines: list[str] = []
    for line in content.splitlines():
        stripped = line.strip()
        if not stripped or len(stripped) < 10 or stripped.startswith("#"):
            continue
        for pat in scope_patterns:
            if pat.search(stripped):
                lines.append(stripped[:200])
                break
    return lines[:5]


def _extract_rationale(content: str) -> list[str]:
    patterns = [re.compile(p, re.IGNORECASE) for p in [
        r"\bbecause\b", r"\breason\b", r"\bwhy\b", r"\bthe point is\b",
        r"\bthis means\b", r"\bmatters because\b",
    ]]
    lines: list[str] = []
    for line in content.splitlines():
        stripped = line.strip()
        if not stripped or len(stripped) < 15 or stripped.startswith("#"):
            continue
        if stripped.startswith("`") or stripped.startswith("- `"):
            continue
        for pat in patterns:
            if pat.search(stripped):
                lines.append(stripped[:200])
                break
    return lines[:5]


def _extract_acceptance_criteria(content: str) -> list[str]:
    patterns = [re.compile(p, re.IGNORECASE) for p in [
        r"\bacceptance criteria\b", r"\bdefinition of done\b",
        r"\bcomplete when\b", r"\bdone when\b", r"\bverif",
    ]]
    lines: list[str] = []
    for line in content.splitlines():
        stripped = line.strip()
        if not stripped or len(stripped) < 10:
            continue
        for pat in patterns:
            if pat.search(stripped):
                lines.append(stripped[:200])
                break
    return lines[:5]


def _extract_risks(content: str) -> list[str]:
    patterns = [re.compile(p, re.IGNORECASE) for p in [
        r"\brisk\b", r"\bdanger\b", r"\bcaveat\b", r"\bdownside\b",
        r"\bfailure\b", r"\bbreaking\b",
    ]]
    lines: list[str] = []
    for line in content.splitlines():
        stripped = line.strip()
        if not stripped or len(stripped) < 15 or stripped.startswith("#"):
            continue
        for pat in patterns:
            if pat.search(stripped):
                lines.append(stripped[:200])
                break
    return lines[:5]


def _extract_dependencies(content: str) -> list[str]:
    patterns = [re.compile(p, re.IGNORECASE) for p in [
        r"\bdepend", r"\brequires\b", r"\bblocked by\b", r"\bwaiting on\b",
        r"\bprerequisite\b", r"\bneeds\b.*\bfirst\b",
    ]]
    lines: list[str] = []
    for line in content.splitlines():
        stripped = line.strip()
        if not stripped or len(stripped) < 15 or stripped.startswith("#"):
            continue
        for pat in patterns:
            if pat.search(stripped):
                lines.append(stripped[:200])
                break
    return lines[:5]


def normalize_candidate_title(text: str) -> str:
    text = text.strip()
    for prefix in ["Project:", "WO:", "Work Order:", "Build:", "- "]:
        if text.lower().startswith(prefix.lower()):
            text = text[len(prefix):].strip()
    text = re.sub(
        r"^(we should|we need to|need to|should|must|todo|next)\s+",
        "", text, flags=re.IGNORECASE,
    )
    text = text.rstrip(".")
    if len(text) > 80:
        text = text[:77] + "..."
    return text.strip().capitalize() if text else "Untitled Project"


def infer_candidate_type(scores: dict[str, Any], project_lines: list[str], wo_lines: list[str]) -> str:
    if scores["wo"] >= 3 or len(wo_lines) >= 2:
        return "work_order"
    if scores["project"] >= 3 or len(project_lines) >= 2:
        return "project"
    return "action_item"


def suggest_area(content: str) -> str:
    lower = content.lower()
    area_scores: dict[str, int] = {}
    for area, keywords in AREA_KEYWORDS.items():
        score = sum(lower.count(kw.lower()) for kw in keywords)
        if score > 0:
            area_scores[area] = score
    if area_scores:
        return max(area_scores, key=area_scores.get)
    return "personal"


def suggest_tags(content: str, area: str, candidate_type: str) -> list[str]:
    tags = [candidate_type.replace("_", "-"), "draft"]
    if area != "personal":
        tags.append(area)
    lower = content.lower()
    if "terrafusion" in lower:
        tags.append("terrafusion")
    if "assessor" in lower or "appraisal" in lower:
        tags.append("assessor")
    if "williamos" in lower:
        tags.append("williamos")
    return sorted(set(tags))


def _load_existing_projects() -> list[dict[str, Any]]:
    existing: list[dict[str, Any]] = []
    for folder_name in ["11_Projects", "10_Ideas", "06_TerraFusion_Strategy", "07_Learning"]:
        folder = VAULT / folder_name
        if folder.exists():
            for f in sorted(folder.glob("*.md")):
                existing.append(_parse_note(f))
    return existing


def find_similar_existing_projects(
    candidate_title: str,
    candidate_content: str,
    existing: list[dict[str, Any]],
) -> list[dict[str, Any]]:
    candidate_words = set(re.findall(r"\b\w{4,}\b", candidate_title.lower()))
    candidate_words.update(re.findall(r"\b\w{4,}\b", candidate_content.lower()[:500]))

    similar: list[dict[str, Any]] = []
    for note in existing:
        note_words = set(re.findall(r"\b\w{4,}\b", note["title"].lower()))
        note_words.update(re.findall(r"\b\w{4,}\b", note["content"].lower()[:500]))
        overlap = candidate_words & note_words
        if len(overlap) >= 3:
            similar.append({
                "title": note["title"],
                "rel": note["rel"],
                "status": note["meta"].get("status", "unknown"),
                "overlap_count": len(overlap),
                "overlap_sample": sorted(overlap)[:5],
            })
    similar.sort(key=lambda x: -x["overlap_count"])
    return similar[:3]


def _get_semantic_similar(title: str) -> list[dict[str, Any]]:
    try:
        from williamos_search import search as sem_search, get_status
        if not get_status().get("index_exists"):
            return []
        results = sem_search(title, top_k=3)
        return [
            {"source": r["source"], "title": r["title"], "score": r["score"]}
            for r in results
            if not r.get("error") and r.get("score", 0) > 0.2
            and "11_Projects" in r.get("source", "")
        ]
    except Exception:
        return []


def detect_project_candidates(source_files: list[Path]) -> list[dict[str, Any]]:
    existing = _load_existing_projects()
    candidates: list[dict[str, Any]] = []
    seen_titles: set[str] = set()

    for f in source_files:
        note = _parse_note(f)
        scores = _score_signals(note["content"])
        if scores["total"] < 2:
            continue

        project_lines = _extract_project_lines(note["content"])
        wo_lines = _extract_wo_lines(note["content"])
        action_lines = _extract_action_lines(note["content"])

        all_lines = project_lines + wo_lines + action_lines
        if not all_lines:
            continue

        best_line = all_lines[0]
        title = normalize_candidate_title(best_line)
        if title.lower() in seen_titles:
            continue
        seen_titles.add(title.lower())

        candidate_type = infer_candidate_type(scores, project_lines, wo_lines)
        scope_lines = _extract_scope(note["content"])
        rationale_lines = _extract_rationale(note["content"])
        ac_lines = _extract_acceptance_criteria(note["content"])
        risk_lines = _extract_risks(note["content"])
        dep_lines = _extract_dependencies(note["content"])
        area = suggest_area(note["content"])
        tags = suggest_tags(note["content"], area, candidate_type)

        total = scores["total"]
        if total >= 8:
            confidence = "high"
        elif total >= 4:
            confidence = "medium"
        else:
            confidence = "low"

        similar = find_similar_existing_projects(title, note["content"], existing)
        semantic_similar = _get_semantic_similar(title)

        candidates.append({
            "candidate_title": title,
            "candidate_type": candidate_type,
            "confidence": confidence,
            "score": total,
            "reason": f"{total} signal matches ({', '.join(scores['matched'][:5])})",
            "source_paths": [note["rel"]],
            "source_lines": all_lines[:8],
            "project_lines": project_lines[:5],
            "wo_lines": wo_lines[:5],
            "action_lines": action_lines[:5],
            "scope": scope_lines,
            "rationale": rationale_lines,
            "acceptance_criteria": ac_lines,
            "next_actions": action_lines[:5],
            "risks": risk_lines,
            "dependencies": dep_lines,
            "suggested_area": area,
            "suggested_tags": tags,
            "similar_existing_projects": similar,
            "semantic_similar": semantic_similar,
        })

    candidates.sort(key=lambda x: -x["score"])
    return candidates


def group_similar_candidates(candidates: list[dict[str, Any]]) -> list[dict[str, Any]]:
    if len(candidates) <= 1:
        return candidates

    grouped: list[dict[str, Any]] = []
    used: set[int] = set()

    for i, c in enumerate(candidates):
        if i in used:
            continue
        group = dict(c)
        group_sources = list(c["source_paths"])
        group_lines = list(c["source_lines"])
        c_words = set(re.findall(r"\b\w{4,}\b", c["candidate_title"].lower()))

        for j, other in enumerate(candidates):
            if j <= i or j in used:
                continue
            o_words = set(re.findall(r"\b\w{4,}\b", other["candidate_title"].lower()))
            if len(c_words & o_words) >= 2:
                used.add(j)
                group_sources.extend(other["source_paths"])
                group_lines.extend(other["source_lines"])
                if other["score"] > group["score"]:
                    group["candidate_title"] = other["candidate_title"]
                    group["candidate_type"] = other["candidate_type"]
                    group["confidence"] = other["confidence"]
                    group["score"] = other["score"]
                    group["reason"] = other["reason"]

        group["source_paths"] = sorted(set(group_sources))
        group["source_lines"] = group_lines[:8]
        grouped.append(group)

    return grouped


def _check_semantic_status() -> dict[str, Any]:
    try:
        from williamos_search import get_status
        return get_status()
    except ImportError:
        return {"index_exists": False, "available_mode": "unavailable"}


def promote_projects(source: str = "all", dry_run: bool = False) -> dict[str, Any]:
    source_files = scan_project_sources(source)
    candidates = detect_project_candidates(source_files)
    grouped = group_similar_candidates(candidates)
    semantic_info = _check_semantic_status()

    projects = [c for c in grouped if c["candidate_type"] == "project"]
    work_orders = [c for c in grouped if c["candidate_type"] == "work_order"]
    actions = [c for c in grouped if c["candidate_type"] == "action_item"]

    high = [c for c in grouped if c["confidence"] == "high"]
    medium = [c for c in grouped if c["confidence"] == "medium"]
    low = [c for c in grouped if c["confidence"] == "low"]

    mode = "semantic-assisted" if semantic_info.get("index_exists") else "deterministic heuristics"

    data: dict[str, Any] = {
        "generated": _local_now_iso(),
        "mode": mode,
        "source": source,
        "total_files_scanned": len(source_files),
        "total_candidates": len(grouped),
        "candidates": grouped,
        "projects": projects,
        "work_orders": work_orders,
        "actions": actions,
        "high": high,
        "medium": medium,
        "low": low,
        "semantic_info": semantic_info,
    }

    if dry_run:
        return data

    report_md = _generate_promotion_report(data)
    today = _local_today().isoformat()
    report_path = REPORTS_DIR / f"Project Promotion - {today}.md"
    REPORTS_DIR.mkdir(parents=True, exist_ok=True)
    report_path.write_text(report_md, encoding="utf-8")
    data["report_path"] = str(report_path)

    draft_paths: list[str] = []
    proj_candidates = [c for c in grouped if c["candidate_type"] in ("project", "action_item")]
    wo_candidates = [c for c in grouped if c["candidate_type"] == "work_order"]

    if proj_candidates:
        draft_paths.extend(_write_project_drafts(proj_candidates))
    if wo_candidates:
        draft_paths.extend(_write_work_order_drafts(wo_candidates))
    data["draft_paths"] = draft_paths

    return data


def _format_candidate_block(c: dict[str, Any]) -> str:
    lines: list[str] = []
    lines.append(f"### {c['candidate_title']}")
    lines.append("")
    lines.append(f"- **Type:** {c['candidate_type']}")
    lines.append(f"- **Confidence:** {c['confidence']}")
    lines.append(f"- **Reason:** {c['reason']}")
    lines.append(f"- **Suggested area:** {c['suggested_area']}")
    lines.append(f"- **Suggested tags:** {', '.join(c['suggested_tags'])}")
    lines.append(f"- **Source paths:**")
    for sp in c["source_paths"]:
        lines.append(f"  - `{sp}`")
    if c.get("scope"):
        lines.append(f"- **Scope signals:**")
        for sl in c["scope"][:3]:
            lines.append(f"  - {sl[:150]}")
    if c.get("rationale"):
        lines.append(f"- **Rationale signals:**")
        for rl in c["rationale"][:3]:
            lines.append(f"  - {rl[:150]}")
    if c.get("next_actions"):
        lines.append(f"- **Next actions:**")
        for na in c["next_actions"][:3]:
            lines.append(f"  - {na[:150]}")
    if c["similar_existing_projects"]:
        lines.append(f"- **Similar existing projects:**")
        for sim in c["similar_existing_projects"]:
            lines.append(f"  - `{sim['rel']}` — {sim['title']} ({sim['overlap_count']} keyword overlap)")
    if c.get("semantic_similar"):
        lines.append(f"- **Semantic matches:**")
        for ss in c["semantic_similar"]:
            lines.append(f"  - `{ss['source']}` — {ss['title']} ({ss['score']:.2f})")
    lines.append("")
    return "\n".join(lines)


def _generate_promotion_report(data: dict[str, Any]) -> str:
    generated = data["generated"]
    mode = data["mode"]
    source = data["source"]
    candidates = data["candidates"]
    high = data["high"]
    medium = data["medium"]
    low = data["low"]
    projects = data["projects"]
    work_orders = data["work_orders"]
    actions = data["actions"]
    semantic_info = data["semantic_info"]

    s: list[str] = []
    s.append("---")
    s.append("type: project-promotion-report")
    s.append("status: draft")
    s.append(f"generated: {generated}")
    s.append(f"source_scope: {source}")
    s.append("tags:")
    s.append("  - project")
    s.append("  - work-order")
    s.append("  - promotion")
    s.append("  - generated")
    s.append("---")
    s.append("")
    s.append(f"# Project Promotion - {_local_today().isoformat()}")
    s.append("")

    s.append("## Executive Summary")
    s.append("")
    s.append(
        f"Scanned {data['total_files_scanned']} source files (scope: {source}). "
        f"Found {len(candidates)} candidates: "
        f"{len(projects)} projects, {len(work_orders)} work orders, {len(actions)} action items. "
        f"Confidence: {len(high)} high, {len(medium)} medium, {len(low)} low."
    )
    s.append("")

    s.append("## Sources Reviewed")
    s.append("")
    dirs = SOURCE_DIRS.get(source, SOURCE_DIRS["all"])
    for d in dirs:
        s.append(f"- `{d}/`")
    s.append("")

    s.append("## High-Confidence Project Candidates")
    s.append("")
    if high:
        for c in high:
            s.append(_format_candidate_block(c))
    else:
        s.append("None.")
    s.append("")

    s.append("## Medium-Confidence Project Candidates")
    s.append("")
    if medium:
        for c in medium:
            s.append(_format_candidate_block(c))
    else:
        s.append("None.")
    s.append("")

    s.append("## Low-Confidence / Needs Human Review")
    s.append("")
    if low:
        for c in low:
            s.append(_format_candidate_block(c))
    else:
        s.append("None.")
    s.append("")

    s.append("## Work Order Seeds")
    s.append("")
    if work_orders:
        for c in work_orders:
            s.append(_format_candidate_block(c))
    else:
        s.append("None.")
    s.append("")

    s.append("## Action Items")
    s.append("")
    if actions:
        for c in actions:
            s.append(_format_candidate_block(c))
    else:
        s.append("None.")
    s.append("")

    all_similar: list[dict] = []
    for c in candidates:
        all_similar.extend(c["similar_existing_projects"])
    seen_rels: set[str] = set()
    unique_similar: list[dict] = []
    for sim in all_similar:
        if sim["rel"] not in seen_rels:
            seen_rels.add(sim["rel"])
            unique_similar.append(sim)

    s.append("## Similar Existing Projects")
    s.append("")
    if unique_similar:
        for sim in unique_similar:
            s.append(f"- `{sim['rel']}` — {sim['title']} ({sim['overlap_count']} keyword overlap)")
    else:
        s.append("No similar existing projects detected.")
    s.append("")

    s.append("## Suggested Drafts Created")
    s.append("")
    if candidates:
        for c in candidates:
            slug = _slugify(c["candidate_title"])
            if c["candidate_type"] == "work_order":
                s.append(f"- `87_ProjectPromotion/work_order_drafts/WO-DRAFT-{slug}.md` — {c['candidate_title']}")
            else:
                s.append(f"- `87_ProjectPromotion/project_drafts/PROJ-DRAFT-{slug}.md` — {c['candidate_title']}")
    else:
        s.append("No drafts created.")
    s.append("")

    s.append("## Suggested Next Actions")
    s.append("")
    next_actions: list[str] = []
    if high:
        next_actions.append(f"Review {len(high)} high-confidence candidates for promotion")
    if work_orders:
        next_actions.append(f"Review {len(work_orders)} work-order seeds")
    if medium:
        next_actions.append(f"Evaluate {len(medium)} medium-confidence candidates")
    if unique_similar:
        next_actions.append(f"Check {len(unique_similar)} potential project duplicates")
    if not next_actions:
        next_actions.append("No project candidates found. Continue building source material.")
    for i, a in enumerate(next_actions, 1):
        s.append(f"{i}. {a}")
    s.append("")

    s.append("## Source Paths")
    s.append("")
    all_paths: set[str] = set()
    for c in candidates:
        all_paths.update(c["source_paths"])
    for p in sorted(all_paths):
        s.append(f"- `{p}`")
    if not all_paths:
        s.append("No source paths cited.")
    s.append("")

    s.append("## Generator Notes")
    s.append("")
    s.append(f"- Mode: {mode}")
    s.append(f"- Generated: {generated}")
    s.append(f"- Source scope: {source}")
    if semantic_info.get("index_exists"):
        fi = semantic_info.get("files_indexed", 0)
        ci = semantic_info.get("chunks_indexed", 0)
        s.append(f"- Semantic index: available ({fi} files, {ci} chunks)")
    else:
        s.append(f"- Semantic index: {semantic_info.get('available_mode', 'unavailable')}")
    s.append("- This note was generated by WilliamOS. Review before acting. No official project notes were modified. No work orders were executed.")
    s.append("")
    return "\n".join(s)


def _write_project_drafts(candidates: list[dict[str, Any]]) -> list[str]:
    PROJECT_DRAFTS_DIR.mkdir(parents=True, exist_ok=True)
    generated = _local_now_iso()
    today = _local_today().isoformat()
    review = (_local_today() + dt.timedelta(days=30)).isoformat()
    paths: list[str] = []

    for c in candidates:
        title = c["candidate_title"]
        slug = _slugify(title)
        area = c["suggested_area"]
        tags_yaml = "\n".join(f"  - {t}" for t in c["suggested_tags"])
        source_yaml = "\n".join(f"  - {sp}" for sp in c["source_paths"])

        scope_block = "\n".join(f"- {sl}" for sl in c.get("scope", [])) or "(Draft — define project scope.)"
        rationale_block = "\n".join(f"> {rl}" for rl in c.get("rationale", [])) or "(Draft — why does this project matter?)"
        dep_block = "\n".join(f"- {dl}" for dl in c.get("dependencies", [])) or "(None identified.)"
        risk_block = "\n".join(f"- {rl}" for rl in c.get("risks", [])) or "(None identified.)"
        action_block = "\n".join(f"- [ ] {na}" for na in c.get("next_actions", [])) or "- [ ] (Define next actions.)"
        evidence = "\n".join(f"> {sl}" for sl in c["source_lines"][:5]) if c.get("source_lines") else "> (see source paths)"
        source_links = "\n".join(f"- [[{Path(sp).stem}]]" for sp in c["source_paths"])

        similar_block = ""
        if c["similar_existing_projects"]:
            similar_block = "\n".join(
                f"- `{sim['rel']}` — {sim['title']} ({sim['overlap_count']} keyword overlap)"
                for sim in c["similar_existing_projects"]
            )
        else:
            similar_block = "No similar existing projects detected."

        draft = f"""---
type: project
status: draft
area: {area}
created: {today}
review: {review}
source_paths:
{source_yaml}
tags:
{tags_yaml}
---

# Project - {title}

## Purpose

(Draft — what is this project for?)

## Scope

{scope_block}

## Rationale

{rationale_block}

## Desired Outcome

(Draft — what does success look like?)

## Related Notes

{source_links}

## Dependencies

{dep_block}

## Risks

{risk_block}

## Next Actions

{action_block}

## Source Evidence

{evidence}

## Similar Existing Projects

{similar_block}

## Human Review Checklist

- [ ] Confirm this is actually a project
- [ ] Confirm title
- [ ] Confirm scope
- [ ] Confirm desired outcome
- [ ] Confirm dependencies and risks
- [ ] Check for duplicate project
- [ ] Move manually to `WilliamOS/11_Projects/` if accepted

## Generator Notes

- Generated: {generated}
- Type: {c['candidate_type']}
- Confidence: {c['confidence']}
- Reason: {c['reason']}
- This project draft was generated by WilliamOS for review. It is not an active project until William accepts it.
"""
        draft_path = PROJECT_DRAFTS_DIR / f"PROJ-DRAFT-{slug}.md"
        draft_path.write_text(draft, encoding="utf-8")
        paths.append(str(draft_path))

    return paths


def _write_work_order_drafts(candidates: list[dict[str, Any]]) -> list[str]:
    WO_DRAFTS_DIR.mkdir(parents=True, exist_ok=True)
    generated = _local_now_iso()
    today = _local_today().isoformat()
    review = (_local_today() + dt.timedelta(days=14)).isoformat()
    paths: list[str] = []

    for c in candidates:
        title = c["candidate_title"]
        slug = _slugify(title)
        area = c["suggested_area"]
        tags_yaml = "\n".join(f"  - {t}" for t in c["suggested_tags"])
        source_yaml = "\n".join(f"  - {sp}" for sp in c["source_paths"])

        scope_block = "\n".join(f"- {sl}" for sl in c.get("scope", [])) or "(Draft — define WO scope.)"
        ac_block = "\n".join(f"- {al}" for al in c.get("acceptance_criteria", [])) or "(Draft — define acceptance criteria.)"
        action_block = "\n".join(f"- [ ] {na}" for na in c.get("next_actions", [])) or "- [ ] (Define tasks.)"
        evidence = "\n".join(f"> {sl}" for sl in c["source_lines"][:5]) if c.get("source_lines") else "> (see source paths)"

        draft = f"""---
type: work-order
status: draft
area: {area}
created: {today}
review: {review}
source_paths:
{source_yaml}
tags:
{tags_yaml}
---

# Work Order - {title}

## Mission

(Draft — what is the mission of this work order?)

## Required Outcome

(Draft — what must be true when this WO is done?)

## Scope

{scope_block}

## Tasks

{action_block}

## Acceptance Criteria

{ac_block}

## Non-Negotiable Constraints

(Draft — what must not happen?)

## Verification

(Draft — how will completion be verified?)

## Source Evidence

{evidence}

## Human Review Checklist

- [ ] Confirm this should become a work order
- [ ] Confirm mission
- [ ] Confirm scope
- [ ] Confirm tasks
- [ ] Confirm acceptance criteria
- [ ] Confirm verification commands
- [ ] Move manually to the appropriate project/work-order folder if accepted

## Generator Notes

- Generated: {generated}
- Type: {c['candidate_type']}
- Confidence: {c['confidence']}
- Reason: {c['reason']}
- This work-order draft was generated by WilliamOS for review. It is not active until William accepts it.
"""
        draft_path = WO_DRAFTS_DIR / f"WO-DRAFT-{slug}.md"
        draft_path.write_text(draft, encoding="utf-8")
        paths.append(str(draft_path))

    return paths


def get_project_status() -> dict[str, Any]:
    status: dict[str, Any] = {}

    status["projects_dir_exists"] = PROJECTS_DIR.exists()
    status["promotion_dir_exists"] = PROMOTION_DIR.exists()

    if PROJECTS_DIR.exists():
        status["official_project_count"] = len(list(PROJECTS_DIR.glob("*.md")))
    else:
        status["official_project_count"] = 0

    required_docs = [
        "README.md", "PROJECT_PROMOTION_POLICY.md",
        "DETECTION_RULES.md", "REVIEW_WORKFLOW.md",
    ]
    status["promotion_docs_exist"] = all(
        (PROMOTION_DIR / d).exists() for d in required_docs
    )

    if PROJECT_DRAFTS_DIR.exists():
        status["project_drafts_count"] = len(list(PROJECT_DRAFTS_DIR.glob("*.md")))
    else:
        status["project_drafts_count"] = 0

    if WO_DRAFTS_DIR.exists():
        status["wo_drafts_count"] = len(list(WO_DRAFTS_DIR.glob("*.md")))
    else:
        status["wo_drafts_count"] = 0

    for folder_name, key in [
        ("60_Synthesis", "synthesis_reports"),
        ("07_Learning", "learning_notes"),
        ("09_Cases", "case_notes"),
        ("10_Ideas", "idea_notes"),
        ("11_Projects", "project_notes"),
    ]:
        folder = VAULT / folder_name
        if folder.exists():
            status[key] = len(list(folder.glob("*.md")))
        else:
            status[key] = 0

    inbox_reports_dir = VAULT / "70_InboxProcessor" / "reports"
    if inbox_reports_dir.exists():
        status["inbox_triage_reports"] = len(list(inbox_reports_dir.glob("Inbox Triage - *.md")))
    else:
        status["inbox_triage_reports"] = 0

    if REPORTS_DIR.exists():
        reports = sorted(REPORTS_DIR.glob("Project Promotion - *.md"), reverse=True)
        status["last_report"] = reports[0].name if reports else None
    else:
        status["last_report"] = None

    try:
        from williamos_search import get_status as search_status
        sem = search_status()
        status["semantic_available"] = sem.get("available_mode", "unavailable")
        status["semantic_index_exists"] = sem.get("index_exists", False)
    except ImportError:
        status["semantic_available"] = "unavailable"
        status["semantic_index_exists"] = False

    return status
