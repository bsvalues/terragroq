"""Tests for /api/sessions and /api/session routes.

TDD: tests written first (red), then routes added to app.py (green).
Monkeypatches MEMORY methods where app.py references them.
"""

import sys
from pathlib import Path

_BACKEND = str(Path(__file__).resolve().parent.parent)
if _BACKEND not in sys.path:
    sys.path.insert(0, _BACKEND)


def test_list_sessions_returns_sessions(monkeypatch):
    """GET /api/sessions returns {"sessions": [...]} from MEMORY.list_sessions()."""
    fake_sessions = [
        {"id": "abc123", "created": "2026-06-19 10:00:00", "message_count": 3, "preview": "hello"},
        {"id": "def456", "created": "2026-06-18 08:00:00", "message_count": 1, "preview": ""},
    ]

    import app
    monkeypatch.setattr(app.MEMORY, "list_sessions", lambda **kw: fake_sessions)

    from fastapi.testclient import TestClient
    client = TestClient(app.app)
    resp = client.get("/api/sessions")
    assert resp.status_code == 200
    assert resp.json() == {"sessions": fake_sessions}


def test_list_sessions_empty(monkeypatch):
    """GET /api/sessions returns {"sessions": []} when no sessions exist."""
    import app
    monkeypatch.setattr(app.MEMORY, "list_sessions", lambda **kw: [])

    from fastapi.testclient import TestClient
    client = TestClient(app.app)
    resp = client.get("/api/sessions")
    assert resp.status_code == 200
    assert resp.json() == {"sessions": []}


def test_get_session_returns_messages(monkeypatch):
    """GET /api/session?session=x returns {"messages": [...]} from MEMORY.get_session(x)."""
    fake_messages = [
        {"role": "user", "content": "hi", "meta": None},
        {"role": "assistant", "content": "hello!", "meta": None},
    ]

    import app
    monkeypatch.setattr(app.MEMORY, "get_session", lambda sid, **kw: fake_messages)

    from fastapi.testclient import TestClient
    client = TestClient(app.app)
    resp = client.get("/api/session", params={"session": "abc123"})
    assert resp.status_code == 200
    assert resp.json() == {"messages": fake_messages}


def test_get_session_missing_param_returns_empty(monkeypatch):
    """GET /api/session with no session param returns {"messages": []}."""
    import app

    from fastapi.testclient import TestClient
    client = TestClient(app.app)
    resp = client.get("/api/session")
    assert resp.status_code == 200
    assert resp.json() == {"messages": []}


def test_get_session_empty_param_returns_empty(monkeypatch):
    """GET /api/session?session= (empty) returns {"messages": []}."""
    import app

    from fastapi.testclient import TestClient
    client = TestClient(app.app)
    resp = client.get("/api/session", params={"session": ""})
    assert resp.status_code == 200
    assert resp.json() == {"messages": []}
