"""Metadata-only Agent Skills Registry.

Phase 5K defines inspectable skill cards for governed agent capabilities.
Skills are descriptive records only: no command execution, activation, MCP
configuration, scheduling, or autonomous worker behavior is exposed here.
"""

from __future__ import annotations

from dataclasses import asdict, dataclass
from typing import Any


@dataclass(frozen=True)
class AgentSkill:
    id: str
    name: str
    category: str
    phase: str
    status: str
    mode: str
    description: str
    allowed_actions: list[str]
    denied_actions: list[str]
    safe_paths: list[str]
    required_validators: list[str]
    evidence_outputs: list[str]
    risk_level: str
    requires_owner_approval: bool
    would_execute: bool = False
    read_only: bool = True
    autonomy_enabled: bool = False
    mcp_activation: bool = False
    production_write: bool = False

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


COMMON_DENIED = [
    "execute commands directly",
    "activate MCP",
    "enable autonomy or schedulers",
    "write production or live data",
    "push, merge, tag, or release",
    "store secrets or credentials",
]


def _skill(
    skill_id: str,
    name: str,
    category: str,
    description: str,
    allowed_actions: list[str],
    safe_paths: list[str],
    validators: list[str],
    evidence: list[str],
    risk: str = "review",
    owner_approval: bool = True,
) -> AgentSkill:
    return AgentSkill(
        id=skill_id,
        name=name,
        category=category,
        phase="5K",
        status="draft-governed",
        mode="metadata-preview-only",
        description=description,
        allowed_actions=allowed_actions,
        denied_actions=COMMON_DENIED,
        safe_paths=safe_paths,
        required_validators=validators,
        evidence_outputs=evidence,
        risk_level=risk,
        requires_owner_approval=owner_approval,
    )


def _seed_skills() -> list[AgentSkill]:
    return [
        _skill(
            "repo_auditor",
            "Repo Auditor",
            "repo-governance",
            "Classifies worktree state, dirty paths, and scope boundaries without mutation.",
            ["inspect git status", "classify tracked and untracked files", "report scope risks"],
            ["WilliamOS/**", "control-center/**", "scripts/**", "brain-council/**"],
            ["git status --short", "git diff --stat"],
            ["repo inventory report", "scope containment summary"],
            risk="low",
        ),
        _skill(
            "commit_classifier",
            "Commit Classifier",
            "repo-governance",
            "Groups changed files into coherent commit candidates and flags mixed scope.",
            ["inspect diffs", "separate commit candidates", "identify owner decisions"],
            ["WilliamOS/**", "control-center/**", "scripts/**"],
            ["git diff --name-status", "git diff --cached --check"],
            ["commit-candidate matrix", "blocked/ambiguous file list"],
        ),
        _skill(
            "work_order_builder",
            "Work Order Builder",
            "governance",
            "Drafts work order metadata, acceptance criteria, validators, and stop conditions.",
            ["draft work order text", "map authority levels", "declare non-authorizations"],
            ["WilliamOS/95_ReleaseGovernance/**"],
            ["python -m pytest control-center/backend/tests/test_work_order_registry.py -q"],
            ["work order draft", "authority and stop-condition summary"],
        ),
        _skill(
            "validation_runner",
            "Validation Runner",
            "validation",
            "Lists and reports approved validators; does not run them without explicit operator authority.",
            ["list validators", "summarize validation output", "record known warnings"],
            ["control-center/backend/tests/**", "WilliamOS/95_ReleaseGovernance/reports/**"],
            ["python -m pytest control-center/backend/tests -q", "npm run build"],
            ["validator transcript", "pass/fail evidence report"],
            risk="medium",
        ),
        _skill(
            "release_gate_reviewer",
            "Release Gate Reviewer",
            "release-governance",
            "Reviews release and production-readiness gates without tagging or publishing.",
            ["inspect release checklist", "verify tag gate evidence", "report blockers"],
            ["WilliamOS/95_ReleaseGovernance/**", "WilliamOS/106_ProductionReadiness/**"],
            ["python scripts/william.py production-readiness"],
            ["release gate review", "non-release decision packet"],
            risk="high",
        ),
        _skill(
            "frontend_smoke_agent",
            "Frontend Smoke Agent",
            "frontend-validation",
            "Reviews Control Center UI surfaces and build output without browser automation authority.",
            ["inspect UI source", "summarize build output", "flag dist decisions"],
            ["control-center/frontend/src/**", "control-center/frontend/dist/**"],
            ["npm run build"],
            ["frontend build result", "dist change summary"],
            risk="medium",
        ),
        _skill(
            "docs_devkit_maintainer",
            "Docs Devkit Maintainer",
            "documentation",
            "Maintains devkit indexes, plans, manifests, and validation reports under governance.",
            ["draft documentation", "update devkit index", "record evidence paths"],
            ["WilliamOS/95_ReleaseGovernance/devkit/**", "WilliamOS/95_ReleaseGovernance/reports/**"],
            ["git diff -- WilliamOS/95_ReleaseGovernance"],
            ["docs diff summary", "validation report"],
            risk="low",
        ),
        _skill(
            "secret_residue_scanner",
            "Secret Residue Scanner",
            "security-review",
            "Searches diffs for secret-like text and reports findings without storing credentials.",
            ["scan diffs for secret-like strings", "report redaction needs", "flag blocked commits"],
            ["WilliamOS/**", "control-center/**", "scripts/**"],
            ["rg secret-patterns against changed files"],
            ["secret scan summary", "credential finding classification"],
            risk="high",
        ),
    ]


def list_agent_skills() -> list[dict[str, Any]]:
    return [skill.to_dict() for skill in _seed_skills()]


def get_agent_skill(skill_id: str) -> dict[str, Any] | None:
    needle = skill_id.strip().lower()
    for skill in _seed_skills():
        if skill.id.lower() == needle:
            return skill.to_dict()
    return None
