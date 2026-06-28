"""Structured Work Order registry for WilliamOS governance.

Read-only seed registry for Phase 5I. Work Orders describe scoped work,
validators, evidence, and closure state. This module does not execute work,
mutate statuses, or authorize commits/releases.
"""

from __future__ import annotations

from dataclasses import asdict, dataclass
from typing import Any


VALID_STATUSES = [
    "draft",
    "active",
    "blocked",
    "hold",
    "accepted",
    "closed",
    "superseded",
    "rejected",
]


@dataclass(frozen=True)
class WorkOrderRecord:
    wo_id: str
    title: str
    status: str
    goal: str
    loop: list[str]
    scope: list[str]
    non_goals: list[str]
    allowed_files: list[str]
    forbidden_files: list[str]
    validators: list[str]
    stop_conditions: list[str]
    owner_decisions: list[str]
    result: str
    evidence: list[str]
    commit: str | None
    tag: str | None
    phase: str

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


SEED_WORK_ORDERS: list[WorkOrderRecord] = [
    WorkOrderRecord(
        wo_id="WO-WILLIAMOS-PHASE5G-DECISION-REGISTER-001",
        title="Phase 5G Decision Register",
        status="closed",
        goal="Turn important decisions into structured, searchable governance records.",
        loop=["read", "classify", "plan", "act-narrowly", "verify", "record", "stop"],
        scope=[
            "Read-only seed decision register.",
            "Decision list, search, and detail API.",
            "Operator Home Decisions panel.",
            "Backend tests and devkit plan.",
        ],
        non_goals=[
            "No Phase 6.",
            "No automatic decision creation.",
            "No automatic enforcement.",
            "No worker authority expansion.",
        ],
        allowed_files=[
            "control-center/backend/decision_register.py",
            "control-center/backend/app.py",
            "control-center/backend/tests/test_decision_register.py",
            "control-center/frontend/src",
            "WilliamOS/95_ReleaseGovernance/devkit",
            "WilliamOS/105_RuntimeSmoke",
            "WilliamOS/106_ProductionReadiness",
        ],
        forbidden_files=[
            "WilliamOS/00_Inbox",
            "v1.3.0 tag",
            "v1.3.1 tag",
            "safety.check_command weakening",
            "command_runner weakening",
        ],
        validators=[
            "python -m pytest control-center/backend/tests -q",
            "cd control-center/frontend && npm run build",
            "python scripts/william.py runtime-smoke",
            "python scripts/william.py production-readiness",
        ],
        stop_conditions=[
            "Phase 6 behavior required.",
            "Cloud fallback required.",
            "Worker authority expansion required.",
            "Out-of-scope files become dirty.",
        ],
        owner_decisions=[
            "Phase 5G first slice accepted as read-only seed register.",
            "Push/tag/release remain blocked.",
        ],
        result="PASS - committed as structured decision register first slice.",
        evidence=[
            "WilliamOS/95_ReleaseGovernance/devkit/110_DECISION_REGISTER_PLAN.md",
            "ecae45c feat(copilot): add structured decision register",
        ],
        commit="ecae45ca680190802f6692e1b3b44b45c50866ca",
        tag=None,
        phase="5G",
    ),
    WorkOrderRecord(
        wo_id="WO-WILLIAMOS-PHASE5H-DOCTRINE-REGISTRY-001",
        title="Phase 5H Doctrine Registry",
        status="closed",
        goal="Make WilliamOS operating rules machine-readable, visible, searchable, and available as context.",
        loop=["read", "classify", "plan", "act-narrowly", "verify", "record", "stop"],
        scope=[
            "Read-only seed doctrine registry.",
            "Doctrine list, search, detail, and advisory check API.",
            "Operator Home Doctrine panel.",
            "Backend tests and validation evidence.",
        ],
        non_goals=[
            "No Phase 6.",
            "No automatic doctrine creation.",
            "No automatic command enforcement.",
            "No cloud fallback.",
            "No provider switching.",
        ],
        allowed_files=[
            "control-center/backend/doctrine_registry.py",
            "control-center/backend/app.py",
            "control-center/backend/tests/test_doctrine_registry.py",
            "control-center/frontend/src",
            "WilliamOS/95_ReleaseGovernance/devkit",
            "WilliamOS/95_ReleaseGovernance/reports",
            "WilliamOS/105_RuntimeSmoke",
            "WilliamOS/106_ProductionReadiness",
        ],
        forbidden_files=[
            "WilliamOS/00_Inbox",
            "v1.3.0 tag",
            "v1.3.1 tag",
            "safety.check_command weakening",
            "command_runner weakening",
        ],
        validators=[
            "python -m pytest control-center/backend/tests -q",
            "cd control-center/frontend && npm run build",
            "python scripts/william.py runtime-smoke",
            "python scripts/william.py production-readiness",
        ],
        stop_conditions=[
            "Phase 6 behavior required.",
            "Automatic enforcement required.",
            "Push/tag/release requested.",
            "Out-of-scope files become dirty.",
        ],
        owner_decisions=[
            "Phase 5H first slice committed as its own auditable unit.",
            "Phase 5I must open as a separate WO.",
        ],
        result="PASS - committed as read-only doctrine registry first slice.",
        evidence=[
            "WilliamOS/95_ReleaseGovernance/devkit/120_DOCTRINE_REGISTRY_PLAN.md",
            "WilliamOS/95_ReleaseGovernance/reports/Phase 5H Doctrine Registry Validation - 2026-06-26.md",
            "681794d feat(copilot): add doctrine registry",
        ],
        commit="681794d7defe80456f30250f10ee4202e05de700",
        tag=None,
        phase="5H",
    ),
    WorkOrderRecord(
        wo_id="WO-WILLIAMOS-PHASE5I-WORK-ORDER-ENGINE-001",
        title="Phase 5I Work Order Engine",
        status="closed",
        goal="Make /goal and /loop first-class structured Work Order objects.",
        loop=["read", "classify", "plan", "act-narrowly", "verify", "record", "stop"],
        scope=[
            "Add structured Work Order registry.",
            "Seed recent/current WilliamOS WOs.",
            "Add read-only backend/API surface for list, search, detail, and active WOs.",
            "Add Operator Home Work Orders panel.",
            "Add tests, devkit plan, and validation evidence.",
        ],
        non_goals=[
            "No Phase 6.",
            "No proactive behavior.",
            "No autonomous WO execution.",
            "No automatic WO creation or mutation.",
            "No worker write authority.",
            "No push, tag, or release.",
            "No cloud fallback.",
            "No provider switching.",
        ],
        allowed_files=[
            "control-center/backend/work_order_registry.py",
            "control-center/backend/app.py",
            "control-center/backend/tests/test_work_order_registry.py",
            "control-center/frontend/src",
            "control-center/frontend/dist",
            "WilliamOS/95_ReleaseGovernance/devkit",
            "WilliamOS/95_ReleaseGovernance/reports",
            "WilliamOS/105_RuntimeSmoke",
            "WilliamOS/106_ProductionReadiness",
        ],
        forbidden_files=[
            "WilliamOS/00_Inbox",
            "v1.3.0 tag",
            "v1.3.1 tag",
            "safety.check_command weakening",
            "command_runner weakening",
            "external worker configs",
        ],
        validators=[
            "python -m pytest control-center/backend/tests -q",
            "cd control-center/frontend && npm run build",
            "python scripts/william.py runtime-smoke",
            "python scripts/william.py production-readiness",
        ],
        stop_conditions=[
            "Phase 6 behavior required.",
            "Autonomous WO execution required.",
            "Status mutation required.",
            "Push/tag/release requested.",
            "Out-of-scope files become dirty.",
        ],
        owner_decisions=[
            "Open Phase 5I as separate scoped WO after Phase 5H commit.",
            "Phase 5I first slice committed as its own auditable unit.",
            "Phase 5J must open as a separate WO.",
        ],
        result="PASS - committed as read-only Work Order registry first slice.",
        evidence=[
            "WilliamOS/95_ReleaseGovernance/devkit/130_WORK_ORDER_ENGINE_PLAN.md",
            "WilliamOS/95_ReleaseGovernance/reports/Phase 5I Work Order Engine Validation - 2026-06-26.md",
            "9fde17a feat(copilot): add work order registry",
        ],
        commit="9fde17a952b7849b3c82c1cc2af1a8adb9667d05",
        tag=None,
        phase="5I",
    ),
    WorkOrderRecord(
        wo_id="WO-WILLIAMOS-PHASE5J-AGENT-CONFIG-INVENTORY-001",
        title="Phase 5J Agent Config Inventory",
        status="active",
        goal="Discover external agent and tool configuration surfaces without changing them.",
        loop=["read", "classify", "plan", "act-narrowly", "verify", "record", "stop"],
        scope=[
            "Add read-only agent config inventory records.",
            "Redact secrets by default.",
            "Flag unknown or risky config surfaces.",
            "Add backend/API surface for list, search, detail, and status filter.",
            "Add Operator Home Agent Configs panel.",
            "Add tests, devkit plan, and validation evidence.",
        ],
        non_goals=[
            "No config mutation.",
            "No secret display.",
            "No provider switching.",
            "No cloud enablement.",
            "No deep-link import.",
            "No worker write authority.",
            "No Phase 6.",
            "No push, tag, or release.",
        ],
        allowed_files=[
            "control-center/backend/agent_config_inventory.py",
            "control-center/backend/app.py",
            "control-center/backend/tests/test_agent_config_inventory.py",
            "control-center/backend/work_order_registry.py",
            "control-center/frontend/src",
            "control-center/frontend/dist",
            "WilliamOS/95_ReleaseGovernance/devkit",
            "WilliamOS/95_ReleaseGovernance/reports",
            "WilliamOS/105_RuntimeSmoke",
            "WilliamOS/106_ProductionReadiness",
        ],
        forbidden_files=[
            "external agent config files",
            "provider config values",
            "WilliamOS/00_Inbox",
            "v1.3.0 tag",
            "v1.3.1 tag",
            "safety.check_command weakening",
            "command_runner weakening",
        ],
        validators=[
            "python -m pytest control-center/backend/tests -q",
            "cd control-center/frontend && npm run build",
            "python scripts/william.py runtime-smoke",
            "python scripts/william.py production-readiness",
        ],
        stop_conditions=[
            "Config mutation required.",
            "Secret display required.",
            "Provider switching required.",
            "Cloud enablement required.",
            "Phase 6 behavior required.",
            "Push/tag/release requested.",
            "Out-of-scope files become dirty.",
        ],
        owner_decisions=[
            "Open Phase 5J as separate scoped WO after Phase 5I commit.",
            "Commit requires separate operator approval after validation.",
        ],
        result="IN PROGRESS - first slice should stop at validated hold before commit.",
        evidence=[
            "WilliamOS/95_ReleaseGovernance/devkit/100_ENTERPRISE_SECOND_BRAIN_DEV_PLAYBOOK.md",
            "WO-WILLIAMOS-PHASE5J-AGENT-CONFIG-INVENTORY-001 authorization packet",
        ],
        commit=None,
        tag=None,
        phase="5J",
    ),
    WorkOrderRecord(
        wo_id="WO-WILLIAMOS-DEVOPS-RUNTIME-PROOF-001",
        title="DevOps Playbook Runtime Proof",
        status="closed",
        goal="Prove the DevOps Playbook application surface through live Control Center smoke, runtime smoke, and production readiness gates.",
        loop=["read", "classify", "plan", "act-narrowly", "verify", "record", "stop"],
        scope=[
            "Add DevOps playbook endpoint coverage to Control Center smoke.",
            "Verify /api/devops/playbook, /api/devops/current-truth, /api/devops/goal, and /api/devops/loop at runtime.",
            "Record runtime smoke and production-readiness proof.",
            "Update Control Center smoke documentation from 18 to 22 checks.",
        ],
        non_goals=[
            "No Phase 6.",
            "No autonomous execution loop.",
            "No mutation from a goal or handoff.",
            "No push, tag, release, or production touch.",
            "No worker write authority expansion.",
        ],
        allowed_files=[
            "scripts/williamos_control_center.py",
            "control-center/backend/tests/test_control_center_smoke_devops.py",
            "control-center/backend/tests/test_work_order_registry.py",
            "control-center/backend/work_order_registry.py",
            "WilliamOS/110_ControlCenter",
            "WilliamOS/95_ReleaseGovernance/reports",
            "WilliamOS/105_RuntimeSmoke",
            "WilliamOS/106_ProductionReadiness",
        ],
        forbidden_files=[
            "v1.3.0 tag",
            "v1.3.1 tag",
            "remote push",
            "Phase 6 proactive behavior",
            "safety.check_command weakening",
            "command_runner weakening",
        ],
        validators=[
            "python -m pytest control-center/backend/tests/test_control_center_smoke_devops.py control-center/backend/tests/test_devops_playbook.py -q",
            "python -m pytest control-center/backend/tests/test_work_order_registry.py -q",
            "python -m pytest control-center/backend/tests -q",
            "cd control-center/frontend && npm run build",
            "python scripts/william.py control-center-smoke",
            "python scripts/william.py runtime-smoke",
            "python scripts/william.py production-readiness",
        ],
        stop_conditions=[
            "DevOps endpoint smoke fails.",
            "Runtime smoke has critical failures.",
            "Production readiness fails.",
            "Phase 6 behavior required.",
            "Out-of-scope files become dirty without classification.",
        ],
        owner_decisions=[
            "Treat DevOps playbook runtime proof as a validation slice.",
            "Do not authorize execution loops from this proof.",
            "Keep Phase 6 blocked.",
        ],
        result="PASS - DevOps playbook app runtime surface proven through 22/22 Control Center smoke, 28/28 runtime smoke, and 10/10 production readiness.",
        evidence=[
            "Control Center smoke: 22/22 PASS.",
            "Runtime smoke: 28/28 PASS, 0 critical failures.",
            "Production readiness: 10/10 PASS.",
            "WilliamOS/110_ControlCenter/SMOKE_TESTS.md",
            "WilliamOS/95_ReleaseGovernance/reports/DevOps Playbook Runtime Proof - 2026-06-26.md",
        ],
        commit=None,
        tag=None,
        phase="devops-runtime-proof",
    ),
]


