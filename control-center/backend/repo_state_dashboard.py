"""Read-only Repo State Dashboard.

Phase 5M summarizes the current repository posture for the Control Center. It
composes the Phase 5L Evidence Pack snapshot and static governance gates; it
does not run validators, write files, mutate git state, or enable automation.
"""

from __future__ import annotations

from pathlib import Path
from typing import Any

import evidence_pack_generator


REPO_ROOT = Path(__file__).resolve().parents[2]
REPORTS_DIR = REPO_ROOT / "WilliamOS" / "95_ReleaseGovernance" / "reports"

ACTIVE_GATES = [
    {
        "id": "clean-worktree",
        "label": "Clean worktree",
        "command": "git status --short",
        "authority": "read-only inspection",
        "required_for": ["commit_candidate", "tag_candidate", "release_candidate"],
    },
    {
        "id": "backend-tests",
        "label": "Backend tests",
        "command": "python -m pytest control-center/backend/tests -q",
        "authority": "local validation only",
        "required_for": ["backend_change", "commit_candidate"],
    },
    {
        "id": "frontend-build",
        "label": "Frontend build",
        "command": "cd control-center/frontend && npm run build",
        "authority": "local validation only",
        "required_for": ["frontend_change", "dist_sync"],
    },
    {
        "id": "owner-decision",
        "label": "Owner decision",
        "command": "n/a",
        "authority": "owner-gated",
        "required_for": ["commit", "push", "PR", "merge", "release"],
    },
]

NON_AUTHORIZATIONS = [
    "no push",
    "no PR creation",
    "no merge",
    "no release",
    "no tag",
    "no pnpm retry/install",
    "no MCP activation",
    "no autonomy",
    "no scheduler",
    "no production/data write",
    "no external agent execution",
]


def _validation_reports(limit: int = 6) -> list[dict[str, str]]:
    if not REPORTS_DIR.exists():
        return []
    reports = sorted(REPORTS_DIR.glob("Phase *.md"), key=lambda path: path.stat().st_mtime, reverse=True)
    return [
        {
            "name": path.name,
            "path": str(path.relative_to(REPO_ROOT)),
            "source": "release-governance-report",
        }
        for path in reports[:limit]
    ]


def _gate_status(packet: dict[str, Any]) -> str:
    if not packet.get("worktree_clean"):
        return "blocked-dirty-worktree"
    safety = packet.get("safety", {})
    unsafe = any(
        safety.get(flag)
        for flag in [
            "would_execute_validators",
            "would_write_files",
            "autonomy_enabled",
            "mcp_activation",
            "production_write",
            "push_pr_merge_release",
        ]
    )
    if unsafe:
        return "blocked-safety-review"
    return "ready-for-owner-work-order"


def current_repo_state_dashboard() -> dict[str, Any]:
    packet = evidence_pack_generator.current_evidence_packet()
    gate_status = _gate_status(packet)
    next_action = (
        "Classify dirty work before any staging or commit."
        if gate_status == "blocked-dirty-worktree"
        else "Owner decision on next scoped local work order."
    )
    return {
        "ok": True,
        "mode": "read-only-repo-state-dashboard-preview",
        "repo": packet["repo"],
        "branch": packet["branch"],
        "head": packet["head"],
        "short_head": packet["short_head"],
        "baseline": {
            "short_head": packet["short_head"],
            "source": "current git HEAD",
            "worktree_clean": packet["worktree_clean"],
        },
        "worktree": {
            "clean": packet["worktree_clean"],
            "status_lines": packet["git_status"],
            "dirty_files": packet["dirty_files"],
        },
        "recent_commits": packet["recent_commits"],
        "validation_history": {
            "latest_reports": _validation_reports(),
            "declared_validators": packet["validators"],
            "test_result": packet["test_result"],
            "build_result": packet["build_result"],
            "validators_run_by_dashboard": False,
        },
        "active_gates": ACTIVE_GATES,
        "gate_status": gate_status,
        "next_valid_action": next_action,
        "safety": {
            "read_only_dashboard": True,
            "would_execute_validators": False,
            "would_write_files": False,
            "autonomy_enabled": False,
            "mcp_activation": False,
            "scheduler_enabled": False,
            "production_write": False,
            "external_agent_execution": False,
            "push_pr_merge_release": False,
        },
        "non_authorizations_preserved": NON_AUTHORIZATIONS,
    }
