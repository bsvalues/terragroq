"""Tests for the Phase 5N preview-only Work Order Composer."""

import sys
from pathlib import Path


_BACKEND = str(Path(__file__).resolve().parent.parent)
if _BACKEND not in sys.path:
    sys.path.insert(0, _BACKEND)

import work_order_composer


def test_composer_requires_objective():
    result = work_order_composer.compose_work_order(work_order_composer.ComposeInput(objective=""))

    assert result["ok"] is False
    assert result["error"] == "OBJECTIVE_REQUIRED"


def test_composer_builds_structured_preview_packet():
    result = work_order_composer.compose_work_order(
        work_order_composer.ComposeInput(
            objective="Add a governed local dashboard.",
            title="Repo Dashboard",
            phase="5N",
            lane="Repo State",
            allowed_scope=["control-center/backend/**"],
            validators=["python -m pytest control-center/backend/tests -q"],
        )
    )

    draft = result["draft"]

    assert result["ok"] is True
    assert result["mode"] == "preview-only-work-order-composer"
    assert draft["title"] == "Repo Dashboard"
    assert draft["phase"] == "5N"
    assert draft["allowed_scope"] == ["control-center/backend/**"]
    assert "python -m pytest control-center/backend/tests -q" in draft["validators"]
    assert "push" in draft["denied_actions"]
    assert "## Safety" in result["packet_markdown"]


def test_composer_never_grants_execution_persistence_or_autonomy():
    result = work_order_composer.compose_work_order(
        work_order_composer.ComposeInput(objective="Create preview packet.")
    )
    draft = result["draft"]
    safety = result["safety"]

    assert draft["would_execute"] is False
    assert draft["would_write_files"] is False
    assert draft["would_persist"] is False
    assert draft["autonomy_enabled"] is False
    assert draft["mcp_activation"] is False
    assert draft["scheduler_enabled"] is False
    assert draft["production_write"] is False
    assert safety["push_pr_merge_release"] is False


def test_work_order_composer_api_returns_preview_only():
    import app
    from fastapi.testclient import TestClient

    client = TestClient(app.app)
    payload = client.post(
        "/api/work-order-composer/preview",
        json={
            "objective": "Add a preview-only composer.",
            "allowed_scope": ["control-center/frontend/src/App.tsx"],
            "evidence_outputs": ["validation report"],
        },
    ).json()

    assert payload["ok"] is True
    assert payload["safety"]["would_execute"] is False
    assert payload["safety"]["would_write_files"] is False
    assert payload["safety"]["would_persist"] is False
    assert payload["draft"]["allowed_scope"] == ["control-center/frontend/src/App.tsx"]


def test_work_order_composer_does_not_mutate_registry():
    before = work_order_composer.compose_work_order(
        work_order_composer.ComposeInput(objective="Temporary preview.")
    )

    import work_order_registry

    ids = {row["wo_id"] for row in work_order_registry.list_work_orders()}

    assert before["draft"]["wo_id"] not in ids
