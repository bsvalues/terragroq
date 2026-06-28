"""Tests for the Phase 5I structured Work Order registry."""

import sys
from pathlib import Path

_BACKEND = str(Path(__file__).resolve().parent.parent)
if _BACKEND not in sys.path:
    sys.path.insert(0, _BACKEND)

import work_order_registry


def test_status_vocabulary_matches_enterprise_playbook():
    assert work_order_registry.VALID_STATUSES == [
        "draft",
        "active",
        "blocked",
        "hold",
        "accepted",
        "closed",
        "superseded",
        "rejected",
    ]


def test_seed_work_orders_include_recent_and_active_wos():
    rows = work_order_registry.list_work_orders()
    ids = {row["wo_id"] for row in rows}

    assert "WO-WILLIAMOS-PHASE5G-DECISION-REGISTER-001" in ids
    assert "WO-WILLIAMOS-PHASE5H-DOCTRINE-REGISTRY-001" in ids
    assert "WO-WILLIAMOS-PHASE5I-WORK-ORDER-ENGINE-001" in ids
    assert "WO-WILLIAMOS-PHASE5J-AGENT-CONFIG-INVENTORY-001" in ids
    assert "WO-WILLIAMOS-DEVOPS-RUNTIME-PROOF-001" in ids


def test_work_order_shape_is_structured():
    row = work_order_registry.get_work_order("WO-WILLIAMOS-PHASE5I-WORK-ORDER-ENGINE-001")

    assert row["status"] == "closed"
    assert row["phase"] == "5I"
    assert row["commit"] == "9fde17a952b7849b3c82c1cc2af1a8adb9667d05"
    assert row["tag"] is None
    assert row["loop"] == ["read", "classify", "plan", "act-narrowly", "verify", "record", "stop"]
    assert row["scope"]
    assert row["non_goals"]
    assert row["validators"]
    assert row["stop_conditions"]
    assert any("No Phase 6" in item for item in row["non_goals"])


def test_search_and_active_work_orders():
    doctrine = work_order_registry.search_work_orders("doctrine")
    active = work_order_registry.active_work_orders()

    assert any(row["wo_id"] == "WO-WILLIAMOS-PHASE5H-DOCTRINE-REGISTRY-001" for row in doctrine)
    assert [row["wo_id"] for row in active] == ["WO-WILLIAMOS-PHASE5J-AGENT-CONFIG-INVENTORY-001"]


def test_devops_runtime_proof_work_order_records_full_runtime_gates():
    row = work_order_registry.get_work_order("WO-WILLIAMOS-DEVOPS-RUNTIME-PROOF-001")

    assert row["status"] == "closed"
    assert row["phase"] == "devops-runtime-proof"
    assert "python scripts/william.py control-center-smoke" in row["validators"]
    assert "python scripts/william.py runtime-smoke" in row["validators"]
    assert "python scripts/william.py production-readiness" in row["validators"]
    assert any("22/22" in item for item in row["evidence"])
    assert any("28/28" in item for item in row["evidence"])
    assert any("10/10" in item for item in row["evidence"])


def test_work_order_api_lists_searches_active_and_detail():
    import app
    from fastapi.testclient import TestClient

    client = TestClient(app.app)

    listed = client.get("/api/work-orders").json()
    searched = client.get("/api/work-orders", params={"q": "decision"}).json()
    active = client.get("/api/work-orders/active").json()
    detail = client.get("/api/work-orders/WO-WILLIAMOS-PHASE5I-WORK-ORDER-ENGINE-001").json()
    missing = client.get("/api/work-orders/WO-NOT-REAL").json()

    assert listed["mode"] == "seed-work-order-registry-read-only"
    assert "active" in listed["statuses"]
    assert listed["total"] >= 3
    assert any(row["wo_id"] == "WO-WILLIAMOS-PHASE5G-DECISION-REGISTER-001" for row in searched["work_orders"])
    assert active["total"] == 1
    assert active["work_orders"][0]["status"] == "active"
    assert active["work_orders"][0]["phase"] == "5J"
    assert detail["ok"] is True
    assert detail["work_order"]["phase"] == "5I"
    assert missing["ok"] is False
