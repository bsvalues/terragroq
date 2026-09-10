"""Absence must be reported as absence, never as a plausible value.

Pins the invariant behind the 2026-09-10 operations audit P0 finding: a missing
directory and a missing key must each surface as an explicit unknown rather than
collapsing into ``0`` or a fallback string that reads as health.
"""

import sys
from pathlib import Path

import pytest

_BACKEND = str(Path(__file__).resolve().parent.parent)
if _BACKEND not in sys.path:
    sys.path.insert(0, _BACKEND)

import state_reader


@pytest.fixture()
def queue_root(tmp_path, monkeypatch):
    monkeypatch.setattr(state_reader, "PROJECT_ROOT", tmp_path)
    return tmp_path


def test_missing_queue_folder_is_distinguishable_from_empty(queue_root, monkeypatch):
    present = queue_root / "WilliamOS" / "86_ConceptPromotion" / "drafts"
    present.mkdir(parents=True)
    missing = queue_root / "WilliamOS" / "80_DoctrinePromotion" / "drafts"

    monkeypatch.setattr(
        state_reader, "DRAFT_FOLDERS", {"concepts": present, "doctrine": missing}
    )
    summary = state_reader.get_review_queue_summary()

    # Both report a zero count, but only one is a genuinely clear queue.
    assert summary["concepts"]["count"] == 0
    assert summary["doctrine"]["count"] == 0

    assert summary["concepts"]["exists"] is True
    assert summary["concepts"]["status"] == "ok"
    assert summary["doctrine"]["exists"] is False
    assert summary["doctrine"]["status"] == "MISSING"

    assert summary["unavailable"] == ["doctrine"]
    assert summary["healthy"] is False


def test_all_queues_present_reports_healthy(queue_root, monkeypatch):
    folder = queue_root / "WilliamOS" / "86_ConceptPromotion" / "drafts"
    folder.mkdir(parents=True)
    (folder / "draft.md").write_text("---\ntype: concept\n---\n", encoding="utf-8")

    monkeypatch.setattr(state_reader, "DRAFT_FOLDERS", {"concepts": folder})
    summary = state_reader.get_review_queue_summary()

    assert summary["concepts"]["count"] == 1
    assert summary["concepts"]["status"] == "ok"
    assert summary["unavailable"] == []
    assert summary["healthy"] is True
    assert summary["total"] == 1


def test_total_ignores_summary_metadata(queue_root, monkeypatch):
    folder = queue_root / "WilliamOS" / "86_ConceptPromotion" / "drafts"
    folder.mkdir(parents=True)
    monkeypatch.setattr(state_reader, "DRAFT_FOLDERS", {"concepts": folder})

    summary = state_reader.get_review_queue_summary()

    # unavailable/healthy are summary fields, not queues; they must not inflate
    # or crash the total.
    assert summary["total"] == 0
    assert isinstance(summary["unavailable"], list)
    assert summary["healthy"] is True


def test_git_info_reports_branch_as_its_own_fact():
    info = state_reader.get_git_info()

    assert "branch" in info
    # A git branch name can never contain a space; a commit subject always does.
    # This is the assertion that would have caught the briefing labelling a
    # commit message as the branch.
    assert info["branch"] is None or " " not in info["branch"]
