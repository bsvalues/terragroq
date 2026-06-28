"""WilliamOS backup governance engine.

Creates safe compressed backup archives excluding secrets, cache,
and machine-local state. Includes Git history. Verifies archives.

Local-first. Never pushes. Never syncs. Never modifies source notes.
"""
from __future__ import annotations

import datetime as dt
import hashlib
import os
import subprocess
import zipfile
from fnmatch import fnmatch
from pathlib import Path
from typing import Any
from zoneinfo import ZoneInfo

VAULT = Path(os.environ.get("WILLIAMOS_VAULT", "WilliamOS"))
BACKUP_DIR = VAULT / "92_BackupGovernance"
MANIFEST_PATH = BACKUP_DIR / "BACKUP_MANIFEST.md"

BACKUP_REQUIRED_DOCS = [
    "92_BackupGovernance/README.md",
    "92_BackupGovernance/BACKUP_POLICY.md",
    "92_BackupGovernance/SYNC_OPTIONS.md",
    "92_BackupGovernance/RESTORE_TEST_POLICY.md",
    "92_BackupGovernance/PRIVATE_REMOTE_GUIDE.md",
]

EXCLUDE_PATTERNS = [
    ".env", "*.env", ".env.*",
    "*.pem", "*.key", "*.p12", "*.pfx",
    "id_rsa", "id_ed25519",
    "secrets.*", "token.*", "credentials.*",
    ".DS_Store", "Thumbs.db",
    "*.pyc",
]

EXCLUDE_DIRS = [
    ".venv", "venv", "node_modules", "__pycache__", ".trash",
    ".obsidian/cache",
]

EXCLUDE_PREFIXES = [
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
    "WilliamOS/92_BackupGovernance/generated/cache/",
    "WilliamOS/92_BackupGovernance/local_archives/",
]

WORKSPACE_PATTERNS = [
    ".obsidian/workspace", ".obsidian/workspace.json",
    ".obsidian/workspace-mobile.json",
]

REQUIRED_IN_ARCHIVE = [
    "scripts/william.py",
    ".gitignore",
    "requirements.txt",
    "PACKAGE_MANIFEST.md",
]


def _local_now() -> dt.datetime:
    tz_name = os.environ.get("WILLIAMOS_TZ", "America/Los_Angeles")
    return dt.datetime.now(ZoneInfo(tz_name))


def _local_today() -> dt.date:
    return _local_now().date()


def is_excluded_path(rel: str) -> bool:
    norm = rel.replace("\\", "/")
    name = Path(norm).name

    for pat in EXCLUDE_PATTERNS:
        if fnmatch(name, pat):
            return True

    for d in EXCLUDE_DIRS:
        segment = d + "/"
        if norm.startswith(segment) or ("/" + segment) in norm or norm == d:
            return True

    for prefix in EXCLUDE_PREFIXES:
        if norm.startswith(prefix):
            return True

    for wp in WORKSPACE_PATTERNS:
        if norm == wp or norm.startswith(wp):
            return True

    return False


def _is_forbidden(rel: str) -> bool:
    norm = rel.replace("\\", "/")
    name = Path(norm).name
    forbidden_file_patterns = [
        ".env", "*.env", ".env.*",
        "*.pem", "*.key", "*.p12", "*.pfx",
        "id_rsa", "id_ed25519",
        "secrets.*", "token.*", "credentials.*",
    ]
    for pat in forbidden_file_patterns:
        if fnmatch(name, pat):
            return True
    return False


def scan_backup_sources() -> dict[str, list[str]]:
    included = []
    excluded = []
    forbidden = []

    root = Path(".")
    for p in sorted(root.rglob("*")):
        if not p.is_file():
            continue
        rel = str(p).replace("\\", "/")
        if rel.startswith("./"):
            rel = rel[2:]

        if _is_forbidden(rel):
            forbidden.append(rel)
            excluded.append(rel)
        elif is_excluded_path(rel):
            excluded.append(rel)
        else:
            included.append(rel)

    return {
        "included": included,
        "excluded": excluded,
        "forbidden": forbidden,
    }


def estimate_backup_size(included: list[str]) -> int:
    total = 0
    for f in included:
        p = Path(f)
        if p.exists():
            total += p.stat().st_size
    return total


def _is_git_repo() -> bool:
    r = subprocess.run(
        ["git", "rev-parse", "--is-inside-work-tree"],
        capture_output=True, text=True,
    )
    return r.returncode == 0 and r.stdout.strip() == "true"


