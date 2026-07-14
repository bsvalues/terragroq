"""Tests for Phase 5D worker registry status."""

from __future__ import annotations

import sys
from pathlib import Path


_BACKEND = str(Path(__file__).resolve().parent.parent)
if _BACKEND not in sys.path:
    sys.path.insert(0, _BACKEND)

import workers


def _trust_gate(worker_id: str = "claude-code") -> dict:
    return {
        "schemaVersion": 2,
        "workerIdentity": {
            "workerId": worker_id,
            "provider": "fixture-provider",
            "surface": "fixture-provider-surface",
            "attributable": True,
        },
        "rawCredentialInspection": False,
        "promptInjectionBoundary": "trusted-work-order-envelope-v1",
        "exactPathConfinement": True,
        "outputRedaction": True,
        "cancellation": {"supported": True, "mode": "pre-dispatch"},
        "independentEvidenceCapture": True,
    }


def _registry() -> dict:
    return {
        "version": 1,
        "control_rule": "WilliamOS delegates.",
        "workers": [
            {
                "id": "claude-code",
                "label": "Claude Code",
                "kind": "external_code_worker",
                "mode": "external_cli",
                "catalog_status": "registered",
                "execution_status": "disabled",
                "enabled": False,
                "availability": {"command": "claude", "args": ["--version"]},
                "allowed_tasks": ["code_review"],
                "delegation_policy": {
                    "default": "work_order_grant_required",
                    "authority": "work_order_bounded",
                    "may_write": True,
                    "may_commit": True,
                    "may_promote": False,
                },
                "execution_policy": {
                    "requires_work_order_grant": True,
                    "max_authority": "A8_PUSH",
                    "allowed_actions": ["inspect", "proposal", "write", "test", "commit", "push", "open_pr", "merge"],
                },
                "preventive_trust_gate_v2": _trust_gate(),
                "scope_policy": {"blocked_paths": [".env", "copilot.db"]},
                "evidence_required": ["summary"],
            },
            {
                "id": "ollama",
                "label": "Ollama",
                "kind": "local_model_runtime",
                "mode": "local_service",
                "enabled": True,
                "availability": {"command": "ollama", "args": ["--version"], "service_url": "http://127.0.0.1:11434/api/tags"},
                "allowed_tasks": ["local_reasoning"],
                "delegation_policy": {"default": "not_delegatable", "authority": "runtime_capacity"},
                "scope_policy": {},
                "evidence_required": ["model"],
            },
        ],
    }


def _enable_proposal_worker(registry: dict) -> dict:
    worker = registry["workers"][0]
    worker["enabled"] = True
    worker["execution_status"] = "available"
    worker["proposal_execution"] = {
        "enabled": True,
        "command": "python",
        "args": ["-c", "import sys; print(sys.stdin.read())"],
        "timeout_seconds": 5,
        "prompt_stdin": True,
    }
    return registry


def _execution_grant(
    *,
    worker_id: str = "claude-code",
    authority: str = "A1_DRAFT",
    actions: list[str] | None = None,
    paths: list[str] | None = None,
    status: str = "active",
) -> dict:
    return {
        "status": status,
        "work_order_id": "WO-MAO-TEST-001",
        "worker_id": worker_id,
        "authority": authority,
        "allowed_actions": actions or ["proposal"],
        "allowed_paths": paths or ["control-center/frontend"],
    }


def _scope(**grant_overrides) -> dict:
    return {
        "repo": "william-os-devops",
        "allowed_paths": ["control-center/frontend"],
        "execution_grant": _execution_grant(**grant_overrides),
    }


def _available(monkeypatch):
    monkeypatch.setattr(workers, "_run_availability_check", lambda availability: {
        "ok": True,
        "installed": True,
        "version": "2.1.186 (Claude Code)",
    })
    monkeypatch.setattr(workers, "_service_check", lambda availability: {"checked": False, "reachable": None})


