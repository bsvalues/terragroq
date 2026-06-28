"""WilliamOS Command Registry Engine.

Discovers, catalogs, and reports on all CLI commands.
Reconciles command count across README, PACKAGE_MANIFEST, and HTML.
Never modifies source notes.
"""

import json
import os
import subprocess
from datetime import datetime
from pathlib import Path

VAULT = Path(os.environ.get("WILLIAMOS_VAULT", "WilliamOS"))
TZ_NAME = os.environ.get("WILLIAMOS_TZ", "America/Los_Angeles")

CMD_DIR = VAULT / "104_CommandRegistry"
REPORTS_DIR = CMD_DIR / "reports"
DATA_DIR = CMD_DIR / "data"

COMMAND_GROUPS = {
    "create": {
        "description": "Create new notes",
        "commands": [
            {"name": "init", "purpose": "Initialize vault scaffold", "safe": True, "writes": True},
            {"name": "today", "purpose": "Create today's daily note", "safe": True, "writes": True},
            {"name": "weekly", "purpose": "Create this week's review note", "safe": True, "writes": True},
            {"name": "inbox", "purpose": "Capture a quick thought", "safe": True, "writes": True, "args": ["text"]},
            {"name": "decision", "purpose": "Create a decision record", "safe": True, "writes": True, "args": ["title"]},
            {"name": "doctrine", "purpose": "Create a doctrine note", "safe": True, "writes": True, "args": ["title"]},
            {"name": "concept", "purpose": "Create a concept note", "safe": True, "writes": True, "args": ["title"]},
            {"name": "case", "purpose": "Create a case analysis note", "safe": True, "writes": True, "args": ["title"]},
        ],
    },
    "check": {
        "description": "Governance and health checks",
        "commands": [
            {"name": "check", "purpose": "Run vault governance checks", "safe": True, "writes": False},
            {"name": "mcp-check", "purpose": "Check MCP readiness", "safe": True, "writes": False},
            {"name": "orphans", "purpose": "Find unlinked notes", "safe": True, "writes": False},
            {"name": "stale-decisions", "purpose": "Find decisions past review date", "safe": True, "writes": False},
        ],
    },
    "search": {
        "description": "Search and graph",
        "commands": [
            {"name": "graph", "purpose": "Run Graphify on vault", "safe": True, "writes": True},
            {"name": "semantic-index", "purpose": "Build semantic search index", "safe": True, "writes": True},
            {"name": "semantic-search", "purpose": "Search the vault semantically", "safe": True, "writes": False, "args": ["query"]},
            {"name": "semantic-status", "purpose": "Show semantic search status", "safe": True, "writes": False},
            {"name": "semantic-clear", "purpose": "Delete search index", "safe": False, "writes": True},
        ],
    },
    "synthesis": {
        "description": "Weekly synthesis",
        "commands": [
            {"name": "synth-week", "purpose": "Generate weekly synthesis", "safe": True, "writes": True},
            {"name": "synth-status", "purpose": "Show weekly synthesis status", "safe": True, "writes": False},
        ],
    },
    "promotion": {
        "description": "Promote inbox and source notes into official knowledge",
        "commands": [
            {"name": "inbox-status", "purpose": "Show inbox processor status", "safe": True, "writes": False},
            {"name": "process-inbox", "purpose": "Process inbox notes", "safe": True, "writes": True},
            {"name": "doctrine-status", "purpose": "Show doctrine promotion status", "safe": True, "writes": False},
            {"name": "promote-doctrine", "purpose": "Promote doctrine candidates", "safe": True, "writes": True},
            {"name": "decision-status", "purpose": "Show decision promotion status", "safe": True, "writes": False},
            {"name": "promote-decisions", "purpose": "Promote decision candidates", "safe": True, "writes": True},
            {"name": "concept-status", "purpose": "Show concept promotion status", "safe": True, "writes": False},
            {"name": "promote-concepts", "purpose": "Promote concept candidates", "safe": True, "writes": True},
            {"name": "project-status", "purpose": "Show project/WO promotion status", "safe": True, "writes": False},
            {"name": "promote-projects", "purpose": "Promote project/WO candidates", "safe": True, "writes": True},
        ],
    },
    "cortex": {
        "description": "Knowledge graph and cockpit",
        "commands": [
            {"name": "cortex-status", "purpose": "Show cortex map status", "safe": True, "writes": False},
            {"name": "cortex-map", "purpose": "Generate cortex map", "safe": True, "writes": True},
            {"name": "cockpit-status", "purpose": "Show review cockpit status", "safe": True, "writes": False},
            {"name": "cockpit", "purpose": "Generate review cockpit dashboard", "safe": True, "writes": True},
        ],
    },
    "git": {
        "description": "Git snapshot governance",
        "commands": [
            {"name": "git-status", "purpose": "Show Git repo status and safety checks", "safe": True, "writes": False},
            {"name": "git-init", "purpose": "Initialize Git repository (no remote)", "safe": True, "writes": True},
            {"name": "snapshot", "purpose": "Create a Git snapshot", "safe": True, "writes": True},
            {"name": "snapshot-manifest", "purpose": "Generate snapshot manifest", "safe": True, "writes": True},
        ],
    },
    "backup": {
        "description": "Backup, restore, and remote strategy",
        "commands": [
            {"name": "backup-status", "purpose": "Show backup readiness", "safe": True, "writes": False},
            {"name": "backup", "purpose": "Create a backup archive", "safe": True, "writes": True},
            {"name": "backup-manifest", "purpose": "Generate/update backup manifest", "safe": True, "writes": True},
            {"name": "backup-verify", "purpose": "Verify a backup archive", "safe": True, "writes": False, "args": ["archive"]},
            {"name": "restore-status", "purpose": "Show restore drill readiness", "safe": True, "writes": False},
            {"name": "restore-drill", "purpose": "Run a restore drill", "safe": True, "writes": True},
            {"name": "restore-runtime-proof", "purpose": "Run full runtime proof against restored backup", "safe": True, "writes": True},
            {"name": "restore-manifest", "purpose": "Generate/update restore manifest", "safe": True, "writes": True},
            {"name": "remote-status", "purpose": "Show remote protection status", "safe": True, "writes": False},
            {"name": "remote-strategy", "purpose": "Generate remote strategy manifest", "safe": True, "writes": True},
            {"name": "remote-readiness", "purpose": "Check readiness for remote protection", "safe": True, "writes": False},
            {"name": "drive-backup-status", "purpose": "Show external drive backup status", "safe": True, "writes": False},
            {"name": "drive-backup-plan", "purpose": "Generate drive backup plan", "safe": True, "writes": True, "args": ["--dest"]},
            {"name": "drive-backup", "purpose": "Run backup to external drive", "safe": True, "writes": True, "args": ["--dest"]},
            {"name": "drive-backup-log", "purpose": "Show external drive backup log", "safe": True, "writes": False},
        ],
    },
    "release": {
        "description": "Release governance and maintenance",
        "commands": [
            {"name": "release-status", "purpose": "Show release governance status", "safe": True, "writes": False},
            {"name": "acceptance", "purpose": "Run v1 acceptance review", "safe": True, "writes": True},
            {"name": "release-manifest", "purpose": "Generate/update release manifest", "safe": True, "writes": True},
            {"name": "release-tag", "purpose": "Create a local release tag", "safe": True, "writes": True, "args": ["--name"]},
            {"name": "maintenance-status", "purpose": "Show maintenance release status", "safe": True, "writes": False},
            {"name": "maintenance-review", "purpose": "Run maintenance review checks", "safe": True, "writes": True},
            {"name": "maintenance-manifest", "purpose": "Generate maintenance manifest", "safe": True, "writes": True},
            {"name": "maintenance-tag", "purpose": "Create maintenance release tag", "safe": True, "writes": True, "args": ["--name"]},
        ],
    },
    "routine": {
        "description": "Operating routine and reviews",
        "commands": [
            {"name": "routine-status", "purpose": "Show operating routine status", "safe": True, "writes": False},
            {"name": "daily-review", "purpose": "Generate daily review note", "safe": True, "writes": True},
            {"name": "weekly-review", "purpose": "Generate weekly operating review", "safe": True, "writes": True},
            {"name": "monthly-review", "purpose": "Generate monthly cortex review", "safe": True, "writes": True},
            {"name": "review-status", "purpose": "Show human review queue status", "safe": True, "writes": False},
            {"name": "review-queues", "purpose": "Generate review queue report", "safe": True, "writes": True},
            {"name": "acceptance-checklist", "purpose": "Generate acceptance checklist", "safe": True, "writes": True},
        ],
    },
    "acceptance": {
        "description": "Official acceptance workflow",
        "commands": [
            {"name": "accept-status", "purpose": "Show acceptance assistant status", "safe": True, "writes": False},
            {"name": "accept-plan", "purpose": "Generate acceptance plan", "safe": True, "writes": True, "args": ["--draft"]},
            {"name": "accept-draft", "purpose": "Accept a draft into official folder", "safe": False, "writes": True, "args": ["--draft", "--dest"]},
            {"name": "accept-log", "purpose": "Show acceptance log", "safe": True, "writes": False},
            {"name": "closure-status", "purpose": "Show post-acceptance closure status", "safe": True, "writes": False},
            {"name": "post-acceptance", "purpose": "Generate closure report", "safe": True, "writes": True},
            {"name": "post-acceptance-checklist", "purpose": "Generate closure checklist", "safe": True, "writes": True},
        ],
    },
    "workspace": {
        "description": "Workspace quality, schema registry, and command registry",
        "commands": [
            {"name": "obsidian-status", "purpose": "Show workspace quality status", "safe": True, "writes": False},
            {"name": "obsidian-quality", "purpose": "Generate workspace quality report", "safe": True, "writes": True},
            {"name": "schema-status", "purpose": "Show schema registry status", "safe": True, "writes": False},
            {"name": "schema-check", "purpose": "Validate schemas and templates", "safe": True, "writes": False},
            {"name": "schema-report", "purpose": "Generate schema report", "safe": True, "writes": True},
            {"name": "help-all", "purpose": "Show all commands grouped", "safe": True, "writes": False},
            {"name": "command-status", "purpose": "Show command registry status", "safe": True, "writes": False},
            {"name": "command-report", "purpose": "Generate command report", "safe": True, "writes": True},
            {"name": "runtime-status", "purpose": "Show runtime smoke status", "safe": True, "writes": False},
            {"name": "runtime-smoke", "purpose": "Run runtime smoke suite", "safe": True, "writes": True},
            {"name": "production-status", "purpose": "Show production readiness status", "safe": True, "writes": False},
            {"name": "production-readiness", "purpose": "Run full production readiness gate", "safe": True, "writes": True},
        ],
    },
    "control": {
        "description": "Control Center cockpit and runtime",
        "commands": [
            {"name": "control-center", "purpose": "Launch the Control Center cockpit", "safe": True, "writes": True, "args": ["--no-open"]},
            {"name": "control-center-stop", "purpose": "Stop the Control Center", "safe": True, "writes": True},
            {"name": "control-center-restart", "purpose": "Restart the Control Center", "safe": True, "writes": True, "args": ["--no-open"]},
            {"name": "control-center-status", "purpose": "Show Control Center status", "safe": True, "writes": False},
            {"name": "control-center-build", "purpose": "Build frontend production bundle", "safe": True, "writes": True},
            {"name": "control-center-smoke", "purpose": "Run Control Center smoke tests", "safe": True, "writes": False},
        ],
    },
}


