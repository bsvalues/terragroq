"""Tests for the Phase 5Q preview-only Local Handoff Packet Exporter."""

import sys
from pathlib import Path


_BACKEND = str(Path(__file__).resolve().parent.parent)
if _BACKEND not in sys.path:
    sys.path.insert(0, _BACKEND)

import handoff_packet_exporter


def _repo_state():
    return {
        "repo": "C:\\repo",
        "branch": "copilot-phase1",
        "short_head": "1a4e766",
        "worktree": {"clean": True},
        "next_valid_action": "Owner decision on next scoped local work order.",
    }


def _evidence_pack():
    return {
        "recent_commits": ["1a4e766 feat(copilot): add commit readiness reviewer"],
    }


def _readiness(safe=False):
    return {
        "safe_to_commit": safe,
        "decision": "SAFE_TO_COMMIT_CANDIDATE" if safe else "NOT_SAFE_TO_COMMIT",
        "candidate_count": 0 if not safe else 2,
        "dist_status": {"decision": "ok"},
        "required_validators": [{"id": "scope-safety", "commands": ["git status --short"]}],
        "blockers": [] if safe else ["No candidate files are present."],
    }


def test_handoff_packet_composes_existing_read_only_surfaces(monkeypatch):
    monkeypatch.setattr(handoff_packet_exporter.repo_state_dashboard, "current_repo_state_dashboard", _repo_state)
    monkeypatch.setattr(handoff_packet_exporter.evidence_pack_generator, "current_evidence_packet", _evidence_pack)
    monkeypatch.setattr(handoff_packet_exporter.commit_readiness_reviewer, "current_commit_readiness", lambda: _readiness())
    monkeypatch.setattr(handoff_packet_exporter.validation_runbook_registry, "list_validation_runbooks", lambda: [{"id": "scope-safety", "name": "Scope Review"}])
    monkeypatch.setattr(handoff_packet_exporter.work_order_registry, "active_work_orders", lambda: [{"wo_id": "WO-1", "status": "active"}])

    packet = handoff_packet_exporter.current_handoff_packet()

    assert packet["ok"] is True
    assert packet["mode"] == "preview-only-local-handoff-packet-exporter"
    assert packet["repo_state"]["short_head"] == "1a4e766"
    assert packet["active_work_orders"][0]["wo_id"] == "WO-1"
    assert "RESULT: PASS" in packet["packet_text"]


def test_handoff_packet_safety_denies_writes_execution_and_remote_actions():
    packet = handoff_packet_exporter.current_handoff_packet()
    safety = packet["safety"]

    assert safety["read_only_exporter"] is True
    assert safety["would_write_files"] is False
    assert safety["would_stage"] is False
    assert safety["would_commit"] is False
    assert safety["would_push"] is False
    assert safety["would_execute_validators"] is False
    assert safety["scheduler_enabled"] is False
    assert safety["autonomy_enabled"] is False
    assert safety["mcp_activation"] is False
    assert safety["production_write"] is False


def test_packet_text_includes_required_sections(monkeypatch):
    monkeypatch.setattr(handoff_packet_exporter.repo_state_dashboard, "current_repo_state_dashboard", _repo_state)
    monkeypatch.setattr(handoff_packet_exporter.evidence_pack_generator, "current_evidence_packet", _evidence_pack)
    monkeypatch.setattr(handoff_packet_exporter.commit_readiness_reviewer, "current_commit_readiness", lambda: _readiness(safe=True))
    monkeypatch.setattr(handoff_packet_exporter.validation_runbook_registry, "list_validation_runbooks", lambda: [{"id": "backend-full", "name": "Full Backend Suite"}])
    monkeypatch.setattr(handoff_packet_exporter.work_order_registry, "active_work_orders", lambda: [])

    text = handoff_packet_exporter.current_handoff_packet()["packet_text"]

    assert "COMMIT_READINESS:" in text
    assert "SAFE_TO_COMMIT_CANDIDATE: YES" in text
    assert "REQUIRED_VALIDATORS:" in text
    assert "NON_AUTHORIZATIONS_PRESERVED:" in text


def test_handoff_packet_api_returns_preview_only():
    import app
    from fastapi.testclient import TestClient

    client = TestClient(app.app)
    payload = client.get("/api/handoff-packet").json()

    assert payload["ok"] is True
    assert payload["mode"] == "preview-only-local-handoff-packet-exporter"
    assert payload["safety"]["would_write_files"] is False
    assert payload["safety"]["would_execute_validators"] is False
    assert "packet_text" in payload
