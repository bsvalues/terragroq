"""Tests for the Phase 5R preview-only Operator Review Inbox."""

import sys
from pathlib import Path


_BACKEND = str(Path(__file__).resolve().parent.parent)
if _BACKEND not in sys.path:
    sys.path.insert(0, _BACKEND)

import operator_review_inbox


def test_operator_review_inbox_contains_expected_preview_items():
    inbox = operator_review_inbox.current_operator_review_inbox()
    kinds = {item["kind"] for item in inbox["items"]}

    assert inbox["ok"] is True
    assert inbox["mode"] == "preview-only-operator-review-inbox"
    assert "handoff_packet" in kinds
    assert "commit_readiness" in kinds
    assert "validation_summary" in kinds
    assert "next_gate" in kinds


def test_operator_review_inbox_denies_persistence_approval_execution_and_remote_actions():
    inbox = operator_review_inbox.current_operator_review_inbox()
    safety = inbox["safety"]

    assert safety["read_only_inbox"] is True
    assert safety["would_persist"] is False
    assert safety["would_auto_approve"] is False
    assert safety["would_execute"] is False
    assert safety["would_execute_validators"] is False
    assert safety["would_stage"] is False
    assert safety["would_commit"] is False
    assert safety["would_push"] is False
    assert safety["scheduler_enabled"] is False
    assert safety["autonomy_enabled"] is False
    assert safety["mcp_activation"] is False
    assert safety["production_write"] is False


def test_operator_review_items_allow_only_inspect_and_copy():
    inbox = operator_review_inbox.current_operator_review_inbox()

    for item in inbox["items"]:
        assert item["actions_allowed"] == ["inspect", "copy"]
        assert "approve" in item["actions_denied"]
        assert "execute" in item["actions_denied"]
        assert "persist" in item["actions_denied"]


def test_operator_review_inbox_api_returns_preview_only():
    import app
    from fastapi.testclient import TestClient

    client = TestClient(app.app)
    payload = client.get("/api/operator-review-inbox").json()

    assert payload["ok"] is True
    assert payload["queue_status"] == "preview-only"
    assert payload["safety"]["would_persist"] is False
    assert payload["safety"]["would_auto_approve"] is False
    assert payload["total"] >= 4
