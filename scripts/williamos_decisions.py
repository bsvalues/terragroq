"""WilliamOS decision promotion engine.

Scans synthesis reports, inbox triage, promoted drafts, ideas, and project notes
for decision candidates. Generates promotion reports and draft decision records
for human review.
Local-first, deterministic heuristics. Optionally enhanced by semantic search.
Never modifies official decision records in 02_Decisions/.
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
DECISIONS_DIR = VAULT / "02_Decisions"
PROMOTION_DIR = VAULT / "85_DecisionPromotion"
REPORTS_DIR = PROMOTION_DIR / "reports"
DRAFTS_DIR = PROMOTION_DIR / "drafts"

SOURCE_DIRS: dict[str, list[str]] = {
    "synthesis": ["60_Synthesis"],
    "inbox": [
        "70_InboxProcessor/reports",
        "70_InboxProcessor/promoted_drafts",
    ],
    "all": [
        "60_Synthesis",
        "70_InboxProcessor/reports",
        "70_InboxProcessor/promoted_drafts",
        "10_Ideas",
        "11_Projects",
        "07_Learning",
        "05_Assessor_Office",
        "06_TerraFusion_Strategy",
        "01_Daily",
    ],
}

DECISION_SIGNAL_PATTERNS = [
    re.compile(p, re.IGNORECASE) for p in [
        r"\bdecide\b",
        r"\bdecision\b",
        r"\bchoose\b",
        r"\bchose\b",
        r"\bapproved\b",
        r"\brejected\b",
        r"\btradeoff\b",
        r"\btrade-off\b",
        r"\bbecause\b",
        r"\brevisit\b",
        r"\balternative\b",
        r"\boption\b",
        r"\bpro\b.*\bcon\b",
        r"\brisk\b",
        r"\bcommit to\b",
        r"\bgoing with\b",
        r"\bwent with\b",
        r"\binstead of\b",
        r"\brather than\b",
        r"\bover\b.*\bbecause\b",
    ]
]

DOMAIN_SIGNAL_PATTERNS = [
    re.compile(p, re.IGNORECASE) for p in [
        r"\bassessor\b",
        r"\bappraisal\b",
        r"\bappeal\b",
        r"\bBOE\b",
        r"\btaxpayer\b",
        r"\bTerraFusion\b",
        r"\bplatform\b",
        r"\barchitecture\b",
        r"\bvendor\b",
        r"\bcontract\b",
        r"\bbudget\b",
        r"\bhire\b",
        r"\bpolicy\b",
        r"\bstrategy\b",
        r"\bstandard\b",
        r"\bframework\b",
    ]
]

AREA_KEYWORDS: dict[str, list[str]] = {
    "assessor": ["assessor", "county", "levy", "taxpayer", "BOE", "appeal"],
    "appraisal": ["appraisal", "evidence", "defensible", "comp", "valuation"],
    "terrafusion": ["terrafusion", "platform", "architecture", "vendor", "solo dev"],
    "leadership": ["policy", "strategy", "standard", "governance", "budget", "hire"],
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


def scan_decision_sources(source: str = "all") -> list[Path]:
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


def _score_decision_signals(content: str) -> tuple[int, list[str]]:
    score = 0
    matched: list[str] = []
    for pat in DECISION_SIGNAL_PATTERNS:
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
    """Extract lines that look like decision statements."""
    strong_patterns = [
        re.compile(p, re.IGNORECASE) for p in [
            r"\bdecide\b",
            r"\bdecision\b",
            r"\bchoose\b",
            r"\bchose\b",
            r"\bgoing with\b",
            r"\bwent with\b",
            r"\bcommit to\b",
            r"\binstead of\b",
            r"\brather than\b",
            r"\bapproved\b",
            r"\brejected\b",
            r"\btradeoff\b",
            r"\btrade-off\b",
            r"\balternative\b",
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


def _extract_rationale(content: str) -> list[str]:
    """Extract lines that contain rationale/tradeoff language."""
    rationale_patterns = [
        re.compile(p, re.IGNORECASE) for p in [
            r"\bbecause\b",
            r"\breason\b",
            r"\brisk\b",
            r"\btrade-?off\b",
            r"\bpro\b",
            r"\bcon\b",
            r"\bdownside\b",
            r"\bupside\b",
            r"\balternative\b",
            r"\binstead of\b",
            r"\brather than\b",
        ]
    ]
    rationale: list[str] = []
    for line in content.splitlines():
        stripped = line.strip()
        if not stripped or len(stripped) < 15 or stripped.startswith("#"):
            continue
        if stripped.startswith("`") or stripped.startswith("- `"):
            continue
        for pat in rationale_patterns:
            if pat.search(stripped):
                rationale.append(stripped[:200])
                break
    return rationale[:10]


def normalize_candidate_title(text: str) -> str:
    """Turn a decision-signal line into a plausible decision title."""
    text = text.strip()
    for prefix in ["Decision:", "Decided:", "- "]:
        if text.lower().startswith(prefix.lower()):
            text = text[len(prefix):].strip()
    text = re.sub(r"^(we decided to|decided to|going with|went with|commit to|committed to)\s+", "", text, flags=re.IGNORECASE)
    text = text.rstrip(".")
    if len(text) > 80:
        text = text[:77] + "..."
    return text.strip().capitalize() if text else "Untitled Decision"


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
    tags = ["decision", "draft"]
    if area != "personal":
        tags.append(area)
    lower = content.lower()
    if "terrafusion" in lower:
        tags.append("terrafusion")
    if "assessor" in lower or "appraisal" in lower:
        tags.append("assessor")
    if "budget" in lower or "contract" in lower:
        tags.append("operations")
    return sorted(set(tags))


def _load_existing_decisions() -> list[dict[str, Any]]:
    if not DECISIONS_DIR.exists():
        return []
    notes: list[dict[str, Any]] = []
    for f in sorted(DECISIONS_DIR.glob("*.md")):
        notes.append(_parse_note(f))
    return notes


def find_similar_existing_decisions(
    candidate_title: str,
    candidate_content: str,
    existing: list[dict[str, Any]],
) -> list[dict[str, Any]]:
    candidate_words = set(re.findall(r"\b\w{4,}\b", candidate_title.lower()))
    candidate_words.update(re.findall(r"\b\w{4,}\b", candidate_content.lower()[:500]))

    similar: list[dict[str, Any]] = []
    for dec in existing:
        dec_words = set(re.findall(r"\b\w{4,}\b", dec["title"].lower()))
        dec_words.update(re.findall(r"\b\w{4,}\b", dec["content"].lower()[:500]))
        overlap = candidate_words & dec_words
        if len(overlap) >= 3:
            similar.append({
                "title": dec["title"],
                "rel": dec["rel"],
                "status": dec["meta"].get("status", "unknown"),
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
            and "02_Decisions" in r.get("source", "")
        ]
    except Exception:
        return []


def detect_decision_candidates(
    source_files: list[Path],
) -> list[dict[str, Any]]:
    existing = _load_existing_decisions()
    candidates: list[dict[str, Any]] = []
    seen_titles: set[str] = set()

    for f in source_files:
        note = _parse_note(f)
        score, matched = _score_decision_signals(note["content"])
        if score < 2:
            continue

        candidate_lines = _extract_candidate_lines(note["content"])
        if not candidate_lines:
            continue

        title = normalize_candidate_title(candidate_lines[0])
        if title.lower() in seen_titles:
            continue
        seen_titles.add(title.lower())

        rationale = _extract_rationale(note["content"])
        area = suggest_area(note["content"])
        tags = suggest_tags(note["content"], area)

        if score >= 6:
            confidence = "high"
        elif score >= 3:
            confidence = "medium"
        else:
            confidence = "low"

        similar_existing = find_similar_existing_decisions(title, note["content"], existing)
        semantic_similar = _get_semantic_similar(title)

        candidates.append({
            "candidate_title": title,
            "candidate_decision": candidate_lines[0],
            "confidence": confidence,
            "score": score,
            "reason": f"{score} signal matches ({', '.join(matched[:5])})",
            "rationale_lines": rationale,
            "source_paths": [note["rel"]],
            "source_lines": candidate_lines[:5],
            "suggested_area": area,
            "suggested_tags": tags,
            "similar_existing_decisions": similar_existing,
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
        group_rationale = list(c["rationale_lines"])
        c_words = set(re.findall(r"\b\w{4,}\b", c["candidate_title"].lower()))

        for j, other in enumerate(candidates):
            if j <= i or j in used:
                continue
            o_words = set(re.findall(r"\b\w{4,}\b", other["candidate_title"].lower()))
            if len(c_words & o_words) >= 2:
                used.add(j)
                group_sources.extend(other["source_paths"])
                group_lines.extend(other["source_lines"])
                group_rationale.extend(other["rationale_lines"])
                if other["score"] > group["score"]:
                    group["candidate_title"] = other["candidate_title"]
                    group["candidate_decision"] = other["candidate_decision"]
                    group["confidence"] = other["confidence"]
                    group["score"] = other["score"]
                    group["reason"] = other["reason"]

        group["source_paths"] = sorted(set(group_sources))
        group["source_lines"] = group_lines[:8]
        group["rationale_lines"] = group_rationale[:10]
        grouped.append(group)

    return grouped


def _check_semantic_status() -> dict[str, Any]:
    try:
        from williamos_search import get_status
        return get_status()
    except ImportError:
        return {"index_exists": False, "available_mode": "unavailable"}


def promote_decisions(
    source: str = "all",
    dry_run: bool = False,
) -> dict[str, Any]:
    source_files = scan_decision_sources(source)
    candidates = detect_decision_candidates(source_files)
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
    report_path = REPORTS_DIR / f"Decision Promotion - {today}.md"
    REPORTS_DIR.mkdir(parents=True, exist_ok=True)
    report_path.write_text(report_md, encoding="utf-8")
    data["report_path"] = str(report_path)

    if grouped:
        draft_paths = _write_decision_drafts(grouped)
        data["draft_paths"] = draft_paths

    return data


def _format_candidate_block(c: dict[str, Any]) -> str:
    lines: list[str] = []
    lines.append(f"### {c['candidate_title']}")
    lines.append("")
    lines.append(f"- **Decision:** {c['candidate_decision']}")
    lines.append(f"- **Confidence:** {c['confidence']}")
    lines.append(f"- **Reason:** {c['reason']}")
    lines.append(f"- **Suggested area:** {c['suggested_area']}")
    lines.append(f"- **Suggested tags:** {', '.join(c['suggested_tags'])}")
    lines.append(f"- **Source paths:**")
    for sp in c["source_paths"]:
        lines.append(f"  - `{sp}`")
    if c["rationale_lines"]:
        lines.append(f"- **Rationale captured:**")
        for rl in c["rationale_lines"][:3]:
            lines.append(f"  - {rl[:150]}")
    if c["similar_existing_decisions"]:
        lines.append(f"- **Similar existing decisions:**")
        for sim in c["similar_existing_decisions"]:
            lines.append(f"  - `{sim['rel']}` — {sim['title']} (status: {sim['status']}, {sim['overlap_count']} keyword overlap)")
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
    s.append("type: decision-promotion-report")
    s.append("status: draft")
    s.append(f"generated: {generated}")
    s.append(f"source_scope: {source}")
    s.append("tags:")
    s.append("  - decision")
    s.append("  - promotion")
    s.append("  - generated")
    s.append("---")
    s.append("")
    s.append(f"# Decision Promotion - {_local_today().isoformat()}")
    s.append("")

    s.append("## Executive Summary")
    s.append("")
    s.append(
        f"Scanned {data['total_files_scanned']} source files (scope: {source}). "
        f"Found {len(candidates)} decision candidates: "
        f"{len(high)} high-confidence, {len(medium)} medium, {len(low)} low/needs-review."
    )
    s.append("")

    s.append("## Sources Reviewed")
    s.append("")
    dirs = SOURCE_DIRS.get(source, SOURCE_DIRS["all"])
    for d in dirs:
        s.append(f"- `{d}/`")
    s.append("")

    s.append("## High-Confidence Decision Candidates")
    s.append("")
    if high:
        for c in high:
            s.append(_format_candidate_block(c))
    else:
        s.append("None.")
    s.append("")

    s.append("## Medium-Confidence Decision Candidates")
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
        all_similar.extend(c["similar_existing_decisions"])
    seen_rels: set[str] = set()
    unique_similar: list[dict] = []
    for sim in all_similar:
        if sim["rel"] not in seen_rels:
            seen_rels.add(sim["rel"])
            unique_similar.append(sim)

    s.append("## Similar Existing Decisions")
    s.append("")
    if unique_similar:
        for sim in unique_similar:
            s.append(f"- `{sim['rel']}` — {sim['title']} (status: {sim['status']}, {sim['overlap_count']} keyword overlap)")
    else:
        s.append("No similar existing decisions detected.")
    s.append("")

    s.append("## Suggested Drafts Created")
    s.append("")
    if candidates:
        for c in candidates:
            slug = _slugify(c["candidate_title"])
            s.append(f"- `85_DecisionPromotion/drafts/DEC-DRAFT-{slug}.md` — {c['candidate_title']}")
    else:
        s.append("No drafts created.")
    s.append("")

    s.append("## Suggested Next Actions")
    s.append("")
    actions: list[str] = []
    if high:
        actions.append(f"Review {len(high)} high-confidence candidates for promotion to `02_Decisions/`")
    if medium:
        actions.append(f"Evaluate {len(medium)} medium-confidence candidates")
    if unique_similar:
        actions.append(f"Check {len(unique_similar)} potential decision duplicates")
    if low:
        actions.append(f"Decide on {len(low)} low-confidence items")
    if not actions:
        actions.append("No decision candidates found. Continue building source material.")
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
    s.append("- This note was generated by WilliamOS. Review before acting. No official decision records were modified.")
    s.append("")

    return "\n".join(s)


def _write_decision_drafts(candidates: list[dict[str, Any]]) -> list[str]:
    DRAFTS_DIR.mkdir(parents=True, exist_ok=True)
    generated = _local_now_iso()
    today = _local_today().isoformat()
    review = (_local_today() + dt.timedelta(days=30)).isoformat()
    paths: list[str] = []

    for c in candidates:
        title = c["candidate_title"]
        slug = _slugify(title)
        decision_text = c["candidate_decision"]
        area = c["suggested_area"]
        tags_yaml = "\n".join(f"  - {t}" for t in c["suggested_tags"])
        source_yaml = "\n".join(f"  - {sp}" for sp in c["source_paths"])

        rationale_block = ""
        if c["rationale_lines"]:
            rationale_block = "\n".join(f"> {rl}" for rl in c["rationale_lines"][:5])
        else:
            rationale_block = "> (no rationale lines extracted — review source notes)"

        evidence_lines = []
        for line in c["source_lines"][:5]:
            evidence_lines.append(f"> {line}")
        evidence = "\n".join(evidence_lines) if evidence_lines else "> (see source paths)"

        source_citations = "\n".join(f"- `{sp}`" for sp in c["source_paths"])

        similar_block = ""
        if c["similar_existing_decisions"]:
            sim_lines = []
            for sim in c["similar_existing_decisions"]:
                sim_lines.append(f"- `{sim['rel']}` — {sim['title']} (status: {sim['status']}, {sim['overlap_count']} keyword overlap)")
            similar_block = "\n".join(sim_lines)
        else:
            similar_block = "No similar existing decisions detected."

        sem_block = ""
        if c.get("semantic_similar"):
            sem_lines = []
            for ss in c["semantic_similar"]:
                sem_lines.append(f"- `{ss['source']}` — {ss['title']} ({ss['score']:.2f})")
            sem_block = "\n\n## Related Notes (Semantic)\n\n" + "\n".join(sem_lines)

        links = set()
        for sp in c["source_paths"]:
            links.add(Path(sp).stem)
        related = "\n".join(f"- [[{lk}]]" for lk in sorted(links)) if links else "- (none)"

        draft = f"""---