def test_registered_provider_lanes_are_not_claimed_as_executable():
    registry = workers.load_registry()
    codex = next(worker for worker in registry["workers"] if worker["id"] == "codex")
    claude = next(worker for worker in registry["workers"] if worker["id"] == "claude-code")

    assert "Bill approves" not in registry["control_rule"]
    assert codex["catalog_status"] == claude["catalog_status"] == "registered"
    assert codex["execution_status"] == "hosted_transport_unproven"
    assert claude["execution_status"] == "provider_lane_unproven"
    assert codex["enabled"] is claude["enabled"] is False
    assert codex["execution_policy"]["max_authority"] == "A8_PUSH"
    assert claude["execution_policy"]["max_authority"] == "A8_PUSH"
    for worker in (codex, claude):
        gate = worker["preventive_trust_gate_v2"]
        assert gate["workerIdentity"]["workerId"] == worker["id"]
        assert gate["workerIdentity"]["attributable"] is True
        assert gate["rawCredentialInspection"] is False
        assert gate["promptInjectionBoundary"] == "trusted-work-order-envelope-v1"
        assert gate["exactPathConfinement"] is True
        assert gate["outputRedaction"] is True
        assert gate["cancellation"]["supported"] is True
        assert gate["independentEvidenceCapture"] is True
    legacy = next(adapter for adapter in codex["legacy_adapters"] if adapter["id"] == "local-nested-codex-exec")
    assert legacy["status"] == "quarantined_terminal"
    assert legacy["execution_allowed"] is False


def test_disabled_external_worker_is_not_delegatable(monkeypatch):
    monkeypatch.setattr(workers, "_run_availability_check", lambda availability: {
        "ok": True,
        "installed": True,
        "version": "2.1.186 (Claude Code)",
    })
    monkeypatch.setattr(workers, "_service_check", lambda availability: {"checked": False, "reachable": None})

    result = workers.worker_status(_registry())
    claude = next(worker for worker in result["workers"] if worker["id"] == "claude-code")

    assert claude["available"] is True
    assert claude["enabled"] is False
    assert claude["delegation"]["allowed"] is False
    assert "disabled" in claude["delegation"]["reason"].lower()
    assert result["summary"]["delegatable"] == 0


def test_ollama_reports_install_and_service_separately(monkeypatch):
    def fake_availability(availability):
        return {"ok": True, "installed": True, "version": "ollama version 0.30.10"}

    def fake_service(availability):
        return {"checked": True, "reachable": False, "error": "connection refused"}

    monkeypatch.setattr(workers, "_run_availability_check", fake_availability)
    monkeypatch.setattr(workers, "_service_check", fake_service)

    result = workers.worker_status(_registry())
    ollama = next(worker for worker in result["workers"] if worker["id"] == "ollama")

    assert ollama["install"]["installed"] is True
    assert ollama["service"]["checked"] is True
    assert ollama["service"]["reachable"] is False
    assert ollama["available"] is False
    assert ollama["state"] == "service_unavailable"
    assert ollama["delegation"]["allowed"] is False


def test_executable_external_worker_requires_bounded_work_order_grant():
    worker = {
        "id": "codex",
        "kind": "external_code_worker",
        "catalog_status": "registered",
        "execution_status": "available",
        "enabled": True,
        "execution_policy": {
            "max_authority": "A8_PUSH",
            "allowed_actions": ["inspect", "write", "test", "commit", "push", "open_pr"],
        },
        "preventive_trust_gate_v2": _trust_gate("codex"),
        "scope_policy": {"blocked_paths": [".env", "*.pem"]},
    }

    missing = workers.can_delegate(worker)
    result = workers.can_delegate(
        worker,
        _execution_grant(worker_id="codex", authority="A8_PUSH", actions=["write", "test", "commit", "push", "open_pr"]),
        {
            "allowed_paths": ["control-center/frontend"],
        },
    )

    assert missing["allowed"] is False
    assert "work-order execution grant" in missing["reason"]
    assert result["allowed"] is True
    assert "WO-MAO-TEST-001" in result["reason"]


def test_execution_grant_over_cap_or_blocked_path_is_rejected():
    worker = {
        "id": "bad-worker",
        "kind": "external_code_worker",
        "catalog_status": "registered",
        "execution_status": "available",
        "enabled": True,
        "execution_policy": {
            "max_authority": "A2_WRITE_OWN",
            "allowed_actions": ["inspect", "write", "test"],
        },
        "preventive_trust_gate_v2": _trust_gate("bad-worker"),
        "scope_policy": {"blocked_paths": [".env", "*.pem"]},
    }

    over_cap = workers.can_delegate(
        worker,
        _execution_grant(worker_id="bad-worker", authority="A8_PUSH", actions=["write"]),
        {"allowed_paths": ["control-center/frontend"]},
    )
    blocked = workers.can_delegate(
        worker,
        _execution_grant(worker_id="bad-worker", authority="A2_WRITE_OWN", actions=["write"], paths=["keys/prod.pem"]),
        {"allowed_paths": ["keys/prod.pem"]},
    )

    assert over_cap["allowed"] is False
    assert "exceeds worker cap" in over_cap["reason"]
    assert blocked["allowed"] is False
    assert "blocked paths" in blocked["reason"]


