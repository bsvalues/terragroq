"""WilliamOS inbox processor.

Scans raw inbox notes and produces classification reports and optional promotion drafts.
Local-first, deterministic heuristics. Optionally enhanced by semantic search.
Never modifies source inbox notes.
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
INBOX_DIR = VAULT / "00_Inbox"
PROCESSOR_DIR = VAULT / "70_InboxProcessor"
REPORTS_DIR = PROCESSOR_DIR / "reports"
DRAFTS_DIR = PROCESSOR_DIR / "promoted_drafts"

CATEGORIES: dict[str, dict[str, Any]] = {
    "doctrine_candidate": {
        "destination": "03_Doctrine",
        "signals": [
            re.compile(p, re.IGNORECASE) for p in [
                r"\brule\b", r"\bprinciple\b", r"\balways\b", r"\bnever\b",
                r"\blesson\b", r"\btruth\b", r"\bthis means\b", r"\bdoctrine\b",
                r"\bmust\b", r"\bshould not\b",
            ]
        ],
    },
    "decision_candidate": {
        "destination": "02_Decisions",
        "signals": [
            re.compile(p, re.IGNORECASE) for p in [
                r"\bdecide\b", r"\bdecision\b", r"\bchoose\b", r"\bapproved\b",
                r"\brejected\b", r"\btradeoff\b", r"\bbecause\b", r"\brevisit\b",
            ]
        ],
    },
    "concept_candidate": {
        "destination": "10_Ideas",
        "signals": [
            re.compile(p, re.IGNORECASE) for p in [
                r"\bwhat is\b", r"\bmeans\b", r"\bidea\b", r"\bconcept\b",
                r"\bpattern\b", r"\btheme\b", r"\bconnection\b", r"\brelationship\b",
            ]
        ],
    },
    "case_candidate": {
        "destination": "09_Cases",
        "signals": [
            re.compile(p, re.IGNORECASE) for p in [
                r"\bproperty\b", r"\bparcel\b", r"\bappeal\b", r"\bappraisal\b",
                r"\bcomp\b", r"\bsale\b", r"\bvaluation\b", r"\badjustment\b",
                r"\bevidence\b", r"\bBOE\b",
            ]
        ],
    },
    "project_candidate": {
        "destination": "11_Projects",
        "signals": [
            re.compile(p, re.IGNORECASE) for p in [
                r"\bproject\b", r"\bbuild\b", r"\broadmap\b", r"\bphase\b",
                r"\bmilestone\b", r"\bimplementation\b", r"\bplan\b",
            ]
        ],
    },
    "learning_candidate": {
        "destination": "07_Learning",
        "signals": [
            re.compile(p, re.IGNORECASE) for p in [
                r"\blearn\b", r"\bstudy\b", r"\bunderstand\b", r"\bcourse\b",
                r"\btutorial\b", r"\bpractice\b", r"\bskill\b", r"\bexplain to me\b",
            ]
        ],
    },
    "person_or_relationship": {
        "destination": "08_People",
        "signals": [
            re.compile(p, re.IGNORECASE) for p in [
                r"\bmet with\b", r"\btalked to\b", r"\bcontact\b",
                r"\brelationship\b", r"\bstakeholder\b",
            ]
        ],
    },
    "source_or_reference": {
        "destination": "07_Learning",
        "signals": [
            re.compile(p, re.IGNORECASE) for p in [
                r"\bsource\b", r"\breference\b", r"\barticle\b", r"\bbook\b",
                r"\bpaper\b", r"\blink\b", r"https?://",
            ]
        ],
    },
    "work_order_seed": {
        "destination": "11_Projects",
        "signals": [
            re.compile(p, re.IGNORECASE) for p in [
                r"\bWO\b", r"\bwork order\b", r"\bimplement\b", r"\bfix\b",
                r"\bgap\b", r"\bacceptance criteria\b", r"\bdefinition of done\b",
                r"\bagent\b", r"\bprompt\b",
            ]
        ],
    },
    "open_loop": {
        "destination": None,
        "signals": [
            re.compile(p, re.IGNORECASE) for p in [
                r"\btodo\b", r"\bnext\b", r"\bwaiting\b", r"\bfollow up\b",
                r"\bneeds\b", r"\bblocked\b", r"\bquestion\b", r"\bunclear\b",
            ]
        ],
    },
    "daily_log_fragment": {
        "destination": "01_Daily",
        "signals": [
            re.compile(p, re.IGNORECASE) for p in [
                r"\btoday\b", r"\bthis morning\b", r"\bthis afternoon\b",
                r"\bmeeting\b", r"\bstandup\b",
            ]
        ],
    },
    "archive_or_noise": {
        "destination": "99_Archive",
        "signals": [
            re.compile(p, re.IGNORECASE) for p in [
                r"\bduplicate\b", r"\brandom\b", r"\bsave for later\b",
                r"\bno action\b", r"\bmaybe\b", r"\blow value\b",
            ]
        ],
    },
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


def scan_inbox_notes(since: dt.date | None = None) -> list[Path]:
    if not INBOX_DIR.exists():
        return []
    exclude_dirs = {"processed", "archive", ".trash"}
    files: list[Path] = []
    for f in sorted(INBOX_DIR.rglob("*.md")):
        rel_parts = f.relative_to(INBOX_DIR).parts
        if rel_parts and rel_parts[0].lower() in exclude_dirs:
            continue
        if since:
            try:
                mtime = dt.datetime.fromtimestamp(f.stat().st_mtime).date()
                if mtime < since:
                    continue
            except OSError:
                continue
        files.append(f)
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
    title = ""
    for line in content.splitlines():
        stripped = line.strip()
        if stripped.startswith("# ") and not stripped.startswith("## "):
            title = stripped[2:].strip()
            break
    if not title:
        title = path.stem

    excerpt = ""
    for line in content.splitlines():
        stripped = line.strip()
        if stripped and not stripped.startswith("#"):
            excerpt = stripped[:200]
            break

    return {
        "path": path,
        "rel": rel,
        "meta": meta,
        "content": content,
        "title": title,
        "excerpt": excerpt,
    }


def _score_category(content: str, signals: list[re.Pattern]) -> int:
    score = 0
    lower = content.lower()
    for sig in signals:
        score += len(sig.findall(lower))
    return score


def classify_inbox_item(note: dict[str, Any]) -> list[dict[str, Any]]:
    content = note["content"]
    results: list[tuple[str, int]] = []
    for cat_name, cat_info in CATEGORIES.items():
        score = _score_category(content, cat_info["signals"])
        if score > 0:
            results.append((cat_name, score))

    results.sort(key=lambda x: -x[1])

    links = [m.group(1).strip() for m in LINK_RE.finditer(content)]

    if not results:
        return [{
            "category": "archive_or_noise",
            "confidence": "low",
            "reason": "No signal patterns matched",
            "destination": "99_Archive",
            "suggested_title": note["title"],
            "suggested_links": links,
            "score": 0,
        }]

    classifications: list[dict[str, Any]] = []
    for cat_name, score in results[:3]:
        if score >= 4:
            confidence = "high"
        elif score >= 2:
            confidence = "medium"
        else:
            confidence = "low"
        dest = CATEGORIES[cat_name]["destination"]
        classifications.append({
            "category": cat_name,
            "confidence": confidence,
            "reason": f"{score} signal matches for {cat_name}",
            "destination": dest,
            "suggested_title": _suggest_title(note, cat_name),
            "suggested_links": links,
            "score": score,
        })
    return classifications


def _suggest_title(note: dict[str, Any], category: str) -> str:
    title = note["title"]
    if title.startswith("Inbox - "):
        title = title.replace("Inbox - ", "").strip()
        if title and len(title) <= 10:
            title = note["excerpt"][:60].strip() if note["excerpt"] else title

    prefixes = {
        "doctrine_candidate": "Doctrine - ",
        "decision_candidate": "DEC-",
        "concept_candidate": "",
        "case_candidate": "Case - ",
        "project_candidate": "Project - ",
        "learning_candidate": "Learning - ",
        "work_order_seed": "WO Seed - ",
    }
    prefix = prefixes.get(category, "")
    if prefix and not title.startswith(prefix):
        return f"{prefix}{title}"
    return title


def _check_semantic() -> dict[str, Any]:
    try:
        from williamos_search import get_status
        return get_status()
    except ImportError:
        return {"index_exists": False, "available_mode": "unavailable"}


def _get_semantic_links(text: str) -> list[dict[str, Any]]:
    try:
        from williamos_search import search as sem_search, get_status
        if not get_status().get("index_exists"):
            return []
        excerpt = text[:300]
        results = sem_search(excerpt, top_k=3)
        return [
            {"source": r["source"], "title": r["title"], "score": r["score"]}
            for r in results if not r.get("error") and r.get("score", 0) > 0.15
        ]
    except Exception:
        return []


def process_inbox(
    since: dt.date | None = None,
    dry_run: bool = False,
    promote_drafts: bool = False,
) -> dict[str, Any]:
    files = scan_inbox_notes(since=since)
    semantic_info = _check_semantic()

    items: list[dict[str, Any]] = []
    for f in files:
        note = _parse_note(f)
        classifications = classify_inbox_item(note)
        sem_links = (
            _get_semantic_links(note["content"])
            if semantic_info.get("index_exists")
            else []
        )
        items.append({
            "note": note,
            "classifications": classifications,
            "primary": classifications[0] if classifications else None,
            "semantic_links": sem_links,
        })

    high = [i for i in items if i["primary"] and i["primary"]["confidence"] == "high"]
    medium = [i for i in items if i["primary"] and i["primary"]["confidence"] == "medium"]
    low = [i for i in items if i["primary"] and i["primary"]["confidence"] == "low"]
    open_loops = [
        i for i in items
        if any(c["category"] == "open_loop" for c in i["classifications"])
    ]
    wo_seeds = [
        i for i in items
        if any(c["category"] == "work_order_seed" for c in i["classifications"])
    ]
    noise = [
        i for i in items
        if i["primary"] and i["primary"]["category"] == "archive_or_noise"
    ]

    mode = "semantic-assisted" if semantic_info.get("index_exists") else "deterministic heuristics"

    data: dict[str, Any] = {
        "generated": _local_now_iso(),
        "mode": mode,
        "total": len(items),
        "items": items,
        "high": high,
        "medium": medium,
        "low": low,
        "open_loops": open_loops,
        "wo_seeds": wo_seeds,
        "noise": noise,
        "semantic_info": semantic_info,
    }

    if dry_run:
        return data

    report_md = _generate_triage_report(data)
    today = _local_today().isoformat()
    report_path = REPORTS_DIR / f"Inbox Triage - {today}.md"
    REPORTS_DIR.mkdir(parents=True, exist_ok=True)
    report_path.write_text(report_md, encoding="utf-8")
    data["report_path"] = str(report_path)

    if promote_drafts and items:
        draft_paths = _write_promoted_drafts(items)
        data["draft_paths"] = draft_paths

    return data


def _format_item_block(item: dict[str, Any]) -> str:
    note = item["note"]
    primary = item["primary"]
    lines: list[str] = []
    lines.append(f"### `{note['rel']}`")
    lines.append("")
    lines.append(f"- **Classification:** {primary['category']}")
    lines.append(f"- **Confidence:** {primary['confidence']}")
    lines.append(f"- **Reason:** {primary['reason']}")
    if primary["destination"]:
        lines.append(f"- **Suggested destination:** `{primary['destination']}/`")
    lines.append(f"- **Suggested title:** {primary['suggested_title']}")
    if primary["suggested_links"]:
        link_str = ", ".join(f"[[{lk}]]" for lk in primary["suggested_links"][:5])
        lines.append(f"- **Suggested links:** {link_str}")
    if item["semantic_links"]:
        sem_str = ", ".join(
            f"`{sl['source']}` ({sl['score']:.2f})"
            for sl in item["semantic_links"][:3]
        )
        lines.append(f"- **Related (semantic):** {sem_str}")
    if note["excerpt"]:
        lines.append(f"- **Excerpt:** {note['excerpt'][:150]}...")
    lines.append("")
    return "\n".join(lines)


def _generate_triage_report(data: dict[str, Any]) -> str:
    generated = data["generated"]
    mode = data["mode"]
    items = data["items"]
    high = data["high"]
    medium = data["medium"]
    low = data["low"]
    open_loops = data["open_loops"]
    wo_seeds = data["wo_seeds"]
    noise = data["noise"]
    semantic_info = data["semantic_info"]

    s: list[str] = []

    s.append("---")
    s.append("type: inbox-triage")
    s.append("status: draft")
    s.append(f"generated: {generated}")
    s.append("source_scope: WilliamOS/00_Inbox")
    s.append("tags:")
    s.append("  - inbox")
    s.append("  - triage")
    s.append("  - generated")
    s.append("---")
    s.append("")
    s.append(f"# Inbox Triage - {_local_today().isoformat()}")
    s.append("")

    s.append("## Executive Summary")
    s.append("")
    s.append(
        f"Processed {len(items)} inbox notes. "
        f"{len(high)} high-confidence, {len(medium)} medium, {len(low)} low/needs-review. "
        f"{len(open_loops)} open loops. {len(wo_seeds)} work order seeds. "
        f"{len(noise)} archive/noise candidates."
    )
    s.append("")

    s.append("## Source Notes Reviewed")
    s.append("")
    if items:
        for item in items:
            s.append(f"- `{item['note']['rel']}`")
    else:
        s.append("No inbox notes found.")
    s.append("")

    s.append("## High-Confidence Promotions")
    s.append("")
    if high:
        for item in high:
            s.append(_format_item_block(item))
    else:
        s.append("None.")
    s.append("")

    s.append("## Medium-Confidence Promotions")
    s.append("")
    if medium:
        for item in medium:
            s.append(_format_item_block(item))
    else:
        s.append("None.")
    s.append("")

    s.append("## Low-Confidence / Needs Human Review")
    s.append("")
    if low:
        for item in low:
            s.append(_format_item_block(item))
    else:
        s.append("None.")
    s.append("")

    s.append("## Open Loops")
    s.append("")
    if open_loops:
        for item in open_loops:
            s.append(f"- `{item['note']['rel']}` — {item['note']['excerpt'][:100]}")
    else:
        s.append("None.")
    s.append("")

    s.append("## Work Order Seeds")
    s.append("")
    if wo_seeds:
        for item in wo_seeds:
            s.append(f"- `{item['note']['rel']}` — {item['note']['excerpt'][:100]}")
    else:
        s.append("None.")
    s.append("")

    s.append("## Archive / Noise Candidates")
    s.append("")
    if noise:
        for item in noise:
            s.append(f"- `{item['note']['rel']}` — {item['primary']['reason']}")
    else:
        s.append("None.")
    s.append("")

    all_sem_links: list[str] = []
    for item in items:
        for sl in item.get("semantic_links", []):
            if sl["source"] not in all_sem_links:
                all_sem_links.append(sl["source"])

    s.append("## Suggested Links")
    s.append("")
    if all_sem_links:
        s.append("*Notes related to inbox items (via semantic search):*")
        s.append("")
        for src in all_sem_links[:15]:
            s.append(f"- `{src}`")
    else:
        s.append("No semantic link suggestions (index unavailable or no matches).")
    s.append("")

    s.append("## Suggested Next Actions")
    s.append("")
    actions: list[str] = []
    if high:
        actions.append(f"Review and promote {len(high)} high-confidence items")
    if medium:
        actions.append(f"Review {len(medium)} medium-confidence items for accuracy")
    if open_loops:
        actions.append(f"Address {len(open_loops)} open loops")
    if noise:
        actions.append(f"Archive {len(noise)} noise candidates")
    if not actions:
        actions.append("Inbox is clean. No actions needed.")
    for i, a in enumerate(actions, 1):
        s.append(f"{i}. {a}")
    s.append("")

    s.append("## Source Paths")
    s.append("")
    for item in items:
        s.append(f"- `{item['note']['rel']}`")
    s.append("")

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
    s.append("- This note was generated by WilliamOS. Review before acting. Source inbox notes were not modified.")
    s.append("")

    return "\n".join(s)


def _write_promoted_drafts(items: list[dict[str, Any]]) -> list[str]:
    DRAFTS_DIR.mkdir(parents=True, exist_ok=True)
    generated = _local_now_iso()
    paths: list[str] = []

    promotable = [
        i for i in items
        if i["primary"]
        and i["primary"]["category"] != "archive_or_noise"
        and i["primary"]["confidence"] in ("high", "medium")
    ]

    for item in promotable:
        note = item["note"]
        primary = item["classifications"][0]
        title = primary["suggested_title"]
        slug = _slugify(title)
        dest = primary.get("destination") or "00_Inbox"
        links = primary.get("suggested_links", [])
        link_str = "\n".join(f"- [[{lk}]]" for lk in links) if links else "- (none detected)"

        sem_str = ""
        if item["semantic_links"]:
            sem_str = "\n".join(
                f"- `{sl['source']}` — {sl['title']} ({sl['score']:.2f})"
                for sl in item["semantic_links"][:5]
            )

        draft = f"""---
