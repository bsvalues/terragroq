"""WilliamOS Control Center — API Server.

Local-first FastAPI server. No cloud, no auth, no external dependencies.
Run: python app.py
"""

import json
import sys
import os

sys.path.insert(0, os.path.dirname(__file__))

from fastapi import FastAPI, File, Form, Request, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, StreamingResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field
from pathlib import Path

import state_reader
import command_runner
import agent
import research_intake
import workers
import decision_register
import doctrine_registry
import work_order_registry
import work_order_composer
import validation_runbook_registry
import agent_config_inventory
import agent_skills_registry
import evidence_pack_generator
import repo_state_dashboard
import commit_readiness_reviewer
import handoff_packet_exporter
import operator_review_inbox
import decision_gate_console
import operator_action_router_preview
import authority_ledger_preview
import owner_decision_record_preview
import approval_packet_preview
import goal_registry_preview
import loop_registry_preview
import goal_loop_readiness_reviewer
import goal_command_preview
import loop_command_preview
import governed_goal_loop_console
import devops_playbook
import command_center
from copilot import loop, memory as _memory_mod, llm, briefing

# --- Module-level singletons ---

MEMORY = _memory_mod.Memory()
PENDING: dict = {}  # Paused turns keyed by call_id

app = FastAPI(title="WilliamOS Control Center", version="1.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://localhost:3000", "http://127.0.0.1:5173"],
    allow_methods=["*"],
    allow_headers=["*"],
)

FRONTEND_DIST = Path(__file__).resolve().parent.parent / "frontend" / "dist"


# --- Models ---

class CaptureRequest(BaseModel):
    text: str

class CommandRequest(BaseModel):
    command: str
    args: list[str] = []
    confirmed: bool = False

class SearchRequest(BaseModel):
    query: str

class AgentAskRequest(BaseModel):
    question: str = ""

class ReviewPathRequest(BaseModel):
    path: str

class AcceptRequest(BaseModel):
    draft_path: str
    dest: str
    confirmation: str

class ChatRequest(BaseModel):
    message: str
    session: str | None = None

class ApproveRequest(BaseModel):
    call_id: str
    approved: bool

class DelegationRequest(BaseModel):
    worker_id: str
    task: str
    scope: dict = {}
    reason: str = ""

class DelegationDecisionRequest(BaseModel):
    request_id: str
    approved: bool

class ProposalRunRequest(BaseModel):
    request_id: str

class MemoryFactEditRequest(BaseModel):
    text: str
    evidence: dict = Field(default_factory=dict)

class MemoryFactStaleRequest(BaseModel):
    stale: bool = True
    evidence: dict = Field(default_factory=dict)

class MemoryFactAuthorityRequest(BaseModel):
    authority_state: str
    confirmation: str = ""
    evidence: dict = Field(default_factory=dict)

class MemoryFactDeleteRequest(BaseModel):
    confirmation: str
    evidence: dict = Field(default_factory=dict)

class DoctrineCheckRequest(BaseModel):
    action: str

class DevOpsGoalRequest(BaseModel):
    goal: str
    lane: str = ""
    mode: str = ""
    authority: str = "A0_READ_ONLY"

class DevOpsLoopRequest(BaseModel):
    target: str
    loop_type: str = "verify"
    authority: str = "A0_READ_ONLY"
    max_iterations: int = 1
    stop_on: str = ""
    evidence: str = ""

class CommandPreviewRequest(BaseModel):
    command: str
    args: list[str] = Field(default_factory=list)
    dry_run: bool = False

class WorkOrderComposeRequest(BaseModel):
    objective: str
    title: str = ""
    phase: str = "5N"
    lane: str = "Work Order Composer"
    mode: str = "local-only governed development"
    allowed_scope: list[str] = Field(default_factory=list)
    denied_actions: list[str] = Field(default_factory=list)
    validators: list[str] = Field(default_factory=list)
    validator_runbook_ids: list[str] = Field(default_factory=list)
    evidence_outputs: list[str] = Field(default_factory=list)
    commit_rules: list[str] = Field(default_factory=list)
    stop_conditions: list[str] = Field(default_factory=list)
    owner_decisions: list[str] = Field(default_factory=list)


# --- API Routes ---

@app.get("/api/status")
def api_status():
    return {"status": "ok", "version": "1.0.0", "engine": "WilliamOS v1.2.0"}


