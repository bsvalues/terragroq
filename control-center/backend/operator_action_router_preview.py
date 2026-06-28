"""Preview-only Operator Action Router.

Phase 5T maps pending decisions to safe next-action categories. It does not
perform actions, approve gates, write state, execute commands, schedule work,
activate MCP, enable autonomy, or write production data.
"""

from __future__ import annotations

from datetime import datetime
from typing import Any

import decision_gate_console


ACTION_TYPES = [
    "hold",
    "review",
    "validate",
    "split",
    "commit-authorize",
    "push-authorize",
    "PR-authorize",
    "stop",
]

DENIED_ACTIONS = [
    "perform_action",
    "approve_gate",
    "write_state",
    "execute_commands",
    "execute_validators",
    "stage",
    "commit",
    "push",
    "open_pr",
    "merge",
    "release",
    "schedule",
    "activate_mcp",
    "enable_autonomy",
    "production_write",
]

NON_AUTHORIZATIONS = [
    "no action execution",
    "no gate approval",
    "no state write",
    "no command execution",
    "no scheduler",
    "no autonomy",
    "no MCP activation",
    "no push",
    "no PR creation/update",
    "no merge",
    "no release",
    "no production/data write",
]


def _route_for_decision(decision: dict[str, Any], console: dict[str, Any]) -> dict[str, Any]:
    if console["blocked_gates"]:
        action_type = "stop"
        authority_required = "owner-review"
        reason = "Blocked gates exist; stop before authorization or execution."
    elif decision["id"] == "commit-candidate":
        action_type = "commit-authorize"
        authority_required = "explicit-owner-local-commit-authorization"
        reason = "Commit candidate requires separate owner authorization outside this router."
    elif decision["id"] == "review-queue-triage":
        action_type = "review"
        authority_required = "read-only"
        reason = "Generated review items can be inspected or copied without state change."
    elif decision["id"] == "next-lane":
        action_type = "review"
        authority_required = "owner-lane-selection"
        reason = "Operator must choose the next scoped governed work order lane."
    else:
        action_type = "hold"
        authority_required = "owner-review"
        reason = "Unknown decision type; hold until classified."
    return {
        "id": f"route-{decision['id']}",
        "decision_id": decision["id"],
        "decision_title": decision["title"],
        "action_type": action_type,
        "authority_required": authority_required,
        "reason": reason,
        "source": decision["source"],
        "would_perform": False,
        "actions_allowed": ["inspect", "copy"],
        "actions_denied": DENIED_ACTIONS,
    }


def current_operator_action_router_preview() -> dict[str, Any]:
    console = decision_gate_console.current_decision_gate_console()
    routes = [
        _route_for_decision(decision, console)
        for decision in console["pending_owner_decisions"]
    ]
    if console["blocked_gates"]:
        routes.append(
            {
                "id": "route-blocked-gates",
                "decision_id": "blocked-gates",
                "decision_title": "Stop on blocked gates",
                "action_type": "stop",
                "authority_required": "owner-review",
                "reason": "Resolve blocked gates before any validation, commit, push, PR, merge, or release decision.",
                "source": "decision_gate_console",
                "would_perform": False,
                "actions_allowed": ["inspect", "copy"],
                "actions_denied": DENIED_ACTIONS,
            }
        )
    recommended_action = "stop" if console["blocked_gates"] else "review"
    return {
        "ok": True,
        "mode": "preview-only-operator-action-router",
        "generated_at": datetime.now().isoformat(timespec="seconds"),
        "repo": console["repo"],
        "branch": console["branch"],
        "head": console["head"],
        "short_head": console["short_head"],
        "action_types": ACTION_TYPES,
        "routes": routes,
        "route_count": len(routes),
        "recommended_action_type": recommended_action,
        "recommended_work_order_lane": console["recommended_work_order_lane"],
        "next_valid_gate": console["next_valid_gate"],
        "denied_actions": DENIED_ACTIONS,
        "safety": {
            "preview_only": True,
            "would_perform_action": False,
            "would_approve_gate": False,
            "would_write_state": False,
            "would_execute_commands": False,
            "would_execute_validators": False,
            "would_stage": False,
            "would_commit": False,
            "would_push": False,
            "would_open_pr": False,
            "scheduler_enabled": False,
            "autonomy_enabled": False,
            "mcp_activation": False,
            "production_write": False,
        },
        "non_authorizations_preserved": NON_AUTHORIZATIONS,
    }
