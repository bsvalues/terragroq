"""WilliamOS Official Acceptance Assistant.

Validates, plans, and executes one-item-at-a-time draft acceptance
into official folders. Copy-by-default — original draft stays in place.
Never moves without --confirm. Never batch-accepts.
"""

import os
import re
import shutil
from datetime import datetime
from pathlib import Path

try:
    import frontmatter
except ImportError:
    frontmatter = None

VAULT = Path(os.environ.get("WILLIAMOS_VAULT", "WilliamOS"))
TZ_NAME = os.environ.get("WILLIAMOS_TZ", "America/Los_Angeles")

ACCEPTANCE_DIR = VAULT / "98_OfficialAcceptance"
PLANS_DIR = ACCEPTANCE_DIR / "plans"
LOGS_DIR = ACCEPTANCE_DIR / "logs"
LOG_PATH = LOGS_DIR / "ACCEPTANCE_LOG.md"

GOVERNANCE_DOCS = [
    "README.md",
    "ACCEPTANCE_POLICY.md",
    "VALIDATION_RULES.md",
    "MANUAL_ACCEPTANCE_WORKFLOW.md",
    "ACCEPTANCE_LOG_POLICY.md",
]

SOURCE_DEST_MAP = {
    "80_DoctrinePromotion/drafts": "03_Doctrine",
    "85_DecisionPromotion/drafts": "02_Decisions",
    "86_ConceptPromotion/drafts": "10_Ideas",
    "87_ProjectPromotion/project_drafts": "11_Projects",
    "87_ProjectPromotion/work_order_drafts": "11_Projects",
}

ALLOWED_DESTINATIONS = {
    "03_Doctrine",
    "02_Decisions",
    "10_Ideas",
    "11_Projects",
}

REQUIRED_SECTIONS = {
    "doctrine": ["## Rule", "## Meaning", "## Source Evidence"],
    "decision": ["## Decision", "## Context", "## Rationale", "## Source Evidence"],
    "concept": ["## Definition", "## Why It Matters", "## Source Evidence"],
    "project": ["## Purpose", "## Scope", "## Source Evidence"],
    "work_order": ["## Mission", "## Required Outcome", "## Verification"],
}


def _now():
    try:
        from zoneinfo import ZoneInfo
        return datetime.now(ZoneInfo(TZ_NAME))
    except Exception:
        return datetime.now()


def _ensure_dirs():
    for d in [PLANS_DIR, LOGS_DIR]:
        d.mkdir(parents=True, exist_ok=True)


def _infer_lane_type(source_folder: str) -> str:
    if "DoctrinePromotion" in source_folder:
        return "doctrine"
    if "DecisionPromotion" in source_folder:
        return "decision"
    if "ConceptPromotion" in source_folder:
        if "work_order" in source_folder:
            return "work_order"
        return "concept"
    if "ProjectPromotion" in source_folder:
        if "work_order" in source_folder:
            return "work_order"
        return "project"
    return "unknown"


def _normalize_filename(name: str) -> str:
    stem = Path(name).stem
    stem = re.sub(r"^(DRAFT-|PROJ-DRAFT-|WO-DRAFT-|CONCEPT-DRAFT-|Doctrine - )", "", stem)
    stem = stem.replace("-", " ").replace("_", " ")
    stem = re.sub(r"\s+", " ", stem).strip()
    return stem


def make_safe_official_filename(draft_path: Path, dest_folder: str) -> str:
    stem = draft_path.stem
    stem = re.sub(r"^(DRAFT-|PROJ-DRAFT-|WO-DRAFT-|CONCEPT-DRAFT-)", "", stem)
    stem = stem.strip(" -")
    if not stem:
        stem = draft_path.stem
    return stem + ".md"


def validate_draft_path(draft_path_str: str) -> dict:
    result = {
        "valid": False,
        "path": None,
        "errors": [],
        "source_folder": None,
        "lane_type": None,
    }

    draft_path = Path(draft_path_str)
    if not draft_path.is_absolute():
        draft_path = VAULT / draft_path_str
    if not draft_path.exists():
        candidates = list(VAULT.rglob(f"*{Path(draft_path_str).name}"))
        if len(candidates) == 1:
            draft_path = candidates[0]
        else:
            result["errors"].append(f"Draft not found: {draft_path_str}")
            return result

    result["path"] = draft_path

    try:
        rel = draft_path.relative_to(VAULT)
    except ValueError:
        result["errors"].append(f"Draft is not inside vault: {draft_path}")
        return result

    rel_parent = str(rel.parent).replace("\\", "/")
    matched_source = None
    for src in SOURCE_DEST_MAP:
        if rel_parent == src or rel_parent.startswith(src + "/"):
            matched_source = src
            break

    if not matched_source:
        result["errors"].append(
            f"Draft is not in an allowed source folder. "
            f"Got: {rel_parent}. "
            f"Allowed: {', '.join(SOURCE_DEST_MAP.keys())}"
        )
        return result

    result["source_folder"] = matched_source
    result["lane_type"] = _infer_lane_type(matched_source)
    result["valid"] = True
    return result


