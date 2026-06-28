"""WilliamOS Control Center — Safety Layer.

Explicit allowlists for what the Control Center may and may not run.
No command executes without passing through this gate.
"""

SAFE_COMMANDS = {
    "check", "mcp-check", "orphans", "stale-decisions",
    "cockpit-status", "routine-status", "review-status",
    "accept-status", "accept-log", "closure-status",
    "semantic-status", "cortex-status",
    "git-status", "backup-status", "restore-status", "remote-status",
    "release-status", "maintenance-status", "drive-backup-status",
    "production-status", "obsidian-status", "schema-status",
    "schema-check", "command-status", "runtime-status",
    "inbox-status", "doctrine-status", "decision-status",
    "concept-status", "project-status", "synth-status",
    "help-all",
    "post-acceptance-checklist",
    "control-center-status", "control-center-smoke",
}

SAFE_WITH_ARGS = {
    "inbox": {"required": ["text"], "flags": []},
    "today": {"required": [], "flags": []},
    "weekly": {"required": [], "flags": []},
    "decision": {"required": ["title"], "flags": []},
    "doctrine": {"required": ["title"], "flags": []},
    "concept": {"required": ["title"], "flags": []},
    "case": {"required": ["title"], "flags": []},
    "semantic-search": {"required": ["query"], "flags": []},
    "review-queues": {"required": [], "flags": ["--dry-run"]},
    "accept-plan": {"required": [], "flags": ["--draft"]},
    "daily-review": {"required": [], "flags": ["--dry-run"]},
    "weekly-review": {"required": [], "flags": ["--dry-run"]},
    "cockpit": {"required": [], "flags": ["--dry-run"]},
    "process-inbox": {"required": [], "flags": ["--dry-run"]},
    "production-readiness": {"required": [], "flags": []},
    "runtime-smoke": {"required": [], "flags": ["--dry-run"]},
    "obsidian-quality": {"required": [], "flags": ["--dry-run"]},
    "post-acceptance": {"required": [], "flags": ["--dry-run", "--refresh-cortex"]},
}

CONFIRM_REQUIRED = {
    "snapshot": "Creates a git commit",
    "backup": "Creates a backup archive",
    "drive-backup": "Copies to external drive",
    "release-tag": "Creates a release tag",
    "maintenance-tag": "Creates a maintenance tag",
    "control-center": "Starts the local Control Center runtime",
    "control-center-stop": "Stops the local Control Center runtime",
    "control-center-restart": "Restarts the local Control Center runtime",
    "control-center-build": "Builds the Control Center frontend bundle",
}

FORBIDDEN = {
    "semantic-clear", "git-init",
    "remote-strategy", "remote-readiness",
    "accept-draft",
}


def check_command(command: str, args: list[str] | None = None) -> dict:
    args = args or []

    if command in FORBIDDEN:
        return {"allowed": False, "reason": f"'{command}' is forbidden through the Control Center."}

    if command in SAFE_COMMANDS:
        return {"allowed": True, "confirm": False}

    if command in SAFE_WITH_ARGS:
        return {"allowed": True, "confirm": False}

    if command in CONFIRM_REQUIRED:
        return {
            "allowed": True,
            "confirm": True,
            "confirm_reason": CONFIRM_REQUIRED[command],
        }

    return {"allowed": False, "reason": f"'{command}' is not in the Control Center allowlist."}
