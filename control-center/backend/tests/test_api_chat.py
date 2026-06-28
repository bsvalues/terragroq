"""Tests for /api/chat SSE, /api/chat/approve, and /api/copilot/health routes.

TDD: write failing tests first, then implement in app.py.
"""

import json
import sys
from pathlib import Path

# Ensure backend dir is on sys.path so `import app` works
_BACKEND = str(Path(__file__).resolve().parent.parent)
if _BACKEND not in sys.path:
    sys.path.insert(0, _BACKEND)


def _parse_sse(text: str) -> list[dict]:
    """Parse SSE data lines into a list of dicts."""
    events = []
    for line in text.splitlines():
        line = line.strip()
        if line.startswith("data:"):
            payload = line[len("data:"):].strip()
            events.append(json.loads(payload))
    return events


def test_chat_streams_events(monkeypatch):
    """POST /api/chat returns SSE containing all events from loop.run_turn."""
    fake_events = [
        {"type": "tool", "name": "backup-status", "status": "ok"},
        {"type": "final", "text": "All good."},
    ]

    def fake_run_turn(user_msg, session, memory, llm_chat=None, max_steps=8, pending=None, **kwargs):
        yield from fake_events

    # Patch before importing app so module-level singletons aren't wired yet
    import copilot.loop as _loop
    monkeypatch.setattr(_loop, "run_turn", fake_run_turn)

    # Also stub memory.start_session so no DB is hit
    import copilot.memory as _memory
    monkeypatch.setattr(_memory.Memory, "start_session", lambda self: "test-session-123")

    import app
    from fastapi.testclient import TestClient

    client = TestClient(app.app)
    resp = client.post("/api/chat", json={"message": "hi"})
    assert resp.status_code == 200
    assert "text/event-stream" in resp.headers["content-type"]

    events = _parse_sse(resp.text)
    # First event must be a session event
    assert events[0]["type"] == "session"
    assert events[0]["session"] == "test-session-123"

    assert events[1]["type"] == "runtime"
    assert events[1]["runtime"]["runtime"] == "ollama"
    assert events[1]["runtime"]["fallback"] is False

    # Remaining non-runtime events must match the fake events
    remaining = events[2:]
    assert len(remaining) == len(fake_events)
    for got, want in zip(remaining, fake_events):
        for k, v in want.items():
            assert got[k] == v


def test_health_returns_llm_health(monkeypatch):
    """GET /api/copilot/health returns the dict from llm.health()."""
    fake_health = {"ok": True, "model": "x", "detail": "y"}

    import copilot.llm as _llm
    monkeypatch.setattr(_llm, "health", lambda: fake_health)

    import app
    from fastapi.testclient import TestClient

    client = TestClient(app.app)
    resp = client.get("/api/copilot/health")
    assert resp.status_code == 200
    assert resp.json() == fake_health
