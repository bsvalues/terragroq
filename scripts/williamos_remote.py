"""WilliamOS private remote strategy engine.

Evaluates remote protection options, checks readiness, and generates
strategy manifests. Never creates remotes, pushes, or stores tokens.

Local-first. Advisory only. William chooses.
"""
from __future__ import annotations

import datetime as dt
import os
import subprocess
from pathlib import Path
from typing import Any
from zoneinfo import ZoneInfo

VAULT = Path(os.environ.get("WILLIAMOS_VAULT", "WilliamOS"))
REMOTE_DIR = VAULT / "94_PrivateRemoteStrategy"
MANIFEST_PATH = REMOTE_DIR / "REMOTE_STRATEGY_MANIFEST.md"

REMOTE_REQUIRED_DOCS = [
    "94_PrivateRemoteStrategy/README.md",
    "94_PrivateRemoteStrategy/REMOTE_STRATEGY_POLICY.md",
    "94_PrivateRemoteStrategy/OPTION_COMPARISON.md",
    "94_PrivateRemoteStrategy/PRIVATE_GITHUB_GUIDE.md",
    "94_PrivateRemoteStrategy/EXTERNAL_DRIVE_STRATEGY.md",
    "94_PrivateRemoteStrategy/ENCRYPTED_ARCHIVE_STRATEGY.md",
    "94_PrivateRemoteStrategy/SYNCTHING_STRATEGY.md",
    "94_PrivateRemoteStrategy/OBSIDIAN_SYNC_STRATEGY.md",
    "94_PrivateRemoteStrategy/REMOTE_READINESS_CHECKLIST.md",
]

PROVIDERS = {
    "github-private": "Private GitHub Repository",
    "external-drive": "External Encrypted Drive",
    "encrypted-archive": "Encrypted Off-Machine Archive",
    "syncthing": "Syncthing Peer-to-Peer Sync",
    "obsidian-sync": "Obsidian Sync (End-to-End Encrypted)",
}


def _local_now() -> dt.datetime:
    tz_name = os.environ.get("WILLIAMOS_TZ", "America/Los_Angeles")
    return dt.datetime.now(ZoneInfo(tz_name))


def _local_today() -> dt.date:
    return _local_now().date()


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


def list_git_remotes() -> list[dict[str, str]]:
    r = subprocess.run(
        ["git", "remote", "-v"],
        capture_output=True, text=True,
    )
    if r.returncode != 0 or not r.stdout.strip():
        return []
    remotes = []
    seen = set()
    for line in r.stdout.strip().splitlines():
        parts = line.split()
        if len(parts) >= 2:
            name = parts[0]
            url = parts[1]
            key = f"{name}:{url}"
            if key not in seen:
                seen.add(key)
                remotes.append({"name": name, "url": url})
    return remotes


def check_push_urls() -> list[str]:
    r = subprocess.run(
        ["git", "remote", "-v"],
        capture_output=True, text=True,
    )
    if r.returncode != 0 or not r.stdout.strip():
        return []
    push_urls = []
    for line in r.stdout.strip().splitlines():
        if "(push)" in line:
            parts = line.split()
            if len(parts) >= 2:
                push_urls.append(parts[1])
    return push_urls


def _load_manifest_status(path: Path) -> str:
    if not path.exists():
        return "not generated"
    return path.name


def remote_status() -> dict[str, Any]:
    docs_ok = all((VAULT / d).exists() for d in REMOTE_REQUIRED_DOCS)
    repo = _is_git_repo()
    branch = _current_branch() if repo else ""
    latest = _latest_commit() if repo else ""
    clean = _is_clean() if repo else False
    remotes = list_git_remotes() if repo else []
    push_urls = check_push_urls() if repo else []
    manifest_exists = MANIFEST_PATH.exists()

    from williamos_backup import MANIFEST_PATH as BACKUP_MANIFEST
    from williamos_restore import MANIFEST_PATH as RESTORE_MANIFEST
    from williamos_restore import REPORTS_DIR as RESTORE_REPORTS

    backup_manifest = _load_manifest_status(BACKUP_MANIFEST)
    restore_manifest = _load_manifest_status(RESTORE_MANIFEST)

    latest_restore_report = ""
    if RESTORE_REPORTS.exists():
        reports = sorted(RESTORE_REPORTS.glob("Restore Drill - *.md"), reverse=True)
        if reports:
            latest_restore_report = reports[0].name

    if not remotes:
        remote_state = "none"
    else:
        remote_state = "configured"

    return {
        "remote_dir_exists": REMOTE_DIR.exists(),
        "docs_exist": docs_ok,
        "git_repo": repo,
        "branch": branch,
        "latest_commit": latest,
        "clean_tree": clean,
        "remotes": remotes,
        "push_urls": push_urls,
        "remote_state": remote_state,
        "manifest_exists": manifest_exists,
        "backup_manifest": backup_manifest,
        "restore_manifest": restore_manifest,
        "latest_restore_report": latest_restore_report,
    }


