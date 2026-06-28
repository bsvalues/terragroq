"""Tests for the Phase 5J read-only agent config inventory."""

import sys
from pathlib import Path

_BACKEND = str(Path(__file__).resolve().parent.parent)
if _BACKEND not in sys.path:
    sys.path.insert(0, _BACKEND)

import agent_config_inventory


def test_inventory_includes_required_surfaces():
    rows = agent_config_inventory.list_config_surfaces()
    ids = {row["surface_id"] for row in rows}

    assert "claude-code" in ids
    assert "codex" in ids
    assert "hermes" in ids
    assert "opencode" in ids
    assert "openclaw" in ids
    assert "cc-switch" in ids
    assert "mcp-servers" in ids
    assert "agents-md" in ids
    assert "claude-md" in ids
    assert "gemini-md" in ids
    assert "skills" in ids
    assert "provider-configs" in ids
    assert "local-model-runtimes" in ids


def test_inventory_shape_is_redacted_and_read_only():
    row = agent_config_inventory.get_config_surface("provider-configs")

    assert row["secrets_redacted"] is True
    assert row["authority"] == "read-only-inventory"
    assert row["risk_level"] == "high"
    assert "secret-risk" in row["flags"]
    assert row["locations"]
    assert set(row["locations"][0]) == {"path", "exists", "kind"}
    assert "token" not in str(row).lower()


def test_search_finds_surface_and_risk_flags():
    cloud = agent_config_inventory.search_config_surfaces("cloud")
    skills = agent_config_inventory.search_config_surfaces("skills")

    assert any(row["surface_id"] == "provider-configs" for row in cloud)
    assert any(row["surface_id"] == "skills" for row in skills)


def test_inventory_status_filter_is_deterministic():
    detected = agent_config_inventory.list_config_surfaces(status="detected")

    assert all(row["status"] == "detected" for row in detected)


def test_agent_config_api_lists_searches_and_details():
    import app
    from fastapi.testclient import TestClient

    client = TestClient(app.app)

    listed = client.get("/api/agent-configs").json()
    searched = client.get("/api/agent-configs", params={"q": "provider"}).json()
    detail = client.get("/api/agent-configs/codex").json()
    missing = client.get("/api/agent-configs/not-real").json()

    assert listed["mode"] == "read-only-redacted-config-inventory"
    assert listed["total"] >= 13
    assert all(row["secrets_redacted"] is True for row in listed["surfaces"])
    assert any(row["surface_id"] == "provider-configs" for row in searched["surfaces"])
    assert detail["ok"] is True
    assert detail["surface"]["surface_id"] == "codex"
    assert missing["ok"] is False
