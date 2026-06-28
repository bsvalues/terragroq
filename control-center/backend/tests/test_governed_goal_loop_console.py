"""Tests for the Phase 6C preview-only Governed Goal/Loop Console."""

import sys
from pathlib import Path


_BACKEND = str(Path(__file__).resolve().parent.parent)
if _BACKEND not in sys.path:
    sys.path.insert(0, _BACKEND)

import governed_goal_loop_console


def test_governed_goal_loop_console_composes_required_surfaces():
    console = governed_goal_loop_console.current_governed_goal_loop_console()

    assert console["ok"] is True
    assert console["mode"] == "preview-only-governed-goal-loop-console"
    assert console["goal_registry"]["goals"]
    assert console["loop_registry"]["loops"]
    assert console["readiness"]["decision"]
    assert console["authority_ledger"]["entries"]
    assert console["approval_packets"]["packets"]
    assert console["action_router"]["routes"]
    assert console["next_valid_gate"]


def test_governed_goal_loop_console_denies_writes_execution_scheduling_and_autonomy():
    safety = governed_goal_loop_console.current_governed_goal_loop_console()["safety"]

    assert safety["preview_only"] is True
    assert safety["would_approve"] is False
    assert safety["would_execute"] is False
    assert safety["would_schedule"] is False
    assert safety["would_write_state"] is False
    assert safety["would_grant_authority"] is False
    assert safety["would_record_approval"] is False
    assert safety["would_start_loop"] is False
    assert safety["would_create_goal"] is False
    assert safety["autonomy_enabled"] is False
    assert safety["mcp_activation"] is False
    assert safety["production_write"] is False


def test_governed_goal_loop_console_summary_counts_surfaces():
    summary = governed_goal_loop_console.current_governed_goal_loop_console()["summary"]

    assert summary["goals"] >= 1
    assert summary["loops"] >= 1
    assert summary["approval_packets"] >= 1
    assert summary["routes"] >= 1


def test_governed_goal_loop_console_api_returns_preview_only():
    import app
    from fastapi.testclient import TestClient

    client = TestClient(app.app)
    payload = client.get("/api/governed-goal-loop-console").json()

    assert payload["ok"] is True
    assert payload["safety"]["would_execute"] is False
    assert payload["safety"]["would_schedule"] is False
    assert payload["safety"]["would_write_state"] is False