@app.get("/api/home")
def api_home():
    return state_reader.get_home_summary()


@app.get("/api/today")
def api_today():
    return state_reader.get_today_note()


@app.post("/api/capture")
def api_capture(req: CaptureRequest):
    if not req.text.strip():
        return {"ok": False, "error": "Empty text"}
    result = command_runner.run_safe("inbox", [req.text.strip()])
    return result


@app.post("/api/research-intake")
async def api_research_intake(
    file: UploadFile = File(...),
    classification: str = Form("Research"),
):
    content = await file.read()
    if not content:
        return {"ok": False, "error": "Empty file", "message": "Research intake needs a non-empty file."}
    return research_intake.ingest_file(
        filename=file.filename or "research-file",
        content=content,
        content_type=file.content_type,
        classification=classification,
    )


@app.get("/api/research-intake/history")
def api_research_intake_history(limit: int = 20):
    return research_intake.history(limit=limit)


@app.get("/api/workers/status")
def api_workers_status():
    return workers.worker_status()


@app.post("/api/workers/delegation/request")
def api_workers_delegation_request(req: DelegationRequest):
    return workers.request_delegation(
        worker_id=req.worker_id,
        task=req.task,
        scope=req.scope,
        reason=req.reason,
    )


@app.post("/api/workers/delegation/decide")
def api_workers_delegation_decide(req: DelegationDecisionRequest):
    return workers.decide_delegation(req.request_id, req.approved)


@app.get("/api/workers/delegation/state")
def api_workers_delegation_state():
    return workers.delegation_state()


@app.post("/api/workers/proposal/run")
def api_workers_proposal_run(req: ProposalRunRequest):
    return workers.run_proposal(req.request_id)


@app.post("/api/workers/proposal/cancel")
def api_workers_proposal_cancel(req: ProposalRunRequest):
    return workers.cancel_proposal(req.request_id)


@app.get("/api/workers/proposal/history")
def api_workers_proposal_history():
    return workers.proposal_state()


@app.get("/api/review-queues")
def api_review_queues():
    return state_reader.get_review_queue_summary()


@app.post("/api/review-queues/refresh")
def api_review_queues_refresh():
    return command_runner.run_safe("review-queues")


@app.get("/api/safety")
def api_safety():
    return agent.summarize_safety()


@app.post("/api/agent/next")
def api_agent_next():
    return agent.get_next_action()


@app.post("/api/agent/today")
def api_agent_today():
    return agent.summarize_today()


@app.post("/api/agent/review-queues")
def api_agent_review_queues():
    return agent.explain_review_queues()


@app.post("/api/agent/health")
def api_agent_health():
    return agent.explain_health()


@app.post("/api/agent/ignore")
def api_agent_ignore():
    return agent.what_can_i_ignore()


@app.get("/api/review/items")
def api_review_items():
    return state_reader.get_review_items()


@app.get("/api/review/item")
def api_review_item(path: str):
    validation = state_reader.validate_review_path(path)
    if not validation["valid"]:
        return {"ok": False, "error": validation["reason"]}
    return state_reader.get_review_item(path)


@app.post("/api/acceptance/plan")
def api_acceptance_plan(req: ReviewPathRequest):
    validation = state_reader.validate_review_path(req.path)
    if not validation["valid"]:
        return {"ok": False, "error": validation["reason"]}
    return state_reader.generate_acceptance_plan(req.path)


@app.post("/api/agent/review-draft")
def api_agent_review_draft(req: ReviewPathRequest):
    return agent.review_draft(req.path)


@app.post("/api/acceptance/accept")
def api_acceptance_accept(req: AcceptRequest):
    if req.confirmation != "ACCEPT":
        return {"ok": False, "error": "Confirmation must be exactly: ACCEPT"}

    path_v = state_reader.validate_review_path(req.draft_path)
    if not path_v["valid"]:
        return {"ok": False, "error": path_v["reason"]}

    dest_v = state_reader.validate_acceptance_dest(req.dest)
    if not dest_v["valid"]:
        return {"ok": False, "error": dest_v["reason"]}

    result = command_runner.run_acceptance(req.draft_path, req.dest)
    if not result["ok"]:
        msg = result.get("stderr") or result.get("stdout") or result.get("error") or "Acceptance failed"
        return {"ok": False, "error": msg}

    return {
        "ok": True,
        "stdout": result["stdout"],
        "draft_path": req.draft_path,
        "dest": req.dest,
    }


