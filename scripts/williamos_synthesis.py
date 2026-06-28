"""WilliamOS weekly review synthesizer.

Scans vault notes and generates a weekly synthesis draft.
Local-first, deterministic heuristics. Optionally enhanced by semantic search.
Never modifies source notes.
"""
from __future__ import annotations

import datetime as dt
import os
import re
from collections import Counter
from pathlib import Path
from typing import Any
from zoneinfo import ZoneInfo

import frontmatter as fm

VAULT = Path(os.environ.get("WILLIAMOS_VAULT", "WilliamOS"))
SYNTHESIS_DIR = VAULT / "60_Synthesis"

SOURCE_INCLUDE_DIRS = [
    "01_Daily", "02_Decisions", "03_Doctrine", "04_Appraisal",
    "05_Assessor_Office", "06_TerraFusion_Strategy", "07_Learning",
    "09_Cases", "10_Ideas", "11_Projects",
]

DOCTRINE_SIGNAL_PATTERNS = [
    re.compile(p, re.IGNORECASE) for p in [
        r"^\s*rule\s*:",
        r"^\s*principle\s*:",
        r"^\s*lesson\s*:",
        r"\bthe truth is\b",
        r"\bthis means\b",
        r"^\s*(?:never|always)\s+\w+",
    ]
]

WO_SIGNAL_PATTERNS = [
    re.compile(p, re.IGNORECASE) for p in [
        r"\bnext WO\b",
        r"\bwork order\b",
        r"\bTODO\b",
        r"\bshould\s+(?:build|implement|fix|create|add)\b",
        r"\bneed(?:s?)\s+to\s+(?:build|implement|fix|create|add)\b",
    ]
]

TENSION_PATTERNS = [
    re.compile(p, re.IGNORECASE) for p in [
        r"\btension\b", r"\bcontradiction\b", r"\bconflict(?:ing)?\b",
        r"\bparadox\b", r"\bdilemma\b",
    ]
]

LINK_RE = re.compile(r"\[\[([^\]|#]+)")
TASK_RE = re.compile(r"^\s*-\s+\[([ xX])\]\s+(.*)", re.MULTILINE)


def _local_today() -> dt.date:
    tz_name = os.environ.get("WILLIAMOS_TZ", "America/Los_Angeles")
    return dt.datetime.now(ZoneInfo(tz_name)).date()


def _local_now_iso() -> str:
    tz_name = os.environ.get("WILLIAMOS_TZ", "America/Los_Angeles")
    return dt.datetime.now(ZoneInfo(tz_name)).isoformat(timespec="seconds")


def current_week_id() -> str:
    today = _local_today()
    y, w, _ = today.isocalendar()
    return f"{y}-W{w:02d}"


def get_week_range(week_id: str) -> tuple[dt.date, dt.date]:
    year_str, week_str = week_id.split("-W")
    monday = dt.date.fromisocalendar(int(year_str), int(week_str), 1)
    sunday = monday + dt.timedelta(days=6)
    return monday, sunday


def _collect_source_files() -> list[Path]:
    files: list[Path] = []
    for folder in SOURCE_INCLUDE_DIRS:
        d = VAULT / folder
        if d.exists():
            files.extend(sorted(d.rglob("*.md")))
    return files


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
    folder = Path(rel).parts[0] if Path(rel).parts else ""

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
        "folder": folder,
        "meta": meta,
        "content": content,
        "title": title,
    }


def _is_in_week(note: dict, week_start: dt.date, week_end: dt.date) -> bool:
    created = note["meta"].get("created")
    if created:
        try:
            if week_start <= dt.date.fromisoformat(str(created)) <= week_end:
                return True
        except (ValueError, TypeError):
            pass

    try:
        if week_start <= dt.date.fromisoformat(note["path"].stem) <= week_end:
            return True
    except ValueError:
        pass

    try:
        mtime = dt.datetime.fromtimestamp(note["path"].stat().st_mtime).date()
        if week_start <= mtime <= week_end:
            return True
    except OSError:
        pass

    return False


