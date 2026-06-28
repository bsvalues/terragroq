"""Non-executing /loop command preview.

Phase 6B classifies loop requests against governance without starting loops,
scheduling loops, autonomous continuation, MCP activation, or production writes.
"""

from __future__ import annotations

from datetime import datetime
from typing import Any

import loop_registry_preview


DENIED_ACTIONS = [
    "start_loop",
    "schedule_loop",
    "execute_loop",
    "autonomous_continuation",
    "write_loop_state",
    "activate_mcp",
    "production_write",
]


def classify_loop_request(request: str) -> dict[str, Any]:
    text = request.strip()
    registry = loop_registry_preview.loop_registry_preview()
    blockers: list[str] = []
    if not text:
        blockers.append("Loop request is empty.")
    if any(token in text.lower() for token in ["forever", "autonomous", "schedule", "cron", "mcp", "production write"]):
        blockers.append("Loop request contains denied scheduler, autonomy, MCP, or production-write language.")
    if "stop" not in text.lower() and "until" not in text.lower():
        blockers.append("Loop request must declare a stop condition.")
    decision = "BLOCKED" if blockers else "ALLOWED_FOR_OWNER_REVIEW"
    return {
        "request": text,
        "decision": decision,
        "allowed_for_owner_review": decision == "ALLOWED_FOR_OWNER_REVIEW",
        "blocked_reasons": blockers,
        "stop_condition_required": True,
        "known_stop_conditions": registry["loops"][0]["stop_conditions"] if registry["loops"] else [],
        "required_authority": "owner-loop-review",
        "next_valid_gate": "Owner review of non-executing loop preview.",
    }


def loop_command_preview(request: str = "") -> dict[str, Any]:
    return {
        "ok": True,
        "mode": "preview-only-loop-command",
        "generated_at": datetime.now().isoformat(timespec="seconds"),
        "preview": classify_loop_request(request),
        "denied_actions": DENIED_ACTIONS,
        "safety": {
            "preview_only": True,
            "would_start_loop": False,
            "would_schedule_loop": False,
            "would_execute_loop": False,
            "would_write_loop_state": False,
            "autonomous_continuation": False,
            "mcp_activation": False,
            "production_write": False,
        },
    }
