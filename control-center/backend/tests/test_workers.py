"""Tests for Phase 5D worker registry status."""

from __future__ import annotations

import sys
from pathlib import Path


_BACKEND = str(Path(__file__).resolve().parent.parent)
if _BACKEND not in sys.path:
    sys.path.insert(0, _BACKEND)

import workers


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
                "enabled": False,
                "availability": {"command": "claude", "args": ["--version"]},
                "allowed_tasks": ["code_review"],
                "delegation_policy": {
                    "default": "confirm_required",
                    "authority": "proposal_only",
                    "may_write": False,
                    "may_commit": False,
                    "may_promote": False,
                },
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
    worker["proposal_execution"] = {
        "enabled": True,
        "command": "python",
        "args": ["-c", "import sys; print(sys.stdin.read())"],
        "timeout_seconds": 5,
        "prompt_stdin": True,
    }
    return registry


def _available(monkeypatch):
    monkeypatch.setattr(workers, "_run_availability_check", lambda availability: {
        "ok": True,
        "installed": True,
        "version": "2.1.186 (Claude Code)",
    })
    monkeypatch.setattr(workers, "_service_check", lambda availability: {"checked": False, "reachable": None})


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


def test_enabled_proposal_only_external_worker_can_only_preview_delegation():
    worker = {
        "id": "codex",
        "kind": "external_code_worker",
        "enabled": True,
        "delegation_policy": {
            "authority": "proposal_only",
            "may_write": False,
            "may_commit": False,
            "may_promote": False,
        },
    }

    result = workers.can_delegate(worker)

    assert result["allowed"] is True
    assert "approval" in result["reason"].lower()


def test_external_worker_with_write_authority_is_rejected():
    worker = {
        "id": "bad-worker",
        "kind": "external_code_worker",
        "enabled": True,
        "delegation_policy": {
            "authority": "proposal_only",
            "may_write": True,
            "may_commit": False,
            "may_promote": False,
        },
    }

    result = workers.can_delegate(worker)

    assert result["allowed"] is False
    assert "proposal-only" in result["reason"]


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
        {"repo": "william-os-devops", "allowed_paths": ["control-center/frontend"]},
        registry=_registry(),
    )

    assert result["ok"] is False
    assert result["error"] == "delegation_not_allowed"
    assert "disabled" in result["message"].lower()


def test_unavailable_worker_cannot_create_delegation_request(monkeypatch):
    registry = _registry()
    registry["workers"][0]["enabled"] = True
    monkeypatch.setattr(workers, "_run_availability_check", lambda availability: {
        "ok": False,
        "installed": False,
        "version": "",
    })
    monkeypatch.setattr(workers, "_service_check", lambda availability: {"checked": False, "reachable": None})

    result = workers.request_delegation("claude-code", "review frontend diff", registry=registry)

    assert result["ok"] is False
    assert result["error"] == "worker_unavailable"


def test_enabled_available_worker_creates_review_event(monkeypatch):
    registry = _registry()
    registry["workers"][0]["enabled"] = True
    monkeypatch.setattr(workers, "_run_availability_check", lambda availability: {
        "ok": True,
        "installed": True,
        "version": "2.1.186 (Claude Code)",
    })
    monkeypatch.setattr(workers, "_service_check", lambda availability: {"checked": False, "reachable": None})
    workers.PENDING_DELEGATIONS.clear()

    result = workers.request_delegation(
        "claude-code",
        "review frontend diff",
        {"repo": "william-os-devops", "allowed_paths": ["control-center/frontend"]},
        "External code worker requested for implementation review.",
        registry=registry,
    )

    assert result["ok"] is True
    event = result["event"]
    assert event["type"] == "delegation_review_required"
    assert event["worker"] == "claude-code"
    assert event["authority"] == "proposal_only"
    assert event["writes_allowed"] is False
    assert event["commit_allowed"] is False
    assert event["promotion_allowed"] is False
    assert event["executed"] is False
    assert event["scope"]["allowed_paths"] == ["control-center/frontend"]
    assert event["request_id"] in workers.PENDING_DELEGATIONS


def test_deny_path_records_no_delegation(monkeypatch):
    registry = _registry()
    registry["workers"][0]["enabled"] = True
    monkeypatch.setattr(workers, "_run_availability_check", lambda availability: {
        "ok": True,
        "installed": True,
        "version": "2.1.186 (Claude Code)",
    })
    monkeypatch.setattr(workers, "_service_check", lambda availability: {"checked": False, "reachable": None})
    workers.PENDING_DELEGATIONS.clear()
    workers.DELEGATION_HISTORY.clear()
    request = workers.request_delegation("claude-code", "review frontend diff", registry=registry)

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
    monkeypatch.setattr(workers, "_run_availability_check", lambda availability: {
        "ok": True,
        "installed": True,
        "version": "2.1.186 (Claude Code)",
    })
    monkeypatch.setattr(workers, "_service_check", lambda availability: {"checked": False, "reachable": None})
    workers.PENDING_DELEGATIONS.clear()
    workers.DELEGATION_HISTORY.clear()
    request = workers.request_delegation("claude-code", "review frontend diff", registry=registry)

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

    request = workers.request_delegation(
        "claude-code",
        "review frontend diff",
        {"repo": "william-os-devops", "allowed_paths": ["control-center/frontend"]},
        registry=registry,
    )
    decision = workers.decide_delegation(request["event"]["request_id"], approved=True, registry=registry)

    def fake_runner(command, prompt, timeout):
        assert "python" in command[0].lower()
        assert "Do not modify files." in prompt
        assert timeout == 5
        return {
            "returncode": 0,
            "stdout": '{"summary":"Proposal only review complete.","files_touched":[],"diff_or_patch":"","test_results":"not run"}',
            "stderr": "diagnostic log",
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
    assert event["evidence"]["logs"][1]["text"] == "diagnostic log"
    assert event["evidence"]["git_unchanged"] is True
    assert workers.DELEGATION_HISTORY[0]["executed"] is True


def test_worker_failure_is_recorded_cleanly(monkeypatch):
    registry = _enable_proposal_worker(_registry())
    _available(monkeypatch)
    monkeypatch.setattr(workers, "_git_status", lambda: "")
    workers.PENDING_DELEGATIONS.clear()
    workers.DELEGATION_HISTORY.clear()
    workers.PROPOSAL_HISTORY.clear()
    request = workers.request_delegation("claude-code", "review frontend diff", registry=registry)
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
    request = workers.request_delegation("claude-code", "review frontend diff", registry=registry)
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


def test_git_change_marks_boundary_violation(monkeypatch):
    registry = _enable_proposal_worker(_registry())
    _available(monkeypatch)
    statuses = iter(["before\n", "after\n"])
    monkeypatch.setattr(workers, "_git_status", lambda: next(statuses))
    workers.PENDING_DELEGATIONS.clear()
    workers.DELEGATION_HISTORY.clear()
    workers.PROPOSAL_HISTORY.clear()
    request = workers.request_delegation("claude-code", "review frontend diff", registry=registry)
    decision = workers.decide_delegation(request["event"]["request_id"], approved=True, registry=registry)

    result = workers.run_proposal(
        decision["decision"]["request_id"],
        registry=registry,
        runner=lambda command, prompt, timeout: {"returncode": 0, "stdout": "ok", "stderr": "", "timed_out": False},
    )

    assert result["ok"] is False
    assert result["event"]["status"] == "proposal_boundary_violation_git_changed"
    assert result["event"]["evidence"]["git_unchanged"] is False
