"""WilliamOS Control Center — State Reader.

Reads vault state, generated JSON, and reports without running commands.
Pure reads — never modifies anything.
"""

import json
import os
import re
import subprocess
from datetime import datetime
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parent.parent.parent
VAULT = PROJECT_ROOT / os.environ.get("WILLIAMOS_VAULT", "WilliamOS")


def _git(*args):
    """Run a read-only git command in the project root; None on any failure."""
    try:
        r = subprocess.run(
            ["git", *args],
            capture_output=True, text=True, cwd=str(PROJECT_ROOT),
        )
        return r.stdout.strip() if r.returncode == 0 else None
    except Exception:
        return None


DRAFT_FOLDERS = {
    "doctrine": VAULT / "80_DoctrinePromotion" / "drafts",
    "decisions": VAULT / "85_DecisionPromotion" / "drafts",
    "concepts": VAULT / "86_ConceptPromotion" / "drafts",
    "projects": VAULT / "87_ProjectPromotion" / "project_drafts",
    "work_orders": VAULT / "87_ProjectPromotion" / "work_order_drafts",
}

TARGET_FOLDERS = {
    "doctrine": "WilliamOS/03_Doctrine/",
    "decision": "WilliamOS/02_Decisions/",
    "concept": "WilliamOS/10_Ideas/",
    "project": "WilliamOS/11_Projects/",
    "work_order": "WilliamOS/11_Projects/",
}

PROTECTED_FOLDERS = {"02_Decisions", "03_Doctrine", "10_Ideas", "11_Projects"}


def _today():
    try:
        from zoneinfo import ZoneInfo
        tz = ZoneInfo(os.environ.get("WILLIAMOS_TZ", "America/Los_Angeles"))
        return datetime.now(tz).strftime("%Y-%m-%d")
    except Exception:
        return datetime.now().strftime("%Y-%m-%d")


def _posix(p: Path) -> str:
    return str(p).replace("\\", "/")


def _display_path(p: Path) -> str:
    """Posix path, relative to the project root when it is inside it.

    WILLIAMOS_VAULT is a documented override, so the vault may legitimately live
    outside the repository. relative_to() raises in that case, which turned a
    supported configuration into a crash in the review queue summary.
    """
    try:
        return _posix(p.relative_to(PROJECT_ROOT))
    except ValueError:
        return _posix(p)



def _parse_frontmatter(text: str) -> tuple:
    if not text.startswith("---"):
        return {}, text
    end = text.find("\n---", 3)
    if end == -1:
        return {}, text
    yaml_block = text[4:end]
    body = text[end + 4:].lstrip("\n")
    fm: dict = {}
    current_key: str | None = None
    for line in yaml_block.split("\n"):
        stripped = line.strip()
        if not stripped:
            continue
        if stripped.startswith("- ") and current_key is not None and isinstance(fm.get(current_key), list):
            fm[current_key].append(stripped[2:].strip())
        elif ":" in stripped and not stripped.startswith("-"):
            key, _, val = stripped.partition(":")
            key = key.strip()
            val = val.strip()
            current_key = key
            fm[key] = val if val else []
    return fm, body


def _read_json(path: Path) -> dict | None:
    if path.exists():
        try:
            return json.loads(path.read_text(encoding="utf-8"))
        except Exception:
            return None
    return None


def get_today_note() -> dict:
    today = _today()
    path = VAULT / "01_Daily" / f"{today}.md"
    return {"date": today, "exists": path.exists(), "path": str(path.relative_to(PROJECT_ROOT))}


def get_inbox_count() -> int:
    inbox = VAULT / "00_Inbox"
    if not inbox.exists():
        return 0
    return sum(1 for f in inbox.glob("*.md") if f.name != "README.md")


