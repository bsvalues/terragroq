"""Metadata-only Goal Registry Preview.

Phase 5X exposes governed goal metadata for operator inspection. It does not
create active goals, persist goal state, execute goals, schedule work, activate
MCP, enable autonomy, or write production data.
"""

from __future__ import annotations

from datetime import datetime
from typing import Any


DENIED_ACTIONS = [
    "create_active_goal",
    "persist_goal",
    "execute_goal",
    "schedule_goal",
    "activate_mcp",
    "enable_autonomy",
    "production_write",
    "push",
    "open_pr",
    "merge",
    "release",
    "tag",
]

GOALS = [
    {
        "id": "GOAL-WILLIAMOS-GOVERNED-OPERATOR-STACK",
        "name": "Complete governed operator stack and prepare safe Goal/Loop readiness",
        "status": "preview",
        "mode": "local-only-owner-gated-non-autonomous",
        "objective": "Build remaining preview-only governance surfaces for goals, loops, approvals, validation, and handoffs without autonomous execution.",
        "allowed_lanes": [
            "Goal Registry Preview",
            "Loop Registry Preview",
            "Goal/Loop Readiness Reviewer",
            "Goal Command Preview Hardening",
            "Loop Command Preview Hardening",
            "Governed Goal/Loop Console",
        ],
        "denied_lanes": [
            "autonomous execution",
            "scheduler activation",
            "MCP activation",
            "production/data writes",
            "push/PR/merge/release/tag",
        ],
        "success_criteria": [
            "all new surfaces are preview-only or metadata-only",
            "no automatic execution",
            "no scheduler activation",
            "no MCP activation",
            "full backend suite passes after each lane",
            "frontend build passes after each lane",
            "worktree clean after every committed lane",
        ],
        "next_gate": "WO-P5Y Loop Registry Preview after owner-approved local WO-P5X commit.",
        "requires_owner_approval": True,
        "would_create_goal": False,
        "would_persist": False,
        "would_execute": False,
        "scheduler_enabled": False,
        "autonomy_enabled": False,
        "mcp_activation": False,
        "production_write": False,
    }
]


def list_goals() -> list[dict[str, Any]]:
    return GOALS


def get_goal(goal_id: str) -> dict[str, Any] | None:
    return next((goal for goal in GOALS if goal["id"] == goal_id), None)


def goal_registry_preview() -> dict[str, Any]:
    return {
        "ok": True,
        "mode": "metadata-only-goal-registry-preview",
        "generated_at": datetime.now().isoformat(timespec="seconds"),
        "goals": list_goals(),
        "total": len(GOALS),
        "denied_actions": DENIED_ACTIONS,
        "safety": {
            "metadata_only": True,
            "preview_only": True,
            "would_create_goal": False,
            "would_persist": False,
            "would_execute": False,
            "scheduler_enabled": False,
            "autonomy_enabled": False,
            "mcp_activation": False,
            "production_write": False,
        },
    }
