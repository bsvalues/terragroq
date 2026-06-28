"""
Brain Council post-install verifier.

Checks installed package shape and writes a local verification report.

This script does NOT:
- edit files
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
import datetime
import hashlib
from pathlib import Path

REQUIRED_FILES = [
    "README.md",
    "VERSION.json",
    "V1_SCOPE_CONTRACT.md",
    "GATE_SCOREBOARD.json",
    "closure/STOP_HERE_DISPOSITION.md",
    "closure/OPERATIONAL_CLOSURE_LEDGER.json",
    "release_notes/RELEASE_NOTES_v1_5.md",
    "owner_gates/NEXT_OBJECTIVE_GATE.md",
    "release/V1_5_1_RELEASE_MANIFEST.json",
    "scripts/install_into_repo.py",
    "scripts/verify_install.py",
    "cli/brain.py",
    "ui/index.html",
]

BLOCKED_MARKERS = [
    "MCP activation",
    "autonomous",
    "production/data write",
    "git add",
    "commit",
    "push",
    "PR readiness",
    "merge",
    "tag",
    "release",
]

def sha256(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as f:
        for chunk in iter(lambda: f.read(1024 * 1024), b""):
            h.update(chunk)
    return h.hexdigest()

def main():
    parser = argparse.ArgumentParser(description="Verify Brain Council installed package shape.")
    parser.add_argument("--root", default="brain-council", help="Installed package root")
    args = parser.parse_args()

    root = Path(args.root).resolve()

    checks = []
    for rel in REQUIRED_FILES:
        path = root / rel
        checks.append({
            "path": rel,
            "exists": path.exists(),
            "size_bytes": path.stat().st_size if path.exists() else 0,
            "sha256": sha256(path) if path.exists() and path.is_file() else None,
        })

    version = None
    version_file = root / "VERSION.json"
    if version_file.exists():
        try:
            version = json.loads(version_file.read_text(encoding="utf-8")).get("version")
        except Exception as exc:
            version = f"ERROR: {exc}"

    missing = [c for c in checks if not c["exists"] or c["size_bytes"] <= 0]
    status = "PASS" if not missing and version == "1.5.1" else "FAIL"

    report = {
        "type": "install_verification_report",
        "timestamp": datetime.datetime.now(datetime.timezone.utc).isoformat(),
        "root": str(root),
        "status": status,
        "version": version,
        "expected_version": "1.5.1",
        "checks": checks,
        "missing_or_empty": missing,
        "non_authorizations_preserved": [
            "MCP",
            "autonomy",
            "production_write",
            "git_add",
            "commit",
            "push",
            "PR_ready",
            "merge",
            "tag",
            "release"
        ],
        "safe_to_commit": "NO unless owner separately approves after review",
        "safe_to_push": "NO",
        "safe_to_pr_ready": "NO",
        "safe_to_merge": "NO",
        "safe_to_release": "NO",
        "safe_to_enable_mcp": "NO",
        "safe_to_enable_autonomy": "NO",
        "safe_for_production_data_write": "NO"
    }

    out_dir = root / "out"
    out_dir.mkdir(parents=True, exist_ok=True)
    report_path = out_dir / "INSTALL_VERIFICATION_REPORT.json"
    report_path.write_text(json.dumps(report, indent=2), encoding="utf-8")

    print(json.dumps(report, indent=2))
    if status != "PASS":
        raise SystemExit(1)

if __name__ == "__main__":
    main()
