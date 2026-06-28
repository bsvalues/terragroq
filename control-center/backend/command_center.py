"""Governed command/workflow catalog for the Control Center GUI.

This module is read-first. It describes commands and workflow steps by combining
the WilliamOS command registry with the existing Control Center safety gate.
Execution still goes through command_runner.py.
"""

from __future__ import annotations

import sys
from pathlib import Path
from typing import Any

import safety

PROJECT_ROOT = Path(__file__).resolve().parents[2]
SCRIPTS_DIR = PROJECT_ROOT / "scripts"
if str(SCRIPTS_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPTS_DIR))

from williamos_commands import COMMAND_GROUPS, all_commands, count_cli_commands  # noqa: E402


WORKFLOW_DEFINITIONS = [
    {
        "id": "review-draft",
        "title": "Review draft",
        "command": "accept-plan",
        "purpose": "Inspect a review-queue draft and generate an acceptance plan before any promotion.",
        "steps": ["Choose a draft", "Generate plan", "Read warnings", "Decide whether acceptance is appropriate"],
        "dry_run_first": True,
    },
    {
        "id": "accept-draft",
        "title": "Accept draft",
        "command": "accept-draft",
        "purpose": "Promote a reviewed draft to an official folder through the dedicated acceptance endpoint.",
        "steps": ["Generate plan", "Type ACCEPT", "Copy draft", "Record closure guidance"],
        "dry_run_first": True,
    },
    {
        "id": "post-acceptance",
        "title": "Post-acceptance",
        "command": "post-acceptance",
        "purpose": "Generate closure evidence after a draft is accepted.",
        "steps": ["Run dry-run", "Review actions", "Generate report only if appropriate"],
        "dry_run_first": True,
    },
    {
        "id": "snapshot",
        "title": "Snapshot",
        "command": "snapshot",
        "purpose": "Preview and then create a local git snapshot only after operator confirmation.",
        "steps": ["Run snapshot dry-run", "Review file list", "Confirm locally if scoped"],
        "dry_run_first": True,
    },
    {
        "id": "backup",
        "title": "Backup",
        "command": "backup",
        "purpose": "Create a local archive after operator confirmation.",
        "steps": ["Check backup status", "Choose destination", "Confirm archive creation"],
        "dry_run_first": True,
    },
    {
        "id": "production-gate",
        "title": "Production gate",
        "command": "production-status",
        "purpose": "Review production posture before running expensive validation.",
        "steps": ["Check production status", "Run runtime smoke", "Run production readiness"],
        "dry_run_first": False,
    },
    {
        "id": "runtime-smoke",
        "title": "Runtime smoke",
        "command": "runtime-smoke",
        "purpose": "Run runtime smoke with zero critical failures.",
        "steps": ["Preview smoke commands", "Run smoke", "Read report"],
        "dry_run_first": True,
    },
    {
        "id": "production-readiness",
        "title": "Production readiness",
        "command": "production-readiness",
        "purpose": "Run the full 10-check production readiness gate.",
        "steps": ["Run Control Center smoke", "Run runtime smoke", "Run production gate", "Read generated evidence"],
        "dry_run_first": False,
    },
]


def _dry_run_args(command_name: str) -> list[str]:
    config = safety.SAFE_WITH_ARGS.get(command_name)
    if config and "--dry-run" in config.get("flags", []):
        return ["--dry-run"]
    if command_name == "snapshot":
        return ["--dry-run"]
    return []


def _registry_row(command_name: str) -> dict[str, Any] | None:
    for row in all_commands():
        if row["name"] == command_name:
            return row
    return None


def _classify_command(row: dict[str, Any]) -> dict[str, Any]:
    command_name = row["name"]
    gate = safety.check_command(command_name, [])
    dry_run_args = _dry_run_args(command_name)
    allowed = bool(gate.get("allowed"))
    confirmation_required = bool(gate.get("confirm"))

    if not allowed:
        safety_tier = "forbidden"
    elif confirmation_required:
        safety_tier = "confirmation-required"
    elif row.get("writes") and dry_run_args:
        safety_tier = "dry-run-first"
    elif row.get("writes"):
        safety_tier = "safe-write"
    else:
        safety_tier = "safe-read"

    return {
        **row,
        "args": row.get("args", []),
        "dry_run_args": dry_run_args,
        "allowed": allowed,
        "runnable": allowed,
        "confirmation_required": confirmation_required,
        "confirm_reason": gate.get("confirm_reason", ""),
        "blocked_reason": gate.get("reason", ""),
        "safety_tier": safety_tier,
        "execution_path": "safety.py -> command_runner.py",
    }


def command_catalog() -> dict[str, Any]:
    commands = [_classify_command(row) for row in all_commands()]
    registry_count = len(commands)
    cli_count = count_cli_commands()
    return {
        "ok": True,
        "registry_count": registry_count,
        "cli_count": cli_count,
        "parity": registry_count == cli_count,
        "groups": [
            {
                "id": group_id,
                "description": group["description"],
                "count": len(group["commands"]),
            }
            for group_id, group in COMMAND_GROUPS.items()
        ],
        "tiers": sorted({row["safety_tier"] for row in commands}),
        "commands": commands,
        "policy": {
            "execution_path": "safety.py -> command_runner.py",
            "forbidden_commands_execute": False,
            "confirmation_required_executes_without_confirmation": False,
            "automatic_execution": False,
        },
    }


def command_detail(command_name: str) -> dict[str, Any]:
    row = _registry_row(command_name)
    if not row:
        return {"ok": False, "error": "Command not found"}
    return {"ok": True, "command": _classify_command(row)}


def preview_command(command_name: str, args: list[str] | None = None, dry_run: bool = False) -> dict[str, Any]:
    detail = command_detail(command_name)
    if not detail.get("ok"):
        return detail
    command = detail["command"]
    final_args = list(args or [])
    if dry_run:
        for arg in command["dry_run_args"]:
            if arg not in final_args:
                final_args.append(arg)
    return {
        "ok": True,
        "command": command_name,
        "args": final_args,
        "dry_run": dry_run,
        "allowed": command["allowed"],
        "confirmation_required": command["confirmation_required"],
        "confirm_reason": command["confirm_reason"],
        "blocked_reason": command["blocked_reason"],
        "safety_tier": command["safety_tier"],
        "would_execute": False,
        "execution_endpoint": "/api/run",
        "policy": "preview-only; execution remains gated by command_runner.py",
    }


def workflow_center() -> dict[str, Any]:
    rows = []
    for workflow in WORKFLOW_DEFINITIONS:
        detail = command_detail(workflow["command"])
        command = detail.get("command", {})
        rows.append(
            {
                **workflow,
                "allowed": command.get("allowed", False),
                "safety_tier": command.get("safety_tier", "unknown"),
                "confirmation_required": command.get("confirmation_required", False),
                "dry_run_args": command.get("dry_run_args", []),
                "blocked_reason": command.get("blocked_reason", ""),
            }
        )
    return {
        "ok": True,
        "workflows": rows,
        "policy": {
            "autonomous_execution": False,
            "execution_path": "existing backend endpoints or /api/run only",
            "runtime_switching": "explicit-only",
            "phase_6": "blocked",
        },
    }
