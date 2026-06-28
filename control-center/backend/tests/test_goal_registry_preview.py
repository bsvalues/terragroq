"""Tests for the Phase 5X metadata-only Goal Registry Preview."""

import sys
from pathlib import Path


_BACKEND = str(Path(__file__).resolve().parent.parent)
if _BACKEND not in sys.path:
    sys.path.insert(0, _BACKEND)

import goal_registry_preview


def test_goal_registry_lists_governed_goal_metadata():
    payload = goal_registry_preview.goal_registry_preview()

    assert payload["ok"] is True
    assert payload["mode"] == "metadata-only-goal-registry-preview"
    assert payload["total"] >= 1
    goal = payload["goals"][0]
    assert goal["id"] == "GOAL-WILLIAMOS-GOVERNED-OPERATOR-STACK"
    assert goal["objective"]
    assert goal["allowed_lanes"]
    assert goal["denied_lanes"]
    assert goal["success_criteria"]
    assert goal["next_gate"]


def test_goal_registry_denies_creation_persistence_execution_and_autonomy():
    payload = goal_registry_preview.goal_registry_preview()
    safety = payload["safety"]

    assert safety["metadata_only"] is True
    assert safety["preview_only"] is True
    assert safety["would_create_goal"] is False
    assert safety["would_persist"] is False
    assert safety["would_execute"] is False
    assert safety["scheduler_enabled"] is False
    assert safety["autonomy_enabled"] is False
    assert safety["mcp_activation"] is False
    assert safety["production_write"] is False


def test_each_goal_declares_denied_lanes_and_success_criteria():
    for goal in goal_registry_preview.list_goals():
        assert goal["denied_lanes"]
        assert goal["success_criteria"]
        assert goal["requires_owner_approval"] is True
        assert goal["would_execute"] is False


def test_goal_registry_api_returns_preview_only():
    import app
    from fastapi.testclient import TestClient

    client = TestClient(app.app)
    payload = client.get("/api/goal-registry").json()

    assert payload["ok"] is True
    assert payload["safety"]["would_create_goal"] is False
    assert payload["safety"]["would_execute"] is False
    assert payload["safety"]["autonomy_enabled"] is False