def get_recent_inbox(limit: int = 5) -> list[dict]:
    inbox = VAULT / "00_Inbox"
    if not inbox.exists():
        return []
    notes = sorted(
        [f for f in inbox.glob("*.md") if f.name != "README.md"],
        key=lambda f: f.stat().st_mtime,
        reverse=True,
    )
    return [{"name": f.name, "path": str(f.relative_to(PROJECT_ROOT))} for f in notes[:limit]]


def get_latest_smoke() -> dict | None:
    data_dir = VAULT / "105_RuntimeSmoke" / "data"
    if not data_dir.exists():
        return None
    files = sorted(data_dir.glob("smoke-*.json"), reverse=True)
    return _read_json(files[0]) if files else None


def get_latest_production_readiness() -> dict | None:
    data_dir = VAULT / "106_ProductionReadiness" / "data"
    if not data_dir.exists():
        return None
    files = sorted(data_dir.glob("production-readiness-*.json"), reverse=True)
    return _read_json(files[0]) if files else None


def get_latest_cockpit() -> dict | None:
    data_dir = VAULT / "89_ReviewCockpit" / "data"
    if not data_dir.exists():
        return None
    files = sorted(data_dir.glob("cockpit-*.json"), reverse=True)
    return _read_json(files[0]) if files else None


def get_review_queue_summary() -> dict:
    """Summarise the promotion draft queues.

    A missing draft folder and an empty draft folder are different facts. The
    earlier shape reported ``count: 0`` for both, so a queue whose directory did
    not exist was indistinguishable from a queue that was genuinely clear — and
    the product reported "0 pending" as health. Each queue now carries explicit
    ``exists``/``status``, and the summary names the unavailable ones so the
    condition is visible instead of inferred.

    The remedy for a missing queue is the product's own scaffold:
    ``python scripts/william.py init`` creates every REQUIRED_DIRS entry.
    """
    queues = {}
    unavailable = []
    for name, folder in DRAFT_FOLDERS.items():
        path = _display_path(folder)
        if folder.exists():
            count = sum(1 for f in folder.glob("*.md"))
            queues[name] = {"count": count, "path": path, "exists": True, "status": "ok"}
        else:
            unavailable.append(name)
            queues[name] = {"count": 0, "path": path, "exists": False, "status": "MISSING"}
    queues["total"] = sum(q["count"] for q in queues.values() if isinstance(q, dict))
    queues["unavailable"] = unavailable
    queues["healthy"] = not unavailable
    return queues


def get_backup_info() -> dict:
    archive_dir = VAULT / "92_BackupGovernance" / "local_archives"
    if not archive_dir.exists():
        return {"count": 0, "latest": None}
    zips = sorted(archive_dir.glob("WilliamOS-backup-*.zip"), reverse=True)
    latest = zips[0].name if zips else None
    return {"count": len(zips), "latest": latest}


def get_git_info() -> dict:
    latest = _git("log", "--oneline", "-1")

    # The branch name is its own fact. It was previously absent from this dict,
    # so consumers fell back to the commit subject and the briefing displayed a
    # commit message in the branch field.
    branch = _git("rev-parse", "--abbrev-ref", "HEAD")
    if branch == "HEAD":  # detached HEAD carries no branch name
        branch = None

    has_remote = bool(_git("remote"))

    tag_out = _git("tag", "-l")
    tags = [t.strip() for t in tag_out.split("\n") if t.strip()] if tag_out else []

    return {"branch": branch, "latest_commit": latest, "has_remote": has_remote, "tags": tags}


def _version_key(tag: str):
    """Sort key for tags like v1.2.0 / v1.3.1, so 'latest' is not alphabetical."""
    nums = [int(n) for n in re.findall(r"\d+", tag)]
    return (len(nums), nums)


