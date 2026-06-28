"""Tests for the Phase 5L read-only Evidence Pack Generator."""

import sys
from pathlib import Path


_BACKEND = str(Path(__file__).resolve().parent.parent)
if _BACKEND not in sys.path:
    sys.path.insert(0, _BACKEND)

import evidence_pack_generator


def test_evidence_packet_contains_repo_truth(monkeypatch):
    monkeypatch.setattr(evidence_pack_generator, "_git_lines", lambda args: [] if args[:2] == ["status", "--short"] else ["e63dda5 commit"])
    monkeypatch.setattr(
        evidence_pack_generator,
        "_git_value",
        lambda args, fallback="unknown": {
            ("branch", "--show-current"): "copilot-phase1",
            ("rev-parse", "HEAD"): "e63dda510ac0f90d3c94fe43eefdab339a529fec",
            ("rev-parse", "--short", "HEAD"): "e63dda5",
        }.get(tuple(args), fallback),
    )

    packet = evidence_pack_generator.current_evidence_packet()

    assert packet["ok"] is True
    assert packet["mode"] == "read-only-evidence-pack-preview"
    assert packet["branch"] == "copilot-phase1"
    assert packet["short_head"] == "e63dda5"
    assert packet["worktree_clean"] is True


def test_dirty_status_is_classified_without_mutation(monkeypatch):
    monkeypatch.setattr(
        evidence_pack_generator,
        "_git_lines",
        lambda args: [" M control-center/backend/app.py", "?? scratch.md", "D  old.js"] if args[:2] == ["status", "--short"] else [],
    )
    monkeypatch.setattr(evidence_pack_generator, "_git_value", lambda args, fallback="unknown": "value")

    packet = evidence_pack_generator.current_evidence_packet()

    assert packet["worktree_clean"] is False
    assert "control-center/backend/app.py" in packet["dirty_files"]["tracked_modified"]
    assert "scratch.md" in packet["dirty_files"]["untracked"]
    assert "old.js" in packet["dirty_files"]["deleted"]
    assert packet["next_valid_gate"] == "Classify dirty work before mutation or commit."


def test_validators_are_declared_but_not_run():
    packet = evidence_pack_generator.current_evidence_packet()

    assert packet["validators"]
    assert all(row["last_result"] == "not-run-by-generator" for row in packet["validators"])
    assert packet["build_result"] == "not-run-by-generator"
    assert packet["test_result"] == "not-run-by-generator"


def test_safety_flags_block_execution_autonomy_mcp_and_production_write():
    packet = evidence_pack_generator.current_evidence_packet()
    safety = packet["safety"]

    assert safety["read_only_generator"] is True
    assert safety["would_execute_validators"] is False
    assert safety["would_write_files"] is False
    assert safety["autonomy_enabled"] is False
    assert safety["mcp_activation"] is False
    assert safety["production_write"] is False
    assert safety["push_pr_merge_release"] is False


def test_evidence_pack_api_returns_preview_only():
    import app
    from fastapi.testclient import TestClient

    client = TestClient(app.app)

    payload = client.get("/api/evidence-pack").json()

    assert payload["ok"] is True
    assert payload["mode"] == "read-only-evidence-pack-preview"
    assert payload["safety"]["would_write_files"] is False
    assert payload["safety"]["would_execute_validators"] is False
