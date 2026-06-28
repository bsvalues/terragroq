"""WilliamOS git snapshot governance engine.

Local-first version control. Produces pre-snapshot safety reports,
forbidden-file detection, snapshot manifests, and safe commits.

Never pushes. Never creates remotes. Never commits secrets.
"""
from __future__ import annotations

import datetime as dt
import fnmatch
import os
import re
import subprocess
import sys
from pathlib import Path
from typing import Any
from zoneinfo import ZoneInfo

VAULT = Path(os.environ.get("WILLIAMOS_VAULT", "WilliamOS"))
GIT_GOV_DIR = VAULT / "91_GitGovernance"
MANIFEST_PATH = GIT_GOV_DIR / "SNAPSHOT_MANIFEST.md"

FORBIDDEN_PATTERNS = [
    ".env",
    "*.env",
    ".env.*",
    "*.pem",
    "*.key",
    "*.p12",
    "*.pfx",
    "id_rsa",
    "id_ed25519",
    "secrets.*",
    "token.*",
    "credentials.*",
    ".obsidian/workspace*",
    ".obsidian/cache/*",
    ".venv/*",
    "venv/*",
    "node_modules/*",
    "WilliamOS/40_Search/generated/vectors.npy",
    "WilliamOS/40_Search/generated/tfidf.joblib",
]

SUSPICIOUS_NAME_PARTS = [
    "secret", "token", "credential", "password",
    "apikey", "api_key", "private_key",
]

GIT_GOV_REQUIRED_DOCS = [
    "91_GitGovernance/README.md",
    "91_GitGovernance/SNAPSHOT_POLICY.md",
    "91_GitGovernance/BACKUP_POLICY.md",
    "91_GitGovernance/RESTORE_WORKFLOW.md",
]

REQUIRED_GITIGNORE_ENTRIES = [
    ".env",
    "*.env",
    ".env.*",
    ".venv/",
    "venv/",
    "node_modules/",
    "__pycache__/",
    "*.pyc",
    ".DS_Store",
    "Thumbs.db",
    ".trash/",
    ".obsidian/workspace*",
    ".obsidian/cache",
    "WilliamOS/20_Graphify/generated/",
    "WilliamOS/40_Search/generated/",
    "WilliamOS/60_Synthesis/generated/cache/",
    "WilliamOS/70_InboxProcessor/generated/cache/",
    "WilliamOS/80_DoctrinePromotion/generated/cache/",
    "WilliamOS/85_DecisionPromotion/generated/cache/",
    "WilliamOS/86_ConceptPromotion/generated/cache/",
    "WilliamOS/87_ProjectPromotion/generated/cache/",
    "WilliamOS/88_CortexMap/generated/cache/",
    "WilliamOS/89_ReviewCockpit/generated/cache/",
    "WilliamOS/91_GitGovernance/generated/cache/",
]


def _local_today() -> dt.date:
    tz_name = os.environ.get("WILLIAMOS_TZ", "America/Los_Angeles")
    return dt.datetime.now(ZoneInfo(tz_name)).date()


def _run_git(*args: str, check: bool = False) -> subprocess.CompletedProcess:
    return subprocess.run(
        ["git"] + list(args),
        capture_output=True,
        text=True,
        check=check,
    )


def is_git_repo() -> bool:
    r = _run_git("rev-parse", "--is-inside-work-tree")
    return r.returncode == 0 and r.stdout.strip() == "true"


def git_init() -> dict[str, Any]:
    if is_git_repo():
        return {"initialized": False, "already_exists": True, "message": "Git repository already exists"}
    r = _run_git("init")
    if r.returncode != 0:
        return {"initialized": False, "already_exists": False, "error": r.stderr.strip()}
    return {"initialized": True, "already_exists": False, "message": "Git repository initialized"}


def _current_branch() -> str:
    if not is_git_repo():
        return ""
    r = _run_git("branch", "--show-current")
    return r.stdout.strip() if r.returncode == 0 else ""