def get_version_info() -> dict:
    """Resolve the product version from a single source of truth.

    Three unrelated numbers were reported for one release: the FastAPI app
    version, the /api/status version, a hard-coded engine string, and the git
    tags. The tags are the real history, so they are the source; an explicit
    WILLIAMOS_VERSION override is honoured for packaged builds; when neither is
    available the version is ``unknown`` rather than a guessed literal.
    """
    override = os.environ.get("WILLIAMOS_VERSION")
    if override:
        return {"version": override, "version_source": "env", "latest_tag": override}

    tag_out = _git("tag", "-l")
    tags = [t.strip() for t in tag_out.split("\n") if t.strip()] if tag_out else []
    if not tags:
        return {"version": "unknown", "version_source": "unknown", "latest_tag": None}

    latest = max(tags, key=_version_key)
    return {"version": latest, "version_source": "git-tag", "latest_tag": latest}



def get_home_summary() -> dict:
    return {
        "today": get_today_note(),
        "inbox_count": get_inbox_count(),
        "recent_inbox": get_recent_inbox(5),
        "review_queues": get_review_queue_summary(),
        "backup": get_backup_info(),
        "git": get_git_info(),
    }


# ---------------------------------------------------------------------------
# Review Workbench — list, read, and plan acceptance for draft items
# ---------------------------------------------------------------------------

def validate_review_path(path_str: str) -> dict:
    normalized = path_str.replace("\\", "/")
    if ".." in normalized:
        return {"valid": False, "reason": "Path traversal not allowed."}
    if not normalized.startswith("WilliamOS/"):
        return {"valid": False, "reason": "Path must be inside WilliamOS/."}
    parts = normalized.split("/")
    if len(parts) >= 2 and parts[1] in PROTECTED_FOLDERS:
        return {"valid": False, "reason": f"Cannot access protected folder: {parts[1]}"}
    if not normalized.endswith(".md"):
        return {"valid": False, "reason": "Only markdown files can be reviewed."}
    full_path = (PROJECT_ROOT / normalized).resolve()
    in_draft = any(
        full_path == f.resolve() or full_path.parent == f.resolve()
        for f in DRAFT_FOLDERS.values()
    ) or any(
        True for f in DRAFT_FOLDERS.values()
        if f.resolve() in full_path.resolve().parents
    )
    if not in_draft:
        return {"valid": False, "reason": "File is not in a recognized draft folder."}
    if not full_path.exists():
        return {"valid": False, "reason": "File does not exist."}
    return {"valid": True}


def get_review_items() -> dict:
    items = []
    for queue_name, folder in DRAFT_FOLDERS.items():
        if not folder.exists():
            continue
        for f in sorted(folder.glob("*.md"), key=lambda p: p.stat().st_mtime, reverse=True):
            try:
                text = f.read_text(encoding="utf-8")
                fm, body = _parse_frontmatter(text)
                title = ""
                for line in body.split("\n"):
                    if line.startswith("# "):
                        title = line[2:].strip()
                        break
                items.append({
                    "path": _posix(f.relative_to(PROJECT_ROOT)),
                    "queue": queue_name,
                    "title": title or f.stem,
                    "type": fm.get("type", "unknown"),
                    "area": fm.get("area", ""),
                    "created": fm.get("created", ""),
                    "status": fm.get("status", "draft"),
                    "checklist_total": text.count("- [ ]") + text.count("- [x]"),
                    "checklist_done": text.count("- [x]"),
                })
            except Exception:
                items.append({
                    "path": _posix(f.relative_to(PROJECT_ROOT)),
                    "queue": queue_name,
                    "title": f.stem,
                    "type": "unknown",
                    "area": "",
                    "created": "",
                    "status": "draft",
                    "checklist_total": 0,
                    "checklist_done": 0,
                })
    return {"items": items, "total": len(items)}