def infer_destination(source_folder: str) -> str:
    return SOURCE_DEST_MAP.get(source_folder)


def validate_destination(dest_str: str) -> dict:
    result = {"valid": False, "path": None, "errors": []}

    dest = dest_str.replace("\\", "/")
    dest = dest.rstrip("/")
    if dest.startswith("WilliamOS/"):
        dest = dest[len("WilliamOS/"):]

    if dest not in ALLOWED_DESTINATIONS:
        result["errors"].append(
            f"Destination not allowed: {dest}. "
            f"Allowed: {', '.join(sorted(ALLOWED_DESTINATIONS))}"
        )
        return result

    dest_path = VAULT / dest
    if not dest_path.exists():
        result["errors"].append(f"Destination folder does not exist: {dest_path}")
        return result

    result["valid"] = True
    result["path"] = dest_path
    return result


def parse_frontmatter_data(draft_path: Path) -> dict:
    result = {"has_frontmatter": False, "metadata": {}, "content": ""}
    try:
        text = draft_path.read_text(encoding="utf-8", errors="ignore")
    except OSError:
        return result

    result["content"] = text
    if frontmatter and text.startswith("---"):
        try:
            post = frontmatter.loads(text)
            result["has_frontmatter"] = True
            result["metadata"] = dict(post.metadata)
        except Exception:
            pass
    elif text.startswith("---"):
        result["has_frontmatter"] = True

    return result


def check_required_sections(content: str, lane_type: str) -> dict:
    required = REQUIRED_SECTIONS.get(lane_type, [])
    found = []
    missing = []
    for section in required:
        if section in content:
            found.append(section)
        else:
            missing.append(section)
    return {
        "lane_type": lane_type,
        "required": required,
        "found": found,
        "missing": missing,
        "passes": len(missing) == 0,
    }


def detect_duplicate_official(dest_path: Path, proposed_filename: str) -> dict:
    result = {
        "exact_match": False,
        "similar": [],
        "proposed_path": dest_path / proposed_filename,
    }

    if (dest_path / proposed_filename).exists():
        result["exact_match"] = True
        return result

    proposed_norm = _normalize_filename(proposed_filename).lower()
    proposed_tokens = set(proposed_norm.split())

    for existing in dest_path.glob("*.md"):
        existing_norm = _normalize_filename(existing.name).lower()
        existing_tokens = set(existing_norm.split())
        if not proposed_tokens or not existing_tokens:
            continue
        overlap = proposed_tokens & existing_tokens
        union = proposed_tokens | existing_tokens
        if len(union) > 0 and len(overlap) / len(union) >= 0.6:
            result["similar"].append(existing.name)

    return result


def scan_pending_drafts() -> list:
    pending = []
    for src_folder, dest_folder in SOURCE_DEST_MAP.items():
        folder = VAULT / src_folder
        if not folder.exists():
            continue
        for p in sorted(folder.glob("*.md")):
            if p.name.startswith("."):
                continue
            pending.append({
                "path": str(p),
                "filename": p.name,
                "source_folder": src_folder,
                "lane_type": _infer_lane_type(src_folder),
                "default_dest": dest_folder,
            })
    return pending


def acceptance_status() -> dict:
    docs_exist = all((ACCEPTANCE_DIR / d).exists() for d in GOVERNANCE_DOCS)
    pending = scan_pending_drafts()
    lane_counts = {}
    for item in pending:
        lt = item["lane_type"]
        lane_counts[lt] = lane_counts.get(lt, 0) + 1

    log_exists = LOG_PATH.exists()
    latest_entry = None
    if log_exists:
        try:
            text = LOG_PATH.read_text(encoding="utf-8", errors="ignore")
            entries = re.findall(r"^## (\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2})", text, re.MULTILINE)
            if entries:
                latest_entry = entries[-1]
        except OSError:
            pass

    official_counts = {}
    for dest in sorted(ALLOWED_DESTINATIONS):
        dp = VAULT / dest
        if dp.exists():
            official_counts[dest] = len(list(dp.glob("*.md")))
        else:
            official_counts[dest] = 0

    import subprocess
    try:
        r = subprocess.run(
            ["git", "status", "--porcelain"],
            capture_output=True, text=True, timeout=10
        )
        git_clean = len(r.stdout.strip()) == 0
    except Exception:
        git_clean = None

    return {
        "acceptance_dir_exists": ACCEPTANCE_DIR.exists(),
        "docs_exist": docs_exist,
        "pending_total": len(pending),
        "lane_counts": lane_counts,
        "log_exists": log_exists,
        "latest_entry": latest_entry,
        "official_counts": official_counts,
        "git_clean": git_clean,
    }