def remote_readiness(provider: str | None = None) -> dict[str, Any]:
    checks: list[dict[str, Any]] = []

    repo = _is_git_repo()
    checks.append({"check": "Git repo exists", "passed": repo})

    clean = _is_clean() if repo else False
    checks.append({"check": "Working tree clean", "passed": clean})

    from williamos_git import snapshot_dry_run, check_forbidden_files
    snap = snapshot_dry_run() if repo else {"safe": False}
    checks.append({"check": "Snapshot dry-run safe", "passed": snap.get("safe", False)})

    from williamos_backup import scan_backup_sources
    scan = scan_backup_sources()
    checks.append({"check": "Backup dry-run safe", "passed": len(scan["forbidden"]) == 0})

    from williamos_restore import REPORTS_DIR
    has_restore = REPORTS_DIR.exists() and any(REPORTS_DIR.glob("Restore Drill - *.md"))
    checks.append({"check": "Restore drill completed", "passed": has_restore})

    forbidden = scan["forbidden"]
    checks.append({"check": "Forbidden files absent", "passed": len(forbidden) == 0})

    remotes = list_git_remotes() if repo else []
    checks.append({"check": "Remote absent or known", "passed": True, "detail": f"{len(remotes)} remote(s)"})

    docs_ok = all((VAULT / d).exists() for d in REMOTE_REQUIRED_DOCS)
    checks.append({"check": "Remote strategy docs exist", "passed": docs_ok})

    all_passed = all(c["passed"] for c in checks)

    guidance = []
    if provider:
        guidance = _provider_guidance(provider)

    return {
        "all_passed": all_passed,
        "checks": checks,
        "provider": provider,
        "provider_name": PROVIDERS.get(provider, provider) if provider else None,
        "guidance": guidance,
    }


def _provider_guidance(provider: str) -> list[str]:
    if provider == "github-private":
        return [
            "1. Create a PRIVATE repository on GitHub (no README, no .gitignore)",
            "2. Add remote: git remote add origin git@github.com:YOUR_USER/william-os-devops.git",
            "3. Verify: git remote -v",
            "4. Push: git push -u origin master",
            "5. Confirm repo is PRIVATE in GitHub settings",
            "Privacy: GitHub stores your data on Microsoft servers. Private repos are not visible to others but are visible to GitHub/Microsoft.",
            "Cost: Free for private repos.",
        ]
    elif provider == "external-drive":
        return [
            "1. Connect an external USB drive",
            "2. Create a backup folder on the drive",
            "3. Run: python scripts/william.py backup --dest E:\\WilliamOS_Backups --create-dest",
            "4. Verify: python scripts/william.py backup-verify E:\\WilliamOS_Backups\\<archive>.zip",
            "5. Optionally encrypt the drive with BitLocker (Windows) or VeraCrypt",
            "Privacy: Fully offline. No third party sees your data.",
            "Cost: Cost of the drive only.",
        ]
    elif provider == "encrypted-archive":
        return [
            "1. Create a backup: python scripts/william.py backup --dest <folder>",
            "2. Encrypt with 7-Zip: 7z a -p -mhe=on encrypted.7z <archive>.zip",
            "3. Copy encrypted archive to off-machine storage (cloud folder, USB, NAS)",
            "4. Store the encryption password separately (password manager)",
            "Privacy: Archive is encrypted at rest. Cloud provider cannot read contents.",
            "Cost: Free (7-Zip is open source).",
        ]
    elif provider == "syncthing":
        return [
            "1. Install Syncthing on this machine and one other device",
            "2. Share the project folder between devices",
            "3. Set the remote device folder to 'Receive Only' for safety",
            "4. Syncthing runs locally with no cloud middleman",
            "Privacy: Peer-to-peer. No third-party server stores your data.",
            "Cost: Free and open source.",
            "Risk: Conflicts possible if both sides edit. Use receive-only on the backup side.",
        ]
    elif provider == "obsidian-sync":
        return [
            "1. Subscribe to Obsidian Sync ($4/month or included in Catalyst)",
            "2. Enable Sync in Obsidian settings",
            "3. Only the vault (WilliamOS/) is synced — scripts and Git are NOT included",
            "4. Sync is end-to-end encrypted by default",
            "Privacy: Obsidian Sync is end-to-end encrypted. Obsidian team cannot read your notes.",
            "Cost: $4/month (or included in some plans).",
            "Limitation: Does NOT back up scripts, Git history, or governance docs outside the vault.",
        ]
    return [f"No specific guidance for provider: {provider}"]


