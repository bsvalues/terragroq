"""Preview-only Work Order Composer.

Phase 5N turns operator-provided fields into a structured Work Order packet.
It does not persist records, execute work, mutate the registry, schedule work,
activate MCP, or grant push/PR/merge/release authority.
"""

from __future__ import annotations

import re
from dataclasses import asdict, dataclass, field
from datetime import date
from typing import Any

import validation_runbook_registry


DEFAULT_DENIED_ACTIONS = [
    "push",
    "PR creation/update",
    "merge",
    "release",
    "tag",
    "pnpm retry/install",
    "MCP activation",
    "autonomy",
    "scheduler",
    "production/data writes",
    "external agent execution",
]

DEFAULT_VALIDATORS = [
    "python -m pytest control-center/backend/tests -q",
    "cd control-center/frontend && npm run build",
]

DEFAULT_EVIDENCE = [
    "validation report",
    "git status before/after",
    "files changed list",
    "safety review",
]


@dataclass(frozen=True)
class WorkOrderDraft:
    wo_id: str
    title: str
    phase: str
    lane: str
    mode: str
    objective: str
    allowed_scope: list[str]
    denied_actions: list[str]
    validators: list[str]
    evidence_outputs: list[str]
    commit_rules: list[str]
    stop_conditions: list[str]
    owner_decisions: list[str]
    status: str = "draft-preview"
    authority: str = "local-only"
    would_execute: bool = False
    would_write_files: bool = False
    would_persist: bool = False
    autonomy_enabled: bool = False
    mcp_activation: bool = False
    scheduler_enabled: bool = False
    production_write: bool = False

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


@dataclass(frozen=True)
class ComposeInput:
    objective: str
    title: str = ""
    phase: str = "5N"
    lane: str = "Work Order Composer"
    mode: str = "local-only governed development"
    allowed_scope: list[str] = field(default_factory=list)
    denied_actions: list[str] = field(default_factory=list)
    validators: list[str] = field(default_factory=list)
    validator_runbook_ids: list[str] = field(default_factory=list)
    evidence_outputs: list[str] = field(default_factory=list)
    commit_rules: list[str] = field(default_factory=list)
    stop_conditions: list[str] = field(default_factory=list)
    owner_decisions: list[str] = field(default_factory=list)


def _normalize_list(values: list[str], fallback: list[str]) -> list[str]:
    cleaned = [value.strip() for value in values if value and value.strip()]
    return cleaned or fallback


def _slug(text: str) -> str:
    cleaned = re.sub(r"[^A-Za-z0-9]+", "-", text.strip()).strip("-").upper()
    return cleaned[:48] or "WORK-ORDER"


def _title_from_objective(objective: str) -> str:
    words = objective.strip().split()
    title = " ".join(words[:8]).strip(" .")
    return title or "Untitled Work Order"


def _packet_markdown(draft: WorkOrderDraft) -> str:
    lines = [
        f"# {draft.wo_id}",
        "",
        "## Objective",
        draft.objective,
        "",
        "## Scope",
        *[f"- {item}" for item in draft.allowed_scope],
        "",
        "## Denied Actions",
        *[f"- {item}" for item in draft.denied_actions],
        "",
        "## Validators",
        *[f"- `{item}`" for item in draft.validators],
        "",
        "## Evidence Outputs",
        *[f"- {item}" for item in draft.evidence_outputs],
        "",
        "## Commit Rules",
        *[f"- {item}" for item in draft.commit_rules],
        "",
        "## Stop Conditions",
        *[f"- {item}" for item in draft.stop_conditions],
        "",
        "## Safety",
        "- preview only",
        "- would_execute: false",
        "- would_write_files: false",
        "- would_persist: false",
        "- autonomy_enabled: false",
        "- mcp_activation: false",
        "- scheduler_enabled: false",
        "- production_write: false",
    ]
    return "\n".join(lines)


def compose_work_order(data: ComposeInput) -> dict[str, Any]:
    objective = data.objective.strip()
    if not objective:
        return {"ok": False, "error": "OBJECTIVE_REQUIRED"}

    title = data.title.strip() or _title_from_objective(objective)
    phase = data.phase.strip() or "5N"
    lane = data.lane.strip() or title
    today = date.today().isoformat().replace("-", "")
    runbook_commands = validation_runbook_registry.commands_for_runbooks(data.validator_runbook_ids)
    validators = _normalize_list([*runbook_commands, *data.validators], DEFAULT_VALIDATORS)
    draft = WorkOrderDraft(
        wo_id=f"WO-WILLIAMOS-P{_slug(phase)}-{_slug(lane)}-{today}",
        title=title,
        phase=phase,
        lane=lane,
        mode=data.mode.strip() or "local-only governed development",
        objective=objective,
        allowed_scope=_normalize_list(data.allowed_scope, ["inspect and modify explicitly authorized lane files only"]),
        denied_actions=_normalize_list(data.denied_actions, DEFAULT_DENIED_ACTIONS),
        validators=validators,
        evidence_outputs=_normalize_list(data.evidence_outputs, DEFAULT_EVIDENCE),
        commit_rules=_normalize_list(
            data.commit_rules,
            ["commit locally only after validators pass and scope is clean", "push remains unauthorized"],
        ),
        stop_conditions=_normalize_list(
            data.stop_conditions,
            ["baseline mismatch", "dirty worktree before start", "out-of-scope mutation required", "tests fail"],
        ),
        owner_decisions=_normalize_list(data.owner_decisions, ["owner must authorize commit separately if required"]),
    )
    return {
        "ok": True,
        "mode": "preview-only-work-order-composer",
        "draft": draft.to_dict(),
        "packet_markdown": _packet_markdown(draft),
        "safety": {
            "would_execute": False,
            "would_write_files": False,
            "would_persist": False,
            "autonomy_enabled": False,
            "mcp_activation": False,
            "scheduler_enabled": False,
            "production_write": False,
            "push_pr_merge_release": False,
        },
    }