def _has_commits() -> bool:
    if not is_git_repo():
        return False
    r = _run_git("log", "--oneline", "-1")
    return r.returncode == 0


def _latest_commit() -> str:
    if not _has_commits():
        return ""
    r = _run_git("log", "--oneline", "-1")
    return r.stdout.strip() if r.returncode == 0 else ""


def list_untracked() -> list[str]:
    if not is_git_repo():
        return []
    r = _run_git("ls-files", "--others", "--exclude-standard")
    if r.returncode != 0:
        return []
    return [l for l in r.stdout.strip().splitlines() if l]


def list_modified() -> list[str]:
    if not is_git_repo():
        return []
    r = _run_git("diff", "--name-only")
    if r.returncode != 0:
        return []
    return [l for l in r.stdout.strip().splitlines() if l]


def list_staged() -> list[str]:
    if not is_git_repo():
        return []
    r = _run_git("diff", "--cached", "--name-only")
    if r.returncode != 0:
        return []
    return [l for l in r.stdout.strip().splitlines() if l]


def _matches_forbidden(filepath: str) -> bool:
    name = Path(filepath).name
    normalized = filepath.replace("\\", "/")
    for pat in FORBIDDEN_PATTERNS:
        if fnmatch.fnmatch(name, pat):
            return True
        if fnmatch.fnmatch(normalized, pat):
            return True
        if fnmatch.fnmatch(normalized, "*/" + pat):
            return True
    return False


def _is_suspicious_name(filepath: str) -> bool:
    name_lower = Path(filepath).name.lower()
    stem_lower = Path(filepath).stem.lower()
    for part in SUSPICIOUS_NAME_PARTS:
        if part in name_lower or part in stem_lower:
            return True
    return False


def check_forbidden_files() -> dict[str, Any]:
    forbidden = []
    suspicious = []

    candidates: list[str] = []
    if is_git_repo():
        candidates = list_untracked() + list_modified() + list_staged()
    else:
        for p in Path(".").rglob("*"):
            if p.is_file():
                candidates.append(str(p).replace("\\", "/"))

    seen = set()
    for f in candidates:
        norm = f.replace("\\", "/")
        if norm in seen:
            continue
        seen.add(norm)
        if _matches_forbidden(norm):
            forbidden.append(norm)
        elif _is_suspicious_name(norm):
            suspicious.append(norm)

    return {
        "forbidden": sorted(forbidden),
        "suspicious": sorted(suspicious),
        "safe": len(forbidden) == 0,
    }


def check_gitignore_coverage() -> dict[str, Any]:
    gitignore_path = Path(".gitignore")
    if not gitignore_path.exists():
        return {"exists": False, "missing_entries": REQUIRED_GITIGNORE_ENTRIES, "coverage": 0.0}

    text = gitignore_path.read_text(encoding="utf-8")
    lines = {l.strip() for l in text.splitlines() if l.strip() and not l.strip().startswith("#")}

    missing = []
    for entry in REQUIRED_GITIGNORE_ENTRIES:
        if entry not in lines:
            missing.append(entry)

    total = len(REQUIRED_GITIGNORE_ENTRIES)
    covered = total - len(missing)

    return {
        "exists": True,
        "missing_entries": missing,
        "coverage": covered / total if total else 1.0,
    }


def git_status_summary() -> dict[str, Any]:
    repo_exists = is_git_repo()
    branch = _current_branch() if repo_exists else ""
    has_commits = _has_commits() if repo_exists else False
    latest = _latest_commit() if has_commits else ""
    untracked = list_untracked() if repo_exists else []
    modified = list_modified() if repo_exists else []
    staged = list_staged() if repo_exists else []
    forbidden_check = check_forbidden_files()
    gitignore_check = check_gitignore_coverage()

    return {
        "is_git_repo": repo_exists,
        "branch": branch,
        "has_commits": has_commits,
        "latest_commit": latest,
        "untracked_count": len(untracked),
        "modified_count": len(modified),
        "staged_count": len(staged),
        "forbidden_files": forbidden_check["forbidden"],
        "suspicious_files": forbidden_check["suspicious"],
        "forbidden_safe": forbidden_check["safe"],
        "gitignore_exists": gitignore_check["exists"],
        "gitignore_missing": gitignore_check["missing_entries"],
        "gitignore_coverage": gitignore_check["coverage"],
    }


