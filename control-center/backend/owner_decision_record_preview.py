"""Preview-only Owner Decision Record composer.

Phase 5V drafts what an owner decision record would contain if the owner later
authorizes recording it. It does not write decisions, grant authority, execute
commands, schedule work, activate MCP, enable autonomy, or write production data.
"""

from __future__ import annotations

from datetime import datetime
from typing import Any

import authority_ledger_preview


DECISION_RECORD_STATUSES = [
    "draft-preview",
    "owner-required",
    "not-authorized",
]

DENIED_ACTIONS = [
    "write_decision_record",
    "grant_authority",
    "record_approval",
    "change_state",
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
    "no decision record write",
    "no authority grant",
    "no approval write",
    "no state change",
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


def _record_for_entry(entry: dict[str, Any], ledger: dict[str, Any]) -> dict[str, Any]:
    owner_required = entry["required_approver"] == "owner" and bool(entry["missing_authority"])
    status = "owner-required" if owner_required else "draft-preview"
    return {
        "id": f"decision-preview-{entry['id']}",
        "title": entry["decision_title"],
        "status": status,
        "decision_type": entry["action_type"],
        "authority_required": entry["authority_required"],
        "missing_authority": entry["missing_authority"],
        "required_approver": entry["required_approver"],
        "recommended_record_text": (
            f"Owner decision required for {entry['action_type']} with authority "
            f"{entry['authority_required']}."
            if owner_required
            else f"Preview-only record for {entry['action_type']}; no owner grant required now."
        ),
        "evidence": {
            "repo": ledger["repo"],
            "branch": ledger["branch"],
            "head": ledger["short_head"],
            "route_id": entry["route_id"],
            "reason": entry["reason"],
        },
        "would_write_record": False,
        "would_grant_authority": False,
        "actions_allowed": ["inspect", "copy"],
        "actions_denied": DENIED_ACTIONS,
    }


def current_owner_decision_record_preview() -> dict[str, Any]:
    ledger = authority_ledger_preview.current_authority_ledger_preview()
    records = [_record_for_entry(entry, ledger) for entry in ledger["entries"]]
    owner_required = [record for record in records if record["status"] == "owner-required"]
    return {
        "ok": True,
        "mode": "preview-only-owner-decision-record",
        "generated_at": datetime.now().isoformat(timespec="seconds"),
        "repo": ledger["repo"],
        "branch": ledger["branch"],
        "head": ledger["head"],
        "short_head": ledger["short_head"],
        "record_statuses": DECISION_RECORD_STATUSES,
        "records": records,
        "record_count": len(records),
        "owner_required_count": len(owner_required),
        "missing_authorities": ledger["missing_authorities"],
        "recommended_work_order_lane": ledger["recommended_work_order_lane"],
        "next_valid_gate": ledger["next_valid_gate"],
        "denied_actions": DENIED_ACTIONS,
        "safety": {
            "preview_only": True,
            "would_write_decision_record": False,
            "would_grant_authority": False,
            "would_record_approval": False,
            "would_change_state": False,
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
