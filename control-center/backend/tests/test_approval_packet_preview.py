"""Tests for the Phase 5W preview-only Approval Packet composer."""

import sys
from pathlib import Path


_BACKEND = str(Path(__file__).resolve().parent.parent)
if _BACKEND not in sys.path:
    sys.path.insert(0, _BACKEND)

import approval_packet_preview


def test_approval_packet_preview_composes_packets():
    preview = approval_packet_preview.current_approval_packet_preview()

    assert preview["ok"] is True
    assert preview["mode"] == "preview-only-approval-packet"
    assert preview["packet_count"] >= 1
    assert preview["recommended_work_order_lane"]
    assert preview["next_valid_gate"]
    assert "missing_authorities" in preview


def test_approval_packet_preview_denies_approval_grants_writes_and_execution():
    preview = approval_packet_preview.current_approval_packet_preview()
    safety = preview["safety"]

    assert safety["preview_only"] is True
    assert safety["would_approve_packet"] is False
    assert safety["would_grant_authority"] is False
    assert safety["would_write_decision_record"] is False
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


def test_approval_packets_are_inspect_copy_only():
    preview = approval_packet_preview.current_approval_packet_preview()

    for packet in preview["packets"]:
        assert packet["would_approve"] is False
        assert packet["would_grant_authority"] is False
        assert packet["would_write_record"] is False
        assert packet["actions_allowed"] == ["inspect", "copy"]
        assert "APPROVAL_STATUS: NOT_GRANTED" in packet["approval_text"]
        assert "approve_packet" in packet["actions_denied"]


def test_approval_packet_preview_api_returns_preview_only():
    import app
    from fastapi.testclient import TestClient

    client = TestClient(app.app)
    payload = client.get("/api/approval-packet-preview").json()

    assert payload["ok"] is True
    assert payload["mode"] == "preview-only-approval-packet"
    assert payload["safety"]["would_approve_packet"] is False
    assert payload["safety"]["would_grant_authority"] is False
    assert payload["safety"]["would_execute_commands"] is False
    assert payload["denied_actions"]