def snapshot_dry_run() -> dict[str, Any]:
    if not is_git_repo():
        return {"error": "not_a_git_repo", "message": "Not a Git repository. Run git-init first."}

    forbidden_check = check_forbidden_files()
    gitignore_check = check_gitignore_coverage()
    untracked = list_untracked()
    modified = list_modified()
    staged = list_staged()

    would_add = sorted(set(untracked + modified))
    already_staged = staged

    forbidden_in_candidates = []
    suspicious_in_candidates = []
    clean_candidates = []

    for f in would_add + already_staged:
        norm = f.replace("\\", "/")
        if _matches_forbidden(norm):
            forbidden_in_candidates.append(norm)
        elif _is_suspicious_name(norm):
            suspicious_in_candidates.append(norm)
        else:
            clean_candidates.append(norm)

    safe = len(forbidden_in_candidates) == 0

    return {
        "safe": safe,
        "would_add_count": len(would_add),
        "already_staged_count": len(already_staged),
        "clean_count": len(clean_candidates),
        "forbidden_count": len(forbidden_in_candidates),
        "suspicious_count": len(suspicious_in_candidates),
        "would_add": would_add[:50],
        "already_staged": already_staged[:20],
        "forbidden_files": forbidden_in_candidates,
        "suspicious_files": suspicious_in_candidates,
        "clean_files": clean_candidates[:50],
        "gitignore_coverage": gitignore_check["coverage"],
        "gitignore_missing": gitignore_check["missing_entries"],
    }


def _count_md_in(directory: Path) -> int:
    if not directory.exists():
        return 0
    return len(list(directory.glob("*.md")))


def _count_json_in(directory: Path) -> int:
    if not directory.exists():
        return 0
    return len(list(directory.glob("*.json")))


