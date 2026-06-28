"""WilliamOS concept promotion engine.

Scans synthesis reports, inbox triage, promoted drafts, ideas, learning notes,
case notes, project notes, and strategy notes for concept candidates. Generates
promotion reports and draft concept notes for human review.
Local-first, deterministic heuristics. Optionally enhanced by semantic search.
Never modifies official concept/idea notes in 10_Ideas/.
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
IDEAS_DIR = VAULT / "10_Ideas"
PROMOTION_DIR = VAULT / "86_ConceptPromotion"
REPORTS_DIR = PROMOTION_DIR / "reports"
DRAFTS_DIR = PROMOTION_DIR / "drafts"

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

CONCEPT_SIGNAL_PATTERNS = [
    re.compile(p, re.IGNORECASE) for p in [
        r"\bconcept\b",
        r"\bidea\b",
        r"\bpattern\b",
        r"\btheme\b",
        r"\bmodel\b",
        r"\bframework\b",
        r"\brelationship\b",
        r"\bconnection\b",
        r"\bmeaning\b",
        r"\bdefinition\b",
        r"\bmeans\b",
        r"\bcalled\b",
        r"\bknown as\b",
        r"\bmental model\b",
        r"\bprinciple\b",
        r"\bcategory\b",
        r"\btype\b",
        r"\bsignal\b",
        r"\bnode\b",
        r"\bmap\b",
        r"\blens\b",
        r"\blayer\b",
        r"\bworkflow\b",
        r"\bsystem\b",
    ]
]

DOMAIN_SIGNAL_PATTERNS = [
    re.compile(p, re.IGNORECASE) for p in [
        r"\bpublic trust\b",
        r"\bdefensible value\b",
        r"\bassessment notice\b",
        r"\btaxpayer anxiety\b",
        r"\bappeal evidence\b",
        r"\bBOE\b",
        r"\blevy confusion\b",
        r"\bPACS\b",
        r"\bGIS\b",
        r"\bGraphify\b",
        r"\bObsidian\b",
        r"\bsemantic search\b",
        r"\bMCP\b",
        r"\bTerraFusion\b",
        r"\bAcademy\b",
        r"\bcounty adoption\b",
        r"\blegacy system\b",
        r"\bAI honesty\b",
        r"\bsolo dev\b",
        r"\bpersonal cortex\b",
    ]
]

AREA_KEYWORDS: dict[str, list[str]] = {
    "assessor": ["assessor", "county", "levy", "taxpayer", "BOE", "appeal", "notice"],
    "appraisal": ["appraisal", "evidence", "defensible", "comp", "valuation", "PACS"],
    "terrafusion": ["terrafusion", "platform", "architecture", "academy", "adoption"],
    "technology": ["GIS", "Graphify", "Obsidian", "semantic search", "MCP", "AI honesty"],
    "leadership": ["governance", "workflow", "system", "framework", "strategy"],
    "personal": [],
}

LINK_RE = re.compile(r"\[\[([^\]|#]+)")


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

    return {
        "path": path,
        "rel": rel,
        "meta": meta,
        "content": content,
        "title": title,
    }


def scan_concept_sources(source: str = "all") -> list[Path]:
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


def _score_concept_signals(content: str) -> tuple[int, list[str]]:
    score = 0
    matched: list[str] = []
    for pat in CONCEPT_SIGNAL_PATTERNS:
        hits = pat.findall(content)
        if hits:
            score += len(hits)
            matched.append(hits[0])
    for pat in DOMAIN_SIGNAL_PATTERNS:
        hits = pat.findall(content)
        if hits:
            score += len(hits)
            matched.append(hits[0])
    return score, matched


def _extract_candidate_lines(content: str) -> list[str]:
    """Extract lines that look like concept definitions or descriptions."""
    strong_patterns = [
        re.compile(p, re.IGNORECASE) for p in [
            r"\bconcept\b",
            r"\bidea\b",
            r"\bpattern\b",
            r"\bframework\b",
            r"\bmental model\b",
            r"\bknown as\b",
            r"\bcalled\b",
            r"\bmeans\b",
            r"\bdefinition\b",
            r"\brelationship\b",
            r"\bconnection\b",
            r"\btheme\b",
            r"\blens\b",
            r"\bmodel\b",
        ]
    ]
    candidates: list[str] = []
    for line in content.splitlines():
        stripped = line.strip()
        if not stripped or len(stripped) < 15 or stripped.startswith("#"):
            continue
        if stripped.startswith("- [ ]") or stripped.startswith("- [x]"):
            continue
        if stripped.startswith("|") or stripped.startswith("```"):
            continue
        if stripped.startswith("`") or stripped.startswith("- `") or stripped.startswith("- **"):
            continue
        if stripped.startswith("---") or stripped.startswith("tags:") or stripped.startswith("type:"):
            continue
        if re.match(r"^\d+\.\s", stripped):
            continue
        for pat in strong_patterns:
            if pat.search(stripped):
                candidates.append(stripped[:200])
                break
    return candidates


def _extract_definition_lines(content: str) -> list[str]:
    """Extract lines that contain definition/meaning language."""
    definition_patterns = [
        re.compile(p, re.IGNORECASE) for p in [
            r"\bmeans\b",
            r"\bdefined as\b",
            r"\bdefinition\b",
            r"\brefers to\b",
            r"\bis when\b",
            r"\bis the\b.*\bof\b",
            r"\bknown as\b",
            r"\bcalled\b",
            r"\bin other words\b",
            r"\bthe point is\b",
            r"\bthis is\b",
        ]
    ]
    definitions: list[str] = []
    for line in content.splitlines():
        stripped = line.strip()
        if not stripped or len(stripped) < 15 or stripped.startswith("#"):
            continue
        if stripped.startswith("`") or stripped.startswith("- `"):
            continue
        for pat in definition_patterns:
            if pat.search(stripped):
                definitions.append(stripped[:200])
                break
    return definitions[:10]


def normalize_candidate_title(text: str) -> str:
    """Turn a concept-signal line into a plausible concept title."""
    text = text.strip()
    for prefix in ["Concept:", "Idea:", "Pattern:", "- "]:
        if text.lower().startswith(prefix.lower()):
            text = text[len(prefix):].strip()
    text = re.sub(
        r"^(the concept of|the idea of|the pattern of|this is called|this means|this is)\s+",
        "", text, flags=re.IGNORECASE
    )
    text = text.rstrip(".")
    if len(text) > 80:
        text = text[:77] + "..."
    return text.strip().capitalize() if text else "Untitled Concept"


def infer_candidate_definition(candidate_lines: list[str], definition_lines: list[str]) -> str:
    """Pick the best definition-like line from available extracts."""
    if definition_lines:
        return definition_lines[0][:200]
    if candidate_lines:
        return candidate_lines[0][:200]
    return "(no definition extracted — review source notes)"


def infer_importance(content: str) -> str:
    """Extract a line that suggests why this concept matters."""
    importance_patterns = [
        re.compile(p, re.IGNORECASE) for p in [
            r"\bmatters because\b",
            r"\bimportant because\b",
            r"\bthe point is\b",
            r"\bthis means\b",
            r"\bthe real\b",
            r"\bwithout this\b",
            r"\bif we don.t\b",
            r"\bthe risk is\b",
        ]
    ]
    for line in content.splitlines():
        stripped = line.strip()
        if not stripped or len(stripped) < 15 or stripped.startswith("#"):
            continue
        for pat in importance_patterns:
            if pat.search(stripped):
                return stripped[:200]
    return "(no importance signal extracted — review source notes)"


def suggest_area(content: str) -> str:
    lower = content.lower()
    scores: dict[str, int] = {}
    for area, keywords in AREA_KEYWORDS.items():
        score = sum(lower.count(kw.lower()) for kw in keywords)
        if score > 0:
            scores[area] = score
    if scores:
        return max(scores, key=scores.get)
    return "personal"


def suggest_tags(content: str, area: str) -> list[str]:
    tags = ["concept", "draft"]
    if area != "personal":
        tags.append(area)
    lower = content.lower()
    if "terrafusion" in lower:
        tags.append("terrafusion")
    if "assessor" in lower or "appraisal" in lower:
        tags.append("assessor")
    if "obsidian" in lower or "graphify" in lower:
        tags.append("tooling")
    if "mcp" in lower or "ai" in lower:
        tags.append("ai")
    return sorted(set(tags))


def suggest_related_notes(content: str) -> list[str]:
    """Find [[wiki-links]] in the content as related notes."""
    links = LINK_RE.findall(content)
    seen: set[str] = set()
    related: list[str] = []
    for lk in links:
        lk = lk.strip()
        if lk.lower() not in seen:
            seen.add(lk.lower())
            related.append(lk)
    return related[:10]


def _load_existing_concepts() -> list[dict[str, Any]]:
    existing: list[dict[str, Any]] = []
    for folder_name in ["10_Ideas", "07_Learning", "05_Assessor_Office", "06_TerraFusion_Strategy"]:
        folder = VAULT / folder_name
        if folder.exists():
            for f in sorted(folder.glob("*.md")):
                existing.append(_parse_note(f))
    return existing


def find_similar_existing_concepts(
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
            and "10_Ideas" in r.get("source", "")
        ]
    except Exception:
        return []


def detect_concept_candidates(
    source_files: list[Path],
) -> list[dict[str, Any]]:
    existing = _load_existing_concepts()
    candidates: list[dict[str, Any]] = []
    seen_titles: set[str] = set()

    for f in source_files:
        note = _parse_note(f)
        score, matched = _score_concept_signals(note["content"])
        if score < 2:
            continue

        candidate_lines = _extract_candidate_lines(note["content"])
        if not candidate_lines:
            continue

        title = normalize_candidate_title(candidate_lines[0])
        if title.lower() in seen_titles:
            continue
        seen_titles.add(title.lower())

        definition_lines = _extract_definition_lines(note["content"])
        definition = infer_candidate_definition(candidate_lines, definition_lines)
        importance = infer_importance(note["content"])
        area = suggest_area(note["content"])
        tags = suggest_tags(note["content"], area)
        related = suggest_related_notes(note["content"])

        if score >= 6:
            confidence = "high"
        elif score >= 3:
            confidence = "medium"
        else:
            confidence = "low"

        similar_existing = find_similar_existing_concepts(title, note["content"], existing)
        semantic_similar = _get_semantic_similar(title)

        candidates.append({
            "candidate_title": title,
            "candidate_definition": definition,
            "confidence": confidence,
            "score": score,
            "reason": f"{score} signal matches ({', '.join(matched[:5])})",
            "importance": importance,
            "source_paths": [note["rel"]],
            "source_lines": candidate_lines[:5],
            "definition_lines": definition_lines[:5],
            "suggested_area": area,
            "suggested_tags": tags,
            "related_notes": related,
            "similar_existing_concepts": similar_existing,
            "semantic_similar": semantic_similar,
        })

    candidates.sort(key=lambda x: -x["score"])
    return candidates


def group_similar_candidates(
    candidates: list[dict[str, Any]],
) -> list[dict[str, Any]]:
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
        group_defs = list(c["definition_lines"])
        group_related = list(c["related_notes"])
        c_words = set(re.findall(r"\b\w{4,}\b", c["candidate_title"].lower()))

        for j, other in enumerate(candidates):
            if j <= i or j in used:
                continue
            o_words = set(re.findall(r"\b\w{4,}\b", other["candidate_title"].lower()))
            if len(c_words & o_words) >= 2:
                used.add(j)
                group_sources.extend(other["source_paths"])
                group_lines.extend(other["source_lines"])
                group_defs.extend(other["definition_lines"])
                group_related.extend(other["related_notes"])
                if other["score"] > group["score"]:
                    group["candidate_title"] = other["candidate_title"]
                    group["candidate_definition"] = other["candidate_definition"]
                    group["confidence"] = other["confidence"]
                    group["score"] = other["score"]
                    group["reason"] = other["reason"]

        group["source_paths"] = sorted(set(group_sources))
        group["source_lines"] = group_lines[:8]
        group["definition_lines"] = group_defs[:5]
        group["related_notes"] = sorted(set(group_related))[:10]
        grouped.append(group)

    return grouped


def _check_semantic_status() -> dict[str, Any]:
    try:
        from williamos_search import get_status
        return get_status()
    except ImportError:
        return {"index_exists": False, "available_mode": "unavailable"}


def promote_concepts(
    source: str = "all",
    dry_run: bool = False,
) -> dict[str, Any]:
    source_files = scan_concept_sources(source)
    candidates = detect_concept_candidates(source_files)
    grouped = group_similar_candidates(candidates)
    semantic_info = _check_semantic_status()

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
        "high": high,
        "medium": medium,
        "low": low,
        "semantic_info": semantic_info,
    }

    if dry_run:
        return data

    report_md = _generate_promotion_report(data)
    today = _local_today().isoformat()
    report_path = REPORTS_DIR / f"Concept Promotion - {today}.md"
    REPORTS_DIR.mkdir(parents=True, exist_ok=True)
    report_path.write_text(report_md, encoding="utf-8")
    data["report_path"] = str(report_path)

    if grouped:
        draft_paths = _write_concept_drafts(grouped)
        data["draft_paths"] = draft_paths

    return data


def _format_candidate_block(c: dict[str, Any]) -> str:
    lines: list[str] = []
    lines.append(f"### {c['candidate_title']}")
    lines.append("")
    lines.append(f"- **Definition:** {c['candidate_definition']}")
    lines.append(f"- **Confidence:** {c['confidence']}")
    lines.append(f"- **Reason:** {c['reason']}")
    lines.append(f"- **Suggested area:** {c['suggested_area']}")
    lines.append(f"- **Suggested tags:** {', '.join(c['suggested_tags'])}")
    lines.append(f"- **Source paths:**")
    for sp in c["source_paths"]:
        lines.append(f"  - `{sp}`")
    if c.get("related_notes"):
        lines.append(f"- **Related notes:**")
        for rn in c["related_notes"][:5]:
            lines.append(f"  - [[{rn}]]")
    if c["similar_existing_concepts"]:
        lines.append(f"- **Similar existing concepts:**")
        for sim in c["similar_existing_concepts"]:
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
    semantic_info = data["semantic_info"]

    s: list[str] = []

    s.append("---")
    s.append("type: concept-promotion-report")
    s.append("status: draft")
    s.append(f"generated: {generated}")
    s.append(f"source_scope: {source}")
    s.append("tags:")
    s.append("  - concept")
    s.append("  - promotion")
    s.append("  - generated")
    s.append("---")
    s.append("")
    s.append(f"# Concept Promotion - {_local_today().isoformat()}")
    s.append("")

    s.append("## Executive Summary")
    s.append("")
    s.append(
        f"Scanned {data['total_files_scanned']} source files (scope: {source}). "
        f"Found {len(candidates)} concept candidates: "
        f"{len(high)} high-confidence, {len(medium)} medium, {len(low)} low/needs-review."
    )
    s.append("")

    s.append("## Sources Reviewed")
    s.append("")
    dirs = SOURCE_DIRS.get(source, SOURCE_DIRS["all"])
    for d in dirs:
        s.append(f"- `{d}/`")
    s.append("")

    s.append("## High-Confidence Concept Candidates")
    s.append("")
    if high:
        for c in high:
            s.append(_format_candidate_block(c))
    else:
        s.append("None.")
    s.append("")

    s.append("## Medium-Confidence Concept Candidates")
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

    all_similar: list[dict] = []
    for c in candidates:
        all_similar.extend(c["similar_existing_concepts"])
    seen_rels: set[str] = set()
    unique_similar: list[dict] = []
    for sim in all_similar:
        if sim["rel"] not in seen_rels:
            seen_rels.add(sim["rel"])
            unique_similar.append(sim)

    s.append("## Similar Existing Concepts")
    s.append("")
    if unique_similar:
        for sim in unique_similar:
            s.append(f"- `{sim['rel']}` — {sim['title']} ({sim['overlap_count']} keyword overlap)")
    else:
        s.append("No similar existing concepts detected.")
    s.append("")

    s.append("## Suggested Drafts Created")
    s.append("")
    if candidates:
        for c in candidates:
            slug = _slugify(c["candidate_title"])
            s.append(f"- `86_ConceptPromotion/drafts/CONCEPT-DRAFT-{slug}.md` — {c['candidate_title']}")
    else:
        s.append("No drafts created.")
    s.append("")

    s.append("## Suggested Next Actions")
    s.append("")
    actions: list[str] = []
    if high:
        actions.append(f"Review {len(high)} high-confidence candidates for promotion to `10_Ideas/`")
    if medium:
        actions.append(f"Evaluate {len(medium)} medium-confidence candidates")
    if unique_similar:
        actions.append(f"Check {len(unique_similar)} potential concept duplicates")
    if low:
        actions.append(f"Decide on {len(low)} low-confidence items")
    if not actions:
        actions.append("No concept candidates found. Continue building source material.")
    for i, a in enumerate(actions, 1):
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
    s.append("- This note was generated by WilliamOS. Review before acting. No official concept notes were modified.")
    s.append("")

    return "\n".join(s)


def _write_concept_drafts(candidates: list[dict[str, Any]]) -> list[str]:
    DRAFTS_DIR.mkdir(parents=True, exist_ok=True)
    generated = _local_now_iso()
    today = _local_today().isoformat()
    review = (_local_today() + dt.timedelta(days=30)).isoformat()
    paths: list[str] = []

    for c in candidates:
        title = c["candidate_title"]
        slug = _slugify(title)
        definition = c["candidate_definition"]
        importance = c.get("importance", "(review source notes)")
        area = c["suggested_area"]
        tags_yaml = "\n".join(f"  - {t}" for t in c["suggested_tags"])
        source_yaml = "\n".join(f"  - {sp}" for sp in c["source_paths"])

        evidence_lines = []
        for line in c["source_lines"][:5]:
            evidence_lines.append(f"> {line}")
        evidence = "\n".join(evidence_lines) if evidence_lines else "> (see source paths)"

        source_citations = "\n".join(f"- `{sp}`" for sp in c["source_paths"])

        related_block = ""
        if c.get("related_notes"):
            related_block = "\n".join(f"- [[{rn}]]" for rn in c["related_notes"][:10])
        else:
            links = set()
            for sp in c["source_paths"]:
                links.add(Path(sp).stem)
            related_block = "\n".join(f"- [[{lk}]]" for lk in sorted(links)) if links else "- (none)"

        similar_block = ""
        if c["similar_existing_concepts"]:
            sim_lines = []
            for sim in c["similar_existing_concepts"]:
                sim_lines.append(f"- `{sim['rel']}` — {sim['title']} ({sim['overlap_count']} keyword overlap)")
            similar_block = "\n".join(sim_lines)
        else:
            similar_block = "No similar existing concepts detected."

        sem_block = ""
        if c.get("semantic_similar"):
            sem_lines = []
            for ss in c["semantic_similar"]:
                sem_lines.append(f"- `{ss['source']}` — {ss['title']} ({ss['score']:.2f})")
            sem_block = "\n\n## Related Notes (Semantic)\n\n" + "\n".join(sem_lines)

        draft = f"""---
