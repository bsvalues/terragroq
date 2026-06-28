"""Tests for WilliamOS production-readiness gate composition."""

from __future__ import annotations

import sys
from pathlib import Path


_ROOT = Path(__file__).resolve().parents[3]
_SCRIPTS = str(_ROOT / "scripts")
if _SCRIPTS not in sys.path:
    sys.path.insert(0, _SCRIPTS)

import williamos_production


def test_control_center_smoke_gate_requires_22_of_22(monkeypatch):
    monkeypatch.setattr(
        williamos_production,
        "_run_cmd",
        lambda cmd, timeout=60: (
            True,
            "=== Control Center Smoke Test ===\n\n  Smoke: PASS (22/22)",
            "",
        ),
    )

    result = williamos_production.check_control_center_smoke()

    assert result == {
        "name": "control-center-smoke",
        "passed": True,
        "detail": "22/22 PASS",
    }


def test_control_center_smoke_gate_fails_without_devops_checks(monkeypatch):
    monkeypatch.setattr(
        williamos_production,
        "_run_cmd",
        lambda cmd, timeout=60: (
            True,
            "=== Control Center Smoke Test ===\n\n  Smoke: PASS (18/18)",
            "",
        ),
    )

    result = williamos_production.check_control_center_smoke()

    assert result["name"] == "control-center-smoke"
    assert result["passed"] is False
    assert "22/22" in result["detail"]


def test_control_center_smoke_gate_reads_full_smoke_output(monkeypatch):
    class Completed:
        returncode = 0
        stdout = "\n".join(
            [
                "=== Control Center Smoke Test ===",
                *[f"  [PASS] check_{i}: PASS" for i in range(40)],
                "",
                "  Smoke: PASS (22/22)",
            ]
        )
        stderr = ""

    monkeypatch.setattr(williamos_production.subprocess, "run", lambda *args, **kwargs: Completed())

    result = williamos_production.check_control_center_smoke()

    assert result["passed"] is True
    assert result["detail"] == "22/22 PASS"


def test_production_readiness_includes_control_center_smoke_gate(monkeypatch, tmp_path):
    monkeypatch.setattr(williamos_production, "PROD_DIR", tmp_path)
    monkeypatch.setattr(williamos_production, "REPORTS_DIR", tmp_path / "reports")
    monkeypatch.setattr(williamos_production, "DATA_DIR", tmp_path / "data")

    gate_names = [
        "global-governance",
        "runtime-smoke",
        "control-center-smoke",
        "restore-proof",
        "schema-check",
        "command-registry",
        "backup-archive",
        "git-safety",
        "required-docs",
        "no-forbidden-files",
    ]

    monkeypatch.setattr(
        williamos_production,
        "check_global_governance",
        lambda: {"name": "global-governance", "passed": True, "detail": "global-governance ok"},
    )
    monkeypatch.setattr(
        williamos_production,
        "check_smoke_suite",
        lambda: {"name": "runtime-smoke", "passed": True, "detail": "runtime-smoke ok"},
    )
    monkeypatch.setattr(
        williamos_production,
        "check_control_center_smoke",
        lambda: {"name": "control-center-smoke", "passed": True, "detail": "control-center-smoke ok"},
    )
    monkeypatch.setattr(
        williamos_production,
        "check_restore_proof",
        lambda: {"name": "restore-proof", "passed": True, "detail": "restore-proof ok"},
    )
    monkeypatch.setattr(
        williamos_production,
        "check_schema_validation",
        lambda: {"name": "schema-check", "passed": True, "detail": "schema-check ok"},
    )
    monkeypatch.setattr(
        williamos_production,
        "check_command_registry",
        lambda: {"name": "command-registry", "passed": True, "detail": "command-registry ok"},
    )
    monkeypatch.setattr(
        williamos_production,
        "check_backup_exists",
        lambda: {"name": "backup-archive", "passed": True, "detail": "backup-archive ok"},
    )
    monkeypatch.setattr(
        williamos_production,
        "check_git_safety",
        lambda: {"name": "git-safety", "passed": True, "detail": "git-safety ok"},
    )
    monkeypatch.setattr(
        williamos_production,
        "check_required_docs",
        lambda: {"name": "required-docs", "passed": True, "detail": "required-docs ok"},
    )
    monkeypatch.setattr(
        williamos_production,
        "check_no_forbidden_files",
        lambda: {"name": "no-forbidden-files", "passed": True, "detail": "no-forbidden-files ok"},
    )

    result = williamos_production.run_production_readiness()

    assert result["verdict"] == "PASS"
    assert result["total"] == 10
    assert [check["name"] for check in result["checks"]] == gate_names
