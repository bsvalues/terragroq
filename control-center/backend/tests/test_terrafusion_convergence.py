"""Tests for the read-only TerraFusion convergence projection."""

import json

import state_reader


def _write_ledger(tmp_path, data):
    root = tmp_path / "terrafusion_os_1.0"
    ledger = root / "docs" / "brain" / "convergence" / "ledger.json"
    ledger.parent.mkdir(parents=True)
    ledger.write_text(json.dumps(data), encoding="utf-8")
    return root


def _base_ledger(items):
    return {
        "version": 1,
        "updated": "2026-10-02",
        "rules": {
            "mock_runtime_policy": "PROHIBITED_ON_PRODUCTION_PATHS",
            "accepted_stage": "ACCEPTED",
        },
        "items": items,
    }


def _item(item_id, priority="P1", stage="MAPPED", accepted=False):
    return {
        "id": item_id,
        "title": f"Seam {item_id}",
        "priority": priority,
        "stage": stage,
        "missing_seam": "" if accepted else "Wire the real path.",
        "next_action": "NONE" if accepted else "Finish and prove the seam.",
        "acceptance": {
            "real_data_proven": accepted,
            "owner_visible_proven": accepted,
            "evidence": ["EV-1"] if accepted else [],
        },
    }


def test_convergence_reader_is_loud_when_checkout_is_unavailable(tmp_path, monkeypatch):
    monkeypatch.setenv("WILLIAMOS_TERRAFUSION_ROOT", str(tmp_path / "missing"))
    result = state_reader.get_terrafusion_convergence()

    assert result["status"] == "UNAVAILABLE"
    assert result["top"] is None
    assert result["accepted"] == 0
    assert "WILLIAMOS_TERRAFUSION_ROOT" in result["reason"]


def test_convergence_reader_projects_counts_and_highest_priority_seam(tmp_path, monkeypatch):
    root = _write_ledger(
        tmp_path,
        _base_ledger(
            [
                _item("CV-001", priority="P1", stage="MAPPED"),
                _item("CV-002", priority="P0", stage="SEAM_DEFINED"),
                _item("CV-003", priority="P2", stage="ACCEPTED", accepted=True),
            ]
        ),
    )
    monkeypatch.setenv("WILLIAMOS_TERRAFUSION_ROOT", str(root))

    result = state_reader.get_terrafusion_convergence()

    assert result["status"] == "AVAILABLE"
    assert result["total"] == 3
    assert result["accepted"] == 1
    assert result["open"] == 2
    assert result["top"] == {
        "id": "CV-002",
        "title": "Seam CV-002",
        "priority": "P0",
        "stage": "SEAM_DEFINED",
        "missing_seam": "Wire the real path.",
        "next_action": "Finish and prove the seam.",
    }


def test_convergence_reader_rejects_dishonest_accepted_state(tmp_path, monkeypatch):
    bad = _item("CV-001", stage="ACCEPTED", accepted=False)
    bad["missing_seam"] = "Still open."
    root = _write_ledger(tmp_path, _base_ledger([bad]))
    monkeypatch.setenv("WILLIAMOS_TERRAFUSION_ROOT", str(root))

    result = state_reader.get_terrafusion_convergence()

    assert result["status"] == "INVALID"
    assert "real-data proof" in result["reason"]
    assert "owner-visible proof" in result["reason"]
    assert "unresolved seam" in result["reason"]


def test_convergence_reader_rejects_mock_runtime_policy_regression(tmp_path, monkeypatch):
    data = _base_ledger([_item("CV-001")])
    data["rules"]["mock_runtime_policy"] = "ALLOW_DEMO_FALLBACK"
    root = _write_ledger(tmp_path, data)
    monkeypatch.setenv("WILLIAMOS_TERRAFUSION_ROOT", str(root))

    result = state_reader.get_terrafusion_convergence()

    assert result["status"] == "INVALID"
    assert "mock runtime policy is not fail-closed" in result["reason"]