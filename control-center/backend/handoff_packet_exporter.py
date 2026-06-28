"""Preview-only Local Handoff Packet Exporter.

Phase 5Q composes operator handoff text from existing read-only governance
surfaces. It does not write packet files, run validators, stage, commit, push,
schedule work, activate MCP, enable autonomy, or perform production writes.
"""

from __future__ import annotations

from datetime import datetime
from typing import Any

import commit_readiness_reviewer
import evidence_pack_generator
import repo_state_dashboard
import validation_runbook_registry
import work_order_registry


NON_AUTHORIZATIONS = [
    "no file writes",
    "no git add",
    "no commit",
    "no push",
    "no PR creation/update",
    "no merge",
    "no release",
    "no tag",
    "no pnpm retry/install",
    "no validator execution",
    "no scheduler",
    "no autonomy",
    "no MCP activation",
    "no production/data write",
    "no external agent execution",
]


def _result_from_readiness(readiness: dict[str, Any]) -> str:
    if readiness["safe_to_commit"]:
        return "PASS"
    if readiness["candidate_count"] == 0:
        return "PASS"
    return "PARTIAL"


def _packet_text(payload: dict[str, Any]) -> str:
    readiness = payload["commit_readiness"]
    repo = payload["repo_state"]
    evidence = payload["evidence_pack"]
    runbooks = payload["validation_runbooks"][:6]
    active_wos = payload["active_work_orders"]
    blockers = readiness["blockers"] or ["NONE"]
    lines = [
        f"RESULT: {payload['result']}",
        f"REPO: {repo['repo']}",
        f"BRANCH: {repo['branch']}",
        f"HEAD: {repo['short_head']}",
        f"WORKTREE_CLEAN: {str(repo['worktree']['clean']).upper()}",
        "",
        "COMMIT_READINESS:",
        f"SAFE_TO_COMMIT_CANDIDATE: {'YES' if readiness['safe_to_commit'] else 'NO'}",
        f"DECISION: {readiness['decision']}",
        f"CANDIDATE_FILES: {readiness['candidate_count']}",
        f"DIST_STATUS: {readiness['dist_status']['decision']}",
        f"VALIDATORS_RUN_BY_EXPORTER: {str(payload['safety']['would_execute_validators']).upper()}",
        "",
        "REQUIRED_VALIDATORS:",
        *[f"- {validator['id']}: {validator['commands'][0]}" for validator in readiness["required_validators"]],
        "",
        "VALIDATION_RUNBOOKS_AVAILABLE:",
        *[f"- {runbook['id']}: {runbook['name']}" for runbook in runbooks],
        "",
        "ACTIVE_WORK_ORDERS:",
        *[f"- {wo['wo_id']} [{wo['status']}]" for wo in active_wos],
        "",
        "RECENT_COMMITS:",
        *[f"- {commit}" for commit in evidence["recent_commits"]],
        "",
        "BLOCKERS:",
        *[f"- {blocker}" for blocker in blockers],
        "",
        "NEXT_VALID_GATE:",
        repo["next_valid_action"],
        "",
        "NON_AUTHORIZATIONS_PRESERVED:",
        *[f"- {item.upper()}" for item in NON_AUTHORIZATIONS],
    ]
    return "\n".join(lines)


def current_handoff_packet() -> dict[str, Any]:
    repo_state = repo_state_dashboard.current_repo_state_dashboard()
    evidence_pack = evidence_pack_generator.current_evidence_packet()
    readiness = commit_readiness_reviewer.current_commit_readiness()
    runbooks = validation_runbook_registry.list_validation_runbooks()
    active_wos = work_order_registry.active_work_orders()
    payload = {
        "ok": True,
        "mode": "preview-only-local-handoff-packet-exporter",
        "generated_at": datetime.now().isoformat(timespec="seconds"),
        "result": _result_from_readiness(readiness),
        "repo_state": repo_state,
        "evidence_pack": evidence_pack,
        "commit_readiness": readiness,
        "validation_runbooks": runbooks,
        "active_work_orders": active_wos,
        "next_valid_gate": repo_state["next_valid_action"],
        "safety": {
            "read_only_exporter": True,
            "would_write_files": False,
            "would_stage": False,
            "would_commit": False,
            "would_push": False,
            "would_execute_validators": False,
            "scheduler_enabled": False,
            "autonomy_enabled": False,
            "mcp_activation": False,
            "production_write": False,
            "external_agent_execution": False,
        },
        "non_authorizations_preserved": NON_AUTHORIZATIONS,
    }
    payload["packet_text"] = _packet_text(payload)
    return payload
