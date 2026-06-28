"""Tests for the Phase 5Z preview-only Goal/Loop Readiness Reviewer."""

import sys
from pathlib import Path


_BACKEND = str(Path(__file__).resolve().parent.parent)
if _BACKEND not in sys.path:
    sys.path.insert(0, _BACKEND)

import goal_loop_readiness_reviewer


def test_goal_loop_readiness_returns_owner_review_decision():
    review = goal_loop_readiness_reviewer.current_goal_loop_readiness()

    assert review["ok"] is True
    assert review["mode"] == "preview-only-goal-loop-readiness-reviewer"
    assert review["decision"] in {"SAFE_FOR_OWNER_REVIEW", "NOT_SAFE_FOR_OWNER_REVIEW"}
    assert review["goals_reviewed"] >= 1
    assert review["loops_reviewed"] >= 1
    assert "next_valid_gate" in review


def test_goal_loop_readiness_denies_approval_execution_scheduler_and_mcp():
    safety = goal_loop_readiness_reviewer.current_goal_loop_readiness()["safety"]

    assert safety["preview_only"] is True
    assert safety["would_approve_goal"] is False
    assert safety["would_start_loop"] is False
    assert safety["would_execute_commands"] is False
    assert safety["would_execute_validators"] is False
    assert safety["scheduler_enabled"] is False
    assert safety["autonomy_enabled"] is False
    assert safety["mcp_activation"] is False
    assert safety["production_write"] is False


def test_goal_loop_readiness_exposes_validators_and_denied_actions():
    review = goal_loop_readiness_reviewer.current_goal_loop_readiness()

    assert review["required_validators"]
    assert "approve_goal" in review["denied_actions"]
    assert "start_loop" in review["denied_actions"]
    assert "execute_commands" in review["denied_actions"]


def test_goal_loop_readiness_api_returns_preview_only():
    import app
    from fastapi.testclient import TestClient

    client = TestClient(app.app)
    payload = client.get("/api/goal-loop-readiness").json()

    assert payload["ok"] is True
    assert payload["safety"]["would_approve_goal"] is False
    assert payload["safety"]["would_start_loop"] is False
    assert payload["safety"]["would_execute_commands"] is False