@app.post("/api/closure/checklist")
def api_closure_checklist():
    return command_runner.run_safe("post-acceptance-checklist")


@app.post("/api/closure/dry-run")
def api_closure_dry_run():
    return command_runner.run_safe("post-acceptance", ["--dry-run"])


@app.post("/api/closure/run")
def api_closure_run():
    return command_runner.run_safe("post-acceptance")


@app.post("/api/git/snapshot-dry-run")
def api_git_snapshot_dry_run():
    return command_runner.run_snapshot_dry_run()


@app.post("/api/agent/post-acceptance")
def api_agent_post_acceptance():
    return agent.post_acceptance_guidance()


@app.post("/api/chat")
def api_chat(req: ChatRequest):
    sid = req.session if req.session else MEMORY.start_session()

    def generate():
        yield f"data: {json.dumps({'type': 'session', 'session': sid})}\n\n"
        try:
            yield f"data: {json.dumps({'type': 'runtime', 'runtime': llm.runtime_evidence()})}\n\n"
        except Exception:
            pass
        for event in loop.run_turn(req.message, sid, MEMORY, pending=PENDING, stream_fn=llm.stream_chat):
            yield f"data: {json.dumps(event)}\n\n"

    return StreamingResponse(generate(), media_type="text/event-stream")


@app.post("/api/chat/approve")
def api_chat_approve(req: ApproveRequest):
    state = PENDING.get(req.call_id)
    sess = state["session"] if state else ""

    def generate():
        try:
            yield f"data: {json.dumps({'type': 'runtime', 'runtime': llm.runtime_evidence()})}\n\n"
        except Exception:
            pass
        for event in loop.resume(req.call_id, req.approved, sess, MEMORY, PENDING, stream_fn=llm.stream_chat):
            yield f"data: {json.dumps(event)}\n\n"

    return StreamingResponse(generate(), media_type="text/event-stream")


@app.get("/api/copilot/health")
def api_copilot_health():
    return llm.health()


@app.get("/api/copilot/runtime")
def api_copilot_runtime():
    return llm.runtime_status()


@app.get("/api/sessions")
def api_sessions():
    return {"sessions": MEMORY.list_sessions()}


@app.get("/api/session")
def api_session(session: str = ""):
    if not session:
        return {"messages": []}
    return {"messages": MEMORY.get_session(session)}


@app.get("/api/memory/facts")
def api_memory_facts(include_archived: bool = False, limit: int = 200):
    return {
        "facts": MEMORY.list_facts(include_archived=include_archived, limit=limit),
        "authority_states": [
            "intake",
            "unreviewed",
            "working",
            "reviewed",
            "canon",
            "deprecated",
            "superseded",
            "archived",
        ],
        "policy": {
            "canon_requires_confirmation": True,
            "delete_is_archive": True,
            "model_may_mutate_memory": False,
        },
    }


@app.get("/api/memory/review")
def api_memory_review(limit: int = 100):
    return MEMORY.review_queue(limit=limit)


@app.get("/api/memory/export")
def api_memory_export(format: str = "json", include_archived: bool = True):
    try:
        return MEMORY.export_facts(format=format, include_archived=include_archived)
    except ValueError as exc:
        return {"ok": False, "error": str(exc)}


@app.get("/api/memory/facts/{fact_id}/audit")
def api_memory_fact_audit(fact_id: int, limit: int = 50):
    return {"events": MEMORY.fact_audit(fact_id, limit=limit)}


@app.get("/api/decisions")
def api_decisions(status: str = "active", q: str = ""):
    rows = decision_register.search_decisions(q) if q.strip() else decision_register.list_decisions(status=status)
    if status:
        rows = [row for row in rows if row["status"] == status]
    return {"decisions": rows, "total": len(rows), "mode": "seed-register-read-only"}


@app.get("/api/decisions/{decision_id}")
def api_decision(decision_id: str):
    decision = decision_register.get_decision(decision_id)
    if not decision:
        return {"ok": False, "error": "Decision not found"}
    return {"ok": True, "decision": decision}


