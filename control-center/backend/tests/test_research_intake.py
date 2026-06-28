"""Tests for Phase 5C Research Drop Zone intake."""

from __future__ import annotations

import json
import sys
from pathlib import Path


_BACKEND = str(Path(__file__).resolve().parent.parent)
if _BACKEND not in sys.path:
    sys.path.insert(0, _BACKEND)

import research_intake


def _patch_dirs(monkeypatch, tmp_path: Path) -> Path:
    vault = tmp_path / "WilliamOS"
    intake_root = vault / "110_ControlCenter" / "research_intake"
    monkeypatch.setattr(research_intake, "VAULT", vault)
    monkeypatch.setattr(research_intake, "INTAKE_ROOT", intake_root)
    monkeypatch.setattr(research_intake, "ORIGINALS_DIR", intake_root / "originals")
    monkeypatch.setattr(research_intake, "METADATA_DIR", intake_root / "metadata")
    monkeypatch.setattr(research_intake, "NOTES_DIR", vault / "07_Learning" / "Research Intake")
    return vault


def test_ingest_text_preserves_original_creates_note_and_metadata(monkeypatch, tmp_path):
    _patch_dirs(monkeypatch, tmp_path)
    semantic_calls = []
    rag_calls = []

    result = research_intake.ingest_file(
        "MA Copilot note.txt",
        b"MA Copilot research intake marker about appraisal evidence.",
        "text/plain",
        "Research",
        semantic_indexer=lambda: semantic_calls.append("search") or {"ok": True, "mode": "tfidf"},
        rag_indexer=lambda path: rag_calls.append(path) or {"ok": True, "chunks": 1},
    )

    assert result["ok"] is True
    assert result["duplicate"] is False
    item = result["item"]
    assert item["source_filename"] == "MA Copilot note.txt"
    assert item["hash"]
    assert item["size"] > 0
    assert item["type"] == "text"
    assert item["ingested_at"]
    assert Path(item["original_path"]).exists()
    note_path = Path(item["note_path"])
    assert note_path.exists()
    note = note_path.read_text(encoding="utf-8")
    assert "authority: unreviewed" in note
    assert "canon: false" in note
    assert "MA Copilot research intake marker" in note
    assert semantic_calls == ["search"]
    assert rag_calls == [note_path]

    metadata = json.loads((research_intake.METADATA_DIR / f"{item['hash']}.json").read_text(encoding="utf-8"))
    assert metadata["source_filename"] == "MA Copilot note.txt"
    assert metadata["note_path"] == item["note_path"]


def test_duplicate_hash_does_not_create_second_copy(monkeypatch, tmp_path):
    _patch_dirs(monkeypatch, tmp_path)
    content = b"duplicate research packet"

    first = research_intake.ingest_file(
        "packet.txt",
        content,
        "text/plain",
        run_indexes=False,
    )
    second = research_intake.ingest_file(
        "renamed-packet.txt",
        content,
        "text/plain",
        run_indexes=False,
    )

    assert first["ok"] is True
    assert second["ok"] is True
    assert second["duplicate"] is True
    assert len(list(research_intake.ORIGINALS_DIR.glob("*"))) == 1
    assert len(list(research_intake.NOTES_DIR.glob("*.md"))) == 1


def test_unsupported_file_fails_cleanly_without_copy(monkeypatch, tmp_path):
    _patch_dirs(monkeypatch, tmp_path)

    result = research_intake.ingest_file(
        "archive.exe",
        b"not allowed",
        "application/octet-stream",
        run_indexes=False,
    )

    assert result["ok"] is False
    assert result["error"] == "Unsupported file type"
    assert ".pdf" in result["supported"]
    assert not research_intake.ORIGINALS_DIR.exists()


def test_history_returns_recent_intake_items(monkeypatch, tmp_path):
    _patch_dirs(monkeypatch, tmp_path)
    research_intake.ingest_file("one.txt", b"one research", "text/plain", run_indexes=False)
    research_intake.ingest_file("two.txt", b"two research", "text/plain", run_indexes=False)

    result = research_intake.history(limit=1)

    assert result["ok"] is True
    assert len(result["items"]) == 1
    assert result["items"][0]["source_filename"] in {"one.txt", "two.txt"}