def generate_acceptance_plan(draft_path_str: str, dest_str: str = None) -> dict:
    now = _now()
    date_str = now.strftime("%Y-%m-%d")

    dv = validate_draft_path(draft_path_str)
    if not dv["valid"]:
        return {"valid": False, "errors": dv["errors"]}

    draft_path = dv["path"]
    source_folder = dv["source_folder"]
    lane_type = dv["lane_type"]

    if dest_str:
        dest_v = validate_destination(dest_str)
        if not dest_v["valid"]:
            return {"valid": False, "errors": dest_v["errors"]}
        dest_path = dest_v["path"]
        dest_folder = str(dest_path.relative_to(VAULT))
    else:
        inferred = infer_destination(source_folder)
        if not inferred:
            return {"valid": False, "errors": [f"Cannot infer destination for source: {source_folder}"]}
        dest_folder = inferred
        dest_path = VAULT / dest_folder

    proposed_filename = make_safe_official_filename(draft_path, dest_folder)
    dup_check = detect_duplicate_official(dest_path, proposed_filename)

    fm_data = parse_frontmatter_data(draft_path)
    section_check = check_required_sections(fm_data["content"], lane_type)

    errors = []
    warnings = []

    if dup_check["exact_match"]:
        errors.append(f"BLOCKED: Official note already exists: {dest_path / proposed_filename}")

    if not section_check["passes"]:
        errors.append(f"BLOCKED: Missing required sections: {', '.join(section_check['missing'])}")

    if not fm_data["has_frontmatter"]:
        warnings.append("Draft has no YAML frontmatter")

    if dup_check["similar"]:
        warnings.append(f"Similar official notes found: {', '.join(dup_check['similar'])}")

    plan = {
        "valid": len(errors) == 0,
        "date": date_str,
        "draft_path": str(draft_path),
        "draft_filename": draft_path.name,
        "source_folder": source_folder,
        "lane_type": lane_type,
        "dest_folder": dest_folder,
        "dest_path": str(dest_path),
        "proposed_filename": proposed_filename,
        "proposed_official_path": str(dest_path / proposed_filename),
        "duplicate_exact": dup_check["exact_match"],
        "duplicate_similar": dup_check["similar"],
        "has_frontmatter": fm_data["has_frontmatter"],
        "section_check": section_check,
        "errors": errors,
        "warnings": warnings,
        "command": f'python scripts/william.py accept-draft --draft "{draft_path_str}" --dest "WilliamOS/{dest_folder}/" --confirm',
    }

    _ensure_dirs()
    lines = []
    lines.append("---")
    lines.append("type: acceptance-plan")
    lines.append("status: draft")
    lines.append(f"generated: \"{now.strftime('%Y-%m-%d %H:%M')}\"")
    lines.append("tags:")
    lines.append("  - acceptance")
    lines.append("  - review")
    lines.append("  - generated")
    lines.append("---")
    lines.append("")
    lines.append(f"# Acceptance Plan - {date_str}")
    lines.append("")
    lines.append(f"## Draft")
    lines.append(f"")
    lines.append(f"- Path: `{draft_path}`")
    lines.append(f"- Filename: `{draft_path.name}`")
    lines.append(f"- Lane: {lane_type}")
    lines.append(f"- Source folder: `{source_folder}`")
    lines.append("")
    lines.append(f"## Inferred Destination")
    lines.append("")
    lines.append(f"- Folder: `WilliamOS/{infer_destination(source_folder) or '?'}/`")
    lines.append("")
    if dest_str:
        lines.append(f"## Requested Destination")
        lines.append("")
        lines.append(f"- Folder: `{dest_str}`")
        lines.append("")
    lines.append(f"## Proposed Official Path")
    lines.append("")
    lines.append(f"- `{dest_path / proposed_filename}`")
    lines.append("")
    lines.append(f"## Validation Results")
    lines.append("")
    if errors:
        for e in errors:
            lines.append(f"- **ERROR**: {e}")
    else:
        lines.append("- All validations passed")
    if warnings:
        for w in warnings:
            lines.append(f"- **WARNING**: {w}")
    lines.append("")
    lines.append(f"## Duplicate Check")
    lines.append("")
    if dup_check["exact_match"]:
        lines.append(f"- **BLOCKED**: Exact filename already exists in `{dest_folder}/`")
    elif dup_check["similar"]:
        lines.append(f"- Similar notes found: {', '.join(dup_check['similar'])}")
    else:
        lines.append("- No duplicates found")
    lines.append("")
    lines.append(f"## Required Sections Check")
    lines.append("")
    lines.append(f"- Lane type: {lane_type}")
    lines.append(f"- Required: {', '.join(section_check['required']) or '(none)'}")
    lines.append(f"- Found: {', '.join(section_check['found']) or '(none)'}")
    if section_check["missing"]:
        lines.append(f"- **MISSING**: {', '.join(section_check['missing'])}")
    else:
        lines.append("- All required sections present")
    lines.append("")
    lines.append(f"## Exact Action")
    lines.append("")
    if plan["valid"]:
        lines.append(f"Copy `{draft_path.name}` from `{source_folder}/` to `{dest_folder}/` as `{proposed_filename}`")
        lines.append("")
        lines.append("Original draft remains in source folder.")
    else:
        lines.append("**BLOCKED** — see validation errors above.")
    lines.append("")
    lines.append(f"## Command to Accept")
    lines.append("")
    if plan["valid"]:
        lines.append(f"```bash")
        lines.append(plan["command"])
        lines.append(f"```")
    else:
        lines.append("Fix validation errors before acceptance.")
    lines.append("")
    lines.append(f"## Snapshot Recommendation")
    lines.append("")
    lines.append(f"After acceptance, run:")
    lines.append(f"```bash")
    lines.append(f"python scripts/william.py snapshot --message \"Accepted {lane_type} draft\"")
    lines.append(f"```")
    lines.append("")
    lines.append(f"## Generator Notes")
    lines.append("")
    lines.append("This plan was generated by WilliamOS. Nothing has been moved.")
    lines.append("")

    plan_path = PLANS_DIR / f"Acceptance Plan - {date_str}.md"
    plan_path.write_text("\n".join(lines), encoding="utf-8")
    plan["plan_path"] = str(plan_path)

    return plan


