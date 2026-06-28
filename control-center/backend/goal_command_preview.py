"""Non-executing /goal command preview.

Phase 6A classifies goal requests against governance without creating goals,
mutating queues, scheduling work, enabling autonomy, or executing anything.
"""

from __future__ import annotations

from datetime import datetime
from typing import Any

import goal_loop_readiness_reviewer


DENIED_ACTIONS = [
    "create_goal",
    "persist_goal",
    "execute_goal",
    "mutate_queue",
    "schedule_goal",
    "enable_autonomy",
    "activate_mcp",
    "production_write",
]


def classify_goal_request(request: str) -> dict[str, Any]:
    text = request.strip()
    readiness = goal_loop_readiness_reviewer.current_goal_loop_readiness()
    blockers: list[str] = []
    if not text:
        blockers.append("Goal request is empty.")
    if any(token in text.lower() for token in ["autonomous", "schedule", "run forever", "production write", "mcp"]):
        blockers.append("Goal request contains denied autonomy, scheduler, production-write, or MCP language.")
    if not readiness["safe_for_owner_review"]:
        blockers.extend(readiness["blocked_gates"])
    decision = "BLOCKED" if blockers else "ALLOWED_FOR_OWNER_REVIEW"
    return {
        "request": text,
        "decision": decision,
        "allowed_for_owner_review": decision == "ALLOWED_FOR_OWNER_REVIEW",
        "blocked_reasons": blockers,
        "required_authority": "owner-goal-review",
        "required_validators": readiness["required_validators"][:4],
        "next_valid_gate": readiness["next_valid_gate"],
    }


def goal_command_preview(request: str = "") -> dict[str, Any]:
    return {
        "ok": True,
        "mode": "preview-only-goal-command",
        "generated_at": datetime.now().isoformat(timespec="seconds"),
        "preview": classify_goal_request(request),
        "denied_actions": DENIED_ACTIONS,
        "safety": {
            "preview_only": True,
            "would_create_goal": False,
            "would_persist_goal": False,
            "would_execute_goal": False,
            "would_mutate_queue": False,
            "scheduler_enabled": False,
            "autonomy_enabled": False,
            "mcp_activation": False,
            "production_write": False,
        },
    }
