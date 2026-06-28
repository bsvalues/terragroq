"""Tests for the governed DevOps playbook application surface."""

from __future__ import annotations

import sys
from pathlib import Path


_BACKEND = str(Path(__file__).resolve().parent.parent)
if _BACKEND not in sys.path:
    sys.path.insert(0, _BACKEND)

import devops_playbook


def test_playbook_summary_exposes_required_operating_surfaces():
    summary = devops_playbook.playbook_summary()

    assert summary["mode"] == "devops-playbook-operational"
    assert "DevOps / Release Engineering" in summary["lanes"]
    assert "EXECUTE" in summary["modes"]
    assert "A9_CANON_PROMOTION" in summary["authority_levels"]
    assert "verify" in summary["loop_types"]
    assert len(summary["mistake_patterns"]) == 10
    assert summary["handoff_banner"]["MUTATION_AUTHORITY"].startswith("NO")
    assert len(summary["first_slices"]) == 5


def test_goal_classifier_caps_mutation_and_matches_mistake_patterns(monkeypatch):
    monkeypatch.setattr(
        devops_playbook,
        "current_truth",
        lambda: {
            "repo": "repo",
            "branch": "main",
            "head": "abc",
            "tag": [],
            "phase": "post-5e-pre-6",
            "phase_6_status": "blocked",
            "active_work_orders": ["WO-ACTIVE"],
            "posture": "HOLD",
            "worktree_dirty": True,
            "worktree_status": [" M file"],
            "allowed": ["Read current state"],
            "blocked": ["Phase 6 proactive behavior", "Mutation from generated packets while worktree has unclassified changes"],
            "last_evidence": [],
            "next_valid_move": "classify",
            "future_william_warning": "do not execute",
        },
    )

    result = devops_playbook.classify_goal(
        "automatically run AI improvements across TerraFusion Phase 6",
        authority="A2_LOCAL_MUTATION",
    )

    assert result["MODE"] == "EXECUTE"
    assert result["LANE"] == "TerraFusion Government Platform"
    assert result["AUTHORITY_REQUESTED"] == "A2_LOCAL_MUTATION"
    assert result["AUTHORITY_GRANTED"] == "A0_READ_ONLY"
    assert result["RISK"] == "P0"
    assert any(match["pattern_id"] == "MP-009" for match in result["MISTAKE_PATTERN_MATCHES"])
    assert any("Phase 6" in conflict for conflict in result["DOCTRINE_CONFLICTS"])
    assert result["work_order_draft"]["STATUS"] == "draft"
    assert result["handoff_banner"]["HANDOFF_AUTHORITY"].startswith("NONE")


def test_loop_planner_is_non_executing_and_blocks_unapproved_execute(monkeypatch):
    monkeypatch.setattr(
        devops_playbook,
        "current_truth",
        lambda: {
            "repo": "repo",
            "branch": "main",
            "head": "abc",
            "tag": [],
            "phase": "post-5e-pre-6",
            "phase_6_status": "blocked",
            "active_work_orders": [],
            "posture": "READY",
            "worktree_dirty": False,
            "worktree_status": [],
            "allowed": ["Read current state"],
            "blocked": ["Phase 6 proactive behavior"],
            "last_evidence": [],
            "next_valid_move": "classify",
            "future_william_warning": "do not execute",
        },
    )

    result = devops_playbook.run_loop_plan(
        target="WO-WILLIAMOS-PHASE5I-WORK-ORDER-ENGINE-001",
        loop_type="execute",
        authority="A0_READ_ONLY",
        max_iterations=3,
    )

    assert result["mode"] == "devops-loop-planner-non-executing"
    assert result["LOOP_TYPE"] == "EXECUTE"
    assert result["AUTHORITY"] == "A0_READ_ONLY"
    assert result["BLOCKERS"] == ["Execute loop requires explicit A2_LOCAL_MUTATION or higher authority."]
    assert result["STOP_REASON"].startswith("BLOCKED:")
    assert "No execution performed by this planner" in result["ACTIONS_TAKEN"]


def test_devops_api_routes_return_packets():
    import app
    from fastapi.testclient import TestClient

    client = TestClient(app.app)

    summary = client.get("/api/devops/playbook").json()
    truth = client.get("/api/devops/current-truth").json()
    goal = client.post(
        "/api/devops/goal",
        json={"goal": "create work order for Current Truth Panel", "authority": "A1_DRAFT_ONLY"},
    ).json()
    loop = client.post(
        "/api/devops/loop",
        json={"target": "WO-WILLIAMOS-PHASE5I-WORK-ORDER-ENGINE-001", "loop_type": "verify"},
    ).json()

    assert summary["ok"] is True
    assert truth["ok"] is True
    assert goal["ok"] is True
    assert goal["AUTHORITY_GRANTED"] == "A1_DRAFT_ONLY"
    assert goal["work_order_draft"]["WO_ID"].startswith("WO-WILLIAMOS-DEVOPS-")
    assert loop["ok"] is True
    assert loop["LOOP_TYPE"] == "VERIFY"
    assert loop["TARGET"] == "WO-WILLIAMOS-PHASE5I-WORK-ORDER-ENGINE-001"


def test_devops_api_rejects_empty_goal_and_loop_target():
    import app
    from fastapi.testclient import TestClient

    client = TestClient(app.app)

    goal = client.post("/api/devops/goal", json={"goal": ""}).json()
    loop = client.post("/api/devops/loop", json={"target": ""}).json()

    assert goal == {"ok": False, "error": "Goal is required."}
    assert loop == {"ok": False, "error": "Loop target is required."}
