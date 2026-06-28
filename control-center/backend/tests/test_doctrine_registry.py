"""Tests for the Phase 5H structured doctrine registry."""

import sys
from pathlib import Path

_BACKEND = str(Path(__file__).resolve().parent.parent)
if _BACKEND not in sys.path:
    sys.path.insert(0, _BACKEND)

import doctrine_registry


def test_seed_doctrine_include_required_rules():
    rows = doctrine_registry.list_doctrine()
    ids = {row["rule_id"] for row in rows}

    assert "DOC-WILLIAMOS-NO-PHASE6-WITHOUT-AUTH" in ids
    assert "DOC-WILLIAMOS-NO-SILENT-FALLBACK" in ids
    assert "DOC-WILLIAMOS-WORKERS-PROPOSE-GOVERN" in ids
    assert "DOC-CLAUDE-CODE-NO-PUSH-BY-DEFAULT" in ids
    assert "DOC-CODEX-AUDIT-EVIDENCE-SCOUT" in ids
    assert "DOC-WILLIAMOS-RESEARCH-INTAKE-NONCANON" in ids
    assert "DOC-WILLIAMOS-NO-GENERATED-ARTIFACT-COMMIT" in ids


def test_doctrine_shape_is_structured_and_active():
    row = doctrine_registry.get_doctrine("DOC-WILLIAMOS-NO-PHASE6-WITHOUT-AUTH")

    assert row["status"] == "active"
    assert row["owner"] == "Bill"
    assert row["scope"]
    assert row["allowed"]
    assert row["forbidden"]
    assert row["requires_approval"]
    assert "proactive intelligence" in " ".join(row["forbidden"]).lower()


def test_search_doctrine_finds_scope_and_text():
    phase = doctrine_registry.search_doctrine("phase-6")
    fallback = doctrine_registry.search_doctrine("silent")

    assert any(row["rule_id"] == "DOC-WILLIAMOS-NO-PHASE6-WITHOUT-AUTH" for row in phase)
    assert any(row["rule_id"] == "DOC-WILLIAMOS-NO-SILENT-FALLBACK" for row in fallback)


def test_doctrine_query_reports_matches_without_granting_authority():
    matched = doctrine_registry.query_action("push branch")
    unknown = doctrine_registry.query_action("invent new category")

    assert matched["mode"] == "seed-doctrine-query-read-only"
    assert matched["result"] == "matched"
    assert any("push" in item.lower() for item in matched["forbidden"])
    assert unknown["result"] == "unknown"
    assert unknown["requires_approval"] == ["Unclassified action requires operator review."]


def test_doctrine_api_lists_searches_and_checks():
    import app
    from fastapi.testclient import TestClient

    client = TestClient(app.app)

    listed = client.get("/api/doctrine").json()
    searched = client.get("/api/doctrine", params={"q": "canon"}).json()
    detail = client.get("/api/doctrine/DOC-WILLIAMOS-NO-PHASE6-WITHOUT-AUTH").json()
    missing = client.get("/api/doctrine/DOC-NOT-REAL").json()
    checked = client.post("/api/doctrine/check", json={"action": "enable cloud fallback"}).json()

    assert listed["mode"] == "seed-doctrine-read-only"
    assert listed["total"] >= 7
    assert any(row["rule_id"] == "DOC-WILLIAMOS-RESEARCH-INTAKE-NONCANON" for row in searched["doctrine"])
    assert detail["ok"] is True
    assert detail["rule"]["rule_id"] == "DOC-WILLIAMOS-NO-PHASE6-WITHOUT-AUTH"
    assert missing["ok"] is False
    assert checked["result"] == "matched"
    assert any("cloud" in item.lower() for item in checked["forbidden"])