def _current_branch() -> str:
    r = subprocess.run(
        ["git", "branch", "--show-current"],
        capture_output=True, text=True,
    )
    return r.stdout.strip() if r.returncode == 0 else ""


def _latest_commit() -> str:
    r = subprocess.run(
        ["git", "log", "--oneline", "-1"],
        capture_output=True, text=True,
    )
    return r.stdout.strip() if r.returncode == 0 else ""


def _is_clean() -> bool:
    r = subprocess.run(
        ["git", "status", "--porcelain"],
        capture_output=True, text=True,
    )
    return r.returncode == 0 and not r.stdout.strip()


def create_backup_archive(dest: str, create_dest: bool = False) -> dict[str, Any]:
    dest_path = Path(dest)
    if not dest_path.exists():
        if create_dest:
            dest_path.mkdir(parents=True, exist_ok=True)
        else:
            return {"error": "dest_not_found", "message": f"Destination does not exist: {dest}. Use --create-dest to create it."}

    if not dest_path.is_dir():
        return {"error": "dest_not_dir", "message": f"Destination is not a directory: {dest}"}

    scan = scan_backup_sources()
    included = scan["included"]
    forbidden = scan["forbidden"]

    if forbidden:
        return {
            "error": "forbidden_files",
            "message": "Forbidden files detected. Remove or exclude them before backup.",
            "forbidden": forbidden,
        }

    now = _local_now()
    ts = now.strftime("%Y%m%d-%H%M%S")
    archive_name = f"WilliamOS-backup-{ts}.zip"
    archive_path = dest_path / archive_name
    checksum_path = dest_path / f"{archive_name}.sha256"

    write_backup_manifest()

    included_set = set(included)
    manifest_rel = str(MANIFEST_PATH).replace("\\", "/")
    if manifest_rel not in included_set:
        included.append(manifest_rel)

    git_files_count = sum(1 for f in included if f.startswith(".git/"))

    with zipfile.ZipFile(archive_path, "w", zipfile.ZIP_DEFLATED) as zf:
        for f in included:
            p = Path(f)
            if p.exists():
                zf.write(p, f)

    sha256 = hashlib.sha256()
    with open(archive_path, "rb") as fh:
        for chunk in iter(lambda: fh.read(8192), b""):
            sha256.update(chunk)
    checksum = sha256.hexdigest()
    checksum_path.write_text(f"{checksum}  {archive_name}\n", encoding="utf-8")

    return {
        "archive_path": str(archive_path),
        "checksum_path": str(checksum_path),
        "checksum": checksum,
        "archive_name": archive_name,
        "files_included": len(included),
        "git_files_included": git_files_count,
        "files_excluded": len(scan["excluded"]),
        "archive_size": archive_path.stat().st_size,
    }


def generate_backup_manifest() -> str:
    today = _local_today().isoformat()
    repo = _is_git_repo()
    branch = _current_branch() if repo else "N/A"
    latest = _latest_commit() if repo else "N/A (no commits)"
    clean = _is_clean() if repo else False

    scan = scan_backup_sources()
    included = scan["included"]
    excluded = scan["excluded"]
    forbidden = scan["forbidden"]
    size = estimate_backup_size(included)

    local_archives_dir = BACKUP_DIR / "local_archives"
    latest_archive = ""
    if local_archives_dir.exists():
        zips = sorted(local_archives_dir.glob("*.zip"), reverse=True)
        if zips:
            latest_archive = zips[0].name

    lines = [
        "---",
        "type: backup-manifest",
        "status: active",
        f"generated: {today}",
        "tags:",
        "  - backup",
        "  - governance",
        "---",
        "",
        "# WilliamOS Backup Manifest",
        "",
        "## Generated",
        "",
        f"{today}",
        "",
        "## Repository Status",
        "",
        f"Git initialized: {'yes' if repo else 'no'}",
        f"Branch: {branch}",
        f"Clean working tree: {'yes' if clean else 'no'}",
        "",
        "## Latest Commit",
        "",
        f"{latest}",
        "",
        "## Backup Scope",
        "",
        f"- Files included: {len(included)}",
        f"- Files excluded: {len(excluded)}",
        f"- Forbidden files: {len(forbidden)}",
        f"- Estimated size: {size:,} bytes ({size / 1024 / 1024:.1f} MB)",
        "",
        "## Included Paths",
        "",
    ]

    top_dirs: dict[str, int] = {}
    for f in included:
        parts = f.split("/")
        top = parts[0] if parts else f
        top_dirs[top] = top_dirs.get(top, 0) + 1
    for d, count in sorted(top_dirs.items()):
        lines.append(f"- `{d}/` — {count} files")
    lines.append("")

    lines.append("## Excluded Paths")
    lines.append("")
    for prefix in EXCLUDE_PREFIXES:
        lines.append(f"- `{prefix}`")
    for d in EXCLUDE_DIRS:
        lines.append(f"- `{d}/`")
    lines.append("")

    lines.append("## Forbidden File Check")
    lines.append("")
    if not forbidden:
        lines.append("No forbidden files detected.")
    else:
        lines.append("**WARNING: Forbidden files detected:**")
        for f in forbidden:
            lines.append(f"- `{f}`")
    lines.append("")

    lines.append("## Latest Archive")
    lines.append("")
    lines.append(latest_archive or "No local archive found.")
    lines.append("")

    lines.append("## Checksum")
    lines.append("")
    lines.append("Generated with each archive as `<archive>.sha256`.")
    lines.append("")

    lines.append("## Restore Notes")
    lines.append("")
    lines.append("1. Extract the archive to a clean folder")
    lines.append("2. `cd` into the extracted folder")
    lines.append("3. `pip install -r requirements.txt`")
    lines.append("4. `python scripts/william.py check`")
    lines.append("5. `python scripts/william.py semantic-index` (optional)")
    lines.append("6. `python scripts/william.py cockpit --dry-run`")
    lines.append("")

    lines.append("## Generator Notes")
    lines.append("")
    lines.append("This manifest was generated by WilliamOS. It does not contain secrets by design.")
    lines.append("")

    return "\n".join(lines)