def list_work_orders(status: str | None = None) -> list[dict[str, Any]]:
    rows = [record.to_dict() for record in SEED_WORK_ORDERS]
    if status:
        rows = [row for row in rows if row["status"] == status]
    return rows


def get_work_order(wo_id: str) -> dict[str, Any] | None:
    needle = wo_id.strip().lower()
    for record in SEED_WORK_ORDERS:
        if record.wo_id.lower() == needle:
            return record.to_dict()
    return None


def search_work_orders(query: str) -> list[dict[str, Any]]:
    needle = query.strip().lower()
    if not needle:
        return list_work_orders()
    result = []
    for row in list_work_orders():
        haystack = " ".join(
            [
                row["wo_id"],
                row["title"],
                row["status"],
                row["goal"],
                row["result"],
                row["phase"],
                " ".join(row["loop"]),
                " ".join(row["scope"]),
                " ".join(row["non_goals"]),
                " ".join(row["allowed_files"]),
                " ".join(row["forbidden_files"]),
                " ".join(row["validators"]),
                " ".join(row["stop_conditions"]),
                " ".join(row["owner_decisions"]),
                " ".join(row["evidence"]),
                row["commit"] or "",
                row["tag"] or "",
            ]
        ).lower()
        if needle in haystack:
            result.append(row)
    return result


def active_work_orders() -> list[dict[str, Any]]:
    return list_work_orders(status="active")
