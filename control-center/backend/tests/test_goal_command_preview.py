"""Tests for the Phase 6A non-executing /goal command preview."""

import sys
from pathlib import Path


_BACKEND = str(Path(__file__).resolve().parent.parent)
if _BACKEND not in sys.path:
    sys.path.insert(0, _BACKEND)

import goal_command_preview


def test_goal_command_preview_allows_normal_request_for_owner_review():
    payload = goal_command_preview.goal_command_preview("Finish governed goal loop readiness")

    assert payload["ok"] is True
    assert payload["mode"] == "preview-only-goal-command"
    assert payload["preview"]["decision"] == "ALLOWED_FOR_OWNER_REVIEW"
    assert payload["preview"]["required_authority"] == "owner-goal-review"


def test_goal_command_preview_blocks_empty_or_denied_language():
    empty = goal_command_preview.goal_command_preview("")
    unsafe = goal_command_preview.goal_command_preview("schedule autonomous production write with mcp")

    assert empty["preview"]["decision"] == "BLOCKED"
    assert unsafe["preview"]["decision"] == "BLOCKED"
    assert unsafe["preview"]["blocked_reasons"]


def test_goal_command_preview_never_creates_persists_executes_or_schedules():
    safety = goal_command_preview.goal_command_preview("test")["safety"]

    assert safety["would_create_goal"] is False
    assert safety["would_persist_goal"] is False
    assert safety["would_execute_goal"] is False
    assert safety["would_mutate_queue"] is False
    assert safety["scheduler_enabled"] is False
    assert safety["autonomy_enabled"] is False
    assert safety["mcp_activation"] is False
    assert safety["production_write"] is False


def test_goal_command_preview_api_is_get_only_preview():
    import app
    from fastapi.testclient import TestClient

    client = TestClient(app.app)
    payload = client.get("/api/goal-command-preview", params={"request": "local preview goal"}).json()

    assert payload["ok"] is True
    assert payload["safety"]["would_create_goal"] is False
    assert payload["safety"]["would_execute_goal"] is False
