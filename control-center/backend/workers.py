"""Phase 5D worker registry, delegation gates, and proposal evidence.

External workers are never WilliamOS authority here. A worker can only run after
an approved delegation record, and the only supported execution mode is
proposal-only output capture.
"""

from __future__ import annotations

import json
import shutil
import subprocess
import time
import uuid
import urllib.error
import urllib.request
from pathlib import Path
from typing import Any


BACKEND_DIR = Path(__file__).resolve().parent
PROJECT_ROOT = BACKEND_DIR.parent.parent
REGISTRY_PATH = BACKEND_DIR / "worker_registry.json"
EXTERNAL_WORKER_KINDS = {"external_code_worker", "external_agent_worker"}
PENDING_DELEGATIONS: dict[str, dict[str, Any]] = {}
DELEGATION_HISTORY: list[dict[str, Any]] = []
PROPOSAL_HISTORY: list[dict[str, Any]] = []


def load_registry(path: str | Path | None = None) -> dict[str, Any]:
    registry_path = Path(path) if path else REGISTRY_PATH
    return json.loads(registry_path.read_text(encoding="utf-8"))


def worker_status(registry: dict[str, Any] | None = None) -> dict[str, Any]:
    reg = registry or load_registry()
    workers = [_status_for_worker(worker) for worker in reg.get("workers", [])]
    return {
        "ok": True,
        "version": reg.get("version", 1),
        "control_rule": reg.get("control_rule", ""),
        "workers": workers,
        "summary": _summary(workers),
    }


def can_delegate(worker: dict[str, Any]) -> dict[str, Any]:
    """Return delegation eligibility without executing a worker."""
    if worker.get("kind") not in EXTERNAL_WORKER_KINDS:
        return {"allowed": False, "reason": "Worker is not delegatable external capacity."}
    if not worker.get("enabled", False):
        return {"allowed": False, "reason": "Worker is disabled. Delegation requires explicit enablement and approval."}
    policy = worker.get("delegation_policy", {})
    if policy.get("authority") != "proposal_only":
        return {"allowed": False, "reason": "Worker authority must be proposal_only."}
    if policy.get("may_write") or policy.get("may_commit") or policy.get("may_promote"):
        return {"allowed": False, "reason": "Worker policy allows authority beyond proposal-only."}
    return {"allowed": True, "reason": "Delegation preview allowed; execution still requires approval."}