def generate_snapshot_manifest() -> str:
    today = _local_today().isoformat()
    repo_exists = is_git_repo()
    branch = _current_branch() if repo_exists else "N/A"
    latest = _latest_commit() if repo_exists else "N/A (no commits)"
    forbidden_check = check_forbidden_files()
    gitignore_check = check_gitignore_coverage()

    lanes: list[tuple[str, str, int, int]] = [
        ("System Check", "check", 0, 0),
        ("MCP Guardrails", "30_MCP", _count_md_in(VAULT / "30_MCP"), 0),
        ("Semantic Search", "40_Search", _count_md_in(VAULT / "40_Search"), 0),
        ("Weekly Synthesis", "60_Synthesis", _count_md_in(VAULT / "60_Synthesis"), 0),
        ("Inbox Processor", "70_InboxProcessor", _count_md_in(VAULT / "70_InboxProcessor" / "reports"), _count_md_in(VAULT / "70_InboxProcessor" / "promoted_drafts")),
        ("Doctrine Promotion", "80_DoctrinePromotion", _count_md_in(VAULT / "80_DoctrinePromotion" / "reports"), _count_md_in(VAULT / "80_DoctrinePromotion" / "drafts")),
        ("Decision Promotion", "85_DecisionPromotion", _count_md_in(VAULT / "85_DecisionPromotion" / "reports"), _count_md_in(VAULT / "85_DecisionPromotion" / "drafts")),
        ("Concept Promotion", "86_ConceptPromotion", _count_md_in(VAULT / "86_ConceptPromotion" / "reports"), _count_md_in(VAULT / "86_ConceptPromotion" / "drafts")),
        ("Project Promotion", "87_ProjectPromotion", _count_md_in(VAULT / "87_ProjectPromotion" / "reports"), _count_md_in(VAULT / "87_ProjectPromotion" / "project_drafts") + _count_md_in(VAULT / "87_ProjectPromotion" / "work_order_drafts")),
        ("Cortex Map", "88_CortexMap", _count_md_in(VAULT / "88_CortexMap" / "reports") + _count_json_in(VAULT / "88_CortexMap" / "graphs"), 0),
        ("Review Cockpit", "89_ReviewCockpit", _count_md_in(VAULT / "89_ReviewCockpit" / "reports") + _count_json_in(VAULT / "89_ReviewCockpit" / "data"), 0),
        ("Git Governance", "91_GitGovernance", _count_md_in(GIT_GOV_DIR), 0),
    ]

    ignored_paths = REQUIRED_GITIGNORE_ENTRIES

    lines = [
        "---",
        "type: snapshot-manifest",
        "status: active",
        f"generated: {today}",
        "tags:",
        "  - git",
        "  - snapshot",
        "  - governance",
        "---",
        "",
        "# WilliamOS Snapshot Manifest",
        "",
        "## Generated",
        "",
        f"{today}",
        "",
        "## Repository Status",
        "",
        f"Git initialized: {'yes' if repo_exists else 'no'}",
        "",
        "## Current Branch",
        "",
        f"{branch}",
        "",
        "## Latest Commit",
        "",
        f"{latest}",
        "",
        "## WilliamOS Lanes",
        "",
        "| Lane | Folder | Artifacts | Drafts |",
        "|------|--------|-----------|--------|",
    ]
    for name, folder, artifacts, drafts in lanes:
        lines.append(f"| {name} | {folder} | {artifacts} | {drafts} |")

    lines.append("")
    lines.append("## Review Queues")
    lines.append("")

    inbox_count = _count_md_in(VAULT / "00_Inbox")
    doctrine_drafts = _count_md_in(VAULT / "80_DoctrinePromotion" / "drafts")
    decision_drafts = _count_md_in(VAULT / "85_DecisionPromotion" / "drafts")
    concept_drafts = _count_md_in(VAULT / "86_ConceptPromotion" / "drafts")
    project_drafts = _count_md_in(VAULT / "87_ProjectPromotion" / "project_drafts")
    wo_drafts = _count_md_in(VAULT / "87_ProjectPromotion" / "work_order_drafts")
    suggested_links = _count_md_in(VAULT / "88_CortexMap" / "suggested_links")

    lines.append(f"- Inbox items: {inbox_count}")
    lines.append(f"- Doctrine drafts: {doctrine_drafts}")
    lines.append(f"- Decision drafts: {decision_drafts}")
    lines.append(f"- Concept drafts: {concept_drafts}")
    lines.append(f"- Project drafts: {project_drafts}")
    lines.append(f"- Work order drafts: {wo_drafts}")
    lines.append(f"- Suggested links: {suggested_links}")
    lines.append("")

    lines.append("## Generated Artifacts")
    lines.append("")
    artifact_dirs = [
        ("Synthesis reports", VAULT / "60_Synthesis"),
        ("Inbox triage reports", VAULT / "70_InboxProcessor" / "reports"),
        ("Inbox promoted drafts", VAULT / "70_InboxProcessor" / "promoted_drafts"),
        ("Doctrine reports", VAULT / "80_DoctrinePromotion" / "reports"),
        ("Doctrine drafts", VAULT / "80_DoctrinePromotion" / "drafts"),
        ("Decision reports", VAULT / "85_DecisionPromotion" / "reports"),
        ("Decision drafts", VAULT / "85_DecisionPromotion" / "drafts"),
        ("Concept reports", VAULT / "86_ConceptPromotion" / "reports"),
        ("Concept drafts", VAULT / "86_ConceptPromotion" / "drafts"),
        ("Project reports", VAULT / "87_ProjectPromotion" / "reports"),
        ("Project drafts", VAULT / "87_ProjectPromotion" / "project_drafts"),
        ("WO drafts", VAULT / "87_ProjectPromotion" / "work_order_drafts"),
        ("Cortex reports", VAULT / "88_CortexMap" / "reports"),
        ("Cortex graphs", VAULT / "88_CortexMap" / "graphs"),
        ("Cortex maps", VAULT / "88_CortexMap" / "maps"),
        ("Cortex suggested links", VAULT / "88_CortexMap" / "suggested_links"),
        ("Cockpit reports", VAULT / "89_ReviewCockpit" / "reports"),
        ("Cockpit data", VAULT / "89_ReviewCockpit" / "data"),
        ("Cockpit HTML", VAULT / "89_ReviewCockpit" / "html"),
    ]
    for label, d in artifact_dirs:
        count = _count_md_in(d) + _count_json_in(d)
        if d.exists():
            html_count = len(list(d.glob("*.html")))
            count += html_count
        lines.append(f"- {label}: {count}")
    lines.append("")

    lines.append("## Ignored Paths")
    lines.append("")
    for p in ignored_paths:
        lines.append(f"- `{p}`")
    lines.append("")

    lines.append("## Forbidden File Check")
    lines.append("")
    if forbidden_check["safe"]:
        lines.append("No forbidden files detected.")
    else:
        lines.append("**WARNING: Forbidden files detected:**")
        for f in forbidden_check["forbidden"]:
            lines.append(f"- `{f}`")
    if forbidden_check["suspicious"]:
        lines.append("")
        lines.append("Suspicious filenames (review before committing):")
        for f in forbidden_check["suspicious"]:
            lines.append(f"- `{f}`")
    lines.append("")

    lines.append("## Recommended Snapshot Message")
    lines.append("")
    lines.append(f"WilliamOS snapshot {today}")
    lines.append("")

    lines.append("## Restore Notes")
    lines.append("")
    lines.append("To restore from a snapshot:")
    lines.append("")
    lines.append("1. `git log --oneline` to find the target commit")
    lines.append("2. `git checkout <hash> -- .` to restore files (preserves current branch)")
    lines.append("3. Or `git stash` current changes, then `git checkout <hash>`")
    lines.append("4. Run `python scripts/william.py check` to verify integrity")
    lines.append("")

    lines.append("## Generator Notes")
    lines.append("")
    lines.append("This manifest was generated by WilliamOS. It does not contain secrets by design.")
    lines.append("")

    return "\n".join(lines)