def _extract_wikilinks(content: str) -> list[str]:
    return [m.group(1).strip() for m in LINK_RE.finditer(content)]


def _find_stale_decisions(
    decisions: list[dict], today: dt.date
) -> list[dict]:
    threshold = today + dt.timedelta(days=7)
    stale = []
    for d in decisions:
        if d["meta"].get("status") == "closed":
            continue
        review = d["meta"].get("review")
        if not review:
            continue
        try:
            review_date = dt.date.fromisoformat(str(review))
        except (ValueError, TypeError):
            continue
        if review_date <= threshold:
            diff = (review_date - today).days
            label = f"{abs(diff)} days overdue" if diff <= 0 else f"in {diff} days"
            stale.append({**d, "review_date": review_date, "review_label": label})
    return stale


def _detect_open_loops(notes: list[dict]) -> list[dict[str, Any]]:
    loops: list[dict[str, Any]] = []
    for note in notes:
        for m in TASK_RE.finditer(note["content"]):
            if m.group(1) == " ":
                text = m.group(2).strip()
                if text and not text.startswith("#"):
                    loops.append({"text": text, "source": note["rel"]})
    return loops


def _detect_repeated_themes(notes: list[dict]) -> list[tuple[str, int, list[str]]]:
    link_sources: dict[str, set[str]] = {}
    for note in notes:
        for link in _extract_wikilinks(note["content"]):
            link_sources.setdefault(link, set()).add(note["rel"])
    return [
        (link, len(srcs), sorted(srcs))
        for link, srcs in sorted(link_sources.items(), key=lambda x: -len(x[1]))
        if len(srcs) >= 2
    ]


def _detect_signals(
    notes: list[dict], patterns: list[re.Pattern], skip_folders: set[str] | None = None, limit: int = 10
) -> list[dict[str, Any]]:
    candidates: list[dict[str, Any]] = []
    for note in notes:
        if skip_folders and note["folder"] in skip_folders:
            continue
        for line in note["content"].splitlines():
            stripped = line.strip()
            if not stripped or len(stripped) < 10 or stripped.startswith("#"):
                continue
            for pattern in patterns:
                if pattern.search(stripped):
                    candidates.append({
                        "signal": stripped[:150],
                        "source": note["rel"],
                        "title": note["title"],
                    })
                    break
            if len(candidates) >= limit:
                return candidates
    return candidates


def _detect_tensions(notes: list[dict]) -> list[dict[str, Any]]:
    return _detect_signals(notes, TENSION_PATTERNS, limit=5)


def _check_semantic_status() -> dict[str, Any]:
    try:
        from williamos_search import get_status
        return get_status()
    except ImportError:
        return {"index_exists": False, "available_mode": "unavailable"}


def _get_semantic_suggestions(themes: list[tuple[str, int, list[str]]]) -> list[dict]:
    try:
        from williamos_search import search as sem_search, get_status
        if not get_status().get("index_exists"):
            return []
        seen: set[str] = set()
        suggestions: list[dict] = []
        for name, _, _ in themes[:5]:
            for r in sem_search(name, top_k=3):
                if r.get("error") or r["source"] in seen:
                    continue
                seen.add(r["source"])
                suggestions.append({
                    "theme": name,
                    "source": r["source"],
                    "title": r["title"],
                    "score": r["score"],
                })
        return suggestions
    except Exception:
        return []


