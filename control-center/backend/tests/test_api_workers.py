"""Tests for Worker status API."""

from __future__ import annotations

import sys
from pathlib import Path


_BACKEND = str(Path(__file__).resolve().parent.parent)
if _BACKEND not in sys.path:
    sys.path.insert(0, _BACKEND)


def test_workers_status_route_returns_registry_status(monkeypatch):
    import workers

    expected = {
        "ok": True,
        "workers": [{"id": "claude-code", "available": True, "delegation": {"allowed": False}}],
        "summary": {"total": 1},
    }
    monkeypatch.setattr(workers, "worker_status", lambda: expected)

    import app
    from fastapi.testclient import TestClient

    client = TestClient(app.app)
    resp = client.get("/api/workers/status")

    assert resp.status_code == 200
    assert resp.json() == expected


def test_delegation_request_route_returns_review_event(monkeypatch):
    import workers

    expected = {
        "ok": True,
        "event": {
            "type": "delegation_review_required",
            "request_id": "req-1",
            "worker": "claude-code",
            "executed": False,
        },
    }

    def fake_request(worker_id, task, scope=None, reason="", registry=None):
        assert worker_id == "claude-code"
        assert task == "review frontend diff"
        assert scope == {"allowed_paths": ["control-center/frontend"]}
        assert reason == "review only"
        return expected

    monkeypatch.setattr(workers, "request_delegation", fake_request)

    import app
    from fastapi.testclient import TestClient

    client = TestClient(app.app)
    resp = client.post(
        "/api/workers/delegation/request",
        json={
            "worker_id": "claude-code",
            "task": "review frontend diff",
            "scope": {"allowed_paths": ["control-center/frontend"]},
            "reason": "review only",
        },
    )

    assert resp.status_code == 200
    assert resp.json() == expected


def test_delegation_decide_route_records_intent(monkeypatch):
    import workers

    expected = {
        "ok": True,
        "decision": {
            "request_id": "req-1",
            "approved": True,
            "executed": False,
            "evidence": {"commands_run": []},
        },
    }
    monkeypatch.setattr(workers, "decide_delegation", lambda request_id, approved: expected)

    import app
    from fastapi.testclient import TestClient

    client = TestClient(app.app)
    resp = client.post(
        "/api/workers/delegation/decide",
        json={"request_id": "req-1", "approved": True},
    )

    assert resp.status_code == 200
    assert resp.json() == expected


def test_delegation_state_route_returns_pending_and_history(monkeypatch):
    import workers

    expected = {"ok": True, "pending": [], "history": [{"request_id": "req-1", "executed": False}]}
    monkeypatch.setattr(workers, "delegation_state", lambda: expected)

    import app
    from fastapi.testclient import TestClient

    client = TestClient(app.app)
    resp = client.get("/api/workers/delegation/state")

    assert resp.status_code == 200
    assert resp.json() == expected


def test_proposal_run_route_executes_worker_proposal(monkeypatch):
    import workers

    expected = {
        "ok": True,
        "event": {
            "type": "worker_proposal_run",
            "request_id": "req-1",
            "status": "proposal_completed",
            "evidence": {"commands_run": ["worker --proposal"]},
        },
    }
    monkeypatch.setattr(workers, "run_proposal", lambda request_id: expected)

    import app
    from fastapi.testclient import TestClient

    client = TestClient(app.app)
    resp = client.post("/api/workers/proposal/run", json={"request_id": "req-1"})

    assert resp.status_code == 200
    assert resp.json() == expected


def test_proposal_cancel_route_cancels_before_execution(monkeypatch):
    import workers

    expected = {
        "ok": True,
        "event": {
            "type": "worker_proposal_canceled",
            "request_id": "req-1",
            "status": "canceled_before_execution",
        },
    }
    monkeypatch.setattr(workers, "cancel_proposal", lambda request_id: expected)

    import app
    from fastapi.testclient import TestClient

    client = TestClient(app.app)
    resp = client.post("/api/workers/proposal/cancel", json={"request_id": "req-1"})

    assert resp.status_code == 200
    assert resp.json() == expected


def test_proposal_history_route_returns_worker_runs(monkeypatch):
    import workers

    expected = {"ok": True, "history": [{"request_id": "req-1", "status": "proposal_completed"}]}
    monkeypatch.setattr(workers, "proposal_state", lambda: expected)

    import app
    from fastapi.testclient import TestClient

    client = TestClient(app.app)
    resp = client.get("/api/workers/proposal/history")

    assert resp.status_code == 200
    assert resp.json() == expected
