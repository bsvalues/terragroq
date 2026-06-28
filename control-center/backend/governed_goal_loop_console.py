"""Preview-only Governed Goal/Loop Console.

Phase 6C composes existing read-only goal/loop governance surfaces into a single
operator decision-support payload. It does not approve, execute, schedule, write
state, activate MCP, enable autonomy, or write production data.
"""

from __future__ import annotations

from datetime import datetime
from typing import Any

import approval_packet_preview
import authority_ledger_preview
import goal_loop_readiness_reviewer
import goal_registry_preview
import loop_registry_preview
import operator_action_router_preview


DENIED_ACTIONS = [
    "approve",
    "execute",
    "schedule",
    "write_state",
    "grant_authority",
    "record_approval",
    "start_loop",
    "create_goal",
    "activate_mcp",
    "enable_autonomy",
    "production_write",
    "push",
    "open_pr",
    "merge",
    "release",
    "tag",
]


def current_governed_goal_loop_console() -> dict[str, Any]:
    goals = goal_registry_preview.goal_registry_preview()
    loops = loop_registry_preview.loop_registry_preview()
    readiness = goal_loop_readiness_reviewer.current_goal_loop_readiness()
    authority = authority_ledger_preview.current_authority_ledger_preview()
    approvals = approval_packet_preview.current_approval_packet_preview()
    router = operator_action_router_preview.current_operator_action_router_preview()
    return {
        "ok": True,
        "mode": "preview-only-governed-goal-loop-console",
        "generated_at": datetime.now().isoformat(timespec="seconds"),
        "goal_registry": goals,
        "loop_registry": loops,
        "readiness": readiness,
        "authority_ledger": authority,
        "approval_packets": approvals,
        "action_router": router,
        "next_valid_gate": readiness["next_valid_gate"],
        "summary": {
            "goals": goals["total"],
            "loops": loops["total"],
            "safe_for_owner_review": readiness["safe_for_owner_review"],
            "missing_authorities": len(authority["missing_authorities"]),
            "approval_packets": approvals["packet_count"],
            "routes": router["route_count"],
        },
        "denied_actions": DENIED_ACTIONS,
        "safety": {
            "preview_only": True,
            "would_approve": False,
            "would_execute": False,
            "would_schedule": False,
            "would_write_state": False,
            "would_grant_authority": False,
            "would_record_approval": False,
            "would_start_loop": False,
            "would_create_goal": False,
            "autonomy_enabled": False,
            "mcp_activation": False,
            "production_write": False,
        },
    }