@app.get("/api/doctrine")
def api_doctrine(status: str = "active", q: str = ""):
    rows = doctrine_registry.search_doctrine(q) if q.strip() else doctrine_registry.list_doctrine(status=status)
    if status:
        rows = [row for row in rows if row["status"] == status]
    return {"doctrine": rows, "total": len(rows), "mode": "seed-doctrine-read-only"}


@app.get("/api/doctrine/{rule_id}")
def api_doctrine_rule(rule_id: str):
    rule = doctrine_registry.get_doctrine(rule_id)
    if not rule:
        return {"ok": False, "error": "Doctrine rule not found"}
    return {"ok": True, "rule": rule}


@app.post("/api/doctrine/check")
def api_doctrine_check(req: DoctrineCheckRequest):
    return doctrine_registry.query_action(req.action)


@app.get("/api/devops/playbook")
def api_devops_playbook():
    return devops_playbook.playbook_summary()


@app.get("/api/devops/current-truth")
def api_devops_current_truth():
    return {"ok": True, "current_truth": devops_playbook.current_truth()}


@app.post("/api/devops/goal")
def api_devops_goal(req: DevOpsGoalRequest):
    if not req.goal.strip():
        return {"ok": False, "error": "Goal is required."}
    return devops_playbook.classify_goal(
        goal=req.goal,
        lane=req.lane,
        mode=req.mode,
        authority=req.authority,
    )


@app.post("/api/devops/loop")
def api_devops_loop(req: DevOpsLoopRequest):
    if not req.target.strip():
        return {"ok": False, "error": "Loop target is required."}
    return devops_playbook.run_loop_plan(
        target=req.target,
        loop_type=req.loop_type,
        authority=req.authority,
        max_iterations=req.max_iterations,
        stop_on=req.stop_on,
        evidence=req.evidence,
    )


@app.get("/api/work-orders")
def api_work_orders(status: str = "", q: str = ""):
    rows = work_order_registry.search_work_orders(q) if q.strip() else work_order_registry.list_work_orders(status=status or None)
    if status:
        rows = [row for row in rows if row["status"] == status]
    return {
        "work_orders": rows,
        "total": len(rows),
        "statuses": work_order_registry.VALID_STATUSES,
        "mode": "seed-work-order-registry-read-only",
    }


@app.get("/api/work-orders/active")
def api_active_work_orders():
    rows = work_order_registry.active_work_orders()
    return {
        "work_orders": rows,
        "total": len(rows),
        "statuses": work_order_registry.VALID_STATUSES,
        "mode": "seed-work-order-registry-read-only",
    }


@app.get("/api/work-orders/{wo_id}")
def api_work_order(wo_id: str):
    work_order = work_order_registry.get_work_order(wo_id)
    if not work_order:
        return {"ok": False, "error": "Work Order not found"}
    return {"ok": True, "work_order": work_order}


@app.post("/api/work-order-composer/preview")
def api_work_order_composer_preview(req: WorkOrderComposeRequest):
    return work_order_composer.compose_work_order(
        work_order_composer.ComposeInput(
            objective=req.objective,
            title=req.title,
            phase=req.phase,
            lane=req.lane,
            mode=req.mode,
            allowed_scope=req.allowed_scope,
            denied_actions=req.denied_actions,
            validators=req.validators,
            validator_runbook_ids=req.validator_runbook_ids,
            evidence_outputs=req.evidence_outputs,
            commit_rules=req.commit_rules,
            stop_conditions=req.stop_conditions,
            owner_decisions=req.owner_decisions,
        )
    )


@app.get("/api/validation-runbooks")
def api_validation_runbooks(category: str = ""):
    rows = validation_runbook_registry.list_validation_runbooks(category=category or None)
    return {
        "ok": True,
        "runbooks": rows,
        "total": len(rows),
        "mode": "metadata-only-validation-runbook-registry",
        "would_execute": False,
        "scheduler_enabled": False,
        "autonomy_enabled": False,
        "mcp_activation": False,
        "production_write": False,
    }


@app.get("/api/validation-runbooks/{runbook_id}")
def api_validation_runbook(runbook_id: str):
    runbook = validation_runbook_registry.get_validation_runbook(runbook_id)
    if not runbook:
        return {"ok": False, "error": "VALIDATION_RUNBOOK_NOT_FOUND"}
    return {"ok": True, "runbook": runbook}