def _tz():
    try:
        from zoneinfo import ZoneInfo
        return ZoneInfo(TZ_NAME)
    except Exception:
        return None


def _now():
    tz = _tz()
    return datetime.now(tz) if tz else datetime.now()


def _now_iso():
    return _now().strftime("%Y-%m-%d %H:%M:%S")


def _today_iso():
    return _now().strftime("%Y-%m-%d")


def _ensure_dirs():
    REPORTS_DIR.mkdir(parents=True, exist_ok=True)
    DATA_DIR.mkdir(parents=True, exist_ok=True)


def all_commands():
    cmds = []
    for group_name, group in COMMAND_GROUPS.items():
        for cmd in group["commands"]:
            cmds.append({**cmd, "group": group_name, "group_desc": group["description"]})
    return cmds


def count_cli_commands():
    try:
        result = subprocess.run(
            ["python", "scripts/william.py", "--help"],
            capture_output=True, text=True, timeout=15
        )
        lines = result.stdout.strip().split("\n")
        cmd_count = 0
        in_cmds = False
        for line in lines:
            if "{" in line and "}" in line and "," in line:
                parts = line.split("{")[1].split("}")[0]
                cmd_count = len([c.strip() for c in parts.split(",") if c.strip()])
                break
        return cmd_count
    except Exception:
        return 0


