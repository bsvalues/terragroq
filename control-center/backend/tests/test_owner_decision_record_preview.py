"""Tests for the Phase 5V preview-only Owner Decision Record composer."""

import sys
from pathlib import Path


_BACKEND = str(Path(__file__).resolve().parent.parent)
if _BACKEND not in sys.path:
    sys.path.insert(0, _BACKEND)

import owner_decision_record_preview


def test_owner_decision_record_preview_composes_records():
    preview = owner_decision_record_preview.current_owner_decision_record_preview()

    assert preview["ok"] is True
    assert preview["mode"] == "preview-only-owner-decision-record"
    assert preview["record_count"] >= 1
    assert preview["record_statuses"]
    assert preview["recommended_work_order_lane"]
    assert preview["next_valid_gate"]


def test_owner_decision_record_preview_denies_writes_grants_and_execution():
    preview = owner_decision_record_preview.current_owner_decision_record_preview()
    safety = preview["safety"]

    assert safety["preview_only"] is True
    assert safety["would_write_decision_record"] is False
    assert safety["would_grant_authority"] is False
    assert safety["would_record_approval"] is False
    assert safety["would_change_state"] is False
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


def test_decision_records_are_inspect_copy_only():
    preview = owner_decision_record_preview.current_owner_decision_record_preview()

    for record in preview["records"]:
        assert record["would_write_record"] is False
        assert record["would_grant_authority"] is False
        assert record["actions_allowed"] == ["inspect", "copy"]
        assert "write_decision_record" in record["actions_denied"]
        assert "grant_authority" in record["actions_denied"]


def test_owner_decision_record_preview_api_returns_preview_only():
    import app
    from fastapi.testclient import TestClient

    client = TestClient(app.app)
    payload = client.get("/api/owner-decision-record-preview").json()

    assert payload["ok"] is True
    assert payload["mode"] == "preview-only-owner-decision-record"
    assert payload["safety"]["would_write_decision_record"] is False
    assert payload["safety"]["would_grant_authority"] is False
    assert payload["safety"]["would_execute_commands"] is False
    assert payload["denied_actions"]
