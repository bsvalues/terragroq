"""Tests for the Phase 5U preview-only Authority Ledger."""

import sys
from pathlib import Path


_BACKEND = str(Path(__file__).resolve().parent.parent)
if _BACKEND not in sys.path:
    sys.path.insert(0, _BACKEND)

import authority_ledger_preview


def test_authority_ledger_reports_entries_and_missing_authority():
    ledger = authority_ledger_preview.current_authority_ledger_preview()

    assert ledger["ok"] is True
    assert ledger["mode"] == "preview-only-authority-ledger"
    assert ledger["entry_count"] >= 1
    assert "grantable_authorities" in ledger
    assert "missing_authorities" in ledger
    assert ledger["recommended_work_order_lane"]
    assert ledger["next_valid_gate"]


def test_authority_ledger_denies_grants_state_changes_and_execution():
    ledger = authority_ledger_preview.current_authority_ledger_preview()
    safety = ledger["safety"]

    assert safety["preview_only"] is True
    assert safety["would_grant_authority"] is False
    assert safety["would_record_approval"] is False
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


def test_authority_entries_do_not_grant_or_record_approval():
    ledger = authority_ledger_preview.current_authority_ledger_preview()

    for entry in ledger["entries"]:
        assert entry["would_grant"] is False
        assert entry["would_record_approval"] is False
        assert "grant_authority" in entry["actions_denied"]
        assert "record_approval" in entry["actions_denied"]


def test_authority_ledger_api_returns_preview_only():
    import app
    from fastapi.testclient import TestClient

    client = TestClient(app.app)
    payload = client.get("/api/authority-ledger").json()

    assert payload["ok"] is True
    assert payload["mode"] == "preview-only-authority-ledger"
    assert payload["safety"]["would_grant_authority"] is False
    assert payload["safety"]["would_record_approval"] is False
    assert payload["safety"]["would_write_state"] is False
    assert payload["denied_actions"]
