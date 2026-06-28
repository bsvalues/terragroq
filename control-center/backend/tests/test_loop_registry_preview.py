"""Tests for the Phase 5Y metadata-only Loop Registry Preview."""

import sys
from pathlib import Path


_BACKEND = str(Path(__file__).resolve().parent.parent)
if _BACKEND not in sys.path:
    sys.path.insert(0, _BACKEND)

import loop_registry_preview


def test_loop_registry_lists_loop_metadata():
    payload = loop_registry_preview.loop_registry_preview()
    loop = payload["loops"][0]

    assert payload["ok"] is True
    assert payload["mode"] == "metadata-only-loop-registry-preview"
    assert loop["id"] == "LOOP-WILLIAMOS-P5X-TO-P6A-READINESS"
    assert loop["steps"]
    assert loop["stop_conditions"]
    assert loop["evidence_expectations"]
    assert loop["human_approval_gates"]


def test_loop_registry_denies_start_schedule_execution_and_state_write():
    safety = loop_registry_preview.loop_registry_preview()["safety"]

    assert safety["metadata_only"] is True
    assert safety["preview_only"] is True
    assert safety["would_start_loop"] is False
    assert safety["would_schedule_loop"] is False
    assert safety["would_execute"] is False
    assert safety["would_write_state"] is False
    assert safety["autonomy_enabled"] is False
    assert safety["mcp_activation"] is False
    assert safety["production_write"] is False


def test_each_loop_declares_stop_conditions_and_denied_actions():
    for loop in loop_registry_preview.list_loops():
        assert loop["stop_conditions"]
        assert "execute_loop" in loop["denied_actions"]
        assert loop["would_execute"] is False
        assert loop["would_write_state"] is False


def test_loop_registry_api_returns_preview_only():
    import app
    from fastapi.testclient import TestClient

    client = TestClient(app.app)
    payload = client.get("/api/loop-registry").json()

    assert payload["ok"] is True
    assert payload["safety"]["would_start_loop"] is False
    assert payload["safety"]["would_execute"] is False
    assert payload["safety"]["autonomy_enabled"] is False