type: decision
status: draft
area: {area}
created: {today}
review: {review}
source_paths:
{source_yaml}
tags:
{tags_yaml}
---

# DEC-DRAFT - {title}

## Decision

{decision_text}

## Why

(Draft — fill in the reasoning behind this decision in your own words.)

## Rationale / Tradeoffs

{rationale_block}

## Alternatives Considered

(Draft — what other options were weighed?)

## Risks

(Draft — what could go wrong?)

## Source Evidence

{evidence}

## Similar Existing Decisions

{similar_block}
{sem_block}

## Related Notes

{related}

## Human Review Checklist

- [ ] Confirm this is actually a decision (not just a preference or observation)
- [ ] Confirm title and decision language
- [ ] Fill in Why, Alternatives, and Risks
- [ ] Confirm area and tags
- [ ] Set a meaningful review date
- [ ] Check for duplicate decisions
- [ ] Move manually to `WilliamOS/02_Decisions/` and rename to `DEC-YYYY-MM-DD-<slug>.md` if accepted

## Generator Notes

- Generated: {generated}
- Confidence: {c['confidence']}
- Reason: {c['reason']}
- This decision draft was generated by WilliamOS for review. It is not an active decision until William accepts it.
"""

        draft_path = DRAFTS_DIR / f"DEC-DRAFT-{slug}.md"
        draft_path.write_text(draft, encoding="utf-8")
        paths.append(str(draft_path))

    return paths


def get_decision_status() -> dict[str, Any]:
    status: dict[str, Any] = {}

    status["decisions_dir_exists"] = DECISIONS_DIR.exists()
    status["promotion_dir_exists"] = PROMOTION_DIR.exists()

    if DECISIONS_DIR.exists():
        all_decs = list(DECISIONS_DIR.glob("*.md"))
        status["official_decision_count"] = len(all_decs)
        open_count = 0
        for f in all_decs:
            text = f.read_text(encoding="utf-8", errors="ignore")
            if text.startswith("---"):
                parts = text.split("---", 2)
                if len(parts) >= 3:
                    for line in parts[1].splitlines():
                        if line.strip().startswith("status:"):
                            val = line.split(":", 1)[1].strip().strip('"')
                            if val != "closed":
                                open_count += 1
                            break
        status["open_decision_count"] = open_count
    else:
        status["official_decision_count"] = 0
        status["open_decision_count"] = 0

    required_docs = [
        "README.md", "DECISION_PROMOTION_POLICY.md",
        "DETECTION_RULES.md", "REVIEW_WORKFLOW.md",
    ]
    status["promotion_docs_exist"] = all(
        (PROMOTION_DIR / d).exists() for d in required_docs
    )

    if DRAFTS_DIR.exists():
        status["existing_drafts_count"] = len(list(DRAFTS_DIR.glob("*.md")))
    else:
        status["existing_drafts_count"] = 0

    synth_dir = VAULT / "60_Synthesis"
    if synth_dir.exists():
        status["synthesis_reports"] = len(list(synth_dir.glob("Weekly Synthesis - *.md")))
    else:
        status["synthesis_reports"] = 0

    inbox_reports_dir = VAULT / "70_InboxProcessor" / "reports"
    if inbox_reports_dir.exists():
        status["inbox_triage_reports"] = len(list(inbox_reports_dir.glob("Inbox Triage - *.md")))
    else:
        status["inbox_triage_reports"] = 0

    if REPORTS_DIR.exists():
        reports = sorted(REPORTS_DIR.glob("Decision Promotion - *.md"), reverse=True)
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
