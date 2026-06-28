"""Tests for the Phase 6B non-executing /loop command preview."""

import sys
from pathlib import Path


_BACKEND = str(Path(__file__).resolve().parent.parent)
if _BACKEND not in sys.path:
    sys.path.insert(0, _BACKEND)

import loop_command_preview


def test_loop_command_preview_allows_request_with_stop_condition():
    payload = loop_command_preview.loop_command_preview("Run validations until tests pass then stop")

    assert payload["ok"] is True
    assert payload["mode"] == "preview-only-loop-command"
    assert payload["preview"]["decision"] == "ALLOWED_FOR_OWNER_REVIEW"
    assert payload["preview"]["required_authority"] == "owner-loop-review"


def test_loop_command_preview_blocks_missing_stop_or_denied_language():
    missing_stop = loop_command_preview.loop_command_preview("Run validations")
    unsafe = loop_command_preview.loop_command_preview("schedule autonomous loop forever with mcp")

    assert missing_stop["preview"]["decision"] == "BLOCKED"
    assert unsafe["preview"]["decision"] == "BLOCKED"
    assert unsafe["preview"]["blocked_reasons"]


def test_loop_command_preview_never_starts_schedules_executes_or_continues():
    safety = loop_command_preview.loop_command_preview("until done stop")["safety"]

    assert safety["would_start_loop"] is False
    assert safety["would_schedule_loop"] is False
    assert safety["would_execute_loop"] is False
    assert safety["would_write_loop_state"] is False
    assert safety["autonomous_continuation"] is False
    assert safety["mcp_activation"] is False
    assert safety["production_write"] is False


def test_loop_command_preview_api_is_get_only_preview():
    import app
    from fastapi.testclient import TestClient

    client = TestClient(app.app)
    payload = client.get("/api/loop-command-preview", params={"request": "Run local checks until pass then stop"}).json()

    assert payload["ok"] is True
    assert payload["safety"]["would_start_loop"] is False
    assert payload["safety"]["would_execute_loop"] is False
