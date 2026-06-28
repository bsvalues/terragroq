"""Tests for the Phase 5S preview-only Decision Gate Console."""

import sys
from pathlib import Path


_BACKEND = str(Path(__file__).resolve().parent.parent)
if _BACKEND not in sys.path:
    sys.path.insert(0, _BACKEND)

import decision_gate_console


def test_decision_gate_console_reports_pending_owner_decisions():
    console = decision_gate_console.current_decision_gate_console()
    decision_ids = {decision["id"] for decision in console["pending_owner_decisions"]}

    assert console["ok"] is True
    assert console["mode"] == "preview-only-decision-gate-console"
    assert "next-lane" in decision_ids
    assert console["recommended_work_order_lane"]
    assert console["next_valid_gate"]


def test_decision_gate_console_denies_state_changes_execution_and_remote_actions():
    console = decision_gate_console.current_decision_gate_console()
    safety = console["safety"]

    assert safety["preview_only"] is True
    assert safety["would_approve_gate"] is False
    assert safety["would_change_state"] is False
    assert safety["would_persist"] is False
    assert safety["would_execute"] is False
    assert safety["would_execute_validators"] is False
    assert safety["would_stage"] is False
    assert safety["would_commit"] is False
    assert safety["would_push"] is False
    assert safety["scheduler_enabled"] is False
    assert safety["autonomy_enabled"] is False
    assert safety["mcp_activation"] is False
    assert safety["production_write"] is False


def test_decisions_allow_only_inspect_copy_and_next_lane_choice():
    console = decision_gate_console.current_decision_gate_console()

    for decision in console["pending_owner_decisions"]:
        assert decision["actions_allowed"] == ["inspect", "copy", "choose_next_lane"]
        assert "approve_gate" in decision["actions_denied"]
        assert "execute_work" in decision["actions_denied"]
        assert "persist_decision" in decision["actions_denied"]


def test_decision_gate_console_api_returns_preview_only():
    import app
    from fastapi.testclient import TestClient

    client = TestClient(app.app)
    payload = client.get("/api/decision-gate-console").json()

    assert payload["ok"] is True
    assert payload["mode"] == "preview-only-decision-gate-console"
    assert payload["safety"]["would_approve_gate"] is False
    assert payload["safety"]["would_change_state"] is False
    assert payload["safety"]["would_execute"] is False
    assert payload["denied_actions"]