def _generate_weekly_markdown(data: dict[str, Any]) -> str:
    week = data["week"]
    generated = data["generated"]
    mode = data["mode"]
    week_notes = data["notes_reviewed"]
    open_decisions = data["open_decisions"]
    stale_decisions = data["stale_decisions"]
    active_doctrines = data["active_doctrines"]
    new_concepts = data["new_concepts"]
    new_cases = data["new_cases"]
    terra_signals = data["terra_signals"]
    learning_signals = data["learning_signals"]
    open_loops = data["open_loops"]
    themes = data["themes"]
    candidate_doctrines = data["candidate_doctrines"]
    candidate_wos = data["candidate_wos"]
    tensions = data["tensions"]
    semantic_info = data["semantic_info"]
    semantic_suggestions = data.get("semantic_suggestions", [])

    all_sources: set[str] = set()
    for n in week_notes + open_decisions + stale_decisions + active_doctrines:
        all_sources.add(n["rel"])

    folders_seen = {n["folder"] for n in week_notes}
    theme_names = ", ".join(t[0] for t in themes[:3]) or "none detected"
    exec_summary = (
        f"Reviewed {len(week_notes)} notes across {len(folders_seen)} folders. "
        f"{len(open_decisions)} open decisions ({len(stale_decisions)} stale/upcoming). "
        f"{len(new_concepts)} new concepts. "
        f"{len(open_loops)} open loops. "
        f"Top themes: {theme_names}."
    )

    s: list[str] = []

    # --- frontmatter ---
    s.append("---")
    s.append("type: weekly-synthesis")
    s.append("status: draft")
    s.append(f"week: {week}")
    s.append(f"generated: {generated}")
    s.append("source_scope: default")
    s.append("tags:")
    s.append("  - weekly-synthesis")
    s.append("  - generated")
    s.append("---")
    s.append("")
    s.append(f"# Weekly Synthesis - {week}")
    s.append("")

    # --- Executive Summary ---
    s.append("## Executive Summary")
    s.append("")
    s.append(exec_summary)
    s.append("")

    # --- Source Notes Reviewed ---
    s.append("## Source Notes Reviewed")
    s.append("")
    if week_notes:
        for n in sorted(week_notes, key=lambda x: x["rel"]):
            s.append(f"- `{n['rel']}` — {n['title']}")
    else:
        s.append("No notes created or modified this week.")
    s.append("")

    # --- Open Loops ---
    s.append("## Open Loops")
    s.append("")
    if open_loops:
        for lp in open_loops:
            s.append(f"- [ ] {lp['text']} — `{lp['source']}`")
    else:
        s.append("No open loops detected.")
    s.append("")

    # --- Decisions ---
    s.append("## Decisions")
    s.append("")
    s.append("### Open Decisions")
    s.append("")
    if open_decisions:
        s.append("| Decision | Status | Review Date |")
        s.append("|----------|--------|-------------|")
        for d in open_decisions:
            name = d["path"].stem
            status = d["meta"].get("status", "unknown")
            review = d["meta"].get("review", "—")
            s.append(f"| {name} | {status} | {review} |")
    else:
        s.append("No open decisions.")
    s.append("")

    s.append("### Stale / Upcoming Reviews")
    s.append("")
    if stale_decisions:
        for d in stale_decisions:
            s.append(f"- {d['path'].stem} — review {d['review_date']} ({d['review_label']})")
    else:
        s.append("No stale or upcoming reviews.")
    s.append("")

    # --- Doctrine Signals ---
    s.append("## Doctrine Signals")
    s.append("")
    s.append("### Active Doctrines Referenced")
    s.append("")
    if active_doctrines:
        for d in active_doctrines:
            s.append(f"- {d['title']} — `{d['rel']}`")
    else:
        s.append("No doctrines referenced in this week's notes.")
    s.append("")

    s.append("### Candidate New Doctrines")
    s.append("")
    if candidate_doctrines:
        for c in candidate_doctrines:
            s.append(f"- \"{c['signal']}\" — `{c['source']}`")
    else:
        s.append("No candidate doctrines detected.")
    s.append("")

    # --- Concepts and Themes ---
    s.append("## Concepts and Themes")
    s.append("")
    s.append("### Repeated Themes")
    s.append("")
    if themes:
        for name, count, _ in themes[:10]:
            s.append(f"- [[{name}]] — appeared in {count} notes")
    else:
        s.append("No repeated themes detected.")
    s.append("")

    s.append("### Emerging Concepts")
    s.append("")
    if new_concepts:
        for n in new_concepts:
            s.append(f"- {n['title']} — created {n['meta'].get('created', 'unknown')}")
    else:
        s.append("No new concepts this week.")
    s.append("")

    s.append("### Tensions / Contradictions")
    s.append("")
    if tensions:
        for t in tensions:
            s.append(f"- \"{t['signal']}\" — `{t['source']}`")
    else:
        s.append("No explicit tensions detected this week.")
    s.append("")

    # --- Domain signals ---
    s.append("## Cases / Appraisal Signals")
    s.append("")
    if new_cases:
        for n in new_cases:
            s.append(f"- {n['title']} — `{n['rel']}`")
    else:
        s.append("No case or appraisal notes this week.")
    s.append("")

    s.append("## TerraFusion Strategy Signals")
    s.append("")
    if terra_signals:
        for n in terra_signals:
            s.append(f"- {n['title']} — `{n['rel']}`")
    else:
        s.append("No TerraFusion strategy notes this week.")
    s.append("")

    s.append("## Learning Signals")
    s.append("")
    if learning_signals:
        for n in learning_signals:
            s.append(f"- {n['title']} — `{n['rel']}`")
    else:
        s.append("No learning notes this week.")
    s.append("")

    # --- Candidate Work Orders ---
    s.append("## Candidate Work Orders")
    s.append("")
    if candidate_wos:
        for c in candidate_wos:
            s.append(f"- \"{c['signal']}\" — `{c['source']}`")
        s.append("")
        s.append("See also: Open Loops section for unchecked tasks that may inform work orders.")
    else:
        s.append("No candidate work orders detected.")
    s.append("")

    # --- Semantic Suggestions ---
    if semantic_suggestions:
        s.append("## Semantic Search Suggestions")
        s.append("")
        s.append("*Related notes surfaced by the semantic index (not necessarily touched this week):*")
        s.append("")
        for sg in semantic_suggestions[:10]:
            s.append(f"- `{sg['source']}` — {sg['title']} (theme: {sg['theme']}, score: {sg['score']:.2f})")
        s.append("")

    # --- Next-Week Focus ---
    s.append("## Suggested Next-Week Focus")
    s.append("")
    suggestions: list[str] = []
    for d in stale_decisions[:2]:
        suggestions.append(f"Review stale decision: {d['path'].stem}")
    for lp in open_loops[:2]:
        suggestions.append(f"Address open loop: {lp['text'][:80]}")
    for name, count, _ in themes[:2]:
        suggestions.append(f"Explore repeated theme: [[{name}]] ({count} notes)")
    if not suggestions:
        suggestions.append("No specific focus areas detected. Continue regular rhythm.")
    for i, sg in enumerate(suggestions, 1):
        s.append(f"{i}. {sg}")
    s.append("")

    # --- Source Paths ---
    s.append("## Source Paths")
    s.append("")
    s.append("All paths cited in this synthesis:")
    s.append("")
    for p in sorted(all_sources):
        s.append(f"- `{p}`")
    s.append("")

    # --- Generator Notes ---
    s.append("## Generator Notes")
    s.append("")
    s.append(f"- Mode: {mode}")
    s.append(f"- Generated: {generated}")
    if semantic_info.get("index_exists"):
        fi = semantic_info.get("files_indexed", 0)
        ci = semantic_info.get("chunks_indexed", 0)
        s.append(f"- Semantic index: available ({fi} files, {ci} chunks)")
    else:
        s.append(f"- Semantic index: {semantic_info.get('available_mode', 'unavailable')}")
    s.append(f"- Source scope: default ({len(SOURCE_INCLUDE_DIRS)} folders)")
    s.append("- This note was generated by WilliamOS. Review before relying on it.")
    s.append("")

    return "\n".join(s)


