"""Tests for GUI command/workflow center governance surfaces."""

import sys
from pathlib import Path

_BACKEND = str(Path(__file__).resolve().parent.parent)
if _BACKEND not in sys.path:
    sys.path.insert(0, _BACKEND)

import app
from fastapi.testclient import TestClient


def test_command_catalog_exposes_registry_with_safety_classification():
    client = TestClient(app.app)

    payload = client.get("/api/commands/catalog").json()

    assert payload["ok"] is True
    assert payload["registry_count"] == 92
    assert payload["cli_count"] == 92
    assert payload["parity"] is True
    assert payload["policy"]["execution_path"] == "safety.py -> command_runner.py"

    by_name = {row["name"]: row for row in payload["commands"]}
    assert by_name["semantic-clear"]["safety_tier"] == "forbidden"
    assert by_name["semantic-clear"]["runnable"] is False
    assert "forbidden" in by_name["semantic-clear"]["blocked_reason"].lower()
    assert by_name["backup"]["safety_tier"] == "confirmation-required"
    assert by_name["backup"]["confirmation_required"] is True
    assert by_name["runtime-smoke"]["dry_run_args"] == ["--dry-run"]
    assert by_name["git-status"]["safety_tier"] == "safe-read"


def test_command_detail_and_preview_preserve_forbidden_and_confirm_gates():
    client = TestClient(app.app)

    forbidden = client.get("/api/commands/semantic-clear").json()
    assert forbidden["ok"] is True
    assert forbidden["command"]["runnable"] is False
    assert forbidden["command"]["safety_tier"] == "forbidden"

    confirm_preview = client.post(
        "/api/commands/preview",
        json={"command": "backup", "args": [], "dry_run": False},
    ).json()
    assert confirm_preview["ok"] is True
    assert confirm_preview["allowed"] is True
    assert confirm_preview["confirmation_required"] is True
    assert confirm_preview["would_execute"] is False

    dry_run_preview = client.post(
        "/api/commands/preview",
        json={"command": "runtime-smoke", "args": [], "dry_run": True},
    ).json()
    assert dry_run_preview["ok"] is True
    assert dry_run_preview["allowed"] is True
    assert dry_run_preview["confirmation_required"] is False
    assert dry_run_preview["command"] == "runtime-smoke"
    assert dry_run_preview["args"] == ["--dry-run"]


def test_workflow_center_definitions_are_guided_and_non_autonomous():
    client = TestClient(app.app)

    payload = client.get("/api/workflows").json()

    assert payload["ok"] is True
    assert payload["policy"]["autonomous_execution"] is False
    assert payload["policy"]["runtime_switching"] == "explicit-only"
    workflow_ids = {row["id"] for row in payload["workflows"]}
    assert {
        "review-draft",
        "accept-draft",
        "post-acceptance",
        "snapshot",
        "backup",
        "runtime-smoke",
        "production-readiness",
    }.issubset(workflow_ids)
    backup = next(row for row in payload["workflows"] if row["id"] == "backup")
    assert backup["confirmation_required"] is True
    assert backup["command"] == "backup"
