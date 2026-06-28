"""Preview-only Goal/Loop Readiness Reviewer.

Phase 5Z determines whether governed goal/loop metadata is safe to enter owner
review. It does not approve goals, start loops, execute commands, schedule work,
activate MCP, enable autonomy, or write production data.
"""

from __future__ import annotations

from datetime import datetime
from typing import Any

import approval_packet_preview
import goal_registry_preview
import loop_registry_preview
import validation_runbook_registry


DENIED_ACTIONS = [
    "approve_goal",
    "start_loop",
    "execute_commands",
    "execute_validators",
    "schedule_loop",
    "write_state",
    "activate_mcp",
    "enable_autonomy",
    "production_write",
    "push",
    "open_pr",
    "merge",
    "release",
    "tag",
]


def current_goal_loop_readiness() -> dict[str, Any]:
    goals = goal_registry_preview.goal_registry_preview()
    loops = loop_registry_preview.loop_registry_preview()
    approvals = approval_packet_preview.current_approval_packet_preview()
    runbooks = validation_runbook_registry.list_validation_runbooks()
    blockers: list[str] = []
    if not goals["goals"]:
        blockers.append("No governed goals are registered.")
    if not loops["loops"]:
        blockers.append("No governed loops are registered.")
    if goals["safety"]["would_execute"] or loops["safety"]["would_execute"]:
        blockers.append("Goal or loop registry indicates execution behavior.")
    if goals["safety"]["scheduler_enabled"] or loops["safety"].get("would_schedule_loop"):
        blockers.append("Scheduler behavior is present.")
    if goals["safety"]["mcp_activation"] or loops["safety"]["mcp_activation"]:
        blockers.append("MCP activation is present.")
    decision = "NOT_SAFE_FOR_OWNER_REVIEW" if blockers else "SAFE_FOR_OWNER_REVIEW"
    return {
        "ok": True,
        "mode": "preview-only-goal-loop-readiness-reviewer",
        "generated_at": datetime.now().isoformat(timespec="seconds"),
        "decision": decision,
        "safe_for_owner_review": decision == "SAFE_FOR_OWNER_REVIEW",
        "goals_reviewed": len(goals["goals"]),
        "loops_reviewed": len(loops["loops"]),
        "missing_approvals": approvals["missing_authorities"],
        "blocked_gates": blockers,
        "required_validators": runbooks[:6],
        "denied_actions": DENIED_ACTIONS,
        "next_valid_gate": "Owner review of Goal/Loop readiness packet.",
        "safety": {
            "preview_only": True,
            "would_approve_goal": False,
            "would_start_loop": False,
            "would_execute_commands": False,
            "would_execute_validators": False,
            "scheduler_enabled": False,
            "autonomy_enabled": False,
            "mcp_activation": False,
            "production_write": False,
        },
    }