@app.get("/api/agent-configs")
def api_agent_configs(status: str = "", q: str = ""):
    rows = agent_config_inventory.search_config_surfaces(q) if q.strip() else agent_config_inventory.list_config_surfaces(status=status or None)
    if status:
        rows = [row for row in rows if row["status"] == status]
    return {
        "surfaces": rows,
        "total": len(rows),
        "mode": "read-only-redacted-config-inventory",
    }


@app.get("/api/agent-configs/{surface_id}")
def api_agent_config(surface_id: str):
    surface = agent_config_inventory.get_config_surface(surface_id)
    if not surface:
        return {"ok": False, "error": "Agent config surface not found"}
    return {"ok": True, "surface": surface}


@app.get("/api/agent-skills")
def api_agent_skills():
    return {
        "ok": True,
        "skills": agent_skills_registry.list_agent_skills(),
        "total": len(agent_skills_registry.list_agent_skills()),
        "mode": "metadata-preview-only",
        "would_execute": False,
        "read_only": True,
        "autonomy_enabled": False,
        "mcp_activation": False,
        "production_write": False,
    }


@app.get("/api/agent-skills/{skill_id}")
def api_agent_skill(skill_id: str):
    skill = agent_skills_registry.get_agent_skill(skill_id)
    if not skill:
        return {"ok": False, "error": "SKILL_NOT_FOUND"}
    return {"ok": True, "skill": skill}


@app.get("/api/evidence-pack")
def api_evidence_pack():
    return evidence_pack_generator.current_evidence_packet()


@app.get("/api/repo-state")
def api_repo_state():
    return repo_state_dashboard.current_repo_state_dashboard()


@app.get("/api/commit-readiness")
def api_commit_readiness():
    return commit_readiness_reviewer.current_commit_readiness()


@app.get("/api/handoff-packet")
def api_handoff_packet():
    return handoff_packet_exporter.current_handoff_packet()


@app.get("/api/operator-review-inbox")
def api_operator_review_inbox():
    return operator_review_inbox.current_operator_review_inbox()


@app.get("/api/decision-gate-console")
def api_decision_gate_console():
    return decision_gate_console.current_decision_gate_console()


@app.get("/api/operator-action-router")
def api_operator_action_router():
    return operator_action_router_preview.current_operator_action_router_preview()


@app.get("/api/authority-ledger")
def api_authority_ledger():
    return authority_ledger_preview.current_authority_ledger_preview()


@app.get("/api/owner-decision-record-preview")
def api_owner_decision_record_preview():
    return owner_decision_record_preview.current_owner_decision_record_preview()


@app.get("/api/approval-packet-preview")
def api_approval_packet_preview():
    return approval_packet_preview.current_approval_packet_preview()


@app.get("/api/goal-registry")
def api_goal_registry():
    return goal_registry_preview.goal_registry_preview()


@app.get("/api/loop-registry")
def api_loop_registry():
    return loop_registry_preview.loop_registry_preview()


@app.get("/api/goal-loop-readiness")
def api_goal_loop_readiness():
    return goal_loop_readiness_reviewer.current_goal_loop_readiness()


@app.get("/api/goal-command-preview")
def api_goal_command_preview(request: str = ""):
    return goal_command_preview.goal_command_preview(request)


@app.get("/api/loop-command-preview")
def api_loop_command_preview(request: str = ""):
    return loop_command_preview.loop_command_preview(request)


@app.get("/api/governed-goal-loop-console")
def api_governed_goal_loop_console():
    return governed_goal_loop_console.current_governed_goal_loop_console()


@app.get("/api/commands/catalog")
def api_command_catalog():
    return command_center.command_catalog()


@app.get("/api/commands/{command_name}")
def api_command_detail(command_name: str):
    return command_center.command_detail(command_name)


@app.post("/api/commands/preview")
def api_command_preview(req: CommandPreviewRequest):
    return command_center.preview_command(req.command, req.args, req.dry_run)


@app.get("/api/workflows")
def api_workflows():
    return command_center.workflow_center()


@app.post("/api/memory/facts/{fact_id}/edit")
def api_memory_fact_edit(fact_id: int, req: MemoryFactEditRequest):
    try:
        fact = MEMORY.update_fact_text(fact_id, req.text, evidence=req.evidence)
    except ValueError as exc:
        return {"ok": False, "error": str(exc)}
    if not fact:
        return {"ok": False, "error": "Fact not found or archived"}
    return {"ok": True, "fact": fact}


