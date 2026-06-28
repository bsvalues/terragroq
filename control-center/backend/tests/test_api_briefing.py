"""Tests for /api/briefing and /api/alerts routes.

TDD: tests written first (red), then routes added to app.py (green).
Monkeypatches copilot.briefing functions where app.py references them.
"""

import sys
from pathlib import Path

# Ensure backend dir is on sys.path so `import app` works
_BACKEND = str(Path(__file__).resolve().parent.parent)
if _BACKEND not in sys.path:
    sys.path.insert(0, _BACKEND)


def test_briefing_returns_known_dict(monkeypatch):
    """GET /api/briefing returns the dict from briefing.build_briefing()."""
    fake_briefing = {
        "generated": "2026-06-19T12:00:00+00:00",
        "health": {"smoke": "PASS", "production": "PASS", "cockpit": "All good"},
        "pending": {"review_total": 0, "inbox": 0, "by_queue": {}},
        "next_action": None,
        "git": {"branch": "copilot-phase1", "clean": True},
        "backup": {"latest": "WilliamOS-backup-2026-06-19.zip"},
    }

    import copilot.briefing as _briefing
    monkeypatch.setattr(_briefing, "build_briefing", lambda: fake_briefing)

    import app
    from fastapi.testclient import TestClient

    client = TestClient(app.app)
    resp = client.get("/api/briefing")
    assert resp.status_code == 200
    assert resp.json() == fake_briefing


def test_alerts_returns_known_list(monkeypatch):
    """GET /api/alerts returns {"alerts": list} from briefing.watch()."""
    fake_alerts = [
        {"level": "warn", "message": "3 drafts awaiting review", "command": "review-status"},
        {"level": "info", "message": "uncommitted changes", "command": "snapshot --dry-run"},
    ]

    import copilot.briefing as _briefing
    monkeypatch.setattr(_briefing, "watch", lambda: fake_alerts)

    import app
    from fastapi.testclient import TestClient

    client = TestClient(app.app)
    resp = client.get("/api/alerts")
    assert resp.status_code == 200
    assert resp.json() == {"alerts": fake_alerts}


def test_alerts_empty_when_healthy(monkeypatch):
    """GET /api/alerts returns {"alerts": []} when watch() returns empty list."""
    import copilot.briefing as _briefing
    monkeypatch.setattr(_briefing, "watch", lambda: [])

    import app
    from fastapi.testclient import TestClient

    client = TestClient(app.app)
    resp = client.get("/api/alerts")
    assert resp.status_code == 200
    assert resp.json() == {"alerts": []}
