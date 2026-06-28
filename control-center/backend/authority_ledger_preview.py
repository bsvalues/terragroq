"""Preview-only Authority Ledger.

Phase 5U shows current and missing authority for proposed operator routes. It
does not grant authority, record approvals, write state, execute commands,
schedule work, activate MCP, enable autonomy, or write production data.
"""

from __future__ import annotations

from datetime import datetime
from typing import Any

import operator_action_router_preview


GRANTABLE_AUTHORITIES = [
    "owner-lane-selection",
    "explicit-owner-local-commit-authorization",
    "explicit-owner-push-authorization",
    "explicit-owner-PR-authorization",
    "explicit-owner-merge-authorization",
    "explicit-owner-release-authorization",
]

DENIED_ACTIONS = [
    "grant_authority",
    "record_approval",
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
    "no authority grant",
    "no approval write",
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


def _current_authority(route: dict[str, Any]) -> str:
    if route["authority_required"] in {"read-only", "clipboard-only"}:
        return "available-preview-authority"
    if route["action_type"] == "stop":
        return "stop-only"
    return "missing-owner-authorization"


def _required_approver(route: dict[str, Any]) -> str:
    if route["authority_required"] in {"read-only", "clipboard-only"}:
        return "none"
    return "owner"


def _ledger_entry(route: dict[str, Any]) -> dict[str, Any]:
    current = _current_authority(route)
    missing = []
    if current == "missing-owner-authorization":
        missing.append(route["authority_required"])
    return {
        "id": f"authority-{route['decision_id']}",
        "route_id": route["id"],
        "decision_title": route["decision_title"],
        "action_type": route["action_type"],
        "authority_required": route["authority_required"],
        "current_authority": current,
        "missing_authority": missing,
        "required_approver": _required_approver(route),
        "authorized_now": current in {"available-preview-authority", "stop-only"},
        "reason": route["reason"],
        "actions_denied": DENIED_ACTIONS,
        "would_grant": False,
        "would_record_approval": False,
    }


def current_authority_ledger_preview() -> dict[str, Any]:
    router = operator_action_router_preview.current_operator_action_router_preview()
    entries = [_ledger_entry(route) for route in router["routes"]]
    missing = sorted({auth for entry in entries for auth in entry["missing_authority"]})
    return {
        "ok": True,
        "mode": "preview-only-authority-ledger",
        "generated_at": datetime.now().isoformat(timespec="seconds"),
        "repo": router["repo"],
        "branch": router["branch"],
        "head": router["head"],
        "short_head": router["short_head"],
        "entries": entries,
        "entry_count": len(entries),
        "grantable_authorities": GRANTABLE_AUTHORITIES,
        "missing_authorities": missing,
        "authorized_preview_actions": [
            entry["action_type"]
            for entry in entries
            if entry["authorized_now"] and entry["action_type"] in {"review", "hold", "stop"}
        ],
        "denied_actions": DENIED_ACTIONS,
        "recommended_work_order_lane": router["recommended_work_order_lane"],
        "next_valid_gate": router["next_valid_gate"],
        "safety": {
            "preview_only": True,
            "would_grant_authority": False,
            "would_record_approval": False,
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