def write_snapshot_manifest() -> Path:
    GIT_GOV_DIR.mkdir(parents=True, exist_ok=True)
    text = generate_snapshot_manifest()
    MANIFEST_PATH.write_text(text, encoding="utf-8")
    return MANIFEST_PATH


def create_snapshot_commit(message: str) -> dict[str, Any]:
    if not is_git_repo():
        return {"error": "not_a_git_repo", "message": "Not a Git repository. Run git-init first."}

    forbidden_check = check_forbidden_files()
    if not forbidden_check["safe"]:
        return {
            "error": "forbidden_files",
            "message": "Forbidden files detected. Remove or ignore them before committing.",
            "forbidden": forbidden_check["forbidden"],
        }

    manifest_path = write_snapshot_manifest()

    r_add = _run_git("add", "-A")
    if r_add.returncode != 0:
        return {"error": "git_add_failed", "message": r_add.stderr.strip()}

    staged = list_staged()
    if not staged:
        return {"error": "nothing_to_commit", "message": "No changes to commit."}

    staged_forbidden = [f for f in staged if _matches_forbidden(f.replace("\\", "/"))]
    if staged_forbidden:
        _run_git("reset", "HEAD")
        return {
            "error": "forbidden_staged",
            "message": "Forbidden files were staged despite .gitignore. Unstaged all.",
            "forbidden": staged_forbidden,
        }

    r_commit = _run_git("commit", "-m", message)
    if r_commit.returncode != 0:
        return {"error": "commit_failed", "message": r_commit.stderr.strip()}

    commit_hash = ""
    r_hash = _run_git("rev-parse", "--short", "HEAD")
    if r_hash.returncode == 0:
        commit_hash = r_hash.stdout.strip()

    return {
        "committed": True,
        "message": message,
        "commit_hash": commit_hash,
        "files_committed": len(staged),
        "manifest_path": str(manifest_path),
    }