def synthesize_week(
    week_id: str | None = None, dry_run: bool = False
) -> dict[str, Any]:
    if week_id is None:
        week_id = current_week_id()

    week_start, week_end = get_week_range(week_id)
    today = _local_today()

    all_notes = [_parse_note(f) for f in _collect_source_files()]
    week_notes = [n for n in all_notes if _is_in_week(n, week_start, week_end)]
    daily_notes = [n for n in week_notes if n["folder"] == "01_Daily"]

    all_decisions = [n for n in all_notes if n["folder"] == "02_Decisions"]
    open_decisions = [d for d in all_decisions if d["meta"].get("status") != "closed"]
    stale_decisions = _find_stale_decisions(all_decisions, today)

    week_links = set()
    for n in week_notes:
        week_links.update(_extract_wikilinks(n["content"]))
    all_doctrines = [n for n in all_notes if n["folder"] == "03_Doctrine"]
    active_doctrines = [
        d for d in all_doctrines
        if d["path"].stem in week_links or d["title"] in week_links
    ]

    new_concepts = [n for n in week_notes if n["folder"] == "10_Ideas"]
    new_cases = [n for n in week_notes if n["folder"] in ("09_Cases", "04_Appraisal")]
    terra_signals = [n for n in week_notes if n["folder"] == "06_TerraFusion_Strategy"]
    learning_signals = [n for n in week_notes if n["folder"] == "07_Learning"]

    open_loops = _detect_open_loops(week_notes)
    themes = _detect_repeated_themes(week_notes)
    candidate_doctrines = _detect_signals(
        week_notes, DOCTRINE_SIGNAL_PATTERNS, skip_folders={"03_Doctrine"}
    )
    candidate_wos = _detect_signals(week_notes, WO_SIGNAL_PATTERNS)
    tensions = _detect_tensions(week_notes)

    semantic_info = _check_semantic_status()
    semantic_suggestions = (
        _get_semantic_suggestions(themes)
        if semantic_info.get("index_exists") and themes
        else []
    )

    mode = "semantic-assisted" if semantic_suggestions else "deterministic heuristics"

    data: dict[str, Any] = {
        "week": week_id,
        "week_start": week_start.isoformat(),
        "week_end": week_end.isoformat(),
        "generated": _local_now_iso(),
        "mode": mode,
        "notes_reviewed": week_notes,
        "daily_notes": daily_notes,
        "open_decisions": open_decisions,
        "stale_decisions": stale_decisions,
        "active_doctrines": active_doctrines,
        "new_concepts": new_concepts,
        "new_cases": new_cases,
        "terra_signals": terra_signals,
        "learning_signals": learning_signals,
        "open_loops": open_loops,
        "themes": themes,
        "candidate_doctrines": candidate_doctrines,
        "candidate_wos": candidate_wos,
        "tensions": tensions,
        "semantic_info": semantic_info,
        "semantic_suggestions": semantic_suggestions,
    }

    if dry_run:
        return data

    markdown = _generate_weekly_markdown(data)
    output_path = SYNTHESIS_DIR / f"Weekly Synthesis - {week_id}.md"
    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_text(markdown, encoding="utf-8")
    data["output_path"] = str(output_path)
    return data


def get_synthesis_status() -> dict[str, Any]:
    docs = ["README.md", "WEEKLY_SYNTHESIS_POLICY.md",
            "WEEKLY_SYNTHESIS_TEMPLATE.md", "QUERY_STRATEGY.md"]
    status: dict[str, Any] = {
        "docs_exist": all((SYNTHESIS_DIR / d).exists() for d in docs),
        "output_dir": str(SYNTHESIS_DIR),
        "output_dir_exists": SYNTHESIS_DIR.exists(),
    }

    if SYNTHESIS_DIR.exists():
        synth_files = sorted(SYNTHESIS_DIR.glob("Weekly Synthesis - *.md"), reverse=True)
        status["last_synthesis"] = synth_files[0].name if synth_files else None
    else:
        status["last_synthesis"] = None

    try:
        from williamos_search import get_status as search_status
        sem = search_status()
        status["semantic_available"] = sem.get("available_mode", "unavailable")
        status["semantic_index_exists"] = sem.get("index_exists", False)
    except ImportError:
        status["semantic_available"] = "unavailable"
        status["semantic_index_exists"] = False

    return status