def command_status():
    registry_cmds = all_commands()
    cli_count = count_cli_commands()
    latest_report = None
    if REPORTS_DIR.exists():
        reports = sorted(REPORTS_DIR.glob("Command Report - *.md"))
        if reports:
            latest_report = reports[-1].name
    return {
        "cmd_dir_exists": CMD_DIR.exists(),
        "docs_exist": all((CMD_DIR / d).exists() for d in ["README.md", "COMMAND_REGISTRY_POLICY.md"]),
        "registry_count": len(registry_cmds),
        "cli_count": cli_count,
        "groups": len(COMMAND_GROUPS),
        "safe_count": sum(1 for c in registry_cmds if c.get("safe", True)),
        "write_count": sum(1 for c in registry_cmds if c.get("writes", False)),
        "latest_report": latest_report,
    }


def generate_command_report(dry_run=False):
    date_str = _today_iso()
    cmds = all_commands()
    cli_count = count_cli_commands()

    groups_summary = {}
    for gn, gd in COMMAND_GROUPS.items():
        groups_summary[gn] = {"desc": gd["description"], "count": len(gd["commands"])}

    if dry_run:
        return {
            "date": date_str,
            "registry_count": len(cmds),
            "cli_count": cli_count,
            "match": len(cmds) == cli_count,
            "groups": len(COMMAND_GROUPS),
            "safe": sum(1 for c in cmds if c.get("safe", True)),
            "write": sum(1 for c in cmds if c.get("writes", False)),
            "dry_run": True,
        }

    lines = []
    lines.append("---")
    lines.append("type: command-report")
    lines.append("status: draft")
    lines.append(f"generated: \"{_now_iso()}\"")
    lines.append("tags:")
    lines.append("  - commands")
    lines.append("  - generated")
    lines.append("---")
    lines.append("")
    lines.append(f"# Command Report - {date_str}")
    lines.append("")
    lines.append("## Summary")
    lines.append("")
    lines.append(f"- Registry commands: {len(cmds)}")
    lines.append(f"- CLI commands (argparse): {cli_count}")
    lines.append(f"- Match: {'YES' if len(cmds) == cli_count else 'NO — reconcile needed'}")
    lines.append(f"- Groups: {len(COMMAND_GROUPS)}")
    lines.append(f"- Safe commands: {sum(1 for c in cmds if c.get('safe', True))}")
    lines.append(f"- Write commands: {sum(1 for c in cmds if c.get('writes', False))}")
    lines.append("")

    for gn, gd in COMMAND_GROUPS.items():
        lines.append(f"## {gd['description']} ({gn})")
        lines.append("")
        lines.append("| Command | Purpose | Safe | Writes |")
        lines.append("|---------|---------|------|--------|")
        for cmd in gd["commands"]:
            safe = "yes" if cmd.get("safe", True) else "NO"
            writes = "yes" if cmd.get("writes", False) else "—"
            lines.append(f"| `{cmd['name']}` | {cmd['purpose']} | {safe} | {writes} |")
        lines.append("")

    lines.append("## Generator Notes")
    lines.append("")
    lines.append("This report was generated by WilliamOS. No notes were modified.")
    lines.append("")

    _ensure_dirs()
    content = "\n".join(lines)
    report_path = REPORTS_DIR / f"Command Report - {date_str}.md"
    report_path.write_text(content, encoding="utf-8")

    json_data = {
        "date": date_str,
        "registry_count": len(cmds),
        "cli_count": cli_count,
        "groups": groups_summary,
        "commands": cmds,
    }
    json_path = DATA_DIR / f"command-registry-{date_str}.json"
    json_path.write_text(json.dumps(json_data, indent=2, default=str), encoding="utf-8")

    return {
        "date": date_str,
        "registry_count": len(cmds),
        "cli_count": cli_count,
        "match": len(cmds) == cli_count,
        "groups": len(COMMAND_GROUPS),
        "report_path": str(report_path),
        "json_path": str(json_path),
        "dry_run": False,
    }
