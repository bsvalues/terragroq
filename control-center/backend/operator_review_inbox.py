"""Preview-only Operator Review Inbox.

Phase 5R aggregates generated governance previews into an in-memory review
queue. It does not persist inbox items, approve work, execute validators, stage,
commit, schedule work, activate MCP, enable autonomy, or write production data.
"""

from __future__ import annotations

from datetime import datetime
from typing import Any

import commit_readiness_reviewer
import handoff_packet_exporter
import repo_state_dashboard
import validation_runbook_registry


NON_AUTHORIZATIONS = [
    "no persistence",
    "no auto-approval",
    "no execution",
    "no validator execution",
    "no git add",
    "no commit",
    "no push",
    "no PR creation/update",
    "no merge",
    "no release",
    "no tag",
    "no scheduler",
    "no autonomy",
    "no MCP activation",
    "no production/data write",
]


def _item(item_id: str, kind: str, title: str, summary: str, status: str, priority: str, source: str, payload: dict[str, Any]) -> dict[str, Any]:
    return {
        "id": item_id,
        "kind": kind,
        "title": title,
        "summary": summary,
        "status": status,
        "priority": priority,
        "source": source,
        "payload": payload,
        "actions_allowed": ["inspect", "copy"],
        "actions_denied": [
            "approve",
            "execute",
            "persist",
            "stage",
            "commit",
            "push",
            "schedule",
            "activate_mcp",
            "enable_autonomy",
            "production_write",
        ],
    }


def current_operator_review_inbox() -> dict[str, Any]:
    handoff = handoff_packet_exporter.current_handoff_packet()
    readiness = commit_readiness_reviewer.current_commit_readiness()
    repo_state = repo_state_dashboard.current_repo_state_dashboard()
    runbooks = validation_runbook_registry.list_validation_runbooks()
    items = [
        _item(
            "handoff-current",
            "handoff_packet",
            "Current Handoff Packet",
            f"{handoff['result']} packet for {repo_state['short_head']}",
            "preview",
            "high",
            "handoff_packet_exporter",
            {"result": handoff["result"], "packet_text": handoff["packet_text"], "next_valid_gate": handoff["next_valid_gate"]},
        ),
        _item(
            "commit-readiness-current",
            "commit_readiness",
            "Commit Readiness Review",
            readiness["decision"],
            "preview",
            "high" if not readiness["safe_to_commit"] else "normal",
            "commit_readiness_reviewer",
            readiness,
        ),
        _item(
            "validation-runbooks-current",
            "validation_summary",
            "Validation Runbook Summary",
            f"{len(runbooks)} approved metadata recipes available",
            "preview",
            "normal",
            "validation_runbook_registry",
            {"runbooks": runbooks},
        ),
        _item(
            "next-gate-current",
            "next_gate",
            "Next Valid Gate",
            repo_state["next_valid_action"],
            "preview",
            "normal",
            "repo_state_dashboard",
            {"next_valid_gate": repo_state["next_valid_action"], "worktree_clean": repo_state["worktree"]["clean"]},
        ),
    ]
    return {
        "ok": True,
        "mode": "preview-only-operator-review-inbox",
        "generated_at": datetime.now().isoformat(timespec="seconds"),
        "items": items,
        "total": len(items),
        "queue_status": "preview-only",
        "safety": {
            "read_only_inbox": True,
            "would_persist": False,
            "would_auto_approve": False,
            "would_execute": False,
            "would_execute_validators": False,
            "would_stage": False,
            "would_commit": False,
            "would_push": False,
            "scheduler_enabled": False,
            "autonomy_enabled": False,
            "mcp_activation": False,
            "production_write": False,
        },
        "non_authorizations_preserved": NON_AUTHORIZATIONS,
    }
