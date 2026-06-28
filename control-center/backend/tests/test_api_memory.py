"""Tests for Memory Governance API routes."""

import sys
from pathlib import Path

_BACKEND = str(Path(__file__).resolve().parent.parent)
if _BACKEND not in sys.path:
    sys.path.insert(0, _BACKEND)


def test_memory_facts_route_returns_policy(monkeypatch):
    import app

    fake_facts = [
        {
            "id": 1,
            "text": "fact",
            "created": "2026-06-26 12:00:00",
            "updated": "2026-06-26 12:00:00",
            "source": "test",
            "authority_state": "working",
            "stale": False,
            "archived": False,
            "last_used": None,
            "citation": "memory.fact:1",
            "review_required": True,
            "staleness_indicator": "needs_review",
            "conflict": False,
            "conflict_with": [],
        }
    ]
    monkeypatch.setattr(app.MEMORY, "list_facts", lambda **kw: fake_facts)

    from fastapi.testclient import TestClient

    client = TestClient(app.app)
    resp = client.get("/api/memory/facts")

    assert resp.status_code == 200
    body = resp.json()
    assert body["facts"] == fake_facts
    assert body["policy"]["canon_requires_confirmation"] is True
    assert body["policy"]["delete_is_archive"] is True
    assert body["policy"]["model_may_mutate_memory"] is False


def test_memory_review_export_and_audit_routes(monkeypatch):
    import app

    monkeypatch.setattr(app.MEMORY, "review_queue", lambda **kw: {"counts": {"needs_review": 1}})
    monkeypatch.setattr(app.MEMORY, "export_facts", lambda **kw: {"format": kw["format"], "facts": []})
    monkeypatch.setattr(app.MEMORY, "fact_audit", lambda fact_id, **kw: [{"fact_id": fact_id, "action": "created"}])

    from fastapi.testclient import TestClient

    client = TestClient(app.app)

    assert client.get("/api/memory/review").json()["counts"]["needs_review"] == 1
    assert client.get("/api/memory/export", params={"format": "json"}).json()["format"] == "json"
    assert client.get("/api/memory/facts/7/audit").json()["events"][0]["fact_id"] == 7


def test_memory_fact_delete_requires_confirmation(monkeypatch):
    import app

    called = {"archive": False}

    def fake_archive(_fact_id, evidence=None):
        called["archive"] = True
        called["evidence"] = evidence
        return {"id": 1, "archived": True}

    monkeypatch.setattr(app.MEMORY, "archive_fact", fake_archive)

    from fastapi.testclient import TestClient

    client = TestClient(app.app)
    denied = client.post("/api/memory/facts/1/delete", json={"confirmation": "YES"})
    allowed = client.post("/api/memory/facts/1/delete", json={"confirmation": "DELETE"})

    assert denied.json()["ok"] is False
    assert called["archive"] is True
    assert called["evidence"]["confirmation"] == "DELETE"
    assert allowed.json()["ok"] is True
    assert allowed.json()["delete_mode"] == "archived"


def test_memory_fact_canon_promotion_requires_confirmation(monkeypatch):
    import app

    called = {"state": None}

    def fake_set(_fact_id, state, evidence=None):
        called["state"] = state
        called["evidence"] = evidence
        return {"id": 1, "authority_state": state}

    monkeypatch.setattr(app.MEMORY, "set_fact_authority", fake_set)

    from fastapi.testclient import TestClient

    client = TestClient(app.app)
    denied = client.post("/api/memory/facts/1/authority", json={"authority_state": "canon"})
    allowed = client.post(
        "/api/memory/facts/1/authority",
        json={"authority_state": "canon", "confirmation": "PROMOTE"},
    )

    assert denied.json()["ok"] is False
    assert called["state"] == "canon"
    assert called["evidence"]["approval"] == "operator-confirmed"
    assert allowed.json()["ok"] is True


def test_memory_fact_edit_and_stale_routes(monkeypatch):
    import app

    monkeypatch.setattr(
        app.MEMORY,
        "update_fact_text",
        lambda fact_id, text, evidence=None: {"id": fact_id, "text": text, "source": "operator_edit"},
    )
    monkeypatch.setattr(
        app.MEMORY,
        "mark_fact_stale",
        lambda fact_id, stale, evidence=None: {"id": fact_id, "stale": stale},
    )

    from fastapi.testclient import TestClient

    client = TestClient(app.app)
    edited = client.post("/api/memory/facts/2/edit", json={"text": "updated"})
    stale = client.post("/api/memory/facts/2/stale", json={"stale": True})

    assert edited.json()["fact"]["text"] == "updated"
    assert stale.json()["fact"]["stale"] is True
