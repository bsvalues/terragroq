"""Tests for Research Drop Zone API routes."""

from __future__ import annotations

import sys
from pathlib import Path


_BACKEND = str(Path(__file__).resolve().parent.parent)
if _BACKEND not in sys.path:
    sys.path.insert(0, _BACKEND)


def test_research_intake_upload_calls_pipeline(monkeypatch):
    import research_intake

    calls = []

    def fake_ingest_file(filename, content, content_type=None, classification=None):
        calls.append((filename, content, content_type, classification))
        return {"ok": True, "item": {"source_filename": filename, "hash": "abc"}}

    monkeypatch.setattr(research_intake, "ingest_file", fake_ingest_file)

    import app
    from fastapi.testclient import TestClient

    client = TestClient(app.app)
    resp = client.post(
        "/api/research-intake",
        data={"classification": "Evidence"},
        files={"file": ("packet.md", b"# Packet\n\nEvidence text.", "text/markdown")},
    )

    assert resp.status_code == 200
    assert resp.json()["ok"] is True
    assert calls == [("packet.md", b"# Packet\n\nEvidence text.", "text/markdown", "Evidence")]


def test_research_intake_history_returns_pipeline_history(monkeypatch):
    import research_intake

    monkeypatch.setattr(research_intake, "history", lambda limit=20: {"ok": True, "items": [{"hash": "abc"}], "limit": limit})

    import app
    from fastapi.testclient import TestClient

    client = TestClient(app.app)
    resp = client.get("/api/research-intake/history?limit=1")

    assert resp.status_code == 200
    assert resp.json() == {"ok": True, "items": [{"hash": "abc"}], "limit": 1}
