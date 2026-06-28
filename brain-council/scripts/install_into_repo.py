"""
Brain Council copy-only installer.

Copies this package into <target>/brain-council by default.

This script does NOT:
- git add
- commit
- push
- merge
- tag
- release
- activate MCP
- enable agents
- write production data
"""

import argparse
import json
import shutil
import datetime
from pathlib import Path

SOURCE = Path(__file__).resolve().parents[1]

EXCLUDE_DIRS = {
    "out",
    "__pycache__",
    ".git",
    ".pytest_cache",
    ".mypy_cache",
    ".ruff_cache",
}

EXCLUDE_SUFFIXES = {".zip", ".pyc", ".pyo"}

def should_copy(path: Path) -> bool:
    rel_parts = path.relative_to(SOURCE).parts
    if any(part in EXCLUDE_DIRS for part in rel_parts):
        return False
    if path.suffix in EXCLUDE_SUFFIXES:
        return False
    return path.is_file()

def main():
    parser = argparse.ArgumentParser(description="Install Brain Council package into a target repo as a copy-only local package.")
    parser.add_argument("--target", required=True, help="Target repo path")
    parser.add_argument("--subdir", default="brain-council", help="Destination subdir under target repo")
    parser.add_argument("--force", action="store_true", help="Overwrite existing destination directory")
    args = parser.parse_args()

    target = Path(args.target).resolve()
    dest = target / args.subdir

    if not target.exists():
        raise SystemExit(f"Target does not exist: {target}")

    if not target.is_dir():
        raise SystemExit(f"Target is not a directory: {target}")

    if dest.exists():
        if not args.force:
            raise SystemExit(f"Destination already exists: {dest}. Re-run with --force only if owner explicitly authorizes overwrite.")
        shutil.rmtree(dest)

    dest.mkdir(parents=True, exist_ok=True)

    copied = []
    for path in SOURCE.rglob("*"):
        if should_copy(path):
            rel = path.relative_to(SOURCE)
            out = dest / rel
            out.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(path, out)
            copied.append(str(rel).replace("\\", "/"))

    report = {
        "type": "brain_council_install_report",
        "timestamp": datetime.datetime.now(datetime.timezone.utc).isoformat(),
        "source": str(SOURCE),
        "target": str(target),
        "destination": str(dest),
        "files_copied": len(copied),
        "copied_files": copied,
        "non_authorizations_preserved": [
            "no_git_add",
            "no_commit",
            "no_push",
            "no_pr_readiness",
            "no_merge",
            "no_tag",
            "no_release",
            "no_mcp_activation",
            "no_autonomous_agents",
            "no_production_data_write"
        ]
    }

    report_path = dest / "out" / "INSTALL_REPORT.json"
    report_path.parent.mkdir(parents=True, exist_ok=True)
    report_path.write_text(json.dumps(report, indent=2), encoding="utf-8")

    print(json.dumps(report, indent=2))
    print("INSTALL COMPLETE: copy-only. No git actions performed.")

if __name__ == "__main__":
    main()