type: concept
status: draft
area: {area}
created: {today}
review: {review}
source_paths:
{source_yaml}
tags:
{tags_yaml}
---

# Concept - {title}

## Definition

{definition}

## Why It Matters

{importance}

## Where It Shows Up

(Draft — describe the domains, workflows, or situations where this concept applies.)

## Related Notes

{related_block}

## Source Evidence

{evidence}

## Similar Existing Concepts

{similar_block}
{sem_block}

## Questions / Edges

(Draft — what is unclear, contested, or worth exploring further about this concept?)

## Human Review Checklist

- [ ] Confirm this is actually a reusable concept
- [ ] Confirm title
- [ ] Confirm definition
- [ ] Confirm area and tags
- [ ] Check for duplicate concept
- [ ] Move manually to `WilliamOS/10_Ideas/` if accepted

## Generator Notes

- Generated: {generated}
- Confidence: {c['confidence']}
- Reason: {c['reason']}
- This concept draft was generated by WilliamOS for review. It is not an active concept until William accepts it.
"""

        draft_path = DRAFTS_DIR / f"CONCEPT-DRAFT-{slug}.md"
        draft_path.write_text(draft, encoding="utf-8")
        paths.append(str(draft_path))

    return paths


def get_concept_status() -> dict[str, Any]:
    status: dict[str, Any] = {}

    status["ideas_dir_exists"] = IDEAS_DIR.exists()
    status["promotion_dir_exists"] = PROMOTION_DIR.exists()

    if IDEAS_DIR.exists():
        status["official_idea_count"] = len(list(IDEAS_DIR.glob("*.md")))
    else:
        status["official_idea_count"] = 0

    required_docs = [
        "README.md", "CONCEPT_PROMOTION_POLICY.md",
        "DETECTION_RULES.md", "REVIEW_WORKFLOW.md",
    ]
    status["promotion_docs_exist"] = all(
        (PROMOTION_DIR / d).exists() for d in required_docs
    )

    if DRAFTS_DIR.exists():
        status["existing_drafts_count"] = len(list(DRAFTS_DIR.glob("*.md")))
    else:
        status["existing_drafts_count"] = 0

    for folder_name, key in [
        ("60_Synthesis", "synthesis_reports"),
        ("07_Learning", "learning_notes"),
        ("09_Cases", "case_notes"),
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
        reports = sorted(REPORTS_DIR.glob("Concept Promotion - *.md"), reverse=True)
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