@app.post("/api/memory/facts/{fact_id}/stale")
def api_memory_fact_stale(fact_id: int, req: MemoryFactStaleRequest):
    fact = MEMORY.mark_fact_stale(fact_id, req.stale, evidence=req.evidence)
    if not fact:
        return {"ok": False, "error": "Fact not found or archived"}
    return {"ok": True, "fact": fact}


@app.post("/api/memory/facts/{fact_id}/authority")
def api_memory_fact_authority(fact_id: int, req: MemoryFactAuthorityRequest):
    target = req.authority_state.strip().lower()
    if target == "canon" and req.confirmation != "PROMOTE":
        return {"ok": False, "error": "Canon promotion requires confirmation: PROMOTE"}
    try:
        evidence = {
            **req.evidence,
            "confirmation": req.confirmation,
            "approval": "operator-confirmed" if req.confirmation else "operator-requested",
        }
        fact = MEMORY.set_fact_authority(fact_id, target, evidence=evidence)
    except ValueError as exc:
        return {"ok": False, "error": str(exc)}
    if not fact:
        return {"ok": False, "error": "Fact not found"}
    return {"ok": True, "fact": fact}


@app.post("/api/memory/facts/{fact_id}/delete")
def api_memory_fact_delete(fact_id: int, req: MemoryFactDeleteRequest):
    if req.confirmation != "DELETE":
        return {"ok": False, "error": "Delete requires confirmation: DELETE"}
    evidence = {
        **req.evidence,
        "confirmation": req.confirmation,
        "delete_mode": "archived",
    }
    fact = MEMORY.archive_fact(fact_id, evidence=evidence)
    if not fact:
        return {"ok": False, "error": "Fact not found"}
    return {"ok": True, "fact": fact, "delete_mode": "archived"}


@app.get("/api/briefing")
def api_briefing():
    return briefing.build_briefing()


@app.get("/api/alerts")
def api_alerts():
    return {"alerts": briefing.watch()}


@app.post("/api/search")
def api_search(req: SearchRequest):
    if not req.query.strip():
        return {"ok": False, "error": "Empty query"}
    return command_runner.run_safe("semantic-search", [req.query.strip()])


@app.post("/api/run")
def api_run_command(req: CommandRequest):
    if req.confirmed:
        return command_runner.run_confirmed(req.command, req.args)
    return command_runner.run_safe(req.command, req.args)


@app.get("/api/smoke")
def api_smoke():
    """Quick health check — tests that core reads work."""
    results = {}
    try:
        results["home"] = "ok" if state_reader.get_home_summary() else "fail"
    except Exception as e:
        results["home"] = f"error: {e}"
    try:
        results["agent"] = "ok" if agent.get_next_action() else "fail"
    except Exception as e:
        results["agent"] = f"error: {e}"
    try:
        results["safety"] = "ok" if agent.summarize_safety() else "fail"
    except Exception as e:
        results["safety"] = f"error: {e}"

    all_ok = all(v == "ok" for v in results.values())
    return {"status": "PASS" if all_ok else "FAIL", "checks": results}


# --- Serve frontend if built ---

if FRONTEND_DIST.exists():
    app.mount("/assets", StaticFiles(directory=str(FRONTEND_DIST / "assets")), name="assets")

    @app.get("/{path:path}")
    def serve_frontend(path: str):
        file_path = FRONTEND_DIST / path
        if file_path.exists() and file_path.is_file():
            return FileResponse(file_path)
        return FileResponse(FRONTEND_DIST / "index.html")


if __name__ == "__main__":
    import uvicorn

    smoke_mode = "--smoke" in sys.argv
    if smoke_mode:
        print("Running smoke check...")
        try:
            home = state_reader.get_home_summary()
            print(f"  Home: ok (inbox={home['inbox_count']})")
            na = agent.get_next_action()
            print(f"  Agent: ok (next={na['recommended']['action'][:50]})")
            sf = agent.summarize_safety()
            print(f"  Safety: {sf['status']}")
            print("Smoke: PASS")
        except Exception as e:
            print(f"Smoke: FAIL — {e}")
            sys.exit(1)
        sys.exit(0)

    print("WilliamOS Control Center starting...")
    print("  http://localhost:8420")
    print("  Press Ctrl+C to stop.")
    uvicorn.run(app, host="127.0.0.1", port=8420, log_level="warning")
