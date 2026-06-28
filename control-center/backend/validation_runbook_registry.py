"""Metadata-only validation runbook registry.

Phase 5O defines approved validation recipes that Work Orders can reference.
Recipes are inspectable metadata only; this module never executes commands,
schedules validation, mutates files, activates MCP, or grants release authority.
"""

from __future__ import annotations

from dataclasses import asdict, dataclass
from typing import Any


@dataclass(frozen=True)
class ValidationRunbook:
    id: str
    name: str
    category: str
    phase: str
    status: str
    description: str
    commands: list[str]
    required_for: list[str]
    evidence_outputs: list[str]
    safe_paths: list[str]
    denied_actions: list[str]
    risk_level: str
    requires_owner_approval: bool
    would_execute: bool = False
    scheduler_enabled: bool = False
    autonomy_enabled: bool = False
    mcp_activation: bool = False
    production_write: bool = False

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


DENIED_ACTIONS = [
    "automatic validator execution",
    "scheduler activation",
    "autonomy",
    "MCP activation",
    "push",
    "PR creation/update",
    "merge",
    "release",
    "tag",
    "production/data writes",
]


RUNBOOKS: list[ValidationRunbook] = [
    ValidationRunbook(
        id="backend-focused",
        name="Focused Backend Test",
        category="backend",
        phase="5O",
        status="approved-metadata",
        description="Run a specific backend pytest file for the active lane.",
        commands=["python -m pytest {test_path} -q"],
        required_for=["backend_change", "api_change", "registry_change"],
        evidence_outputs=["focused pytest result", "test file path", "warning summary"],
        safe_paths=["control-center/backend/tests/**", "control-center/backend/**"],
        denied_actions=DENIED_ACTIONS,
        risk_level="low",
        requires_owner_approval=False,
    ),
    ValidationRunbook(
        id="backend-full",
        name="Full Backend Suite",
        category="backend",
        phase="5O",
        status="approved-metadata",
        description="Run the full Control Center backend test suite.",
        commands=["python -m pytest control-center/backend/tests -q"],
        required_for=["backend_change", "commit_candidate"],
        evidence_outputs=["total tests passed", "warning summary", "failure trace if any"],
        safe_paths=["control-center/backend/tests/**", "control-center/backend/**"],
        denied_actions=DENIED_ACTIONS,
        risk_level="low",
        requires_owner_approval=False,
    ),
    ValidationRunbook(
        id="frontend-build",
        name="Frontend Build",
        category="frontend",
        phase="5O",
        status="approved-metadata",
        description="Compile the Control Center frontend and regenerate tracked dist output.",
        commands=["cd control-center/frontend && npm run build"],
        required_for=["frontend_change", "dist_change", "commit_candidate"],
        evidence_outputs=["build result", "dist triplet", "manual dist edit check"],
        safe_paths=["control-center/frontend/src/**", "control-center/frontend/dist/**"],
        denied_actions=DENIED_ACTIONS,
        risk_level="medium",
        requires_owner_approval=True,
    ),
    ValidationRunbook(
        id="scope-safety",
        name="Scope and Safety Diff Review",
        category="governance",
        phase="5O",
        status="approved-metadata",
        description="Inspect staged or unstaged changes for lane scope and denied behavior.",
        commands=[
            "git status --short",
            "git diff --name-status",
            "git diff --check",
        ],
        required_for=["commit_candidate", "governance_change"],
        evidence_outputs=["changed files", "whitespace result", "scope decision"],
        safe_paths=["repo metadata", "active lane files"],
        denied_actions=DENIED_ACTIONS,
        risk_level="low",
        requires_owner_approval=False,
    ),
    ValidationRunbook(
        id="runtime-smoke",
        name="Runtime Smoke",
        category="runtime",
        phase="5O",
        status="approved-metadata",
        description="Validate runtime posture without granting release authority.",
        commands=["python scripts/william.py runtime-smoke"],
        required_for=["runtime_change", "release_candidate"],
        evidence_outputs=["runtime smoke result", "critical failure count"],
        safe_paths=["scripts/**", "WilliamOS/105_RuntimeSmoke/**"],
        denied_actions=DENIED_ACTIONS,
        risk_level="medium",
        requires_owner_approval=True,
    ),
    ValidationRunbook(
        id="production-readiness",
        name="Production Readiness",
        category="release-gate",
        phase="5O",
        status="approved-metadata",
        description="Check production readiness without authorizing release or tag.",
        commands=["python scripts/william.py production-readiness"],
        required_for=["release_candidate", "tag_candidate"],
        evidence_outputs=["production readiness result", "gate count", "blockers"],
        safe_paths=["WilliamOS/106_ProductionReadiness/**", "scripts/**"],
        denied_actions=DENIED_ACTIONS,
        risk_level="medium",
        requires_owner_approval=True,
    ),
]


def list_validation_runbooks(category: str | None = None) -> list[dict[str, Any]]:
    rows = [runbook.to_dict() for runbook in RUNBOOKS]
    if category:
        rows = [row for row in rows if row["category"] == category]
    return rows


def get_validation_runbook(runbook_id: str) -> dict[str, Any] | None:
    needle = runbook_id.strip().lower()
    for runbook in RUNBOOKS:
        if runbook.id.lower() == needle:
            return runbook.to_dict()
    return None


def commands_for_runbooks(runbook_ids: list[str]) -> list[str]:
    commands: list[str] = []
    for runbook_id in runbook_ids:
        runbook = get_validation_runbook(runbook_id)
        if runbook:
            commands.extend(runbook["commands"])
    return commands
