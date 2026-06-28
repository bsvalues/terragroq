"""Tests for the Phase 5M read-only Repo State Dashboard."""

import sys
from pathlib import Path


_BACKEND = str(Path(__file__).resolve().parent.parent)
if _BACKEND not in sys.path:
    sys.path.insert(0, _BACKEND)

import repo_state_dashboard


def _packet(clean=True):
    return {
        "repo": "C:\\repo",
        "branch": "copilot-phase1",
        "head": "a411e6b9230731674ddb51ac522219191b051f56",
        "short_head": "a411e6b",
        "worktree_clean": clean,
        "git_status": [] if clean else [" M control-center/backend/app.py"],
        "dirty_files": {"clean": clean, "tracked_modified": [] if clean else ["control-center/backend/app.py"]},
        "recent_commits": ["a411e6b feat(copilot): add evidence pack generator"],
        "validators": [
            {
                "id": "backend-tests",
                "command": "python -m pytest control-center/backend/tests -q",
                "purpose": "Validate backend.",
                "required_for": ["backend_change"],
                "last_result": "not-run-by-generator",
            }
        ],
        "test_result": "not-run-by-generator",
        "build_result": "not-run-by-generator",
        "safety": {
            "would_execute_validators": False,
            "would_write_files": False,
            "autonomy_enabled": False,
            "mcp_activation": False,
            "production_write": False,
            "push_pr_merge_release": False,
        },
    }


def test_repo_state_dashboard_summarizes_clean_baseline(monkeypatch):
    monkeypatch.setattr(repo_state_dashboard.evidence_pack_generator, "current_evidence_packet", lambda: _packet(clean=True))
    monkeypatch.setattr(repo_state_dashboard, "_validation_reports", lambda limit=6: [{"name": "report.md", "path": "reports/report.md"}])

    dashboard = repo_state_dashboard.current_repo_state_dashboard()

    assert dashboard["ok"] is True
    assert dashboard["mode"] == "read-only-repo-state-dashboard-preview"
    assert dashboard["branch"] == "copilot-phase1"
    assert dashboard["baseline"]["short_head"] == "a411e6b"
    assert dashboard["worktree"]["clean"] is True
    assert dashboard["gate_status"] == "ready-for-owner-work-order"


def test_dirty_worktree_sets_classification_next_action(monkeypatch):
    monkeypatch.setattr(repo_state_dashboard.evidence_pack_generator, "current_evidence_packet", lambda: _packet(clean=False))
    monkeypatch.setattr(repo_state_dashboard, "_validation_reports", lambda limit=6: [])

    dashboard = repo_state_dashboard.current_repo_state_dashboard()

    assert dashboard["worktree"]["clean"] is False
    assert dashboard["gate_status"] == "blocked-dirty-worktree"
    assert dashboard["next_valid_action"] == "Classify dirty work before any staging or commit."


def test_dashboard_declares_validators_without_running_them(monkeypatch):
    monkeypatch.setattr(repo_state_dashboard.evidence_pack_generator, "current_evidence_packet", lambda: _packet(clean=True))
    monkeypatch.setattr(repo_state_dashboard, "_validation_reports", lambda limit=6: [])

    dashboard = repo_state_dashboard.current_repo_state_dashboard()

    assert dashboard["validation_history"]["declared_validators"]
    assert dashboard["validation_history"]["validators_run_by_dashboard"] is False
    assert dashboard["validation_history"]["test_result"] == "not-run-by-generator"
    assert dashboard["validation_history"]["build_result"] == "not-run-by-generator"


def test_dashboard_safety_denies_write_execute_autonomy_mcp_scheduler_and_production(monkeypatch):
    monkeypatch.setattr(repo_state_dashboard.evidence_pack_generator, "current_evidence_packet", lambda: _packet(clean=True))
    monkeypatch.setattr(repo_state_dashboard, "_validation_reports", lambda limit=6: [])

    safety = repo_state_dashboard.current_repo_state_dashboard()["safety"]

    assert safety["read_only_dashboard"] is True
    assert safety["would_execute_validators"] is False
    assert safety["would_write_files"] is False
    assert safety["autonomy_enabled"] is False
    assert safety["mcp_activation"] is False
    assert safety["scheduler_enabled"] is False
    assert safety["production_write"] is False
    assert safety["external_agent_execution"] is False


def test_repo_state_api_returns_get_only_preview():
    import app
    from fastapi.testclient import TestClient

    client = TestClient(app.app)
    payload = client.get("/api/repo-state").json()

    assert payload["ok"] is True
    assert payload["mode"] == "read-only-repo-state-dashboard-preview"
    assert payload["safety"]["would_write_files"] is False
    assert payload["safety"]["would_execute_validators"] is False
    assert payload["safety"]["scheduler_enabled"] is False
