"""Tests for the Phase 5G structured decision register."""

import sys
from pathlib import Path

_BACKEND = str(Path(__file__).resolve().parent.parent)
if _BACKEND not in sys.path:
    sys.path.insert(0, _BACKEND)

import decision_register


def test_seed_decisions_include_required_governance_records():
    rows = decision_register.list_decisions()
    ids = {row["decision_id"] for row in rows}

    assert "DEC-WILLIAMOS-PHASE6-BLOCKED" in ids
    assert "DEC-WILLIAMOS-RESEARCH-INTAKE-NONCANON" in ids
    assert "DEC-WILLIAMOS-WORKERS-PROPOSAL-ONLY" in ids
    assert "DEC-WILLIAMOS-RUNTIME-14B-DEFAULT" in ids
    assert "DEC-WILLIAMOS-NO-CLOUD-FALLBACK" in ids
    assert "DEC-WILLIAMOS-V130-STABLE-BASELINE" in ids
    assert "DEC-WILLIAMOS-V131-RUNTIME-HARDENING" in ids


def test_decision_shape_is_structured():
    row = decision_register.get_decision("DEC-WILLIAMOS-PHASE6-BLOCKED")

    assert row["status"] == "active"
    assert row["owner"] == "Bill"
    assert row["evidence"]
    assert row["scope"]
    assert row["supersedes"] == []
    assert row["superseded_by"] is None
    assert "blocked" in row["decision"].lower()


def test_search_decisions_finds_scope_and_text():
    runtime = decision_register.search_decisions("14b")
    phase = decision_register.search_decisions("phase-6")

    assert any(row["decision_id"] == "DEC-WILLIAMOS-RUNTIME-14B-DEFAULT" for row in runtime)
    assert any(row["decision_id"] == "DEC-WILLIAMOS-PHASE6-BLOCKED" for row in phase)


def test_decisions_api_lists_and_searches():
    import app
    from fastapi.testclient import TestClient

    client = TestClient(app.app)

    listed = client.get("/api/decisions").json()
    searched = client.get("/api/decisions", params={"q": "cloud"}).json()
    detail = client.get("/api/decisions/DEC-WILLIAMOS-NO-CLOUD-FALLBACK").json()
    missing = client.get("/api/decisions/DEC-NOT-REAL").json()

    assert listed["mode"] == "seed-register-read-only"
    assert listed["total"] >= 7
    assert any(row["decision_id"] == "DEC-WILLIAMOS-NO-CLOUD-FALLBACK" for row in searched["decisions"])
    assert detail["ok"] is True
    assert detail["decision"]["decision_id"] == "DEC-WILLIAMOS-NO-CLOUD-FALLBACK"
    assert missing["ok"] is False