type: promoted-draft
status: draft
source_path: {note['rel']}
suggested_type: {primary['category']}
suggested_destination: {dest}
generated: {generated}
tags:
  - promoted-draft
---

# {title}

## Source

`{note['rel']}`

## Original Capture

{note['content'].strip()}

## Suggested Classification

- **Type:** {primary['category']}
- **Confidence:** {primary['confidence']}
- **Reason:** {primary['reason']}
- **Destination:** `{dest}/`

## Suggested Links

{link_str}
"""
        if sem_str:
            draft += f"""
## Related Notes (Semantic)

{sem_str}
"""

        draft += """
## Human Review Checklist

- [ ] Confirm classification
- [ ] Confirm destination
- [ ] Rename if needed
- [ ] Move manually to final folder
- [ ] Update links
"""

        draft_path = DRAFTS_DIR / f"{slug}.md"
        draft_path.write_text(draft, encoding="utf-8")
        paths.append(str(draft_path))

    return paths


def get_inbox_status() -> dict[str, Any]:
    status: dict[str, Any] = {
        "inbox_exists": INBOX_DIR.exists(),
        "processor_docs_exist": all(
            (PROCESSOR_DIR / d).exists()
            for d in ["README.md", "INBOX_PROCESSING_POLICY.md",
                       "CLASSIFICATION_RULES.md", "PROMOTION_WORKFLOW.md"]
        ),
    }

    if INBOX_DIR.exists():
        files = scan_inbox_notes()
        status["inbox_count"] = len(files)
        if files:
            mtimes = []
            for f in files:
                try:
                    mtimes.append((f, dt.datetime.fromtimestamp(f.stat().st_mtime)))
                except OSError:
                    pass
            if mtimes:
                mtimes.sort(key=lambda x: x[1])
                status["oldest"] = mtimes[0][0].name
                status["newest"] = mtimes[-1][0].name
            else:
                status["oldest"] = None
                status["newest"] = None
        else:
            status["oldest"] = None
            status["newest"] = None
    else:
        status["inbox_count"] = 0
        status["oldest"] = None
        status["newest"] = None

    if REPORTS_DIR.exists():
        reports = sorted(REPORTS_DIR.glob("Inbox Triage - *.md"), reverse=True)
        status["last_report"] = reports[0].name if reports else None
    else:
        status["last_report"] = None

    status["drafts_dir_exists"] = DRAFTS_DIR.exists()

    try:
        from williamos_search import get_status as search_status
        sem = search_status()
        status["semantic_available"] = sem.get("available_mode", "unavailable")
        status["semantic_index_exists"] = sem.get("index_exists", False)
    except ImportError:
        status["semantic_available"] = "unavailable"
        status["semantic_index_exists"] = False

    return status
