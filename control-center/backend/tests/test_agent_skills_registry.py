"""Tests for the Phase 5K metadata-only Agent Skills Registry."""

import sys
from pathlib import Path


_BACKEND = str(Path(__file__).resolve().parent.parent)
if _BACKEND not in sys.path:
    sys.path.insert(0, _BACKEND)

import agent_skills_registry


EXPECTED_SKILLS = {
    "repo_auditor",
    "commit_classifier",
    "work_order_builder",
    "validation_runner",
    "release_gate_reviewer",
    "frontend_smoke_agent",
    "docs_devkit_maintainer",
    "secret_residue_scanner",
}


def test_skill_catalog_returns_expected_skills():
    rows = agent_skills_registry.list_agent_skills()
    ids = {row["id"] for row in rows}

    assert ids == EXPECTED_SKILLS
    assert len(rows) == 8


def test_skill_detail_returns_expected_fields():
    row = agent_skills_registry.get_agent_skill("repo_auditor")

    assert row["name"] == "Repo Auditor"
    assert row["phase"] == "5K"
    assert row["mode"] == "metadata-preview-only"
    assert row["allowed_actions"]
    assert row["safe_paths"]
    assert row["required_validators"]
    assert row["evidence_outputs"]


def test_missing_skill_returns_none():
    assert agent_skills_registry.get_agent_skill("not-real") is None


def test_all_skills_declare_denied_actions_and_validators():
    for row in agent_skills_registry.list_agent_skills():
        denied = " ".join(row["denied_actions"]).lower()
        assert row["denied_actions"]
        assert "execute" in denied
        assert "mcp" in denied
        assert "autonomy" in denied
        assert row["required_validators"]


def test_all_skills_are_read_only_and_non_autonomous():
    for row in agent_skills_registry.list_agent_skills():
        assert row["would_execute"] is False
        assert row["read_only"] is True
        assert row["autonomy_enabled"] is False
        assert row["mcp_activation"] is False
        assert row["production_write"] is False


def test_no_skill_has_run_execute_or_activate_authority():
    forbidden = ("run ", "execute ", "activate ", "schedule", "autonomous")
    for row in agent_skills_registry.list_agent_skills():
        allowed = " ".join(row["allowed_actions"]).lower()
        assert not any(term in allowed for term in forbidden)


def test_agent_skills_api_lists_and_details_safely():
    import app
    from fastapi.testclient import TestClient

    client = TestClient(app.app)

    listed = client.get("/api/agent-skills").json()
    detail = client.get("/api/agent-skills/repo_auditor").json()
    missing = client.get("/api/agent-skills/not-real").json()

    assert listed["ok"] is True
    assert listed["read_only"] is True
    assert listed["would_execute"] is False
    assert listed["autonomy_enabled"] is False
    assert listed["mcp_activation"] is False
    assert listed["production_write"] is False
    assert {row["id"] for row in listed["skills"]} == EXPECTED_SKILLS
    assert detail["ok"] is True
    assert detail["skill"]["id"] == "repo_auditor"
    assert missing == {"ok": False, "error": "SKILL_NOT_FOUND"}