def test_preventive_trust_gate_v2_accepts_complete_matching_contract():
    worker = _registry()["workers"][0]
    worker["enabled"] = True
    worker["execution_status"] = "available"
    grant = _execution_grant()
    scope = {"allowed_paths": ["control-center/frontend"]}

    result = workers.can_delegate(worker, grant, scope)

    assert result["allowed"] is True
    assert result["reason_code"] == "EXECUTABLE_WORKER_TRUST_GATE_PASSED"
    assert result["trust_gate"] == {
        "schemaVersion": 2,
        "workerId": "claude-code",
        "provider": "fixture-provider",
        "surface": "fixture-provider-surface",
        "promptInjectionBoundary": "trusted-work-order-envelope-v1",
        "allowedPaths": ["control-center/frontend"],
        "rawCredentialInspection": False,
        "outputRedaction": True,
        "cancellationSupported": True,
        "independentEvidenceCapture": True,
    }


def test_preventive_trust_gate_v2_fails_closed_for_missing_false_or_mismatched_controls():
    base = _registry()["workers"][0]
    base["enabled"] = True
    base["execution_status"] = "available"
    grant = _execution_grant()
    scope = {"allowed_paths": ["control-center/frontend"]}
    mutations = [
        ("missing", lambda gate: None, "PREVENTIVE_TRUST_GATE_V2_MISSING"),
        ("identity", lambda gate: gate["workerIdentity"].update({"workerId": "someone-else"}), "WORKER_IDENTITY_MISMATCH"),
        ("credentials", lambda gate: gate.update({"rawCredentialInspection": True}), "RAW_CREDENTIAL_INSPECTION_FORBIDDEN"),
        ("boundary", lambda gate: gate.update({"promptInjectionBoundary": "claimed-but-not-enforced"}), "PROMPT_INJECTION_BOUNDARY_UNRECOGNIZED"),
        ("paths", lambda gate: gate.update({"exactPathConfinement": False}), "EXACT_PATH_CONFINEMENT_REQUIRED"),
        ("redaction", lambda gate: gate.update({"outputRedaction": False}), "OUTPUT_REDACTION_REQUIRED"),
        ("cancel", lambda gate: gate["cancellation"].update({"supported": False}), "CANCELLATION_REQUIRED"),
        ("evidence", lambda gate: gate.update({"independentEvidenceCapture": False}), "INDEPENDENT_EVIDENCE_CAPTURE_REQUIRED"),
    ]

    for name, mutate, expected in mutations:
        worker = _registry()["workers"][0]
        worker["enabled"] = True
        worker["execution_status"] = "available"
        gate = worker["preventive_trust_gate_v2"]
        if name == "missing":
            worker.pop("preventive_trust_gate_v2")
        else:
            mutate(gate)
        result = workers.can_delegate(worker, grant, scope)
        assert result["allowed"] is False, name
        assert result["reason_code"] == expected, name


def test_preventive_trust_gate_v2_rejects_scope_mismatch_and_unsafe_paths():
    worker = _registry()["workers"][0]
    worker["enabled"] = True
    worker["execution_status"] = "available"

    mismatch = workers.can_delegate(
        worker,
        _execution_grant(paths=["control-center/frontend"]),
        {"allowed_paths": ["control-center/backend"]},
    )
    wildcard = workers.can_delegate(
        worker,
        _execution_grant(paths=["control-center/*"]),
        {"allowed_paths": ["control-center/*"]},
    )
    traversal = workers.can_delegate(
        worker,
        _execution_grant(paths=["../secrets"]),
        {"allowed_paths": ["../secrets"]},
    )

    assert mismatch["reason_code"] == "EXACT_PATH_SCOPE_MISMATCH"
    assert wildcard["reason_code"] == "EXACT_PATH_SCOPE_INVALID"
    assert traversal["reason_code"] == "EXACT_PATH_SCOPE_INVALID"


