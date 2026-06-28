"""Tests for the Phase 5O metadata-only Validation Runbook Registry."""

import sys
from pathlib import Path


_BACKEND = str(Path(__file__).resolve().parent.parent)
if _BACKEND not in sys.path:
    sys.path.insert(0, _BACKEND)

import validation_runbook_registry
import work_order_composer


def test_validation_runbooks_are_metadata_only():
    rows = validation_runbook_registry.list_validation_runbooks()

    assert rows
    assert all(row["would_execute"] is False for row in rows)
    assert all(row["scheduler_enabled"] is False for row in rows)
    assert all(row["autonomy_enabled"] is False for row in rows)
    assert all(row["mcp_activation"] is False for row in rows)
    assert all(row["production_write"] is False for row in rows)


def test_runbooks_include_core_validation_recipes():
    ids = {row["id"] for row in validation_runbook_registry.list_validation_runbooks()}

    assert "backend-full" in ids
    assert "frontend-build" in ids
    assert "scope-safety" in ids
    assert "runtime-smoke" in ids
    assert "production-readiness" in ids


def test_runbook_detail_and_category_filter():
    frontend = validation_runbook_registry.list_validation_runbooks(category="frontend")
    detail = validation_runbook_registry.get_validation_runbook("frontend-build")

    assert [row["id"] for row in frontend] == ["frontend-build"]
    assert detail is not None
    assert detail["requires_owner_approval"] is True
    assert "cd control-center/frontend && npm run build" in detail["commands"]


def test_composer_can_reference_runbooks_without_executing_them():
    result = work_order_composer.compose_work_order(
        work_order_composer.ComposeInput(
            objective="Preview a governed frontend lane.",
            validator_runbook_ids=["backend-full", "frontend-build"],
        )
    )

    validators = result["draft"]["validators"]

    assert "python -m pytest control-center/backend/tests -q" in validators
    assert "cd control-center/frontend && npm run build" in validators
    assert result["safety"]["would_execute"] is False
    assert result["safety"]["would_persist"] is False


def test_validation_runbook_api_lists_and_details():
    import app
    from fastapi.testclient import TestClient

    client = TestClient(app.app)
    listed = client.get("/api/validation-runbooks").json()
    filtered = client.get("/api/validation-runbooks", params={"category": "backend"}).json()
    detail = client.get("/api/validation-runbooks/backend-full").json()
    missing = client.get("/api/validation-runbooks/not-real").json()

    assert listed["ok"] is True
    assert listed["mode"] == "metadata-only-validation-runbook-registry"
    assert listed["would_execute"] is False
    assert listed["scheduler_enabled"] is False
    assert any(row["id"] == "backend-full" for row in filtered["runbooks"])
    assert detail["ok"] is True
    assert detail["runbook"]["id"] == "backend-full"
    assert missing["ok"] is False
    assert missing["error"] == "VALIDATION_RUNBOOK_NOT_FOUND"