def get_review_item(path_str: str) -> dict:
    validation = validate_review_path(path_str)
    if not validation["valid"]:
        return {"ok": False, "error": validation["reason"]}
    full_path = PROJECT_ROOT / path_str.replace("\\", "/")
    text = full_path.read_text(encoding="utf-8")
    fm, body = _parse_frontmatter(text)

    title = ""
    for line in body.split("\n"):
        if line.startswith("# "):
            title = line[2:].strip()
            break

    sections = []
    heading = None
    lines: list[str] = []
    for line in body.split("\n"):
        if line.startswith("## "):
            if heading:
                sections.append({"heading": heading, "content": "\n".join(lines).strip()})
            heading = line[3:].strip()
            lines = []
        elif heading is not None:
            lines.append(line)
    if heading:
        sections.append({"heading": heading, "content": "\n".join(lines).strip()})

    checklist = []
    for line in text.split("\n"):
        s = line.strip()
        if s.startswith("- [ ] "):
            checklist.append({"text": s[6:], "done": False})
        elif s.startswith("- [x] "):
            checklist.append({"text": s[6:], "done": True})

    queue = "unknown"
    for q_name, folder in DRAFT_FOLDERS.items():
        try:
            full_path.resolve().relative_to(folder.resolve())
            queue = q_name
            break
        except ValueError:
            continue

    return {
        "ok": True,
        "path": path_str.replace("\\", "/"),
        "queue": queue,
        "title": title or full_path.stem,
        "frontmatter": fm,
        "sections": sections,
        "checklist": checklist,
        "checklist_total": len(checklist),
        "checklist_done": sum(1 for c in checklist if c["done"]),
        "content": body,
    }


def generate_acceptance_plan(path_str: str) -> dict:
    item = get_review_item(path_str)
    if not item.get("ok"):
        return item
    fm = item["frontmatter"]
    draft_type = fm.get("type", "unknown")
    target = TARGET_FOLDERS.get(draft_type)

    incomplete = [c for c in item["checklist"] if not c["done"]]

    placeholder_sections = []
    for sec in item["sections"]:
        if any(marker in sec["content"] for marker in ("(Draft", "(None identified", "(Define ")):
            placeholder_sections.append(sec["heading"])

    steps = []
    if incomplete:
        steps.append(f"Complete {len(incomplete)} unchecked item{'s' if len(incomplete) != 1 else ''} in the Human Review Checklist")
    if placeholder_sections:
        steps.append(f"Fill in placeholder sections: {', '.join(placeholder_sections)}")
    if target:
        steps.append(f"When ready, move to: {target}")
        steps.append(f'CLI: william accept-draft --draft "{path_str}" --confirm')
    else:
        steps.append("Target folder unknown for this draft type. Review manually.")

    warnings = []
    for sec in item["sections"]:
        if "Similar" in sec["heading"] and sec["content"].strip():
            sim_lines = [l.strip() for l in sec["content"].split("\n") if l.strip().startswith("- ")]
            if sim_lines:
                warnings.append(f"Check for duplicates: {len(sim_lines)} similar item{'s' if len(sim_lines) != 1 else ''} found")

    return {
        "ok": True,
        "draft_title": item["title"],
        "draft_type": draft_type,
        "target_folder": target,
        "checklist": item["checklist"],
        "incomplete_count": len(incomplete),
        "placeholder_sections": placeholder_sections,
        "steps": steps,
        "warnings": warnings,
        "ready": len(incomplete) == 0 and len(placeholder_sections) == 0,
        "safety": "Read-only analysis. No files were modified.",
    }


def validate_acceptance_dest(dest_str: str) -> dict:
    normalized = dest_str.replace("\\", "/").rstrip("/")
    if ".." in normalized:
        return {"valid": False, "reason": "Path traversal not allowed."}
    if not normalized.startswith("WilliamOS/"):
        return {"valid": False, "reason": "Destination must be inside WilliamOS/."}
    allowed = set(TARGET_FOLDERS.values())
    match = normalized + "/"
    if match not in allowed and normalized + "/" not in allowed:
        stripped = normalized.rstrip("/") + "/"
        if stripped not in allowed:
            return {"valid": False, "reason": f"Not an allowed official folder: {normalized}"}
    dest_path = PROJECT_ROOT / normalized
    if not dest_path.exists():
        return {"valid": False, "reason": f"Destination folder does not exist: {normalized}"}
    return {"valid": True, "path": normalized}