def test_disabled_worker_cannot_create_delegation_request(monkeypatch):
    monkeypatch.setattr(workers, "_run_availability_check", lambda availability: {
        "ok": True,
        "installed": True,
        "version": "2.1.186 (Claude Code)",
    })
    monkeypatch.setattr(workers, "_service_check", lambda availability: {"checked": False, "reachable": None})

    result = workers.request_delegation(
        "claude-code",
        "review frontend diff",
        _scope(),
        registry=_registry(),
    )

    assert result["ok"] is False
    assert result["error"] == "delegation_not_allowed"
    assert "disabled" in result["message"].lower()


def test_unavailable_worker_cannot_create_delegation_request(monkeypatch):
    registry = _registry()
    registry["workers"][0]["enabled"] = True
    registry["workers"][0]["execution_status"] = "available"
    monkeypatch.setattr(workers, "_run_availability_check", lambda availability: {
        "ok": False,
        "installed": False,
        "version": "",
    })
    monkeypatch.setattr(workers, "_service_check", lambda availability: {"checked": False, "reachable": None})

    result = workers.request_delegation("claude-code", "review frontend diff", scope=_scope(), registry=registry)

    assert result["ok"] is False
    assert result["error"] == "worker_unavailable"


def test_enabled_available_worker_creates_review_event(monkeypatch):
    registry = _registry()
    registry["workers"][0]["enabled"] = True
    registry["workers"][0]["execution_status"] = "available"
    monkeypatch.setattr(workers, "_run_availability_check", lambda availability: {
        "ok": True,
        "installed": True,
        "version": "2.1.186 (Claude Code)",
    })
    monkeypatch.setattr(workers, "_service_check", lambda availability: {"checked": False, "reachable": None})
    workers.PENDING_DELEGATIONS.clear()

    result = workers.request_delegation(
        "claude-code",
        "implement and open a pull request",
        _scope(authority="A8_PUSH", actions=["write", "test", "commit", "push", "open_pr", "merge"]),
        "External code worker requested for bounded implementation.",
        registry=registry,
    )

    assert result["ok"] is True
    event = result["event"]
    assert event["type"] == "delegation_review_required"
    assert event["worker"] == "claude-code"
    assert event["authority"] == "A8_PUSH"
    assert event["writes_allowed"] is True
    assert event["commit_allowed"] is True
    assert event["promotion_allowed"] is False
    assert event["executed"] is False
    assert event["scope"]["allowed_paths"] == ["control-center/frontend"]
    assert event["request_id"] in workers.PENDING_DELEGATIONS


def test_deny_path_records_no_delegation(monkeypatch):
    registry = _registry()
    registry["workers"][0]["enabled"] = True
    registry["workers"][0]["execution_status"] = "available"
    monkeypatch.setattr(workers, "_run_availability_check", lambda availability: {
        "ok": True,
        "installed": True,
        "version": "2.1.186 (Claude Code)",
    })
    monkeypatch.setattr(workers, "_service_check", lambda availability: {"checked": False, "reachable": None})
    workers.PENDING_DELEGATIONS.clear()
    workers.DELEGATION_HISTORY.clear()
    request = workers.request_delegation("claude-code", "review frontend diff", scope=_scope(), registry=registry)

    result = workers.decide_delegation(request["event"]["request_id"], approved=False)

    assert result["ok"] is True
    decision = result["decision"]
    assert decision["approved"] is False
    assert decision["status"] == "denied_no_delegation"
    assert decision["executed"] is False
    assert decision["evidence"]["commands_run"] == []
    assert not workers.PENDING_DELEGATIONS
    assert workers.DELEGATION_HISTORY[0]["request_id"] == decision["request_id"]


def test_approval_path_records_intent_only(monkeypatch):
    registry = _registry()
    registry["workers"][0]["enabled"] = True
    registry["workers"][0]["execution_status"] = "available"
    monkeypatch.setattr(workers, "_run_availability_check", lambda availability: {
        "ok": True,
        "installed": True,
        "version": "2.1.186 (Claude Code)",
    })
    monkeypatch.setattr(workers, "_service_check", lambda availability: {"checked": False, "reachable": None})
    workers.PENDING_DELEGATIONS.clear()
    workers.DELEGATION_HISTORY.clear()
    request = workers.request_delegation("claude-code", "review frontend diff", scope=_scope(), registry=registry)

    result = workers.decide_delegation(request["event"]["request_id"], approved=True)

    assert result["ok"] is True
    decision = result["decision"]
    assert decision["approved"] is True
    assert decision["status"] == "approved_intent_recorded"
    assert decision["executed"] is False
    assert decision["evidence"]["summary"].startswith("Delegation approval intent recorded")
    assert decision["evidence"]["commands_run"] == []


