"""Tests for the Phase 5T preview-only Operator Action Router."""

import sys
from pathlib import Path


_BACKEND = str(Path(__file__).resolve().parent.parent)
if _BACKEND not in sys.path:
    sys.path.insert(0, _BACKEND)

import operator_action_router_preview


def test_operator_action_router_maps_decisions_to_preview_routes():
    router = operator_action_router_preview.current_operator_action_router_preview()
    action_types = {route["action_type"] for route in router["routes"]}

    assert router["ok"] is True
    assert router["mode"] == "preview-only-operator-action-router"
    assert router["route_count"] >= 1
    assert action_types <= set(router["action_types"])
    assert router["recommended_work_order_lane"]
    assert router["next_valid_gate"]


def test_operator_action_router_denies_execution_state_changes_and_remote_actions():
    router = operator_action_router_preview.current_operator_action_router_preview()
    safety = router["safety"]

    assert safety["preview_only"] is True
    assert safety["would_perform_action"] is False
    assert safety["would_approve_gate"] is False
    assert safety["would_write_state"] is False
    assert safety["would_execute_commands"] is False
    assert safety["would_execute_validators"] is False
    assert safety["would_stage"] is False
    assert safety["would_commit"] is False
    assert safety["would_push"] is False
    assert safety["would_open_pr"] is False
    assert safety["scheduler_enabled"] is False
    assert safety["autonomy_enabled"] is False
    assert safety["mcp_activation"] is False
    assert safety["production_write"] is False


def test_routes_allow_only_inspect_and_copy():
    router = operator_action_router_preview.current_operator_action_router_preview()

    for route in router["routes"]:
        assert route["would_perform"] is False
        assert route["actions_allowed"] == ["inspect", "copy"]
        assert "perform_action" in route["actions_denied"]
        assert "execute_commands" in route["actions_denied"]
        assert "approve_gate" in route["actions_denied"]


def test_operator_action_router_api_returns_preview_only():
    import app
    from fastapi.testclient import TestClient

    client = TestClient(app.app)
    payload = client.get("/api/operator-action-router").json()

    assert payload["ok"] is True
    assert payload["mode"] == "preview-only-operator-action-router"
    assert payload["safety"]["would_perform_action"] is False
    assert payload["safety"]["would_write_state"] is False
    assert payload["safety"]["would_execute_commands"] is False
    assert payload["denied_actions"]