def generate_remote_strategy_manifest() -> str:
    today = _local_today().isoformat()
    s = remote_status()
    r = remote_readiness()

    lines = [
        "---",
        "type: remote-strategy-manifest",
        "status: draft",
        f"generated: {today}",
        "tags:",
        "  - remote",
        "  - backup",
        "  - governance",
        "---",
        "",
        "# WilliamOS Remote Strategy Manifest",
        "",
        "## Generated",
        "",
        f"{today}",
        "",
        "## Current Protection State",
        "",
        f"- Git repo: {'yes' if s['git_repo'] else 'no'}",
        f"- Branch: {s['branch'] or 'N/A'}",
        f"- Latest commit: {s['latest_commit'] or 'N/A'}",
        f"- Clean tree: {'yes' if s['clean_tree'] else 'no'}",
        f"- Backup manifest: {s['backup_manifest']}",
        f"- Restore manifest: {s['restore_manifest']}",
        f"- Latest restore report: {s['latest_restore_report'] or 'none'}",
        "",
        "## Git State",
        "",
        f"- Repository: {'initialized' if s['git_repo'] else 'not initialized'}",
        f"- Branch: {s['branch'] or 'N/A'}",
        f"- Latest commit: {s['latest_commit'] or 'N/A'}",
        "",
        "## Backup State",
        "",
        f"- Backup manifest: {s['backup_manifest']}",
        "",
        "## Restore Drill State",
        "",
        f"- Restore manifest: {s['restore_manifest']}",
        f"- Latest report: {s['latest_restore_report'] or 'none'}",
        "",
        "## Current Remote State",
        "",
    ]
    if not s["remotes"]:
        lines.append("No remotes configured. This is the expected default.")
    else:
        for rm in s["remotes"]:
            lines.append(f"- `{rm['name']}` → `{rm['url']}`")
    lines.append("")

    if s["push_urls"]:
        lines.append("Push URLs:")
        for pu in s["push_urls"]:
            lines.append(f"- `{pu}`")
        lines.append("")

    lines.append("## Option Comparison")
    lines.append("")
    lines.append("| Option | Privacy | Complexity | Restore | Cost | Offline |")
    lines.append("|--------|---------|-----------|---------|------|---------|")
    lines.append("| Local Git + backup | Full | Low | High | Free | Yes |")
    lines.append("| External drive | Full | Low | High | Drive cost | Yes |")
    lines.append("| Encrypted archive | Full | Medium | High | Free/low | Partial |")
    lines.append("| Private GitHub | Moderate | Low | High | Free | No |")
    lines.append("| Syncthing | Full | Medium | Medium | Free | Yes |")
    lines.append("| Obsidian Sync | High (E2E) | Low | Vault only | $4/mo | No |")
    lines.append("")

    lines.append("## Recommended Strategy")
    lines.append("")
    lines.append("1. **Primary**: Local Git snapshot + verified local backup (already in place)")
    lines.append("2. **Secondary**: External encrypted drive backup")
    lines.append("3. **Tertiary**: Restore drill after each backup")
    lines.append("4. **Optional**: Encrypted off-machine archive for geographic redundancy")
    lines.append("5. **Optional**: Private Git remote only if William explicitly approves")
    lines.append("6. **Convenience**: Obsidian Sync for cross-device vault access (not sole backup)")
    lines.append("")

    lines.append("## Explicit Non-Actions")
    lines.append("")
    lines.append("This manifest does NOT:")
    lines.append("")
    lines.append("- Create any remote")
    lines.append("- Push to any service")
    lines.append("- Store tokens or credentials")
    lines.append("- Configure sync daemons")
    lines.append("- Enable background sync")
    lines.append("- Upload notes to any cloud")
    lines.append("- Choose a provider on William's behalf")
    lines.append("")

    lines.append("## Provider Readiness")
    lines.append("")
    lines.append("| Check | Status |")
    lines.append("|-------|--------|")
    for c in r["checks"]:
        status = "PASS" if c["passed"] else "FAIL"
        detail = f" ({c['detail']})" if c.get("detail") else ""
        lines.append(f"| {c['check']} | {status}{detail} |")
    lines.append("")

    lines.append("## Manual Next Steps")
    lines.append("")
    lines.append("1. Review OPTION_COMPARISON.md for full analysis")
    lines.append("2. Choose a protection strategy")
    lines.append("3. Follow the guide for your chosen provider")
    lines.append("4. Run `remote-readiness --provider <name>` for provider-specific guidance")
    lines.append("5. After configuring, run `remote-status` to confirm")
    lines.append("")

    lines.append("## Generator Notes")
    lines.append("")
    lines.append("This manifest was generated by WilliamOS. It does not configure or enable any remote.")
    lines.append("")

    return "\n".join(lines)


def write_remote_strategy_manifest() -> Path:
    REMOTE_DIR.mkdir(parents=True, exist_ok=True)
    text = generate_remote_strategy_manifest()
    MANIFEST_PATH.write_text(text, encoding="utf-8")
    return MANIFEST_PATH