def test_disabled_worker_cannot_execute_even_with_stale_approval(monkeypatch):
    registry = _registry()
    _available(monkeypatch)
    workers.DELEGATION_HISTORY.clear()
    workers.PROPOSAL_HISTORY.clear()
    workers.DELEGATION_HISTORY.insert(0, {
        "request_id": "req-disabled",
        "worker": "claude-code",
        "worker_label": "Claude Code",
        "task": "review frontend diff",
        "scope": {"repo": "william-os-devops", "allowed_paths": ["control-center/frontend"]},
        "approved": True,
        "status": "approved_intent_recorded",
        "executed": False,
    })

    result = workers.run_proposal("req-disabled", registry=registry)

    assert result["ok"] is False
    assert result["error"] == "delegation_not_allowed"
    assert result["event"]["executed"] is False
    assert result["event"]["evidence"]["commands_run"] == []


def test_unavailable_worker_cannot_execute_after_approval(monkeypatch):
    registry = _enable_proposal_worker(_registry())
    monkeypatch.setattr(workers, "_run_availability_check", lambda availability: {
        "ok": False,
        "installed": False,
        "version": "",
    })
    monkeypatch.setattr(workers, "_service_check", lambda availability: {"checked": False, "reachable": None})
    workers.DELEGATION_HISTORY.clear()
    workers.PROPOSAL_HISTORY.clear()
    workers.DELEGATION_HISTORY.insert(0, {
        "request_id": "req-unavailable",
        "worker": "claude-code",
        "worker_label": "Claude Code",
        "task": "review frontend diff",
        "scope": {"repo": "william-os-devops", "allowed_paths": ["control-center/frontend"]},
        "approved": True,
        "status": "approved_intent_recorded",
        "executed": False,
    })

    result = workers.run_proposal("req-unavailable", registry=registry)

    assert result["ok"] is False
    assert result["error"] == "worker_unavailable"
    assert workers.PROPOSAL_HISTORY[0]["status"] == "worker_unavailable"


def test_approved_proposal_run_captures_evidence_and_git_unchanged(monkeypatch):
    registry = _enable_proposal_worker(_registry())
    _available(monkeypatch)
    monkeypatch.setattr(workers, "_git_status", lambda: " M unrelated-user-file\n")
    workers.PENDING_DELEGATIONS.clear()
    workers.DELEGATION_HISTORY.clear()
    workers.PROPOSAL_HISTORY.clear()
    workers.TRUST_GATE_HISTORY.clear()

    request = workers.request_delegation("claude-code", "review frontend diff", _scope(), registry=registry)
    decision = workers.decide_delegation(request["event"]["request_id"], approved=True, registry=registry)

    def fake_runner(command, prompt, timeout):
        assert "python" in command[0].lower()
        assert "Do not modify files." in prompt
        assert "PROMPT_INJECTION_BOUNDARY=trusted-work-order-envelope-v1" in prompt
        assert "BEGIN_UNTRUSTED_WORK_ORDER_DATA_JSON" in prompt
        assert "END_UNTRUSTED_WORK_ORDER_DATA_JSON" in prompt
        assert timeout == 5
        return {
            "returncode": 0,
            "stdout": '{"summary":"Proposal only review complete.","api_key":"sk-proj-fixturesecret123456789","files_touched":[],"diff_or_patch":"","test_results":"not run"}',
            "stderr": "Authorization: Bearer fixture-secret-token",
            "timed_out": False,
        }

    result = workers.run_proposal(decision["decision"]["request_id"], registry=registry, runner=fake_runner)

    assert result["ok"] is True
    event = result["event"]
    assert event["status"] == "proposal_completed"
    assert event["command_preview"].startswith("python ")
    assert event["evidence"]["summary"] == "Proposal only review complete."
    assert event["evidence"]["commands_run"] == [event["command_preview"]]
    assert event["evidence"]["files_touched"] == []
    assert event["evidence"]["test_results"] == "not run"
    assert event["evidence"]["logs"][0]["stream"] == "stdout"
    persisted_output = "\n".join(log["text"] for log in event["evidence"]["logs"])
    assert "fixturesecret" not in persisted_output
    assert "fixture-secret-token" not in persisted_output
    assert "[REDACTED" in persisted_output
    assert event["evidence"]["git_unchanged"] is True
    assert workers.DELEGATION_HISTORY[0]["executed"] is True
    assert len(workers.TRUST_GATE_HISTORY) == 2
    run_gate, request_gate = workers.TRUST_GATE_HISTORY
    assert run_gate["phase"] == "run"
    assert request_gate["phase"] == "request"
    assert run_gate["provider_output_captured"] is False
    assert run_gate["controls"]["independentEvidenceCapture"] is True
    assert event["trust_gate_evidence_id"] == run_gate["evidence_id"]
    assert decision["decision"]["trust_gate_evidence_id"] == request_gate["evidence_id"]
    assert workers.trust_gate_state()["history"][0] == run_gate


