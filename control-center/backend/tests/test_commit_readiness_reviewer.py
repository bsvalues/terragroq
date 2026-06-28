"""Tests for the Phase 5P preview-only Commit Readiness Reviewer."""

import sys
from pathlib import Path


_BACKEND = str(Path(__file__).resolve().parent.parent)
if _BACKEND not in sys.path:
    sys.path.insert(0, _BACKEND)

import commit_readiness_reviewer


def _packet(lines):
    return {
        "repo": "C:\\repo",
        "branch": "copilot-phase1",
        "head": "3ad56d9cb26f59c1afdd64377ed861c83ca10d7d",
        "short_head": "3ad56d9",
        "git_status": lines,
    }


def test_clean_tree_is_not_a_commit_candidate(monkeypatch):
    monkeypatch.setattr(commit_readiness_reviewer.evidence_pack_generator, "current_evidence_packet", lambda: _packet([]))

    review = commit_readiness_reviewer.current_commit_readiness()

    assert review["decision"] == "NOT_SAFE_TO_COMMIT"
    assert review["safe_to_commit"] is False
    assert "No candidate files are present." in review["blockers"]


def test_backend_candidate_recommends_scope_and_backend_validators(monkeypatch):
    monkeypatch.setattr(
        commit_readiness_reviewer.evidence_pack_generator,
        "current_evidence_packet",
        lambda: _packet([" M control-center/backend/app.py", "?? control-center/backend/tests/test_x.py"]),
    )

    review = commit_readiness_reviewer.current_commit_readiness()
    validator_ids = {row["id"] for row in review["required_validators"]}

    assert review["decision"] == "SAFE_TO_COMMIT_CANDIDATE"
    assert review["safe_to_commit"] is True
    assert "scope-safety" in validator_ids
    assert "backend-full" in validator_ids
    assert review["validators_run_by_reviewer"] is False


def test_complete_dist_triplet_is_classified_for_owner_review(monkeypatch):
    monkeypatch.setattr(
        commit_readiness_reviewer.evidence_pack_generator,
        "current_evidence_packet",
        lambda: _packet(
            [
                " D control-center/frontend/dist/assets/index-old.js",
                "?? control-center/frontend/dist/assets/index-new.js",
                " M control-center/frontend/dist/index.html",
            ]
        ),
    )

    review = commit_readiness_reviewer.current_commit_readiness()

    assert review["dist_status"]["present"] is True
    assert review["dist_status"]["complete_matching_triplet"] is True
    assert review["dist_status"]["decision"] == "ok"
    assert review["safe_to_commit"] is True


def test_incomplete_dist_triplet_blocks_commit_candidate(monkeypatch):
    monkeypatch.setattr(
        commit_readiness_reviewer.evidence_pack_generator,
        "current_evidence_packet",
        lambda: _packet([" M control-center/frontend/dist/index.html"]),
    )

    review = commit_readiness_reviewer.current_commit_readiness()

    assert review["decision"] == "NOT_SAFE_TO_COMMIT"
    assert review["safe_to_commit"] is False
    assert review["dist_status"]["decision"] == "owner-review-required"


def test_commit_readiness_api_is_preview_only():
    import app
    from fastapi.testclient import TestClient

    client = TestClient(app.app)
    payload = client.get("/api/commit-readiness").json()

    assert payload["ok"] is True
    assert payload["mode"] == "preview-only-commit-readiness-reviewer"
    assert payload["safety"]["would_stage"] is False
    assert payload["safety"]["would_commit"] is False
    assert payload["safety"]["would_execute_validators"] is False
