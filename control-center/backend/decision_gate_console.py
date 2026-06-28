"""Preview-only Decision Gate Console.

Phase 5S summarizes the next owner decision from existing read-only governance
surfaces. It does not approve gates, persist state, execute work, schedule work,
activate MCP, enable autonomy, or write production data.
"""

from __future__ import annotations

from datetime import datetime
from typing import Any

import commit_readiness_reviewer
import operator_review_inbox
import repo_state_dashboard
import validation_runbook_registry
import work_order_registry


NON_AUTHORIZATIONS = [
    "no approval",
    "no state change",
    "no persistence",
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

DENIED_ACTIONS = [
    "approve_gate",
    "change_state",
    "persist_decision",
    "execute_work",
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


def _decision(decision_id: str, title: str, status: str, reason: str, owner_action_required: bool, source: str) -> dict[str, Any]:
    return {
        "id": decision_id,
        "title": title,
        "status": status,
        "reason": reason,
        "owner_action_required": owner_action_required,
        "source": source,
        "actions_allowed": ["inspect", "copy", "choose_next_lane"],
        "actions_denied": DENIED_ACTIONS,
    }


def _blocked_gates(repo_state: dict[str, Any], readiness: dict[str, Any]) -> list[dict[str, str]]:
    gates: list[dict[str, str]] = []
    if not repo_state["worktree"]["clean"]:
        gates.append(
            {
                "id": "dirty-worktree",
                "label": "Worktree has uncommitted files",
                "reason": "Classify and validate candidate files before any commit decision.",
            }
        )
    if readiness["dist_status"]["present"] and not readiness["dist_status"]["complete_matching_triplet"]:
        gates.append(
            {
                "id": "dist-owner-review",
                "label": "Tracked dist output needs owner review",
                "reason": readiness["dist_status"]["decision"],
            }
        )
    if readiness["blockers"]:
        gates.append(
            {
                "id": "commit-readiness-blockers",
                "label": "Commit readiness blockers present",
                "reason": "; ".join(readiness["blockers"]),
            }
        )
    return gates


def _pending_decisions(repo_state: dict[str, Any], readiness: dict[str, Any], inbox: dict[str, Any]) -> list[dict[str, Any]]:
    decisions = [
        _decision(
            "next-lane",
            "Choose next governed lane",
            "pending-owner-choice",
            repo_state["next_valid_action"],
            True,
            "repo_state_dashboard",
        )
    ]
    if readiness["safe_to_commit"]:
        decisions.append(
            _decision(
                "commit-candidate",
                "Decide whether to authorize local commit",
                "pending-owner-choice",
                f"{readiness['candidate_count']} candidate files are ready for owner-gated local commit review.",
                True,
                "commit_readiness_reviewer",
            )
        )
    if inbox["total"] > 0:
        decisions.append(
            _decision(
                "review-queue-triage",
                "Triage generated operator review items",
                "preview-only",
                f"{inbox['total']} generated review items are available for inspection.",
                False,
                "operator_review_inbox",
            )
        )
    return decisions


def _allowed_next_actions(repo_state: dict[str, Any], readiness: dict[str, Any]) -> list[dict[str, str]]:
    actions = [
        {
            "id": "inspect-review-inbox",
            "label": "Inspect review inbox",
            "authority": "read-only",
            "reason": "Review generated handoff, readiness, validation, and next-gate summaries.",
        },
        {
            "id": "copy-handoff-packet",
            "label": "Copy handoff packet",
            "authority": "clipboard-only",
            "reason": "Export preview text without writing files.",
        },
    ]
    if repo_state["worktree"]["clean"]:
        actions.append(
            {
                "id": "authorize-next-wo",
                "label": "Authorize next work order lane",
                "authority": "owner-gated",
                "reason": "Worktree is clean; the next safe action is choosing a scoped local lane.",
            }
        )
    if readiness["safe_to_commit"]:
        actions.append(
            {
                "id": "owner-local-commit-decision",
                "label": "Owner local commit decision",
                "authority": "owner-gated",
                "reason": "Readiness reviewer found a local commit candidate, but this console cannot stage or commit.",
            }
        )
    return actions


def current_decision_gate_console() -> dict[str, Any]:
    repo_state = repo_state_dashboard.current_repo_state_dashboard()
    readiness = commit_readiness_reviewer.current_commit_readiness()
    inbox = operator_review_inbox.current_operator_review_inbox()
    runbooks = validation_runbook_registry.list_validation_runbooks()
    active_wos = work_order_registry.active_work_orders()
    blocked_gates = _blocked_gates(repo_state, readiness)
    pending_decisions = _pending_decisions(repo_state, readiness, inbox)
    recommended_lane = (
        "PHASE_5T: Owner Decision Ledger"
        if repo_state["worktree"]["clean"]
        else "Dirty Worktree Classification"
    )
    return {
        "ok": True,
        "mode": "preview-only-decision-gate-console",
        "generated_at": datetime.now().isoformat(timespec="seconds"),
        "repo": repo_state["repo"],
        "branch": repo_state["branch"],
        "head": repo_state["head"],
        "short_head": repo_state["short_head"],
        "worktree_clean": repo_state["worktree"]["clean"],
        "gate_status": "blocked" if blocked_gates else "owner-decision-needed",
        "pending_owner_decisions": pending_decisions,
        "blocked_gates": blocked_gates,
        "allowed_next_actions": _allowed_next_actions(repo_state, readiness),
        "denied_actions": DENIED_ACTIONS,
        "recommended_work_order_lane": recommended_lane,
        "next_valid_gate": repo_state["next_valid_action"],
        "review_item_count": inbox["total"],
        "validation_runbook_count": len(runbooks),
        "active_work_order_count": len(active_wos),
        "safety": {
            "preview_only": True,
            "would_approve_gate": False,
            "would_change_state": False,
            "would_persist": False,
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