def test_worker_failure_is_recorded_cleanly(monkeypatch):
    registry = _enable_proposal_worker(_registry())
    _available(monkeypatch)
    monkeypatch.setattr(workers, "_git_status", lambda: "")
    workers.PENDING_DELEGATIONS.clear()
    workers.DELEGATION_HISTORY.clear()
    workers.PROPOSAL_HISTORY.clear()
    workers.TRUST_GATE_HISTORY.clear()
    request = workers.request_delegation("claude-code", "review frontend diff", scope=_scope(), registry=registry)
    decision = workers.decide_delegation(request["event"]["request_id"], approved=True, registry=registry)

    result = workers.run_proposal(
        decision["decision"]["request_id"],
        registry=registry,
        runner=lambda command, prompt, timeout: {
            "returncode": 2,
            "stdout": "",
            "stderr": "worker failed",
            "timed_out": False,
        },
    )

    assert result["ok"] is False
    assert result["event"]["status"] == "proposal_failed"
    assert result["event"]["evidence"]["logs"][1]["text"] == "worker failed"
    assert workers.PROPOSAL_HISTORY[0]["request_id"] == decision["decision"]["request_id"]


def test_proposal_timeout_and_cancel_paths(monkeypatch):
    registry = _enable_proposal_worker(_registry())
    _available(monkeypatch)
    workers.PENDING_DELEGATIONS.clear()
    workers.DELEGATION_HISTORY.clear()
    workers.PROPOSAL_HISTORY.clear()
    workers.TRUST_GATE_HISTORY.clear()
    request = workers.request_delegation("claude-code", "review frontend diff", scope=_scope(), registry=registry)
    decision = workers.decide_delegation(request["event"]["request_id"], approved=True, registry=registry)

    canceled = workers.cancel_proposal(decision["decision"]["request_id"])
    rerun = workers.run_proposal(
        decision["decision"]["request_id"],
        registry=registry,
        runner=lambda command, prompt, timeout: {"returncode": 0, "stdout": "", "stderr": "", "timed_out": False},
    )

    assert canceled["ok"] is True
    assert canceled["event"]["status"] == "canceled_before_execution"
    assert rerun["ok"] is False
    assert rerun["error"] == "canceled"
    assert len(workers.TRUST_GATE_HISTORY) == 1
    assert workers.TRUST_GATE_HISTORY[0]["phase"] == "request"
    assert workers.TRUST_GATE_HISTORY[0]["controls"]["cancellationSupported"] is True


def test_git_change_marks_boundary_violation(monkeypatch):
    registry = _enable_proposal_worker(_registry())
    _available(monkeypatch)
    statuses = iter(["before\n", "after\n"])
    monkeypatch.setattr(workers, "_git_status", lambda: next(statuses))
    workers.PENDING_DELEGATIONS.clear()
    workers.DELEGATION_HISTORY.clear()
    workers.PROPOSAL_HISTORY.clear()
    request = workers.request_delegation("claude-code", "review frontend diff", scope=_scope(), registry=registry)
    decision = workers.decide_delegation(request["event"]["request_id"], approved=True, registry=registry)

    result = workers.run_proposal(
        decision["decision"]["request_id"],
        registry=registry,
        runner=lambda command, prompt, timeout: {"returncode": 0, "stdout": "ok", "stderr": "", "timed_out": False},
    )

    assert result["ok"] is False
    assert result["event"]["status"] == "proposal_boundary_violation_git_changed"
    assert result["event"]["evidence"]["git_unchanged"] is False