def request_delegation(
    worker_id: str,
    task: str,
    scope: dict[str, Any] | None = None,
    reason: str = "",
    registry: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """Create a delegation review event without executing a worker."""
    task = task.strip()
    if not task:
        return {"ok": False, "error": "empty_task", "message": "Delegation request needs a task."}

    status = worker_status(registry)
    worker = next((item for item in status["workers"] if item["id"] == worker_id), None)
    if not worker:
        return {"ok": False, "error": "unknown_worker", "message": f"Worker '{worker_id}' is not registered."}

    if not worker.get("available"):
        return {"ok": False, "error": "worker_unavailable", "worker": worker, "message": "Worker is unavailable."}

    delegation = worker.get("delegation", {})
    if not delegation.get("allowed"):
        return {
            "ok": False,
            "error": "delegation_not_allowed",
            "worker": worker,
            "message": delegation.get("reason", "Worker cannot receive delegation."),
        }

    policy = worker.get("delegation_policy", {})
    request_id = uuid.uuid4().hex
    event = {
        "type": "delegation_review_required",
        "request_id": request_id,
        "worker": worker["id"],
        "worker_label": worker["label"],
        "task": task,
        "scope": _normalize_scope(scope),
        "authority": policy.get("authority", "proposal_only"),
        "writes_allowed": bool(policy.get("may_write", False)),
        "commit_allowed": bool(policy.get("may_commit", False)),
        "promotion_allowed": bool(policy.get("may_promote", False)),
        "reason": reason.strip() or "External worker delegation requested.",
        "approve_label": "Approve delegation",
        "deny_label": "Deny",
        "execution": "not_started",
        "executed": False,
        "created_at": _now(),
    }
    PENDING_DELEGATIONS[request_id] = event
    return {"ok": True, "event": event}


def decide_delegation(
    request_id: str,
    approved: bool,
    registry: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """Record approval or denial intent. This never runs a worker."""
    event = PENDING_DELEGATIONS.pop(request_id, None)
    if not event:
        return {"ok": False, "error": "unknown_request", "message": "Delegation request is not pending."}

    command_preview = ""
    execution_ready = False
    execution_message = "No external worker executed."
    if approved:
        worker = _raw_worker(event["worker"], registry or load_registry())
        proposal_execution = worker.get("proposal_execution", {}) if worker else {}
        execution_ready = bool(proposal_execution.get("enabled"))
        command_preview = _proposal_command_preview(proposal_execution) if execution_ready else ""
        execution_message = (
            "Proposal execution is ready and still requires a separate run action."
            if execution_ready
            else "Delegation approval intent recorded. Proposal execution is not configured for this worker."
        )

    decision = {
        **event,
        "type": "delegation_decision",
        "approved": bool(approved),
        "status": "approved_intent_recorded" if approved else "denied_no_delegation",
        "executed": False,
        "proposal_status": "approved_pending_execution" if approved else "denied",
        "proposal_execution_ready": execution_ready,
        "command_preview": command_preview,
        "cancel_supported": approved,
        "decided_at": _now(),
        "evidence": {
            "summary": execution_message if approved else "Delegation denied. No external worker executed.",
            "commands_run": [],
            "files_touched": [],
            "diff_or_patch": "",
            "test_results": "",
            "logs": [],
        },
    }
    DELEGATION_HISTORY.insert(0, decision)
    del DELEGATION_HISTORY[50:]
    return {"ok": True, "decision": decision}


def delegation_state() -> dict[str, Any]:
    return {
        "ok": True,
        "pending": list(PENDING_DELEGATIONS.values()),
        "history": DELEGATION_HISTORY[:20],
    }


def proposal_state() -> dict[str, Any]:
    return {
        "ok": True,
        "history": PROPOSAL_HISTORY[:20],
    }


def cancel_proposal(request_id: str) -> dict[str, Any]:
    decision = _approved_decision(request_id)
    if not decision:
        return {"ok": False, "error": "unknown_or_unapproved_request", "message": "No approved pending delegation found."}
    if decision.get("executed"):
        return {"ok": False, "error": "already_executed", "message": "Worker proposal has already run."}
    if decision.get("proposal_status") == "canceled":
        return {"ok": False, "error": "already_canceled", "message": "Worker proposal was already canceled."}

    decision["proposal_status"] = "canceled"
    event = {
        "type": "worker_proposal_canceled",
        "run_id": uuid.uuid4().hex,
        "request_id": request_id,
        "worker": decision["worker"],
        "worker_label": decision["worker_label"],
        "task": decision["task"],
        "status": "canceled_before_execution",
        "executed": False,
        "created_at": _now(),
        "evidence": {
            "summary": "Proposal execution canceled before any external worker process ran.",
            "commands_run": [],
            "files_touched": [],
            "diff_or_patch": "",
            "test_results": "",
            "logs": [],
        },
    }
    _record_proposal(event)
    return {"ok": True, "event": event}


def run_proposal(
    request_id: str,
    registry: dict[str, Any] | None = None,
    runner: Any | None = None,
) -> dict[str, Any]:
    """Run an approved worker in proposal-only mode and capture evidence."""
    decision = _approved_decision(request_id)
    if not decision:
        return {"ok": False, "error": "unknown_or_unapproved_request", "message": "No approved pending delegation found."}
    if decision.get("executed"):
        return {"ok": False, "error": "already_executed", "message": "Worker proposal has already run."}
    if decision.get("proposal_status") == "canceled":
        return {"ok": False, "error": "canceled", "message": "Worker proposal was canceled before execution."}

    reg = registry or load_registry()
    status = worker_status(reg)
    worker = next((item for item in status["workers"] if item["id"] == decision["worker"]), None)
    raw_worker = _raw_worker(decision["worker"], reg)
    if not worker or not raw_worker:
        return {"ok": False, "error": "unknown_worker", "message": "Worker is not registered."}
    if not worker.get("available"):
        event = _proposal_failure(decision, "worker_unavailable", "Worker is unavailable; no process executed.")
        _record_proposal(event)
        return {"ok": False, "error": "worker_unavailable", "event": event, "message": "Worker is unavailable."}
    if not worker.get("delegation", {}).get("allowed"):
        event = _proposal_failure(
            decision,
            "delegation_not_allowed",
            worker.get("delegation", {}).get("reason", "Worker is not allowed to execute."),
        )
        _record_proposal(event)
        return {"ok": False, "error": "delegation_not_allowed", "event": event, "message": event["evidence"]["summary"]}

    policy = worker.get("delegation_policy", {})
    if policy.get("authority") != "proposal_only" or policy.get("may_write") or policy.get("may_commit") or policy.get("may_promote"):
        event = _proposal_failure(decision, "unsafe_policy", "Worker policy exceeds proposal-only authority; no process executed.")
        _record_proposal(event)
        return {"ok": False, "error": "unsafe_policy", "event": event, "message": "Worker policy exceeds proposal-only authority."}

    execution = raw_worker.get("proposal_execution", {})
    if not execution.get("enabled"):
        event = _proposal_failure(decision, "execution_not_configured", "Proposal execution is not configured; no process executed.")
        _record_proposal(event)
        return {"ok": False, "error": "execution_not_configured", "event": event, "message": "Proposal execution is not configured."}

    command_preview = _proposal_command_preview(execution)
    prompt = _proposal_prompt(decision)
    before_status = _git_status()
    process = _run_proposal_process(execution, prompt, runner=runner)
    after_status = _git_status()
    git_unchanged = before_status == after_status
    fields = _proposal_fields(process.get("stdout", ""))
    if not process.get("timed_out") and process.get("returncode") == 0 and git_unchanged:
        status_text = "proposal_completed"
        ok = True
    elif process.get("timed_out"):
        status_text = "proposal_timeout"
        ok = False
    elif not git_unchanged:
        status_text = "proposal_boundary_violation_git_changed"
        ok = False
    else:
        status_text = "proposal_failed"
        ok = False

    event = {
        "type": "worker_proposal_run",
        "run_id": uuid.uuid4().hex,
        "request_id": request_id,
        "worker": decision["worker"],
        "worker_label": decision["worker_label"],
        "task": decision["task"],
        "scope": decision.get("scope", {}),
        "authority": "proposal_only",
        "writes_allowed": False,
        "commit_allowed": False,
        "promotion_allowed": False,
        "status": status_text,
        "executed": True,
        "command_preview": command_preview,
        "timeout_seconds": float(execution.get("timeout_seconds", 30)),
        "cancel_supported": "pre_run_cancel_only",
        "created_at": _now(),
        "evidence": {
            "summary": fields["summary"],
            "commands_run": [command_preview],
            "files_touched": fields["files_touched"],
            "diff_or_patch": fields["diff_or_patch"],
            "test_results": fields["test_results"],
            "logs": [
                {"stream": "stdout", "text": process.get("stdout", "")[:20000]},
                {"stream": "stderr", "text": process.get("stderr", "")[:20000]},
            ],
            "returncode": process.get("returncode"),
            "timed_out": bool(process.get("timed_out")),
            "git_before": before_status,
            "git_after": after_status,
            "git_unchanged": git_unchanged,
        },
    }
    decision["executed"] = True
    decision["proposal_status"] = status_text
    decision["proposal_run_id"] = event["run_id"]
    decision["evidence"] = event["evidence"]
    _record_proposal(event)
    return {"ok": ok, "event": event}


def _status_for_worker(worker: dict[str, Any]) -> dict[str, Any]:
    availability = worker.get("availability", {})
    command_result = _run_availability_check(availability)
    service_result = _service_check(availability)
    installed = command_result["installed"]

    if worker.get("kind") == "local_model_runtime":
        available = installed and service_result.get("reachable", False)
        state = "online" if available else ("service_unavailable" if installed else "not_installed")
    else:
        available = command_result["ok"]
        state = "available" if available else "unavailable"

    delegation = can_delegate(worker)

    return {
        "id": worker.get("id"),
        "label": worker.get("label"),
        "kind": worker.get("kind"),
        "mode": worker.get("mode"),
        "enabled": bool(worker.get("enabled", False)),
        "available": available,
        "state": state,
        "install": command_result,
        "service": service_result,
        "delegation": delegation,
        "allowed_tasks": worker.get("allowed_tasks", []),
        "delegation_policy": worker.get("delegation_policy", {}),
        "scope_policy": worker.get("scope_policy", {}),
        "evidence_required": worker.get("evidence_required", []),
        "proposal_execution": worker.get("proposal_execution", {}),
    }


def _approved_decision(request_id: str) -> dict[str, Any] | None:
    return next(
        (
            decision
            for decision in DELEGATION_HISTORY
            if decision.get("request_id") == request_id
            and decision.get("approved") is True
            and decision.get("status") == "approved_intent_recorded"
        ),
        None,
    )


def _raw_worker(worker_id: str, registry: dict[str, Any]) -> dict[str, Any] | None:
    return next((worker for worker in registry.get("workers", []) if worker.get("id") == worker_id), None)


def _record_proposal(event: dict[str, Any]) -> None:
    PROPOSAL_HISTORY.insert(0, event)
    del PROPOSAL_HISTORY[50:]


def _proposal_failure(decision: dict[str, Any], status: str, summary: str) -> dict[str, Any]:
    return {
        "type": "worker_proposal_run",
        "run_id": uuid.uuid4().hex,
        "request_id": decision["request_id"],
        "worker": decision["worker"],
        "worker_label": decision["worker_label"],
        "task": decision["task"],
        "scope": decision.get("scope", {}),
        "authority": "proposal_only",
        "writes_allowed": False,
        "commit_allowed": False,
        "promotion_allowed": False,
        "status": status,
        "executed": False,
        "command_preview": "",
        "created_at": _now(),
        "evidence": {
            "summary": summary,
            "commands_run": [],
            "files_touched": [],
            "diff_or_patch": "",
            "test_results": "",
            "logs": [],
        },
    }


def _proposal_command_preview(execution: dict[str, Any]) -> str:
    command = execution.get("command", "")
    args = execution.get("args", [])
    return " ".join(str(part) for part in [command, *args] if str(part).strip())


def _proposal_prompt(decision: dict[str, Any]) -> str:
    scope = decision.get("scope", {})
    paths = ", ".join(scope.get("allowed_paths", [])) or scope.get("repo", PROJECT_ROOT.name)
    return "\n".join(
        [
            "WilliamOS proposal-only worker delegation.",
            f"Task: {decision.get('task', '')}",
            f"Scope: {paths}",
            "Rules:",
            "- Do not modify files.",
            "- Do not commit.",
            "- Do not promote or mutate canon.",
            "- Do not run destructive commands.",
            "- Return summary, risks, proposed changes, files_touched, tests to run, and patch text if available.",
        ]
    )


def _run_proposal_process(
    execution: dict[str, Any],
    prompt: str,
    runner: Any | None = None,
) -> dict[str, Any]:
    command = execution.get("command", "")
    args = [str(arg) for arg in execution.get("args", [])]
    timeout = float(execution.get("timeout_seconds", 30))
    resolved = shutil.which(command) if command else None
    if not command or not resolved:
        return {
            "returncode": None,
            "stdout": "",
            "stderr": f"command_not_found: {command}",
            "timed_out": False,
        }

    command_list = [resolved, *args]
    if runner:
        return runner(command_list, prompt, timeout)

    try:
        result = subprocess.run(
            command_list,
            input=prompt if execution.get("prompt_stdin", True) else None,
            capture_output=True,
            text=True,
            encoding="utf-8",
            errors="replace",
            timeout=timeout,
            cwd=str(PROJECT_ROOT),
        )
    except subprocess.TimeoutExpired as exc:
        return {
            "returncode": None,
            "stdout": (exc.stdout or "") if isinstance(exc.stdout, str) else "",
            "stderr": (exc.stderr or "") if isinstance(exc.stderr, str) else "",
            "timed_out": True,
        }
    except Exception as exc:
        return {
            "returncode": None,
            "stdout": "",
            "stderr": str(exc)[:20000],
            "timed_out": False,
        }
    return {
        "returncode": result.returncode,
        "stdout": result.stdout,
        "stderr": result.stderr,
        "timed_out": False,
    }


def _proposal_fields(stdout: str) -> dict[str, Any]:
    fields = {
        "summary": _first_line(stdout) or "Worker proposal completed without summary.",
        "files_touched": [],
        "diff_or_patch": "",
        "test_results": "",
    }
    try:
        parsed = json.loads(stdout.strip())
    except (json.JSONDecodeError, AttributeError):
        return fields
    if not isinstance(parsed, dict):
        return fields
    fields["summary"] = str(parsed.get("summary") or fields["summary"])
    files_touched = parsed.get("files_touched", [])
    if isinstance(files_touched, list):
        fields["files_touched"] = [str(path) for path in files_touched]
    fields["diff_or_patch"] = str(parsed.get("diff_or_patch") or "")
    fields["test_results"] = str(parsed.get("test_results") or "")
    return fields


def _first_line(text: str) -> str:
    return next((line.strip() for line in text.splitlines() if line.strip()), "")


def _git_status() -> str:
    try:
        result = subprocess.run(
            ["git", "status", "--porcelain=v1"],
            capture_output=True,
            text=True,
            encoding="utf-8",
            errors="replace",
            timeout=10,
            cwd=str(PROJECT_ROOT),
        )
    except Exception as exc:
        return f"git_status_error: {str(exc)[:240]}"
    return result.stdout


def _run_availability_check(availability: dict[str, Any]) -> dict[str, Any]:
    command = availability.get("command", "")
    args = availability.get("args", [])
    timeout = float(availability.get("timeout_seconds", 5))
    expected = availability.get("expected_contains", "")
    resolved = shutil.which(command) if command else None

    if not command or not resolved:
        return {
            "ok": False,
            "installed": False,
            "command": command,
            "resolved": resolved or "",
            "version": "",
            "error": "command_not_found",
        }

    try:
        result = subprocess.run(
            [resolved, *args],
            capture_output=True,
            text=True,
            encoding="utf-8",
            errors="replace",
            timeout=timeout,
            cwd=str(PROJECT_ROOT),
        )
    except subprocess.TimeoutExpired:
        return {
            "ok": False,
            "installed": True,
            "command": command,
            "resolved": resolved,
            "version": "",
            "error": "timeout",
        }
    except Exception as exc:
        return {
            "ok": False,
            "installed": True,
            "command": command,
            "resolved": resolved,
            "version": "",
            "error": str(exc)[:240],
        }

    output = "\n".join(part.strip() for part in (result.stdout, result.stderr) if part.strip())
    expected_ok = expected.lower() in output.lower() if expected else True
    return {
        "ok": result.returncode == 0 and expected_ok,
        "installed": True,
        "command": command,
        "resolved": resolved,
        "version": output[:400],
        "returncode": result.returncode,
        "expected_match": expected_ok,
    }


def _service_check(availability: dict[str, Any]) -> dict[str, Any]:
    url = availability.get("service_url")
    if not url:
        return {"checked": False, "reachable": None}

    try:
        with urllib.request.urlopen(url, timeout=3) as resp:
            body = json.loads(resp.read().decode("utf-8"))
    except (OSError, urllib.error.URLError, json.JSONDecodeError) as exc:
        return {"checked": True, "reachable": False, "error": str(exc)[:240]}

    models = sorted(model.get("name", "") for model in body.get("models", []))
    expected_model = availability.get("expected_model", "")
    model_available = expected_model in models if expected_model else None
    return {
        "checked": True,
        "reachable": True,
        "models": models,
        "expected_model": expected_model,
        "expected_model_available": model_available,
    }


def _summary(workers: list[dict[str, Any]]) -> dict[str, int]:
    return {
        "total": len(workers),
        "available": sum(1 for worker in workers if worker.get("available")),
        "enabled": sum(1 for worker in workers if worker.get("enabled")),
        "delegatable": sum(1 for worker in workers if worker.get("delegation", {}).get("allowed")),
        "disabled_external": sum(
            1
            for worker in workers
            if worker.get("kind") in EXTERNAL_WORKER_KINDS and not worker.get("enabled")
        ),
    }


def _normalize_scope(scope: dict[str, Any] | None) -> dict[str, Any]:
    scope = scope or {}
    allowed_paths = scope.get("allowed_paths") or []
    if not isinstance(allowed_paths, list):
        allowed_paths = []
    return {
        "repo": str(scope.get("repo") or PROJECT_ROOT.name),
        "allowed_paths": [str(path) for path in allowed_paths],
    }


def _now() -> str:
    return time.strftime("%Y-%m-%dT%H:%M:%S")