def accept_draft(draft_path_str: str, dest_str: str, confirm: bool = False) -> dict:
    if not confirm:
        return {"accepted": False, "error": "Acceptance requires --confirm flag. This is a safety measure."}

    plan = generate_acceptance_plan(draft_path_str, dest_str)
    if not plan.get("valid"):
        return {"accepted": False, "errors": plan.get("errors", ["Validation failed"])}

    draft_path = Path(plan["draft_path"])
    dest_path = Path(plan["proposed_official_path"])

    if dest_path.exists():
        return {"accepted": False, "error": f"BLOCKED: Official note already exists: {dest_path}"}

    dest_path.parent.mkdir(parents=True, exist_ok=True)
    shutil.copy2(str(draft_path), str(dest_path))

    now = _now()
    _write_log_entry(
        timestamp=now.strftime("%Y-%m-%d %H:%M:%S"),
        draft_path=str(draft_path),
        official_path=str(dest_path),
        lane=plan["lane_type"],
        source_folder=plan["source_folder"],
        dest_folder=plan["dest_folder"],
    )

    return {
        "accepted": True,
        "draft_path": str(draft_path),
        "official_path": str(dest_path),
        "lane": plan["lane_type"],
        "source_folder": plan["source_folder"],
        "dest_folder": plan["dest_folder"],
        "snapshot_recommendation": f'python scripts/william.py snapshot --message "Accepted {plan["lane_type"]} draft: {dest_path.name}"',
    }


def _write_log_entry(timestamp, draft_path, official_path, lane, source_folder, dest_folder):
    _ensure_dirs()
    entry = []
    entry.append(f"\n## {timestamp}\n")
    entry.append(f"- Accepted draft: `{draft_path}`")
    entry.append(f"- Official path: `{official_path}`")
    entry.append(f"- Lane: {lane}")
    entry.append(f"- Source folder: `{source_folder}`")
    entry.append(f"- Destination folder: `{dest_folder}`")
    entry.append(f"- Duplicate check: passed")
    entry.append(f"- Snapshot recommendation: run snapshot after review")
    entry.append("")

    if not LOG_PATH.exists():
        header = "# WilliamOS Acceptance Log\n"
        LOG_PATH.write_text(header + "\n".join(entry), encoding="utf-8")
    else:
        with open(LOG_PATH, "a", encoding="utf-8") as f:
            f.write("\n".join(entry))


def read_acceptance_log(limit: int = 10) -> dict:
    if not LOG_PATH.exists():
        return {"exists": False, "path": str(LOG_PATH), "entries": []}

    text = LOG_PATH.read_text(encoding="utf-8", errors="ignore")
    entries = []
    current = None
    for line in text.split("\n"):
        if line.startswith("## "):
            if current:
                entries.append(current)
            current = {"timestamp": line[3:].strip(), "details": []}
        elif current and line.startswith("- "):
            current["details"].append(line[2:].strip())

    if current:
        entries.append(current)

    return {
        "exists": True,
        "path": str(LOG_PATH),
        "total_entries": len(entries),
        "entries": entries[-limit:],
    }
