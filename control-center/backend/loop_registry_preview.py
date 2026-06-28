"""Metadata-only Loop Registry Preview.

Phase 5Y exposes governed loop plan metadata for inspection. It does not start
loops, schedule loops, execute loops, write loop state, activate MCP, enable
autonomy, or write production data.
"""

from __future__ import annotations

from datetime import datetime
from typing import Any


DENIED_ACTIONS = [
    "start_loop",
    "schedule_loop",
    "execute_loop",
    "write_loop_state",
    "autonomous_continuation",
    "activate_mcp",
    "production_write",
    "push",
    "open_pr",
    "merge",
    "release",
    "tag",
]

LOOPS = [
    {
        "id": "LOOP-WILLIAMOS-P5X-TO-P6A-READINESS",
        "name": "Sequential governed local loop",
        "status": "preview",
        "mode": "sequential-governed-local-loop",
        "steps": [
            "confirm baseline and clean worktree",
            "implement allowed preview/metadata scope",
            "run focused backend tests",
            "run full backend suite",
            "run frontend build",
            "run safety and secret scans",
            "commit locally as one scoped lane",
        ],
        "stop_conditions": [
            "baseline mismatch",
            "dirty worktree before lane",
            "test or build failure",
            "forbidden execution/write/autonomy/MCP/scheduler behavior",
            "secret-like material found",
            "partial or suspicious dist output",
        ],
        "denied_actions": DENIED_ACTIONS,
        "evidence_expectations": [
            "focused test result",
            "full backend suite result",
            "frontend build result",
            "safety scan result",
            "secret scan result",
            "clean worktree confirmation",
        ],
        "human_approval_gates": [
            "owner authorizes queue before loop starts",
            "owner decides next valid gate after batch report",
            "push/PR/merge/release/tag remain separately owner-gated",
        ],
        "would_start_loop": False,
        "would_schedule_loop": False,
        "would_execute": False,
        "would_write_state": False,
        "autonomy_enabled": False,
        "mcp_activation": False,
        "production_write": False,
    }
]


def list_loops() -> list[dict[str, Any]]:
    return LOOPS


def loop_registry_preview() -> dict[str, Any]:
    return {
        "ok": True,
        "mode": "metadata-only-loop-registry-preview",
        "generated_at": datetime.now().isoformat(timespec="seconds"),
        "loops": list_loops(),
        "total": len(LOOPS),
        "denied_actions": DENIED_ACTIONS,
        "safety": {
            "metadata_only": True,
            "preview_only": True,
            "would_start_loop": False,
            "would_schedule_loop": False,
            "would_execute": False,
            "would_write_state": False,
            "autonomy_enabled": False,
            "mcp_activation": False,
            "production_write": False,
        },
    }
