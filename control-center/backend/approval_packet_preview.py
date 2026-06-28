"""Preview-only Approval Packet composer.

Phase 5W packages owner decision drafts into approval packet previews. It does
not approve, grant authority, write records, execute commands, schedule work,
activate MCP, enable autonomy, or write production data.
"""

from __future__ import annotations

from datetime import datetime
from typing import Any

import owner_decision_record_preview


DENIED_ACTIONS = [
    "approve_packet",
    "grant_authority",
    "write_decision_record",
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
    "no packet approval",
    "no authority grant",
    "no decision record write",
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


def _packet_for_record(record: dict[str, Any]) -> dict[str, Any]:
    approval_text = "\n".join(
        [
            f"DECISION: {record['title']}",
            f"ACTION_TYPE: {record['decision_type']}",
            f"AUTHORITY_REQUIRED: {record['authority_required']}",
            f"APPROVER_REQUIRED: {record['required_approver']}",
            f"MISSING_AUTHORITY: {', '.join(record['missing_authority']) or 'NONE'}",
            f"EVIDENCE_HEAD: {record['evidence']['head']}",
            "APPROVAL_STATUS: NOT_GRANTED",
        ]
    )
    return {
        "id": f"approval-packet-{record['id']}",
        "decision_record_id": record["id"],
        "title": record["title"],
        "status": "preview-only",
        "owner_required": record["status"] == "owner-required",
        "authority_required": record["authority_required"],
        "required_approver": record["required_approver"],
        "approval_text": approval_text,
        "required_evidence": record["evidence"],
        "would_approve": False,
        "would_grant_authority": False,
        "would_write_record": False,
        "actions_allowed": ["inspect", "copy"],
        "actions_denied": DENIED_ACTIONS,
    }


def current_approval_packet_preview() -> dict[str, Any]:
    decision_preview = owner_decision_record_preview.current_owner_decision_record_preview()
    packets = [_packet_for_record(record) for record in decision_preview["records"]]
    owner_required = [packet for packet in packets if packet["owner_required"]]
    return {
        "ok": True,
        "mode": "preview-only-approval-packet",
        "generated_at": datetime.now().isoformat(timespec="seconds"),
        "repo": decision_preview["repo"],
        "branch": decision_preview["branch"],
        "head": decision_preview["head"],
        "short_head": decision_preview["short_head"],
        "packets": packets,
        "packet_count": len(packets),
        "owner_required_count": len(owner_required),
        "missing_authorities": decision_preview["missing_authorities"],
        "recommended_work_order_lane": decision_preview["recommended_work_order_lane"],
        "next_valid_gate": decision_preview["next_valid_gate"],
        "denied_actions": DENIED_ACTIONS,
        "safety": {
            "preview_only": True,
            "would_approve_packet": False,
            "would_grant_authority": False,
            "would_write_decision_record": False,
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