def write_backup_manifest() -> Path:
    BACKUP_DIR.mkdir(parents=True, exist_ok=True)
    text = generate_backup_manifest()
    MANIFEST_PATH.write_text(text, encoding="utf-8")
    return MANIFEST_PATH


def verify_backup_archive(archive_path: str) -> dict[str, Any]:
    ap = Path(archive_path)
    if not ap.exists():
        return {"error": "not_found", "message": f"Archive not found: {archive_path}"}

    if not ap.suffix == ".zip":
        return {"error": "not_zip", "message": f"Not a zip file: {archive_path}"}

    try:
        with zipfile.ZipFile(ap, "r") as zf:
            names = zf.namelist()
    except zipfile.BadZipFile:
        return {"error": "bad_zip", "message": f"Corrupt or unreadable zip: {archive_path}"}

    missing_required = []
    for req in REQUIRED_IN_ARCHIVE:
        if req not in names:
            missing_required.append(req)

    forbidden_found = []
    for name in names:
        if _is_forbidden(name):
            forbidden_found.append(name)

    has_git = any(n.startswith(".git/") for n in names)

    checksum_ok = None
    checksum_path = Path(f"{archive_path}.sha256")
    if checksum_path.exists():
        expected_line = checksum_path.read_text(encoding="utf-8").strip()
        expected_hash = expected_line.split()[0] if expected_line else ""
        sha256 = hashlib.sha256()
        with open(ap, "rb") as fh:
            for chunk in iter(lambda: fh.read(8192), b""):
                sha256.update(chunk)
        actual_hash = sha256.hexdigest()
        checksum_ok = actual_hash == expected_hash

    passed = (
        len(missing_required) == 0
        and len(forbidden_found) == 0
        and (checksum_ok is None or checksum_ok)
    )

    return {
        "passed": passed,
        "archive": str(ap),
        "file_count": len(names),
        "has_git_history": has_git,
        "missing_required": missing_required,
        "forbidden_found": forbidden_found,
        "checksum_verified": checksum_ok,
    }


def backup_status() -> dict[str, Any]:
    backup_exists = BACKUP_DIR.exists()
    docs_ok = all((VAULT / d).exists() for d in BACKUP_REQUIRED_DOCS)
    repo = _is_git_repo()
    branch = _current_branch() if repo else ""
    latest_commit = _latest_commit() if repo else ""
    clean = _is_clean() if repo else False

    manifest_exists = MANIFEST_PATH.exists()

    local_archives_dir = BACKUP_DIR / "local_archives"
    latest_archive = ""
    archive_count = 0
    if local_archives_dir.exists():
        zips = sorted(local_archives_dir.glob("*.zip"), reverse=True)
        archive_count = len(zips)
        if zips:
            latest_archive = zips[0].name

    return {
        "backup_dir_exists": backup_exists,
        "docs_exist": docs_ok,
        "git_repo": repo,
        "branch": branch,
        "latest_commit": latest_commit,
        "clean_tree": clean,
        "manifest_exists": manifest_exists,
        "latest_archive": latest_archive,
        "archive_count": archive_count,
    }
