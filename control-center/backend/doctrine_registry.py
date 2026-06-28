"""Structured doctrine registry for WilliamOS governance.

Read-only seed registry for Phase 5H. Doctrine records describe operating
rules; this module does not execute commands, mutate configs, or enforce gates.
"""

from __future__ import annotations

from dataclasses import asdict, dataclass
from typing import Any


@dataclass(frozen=True)
class DoctrineRule:
    rule_id: str
    title: str
    scope: list[str]
    status: str
    allowed: list[str]
    forbidden: list[str]
    requires_approval: list[str]
    evidence: list[str]
    supersedes: list[str]
    created_at: str
    owner: str

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


SEED_DOCTRINE: list[DoctrineRule] = [
    DoctrineRule(
        rule_id="DOC-WILLIAMOS-NO-PHASE6-WITHOUT-AUTH",
        title="No Phase 6 without explicit authorization",
        scope=["phase-6", "proactive-intelligence", "operator-authority"],
        status="active",
        allowed=["Record Phase 6 as blocked.", "Prepare authorization packets when requested."],
        forbidden=["Start proactive intelligence.", "Create autonomous background agents.", "Treat Phase 6 as an implementation gap."],
        requires_approval=["Any Phase 6 authorization packet.", "Any proactive notification behavior."],
        evidence=[
            "WilliamOS/95_ReleaseGovernance/devkit/100_ENTERPRISE_SECOND_BRAIN_DEV_PLAYBOOK.md",
            "DEC-WILLIAMOS-PHASE6-BLOCKED",
        ],
        supersedes=[],
        created_at="2026-06-26",
        owner="Bill",
    ),
    DoctrineRule(
        rule_id="DOC-WILLIAMOS-NO-SILENT-FALLBACK",
        title="No silent model fallback",
        scope=["runtime", "model-runtime", "cloud", "privacy"],
        status="active",
        allowed=["Show runtime status.", "Use the explicitly selected local runtime."],
        forbidden=["Switch model providers silently.", "Fall back to cloud or external runtimes by default."],
        requires_approval=["Changing the selected runtime.", "Enabling any cloud or external provider."],
        evidence=[
            "WilliamOS/95_ReleaseGovernance/devkit/60_MODEL_RUNTIME_ADAPTER_PLAN.md",
            "DEC-WILLIAMOS-NO-CLOUD-FALLBACK",
        ],
        supersedes=[],
        created_at="2026-06-26",
        owner="Bill",
    ),
    DoctrineRule(
        rule_id="DOC-WILLIAMOS-WORKERS-PROPOSE-GOVERN",
        title="Workers propose; WilliamOS governs",
        scope=["workers", "delegation", "authority"],
        status="active",
        allowed=["External workers may propose plans, patches, and evidence.", "WilliamOS may record worker proposals."],
        forbidden=["Grant workers direct write, promote, push, tag, merge, or release authority by default."],
        requires_approval=["Executing a worker proposal.", "Promoting worker output into canon or release scope."],
        evidence=[
            "WilliamOS/95_ReleaseGovernance/devkit/50_AGENT_DOCK_EXTERNAL_WORKERS.md",
            "DEC-WILLIAMOS-WORKERS-PROPOSAL-ONLY",
        ],
        supersedes=[],
        created_at="2026-06-26",
        owner="Bill",
    ),
    DoctrineRule(
        rule_id="DOC-CLAUDE-CODE-NO-PUSH-BY-DEFAULT",
        title="Claude Code may not push by default",
        scope=["workers", "claude-code", "git", "remote"],
        status="active",
        allowed=["Claude Code may perform scoped local surgery when authorized.", "Claude Code may commit locally when the WO allows it."],
        forbidden=["Push branches by default.", "Open PRs, merge, tag, or release without explicit operator approval."],
        requires_approval=["Any push.", "Any PR creation.", "Any merge, tag, or release operation."],
        evidence=[
            "WilliamOS/95_ReleaseGovernance/devkit/100_ENTERPRISE_SECOND_BRAIN_DEV_PLAYBOOK.md",
            "DEC-WILLIAMOS-WORKERS-PROPOSAL-ONLY",
        ],
        supersedes=[],
        created_at="2026-06-26",
        owner="Bill",
    ),
    DoctrineRule(
        rule_id="DOC-CODEX-AUDIT-EVIDENCE-SCOUT",
        title="Codex is audit/evidence scout by default",
        scope=["workers", "codex", "audit", "evidence"],
        status="active",
        allowed=["Codex may inspect, classify, run validators, write evidence, and recommend WOs.", "Codex may implement scoped work when explicitly authorized in the active WO."],
        forbidden=["Merge, push, tag, release, open Phase 6, or silently widen scope."],
        requires_approval=["Any controlled git publication action.", "Any scope expansion beyond the active WO."],
        evidence=[
            "WilliamOS/95_ReleaseGovernance/devkit/100_ENTERPRISE_SECOND_BRAIN_DEV_PLAYBOOK.md",
        ],
        supersedes=[],
        created_at="2026-06-26",
        owner="Bill",
    ),
    DoctrineRule(
        rule_id="DOC-WILLIAMOS-RESEARCH-INTAKE-NONCANON",
        title="Research intake is non-canon until reviewed",
        scope=["research-intake", "canon", "memory", "provenance"],
        status="active",
        allowed=["Capture originals and provenance.", "Create unreviewed intake notes for later review."],
        forbidden=["Automatically promote intake to canon.", "Treat unreviewed intake as authoritative memory."],
        requires_approval=["Canon promotion.", "Doctrine, decision, or memory mutation based on intake."],
        evidence=[
            "WilliamOS/95_ReleaseGovernance/devkit/40_RESEARCH_DROP_ZONE.md",
            "DEC-WILLIAMOS-RESEARCH-INTAKE-NONCANON",
        ],
        supersedes=[],
        created_at="2026-06-26",
        owner="Bill",
    ),
    DoctrineRule(
        rule_id="DOC-WILLIAMOS-NO-GENERATED-ARTIFACT-COMMIT",
        title="No generated artifact commit without classification",
        scope=["git", "evidence", "generated-artifacts", "governance"],
        status="active",
        allowed=["Commit scoped validation evidence when the WO allows it.", "Leave local-only generated notes unstaged when out of scope."],
        forbidden=["Stage generated reports, intake notes, local configs, or runtime residue without classification."],
        requires_approval=["Committing generated artifacts outside expected evidence scope.", "Changing local-only note disposition."],
        evidence=[
            "WilliamOS/95_ReleaseGovernance/devkit/100_ENTERPRISE_SECOND_BRAIN_DEV_PLAYBOOK.md",
            "5e74521 chore(governance): untrack local inbox note",
        ],
        supersedes=[],
        created_at="2026-06-26",
        owner="Bill",
    ),
]


def list_doctrine(status: str | None = None) -> list[dict[str, Any]]:
    rows = [record.to_dict() for record in SEED_DOCTRINE]
    if status:
        rows = [row for row in rows if row["status"] == status]
    return rows


def get_doctrine(rule_id: str) -> dict[str, Any] | None:
    needle = rule_id.strip().lower()
    for record in SEED_DOCTRINE:
        if record.rule_id.lower() == needle:
            return record.to_dict()
    return None


def search_doctrine(query: str) -> list[dict[str, Any]]:
    needle = query.strip().lower()
    if not needle:
        return list_doctrine()
    result = []
    for row in list_doctrine():
        haystack = " ".join(
            [
                row["rule_id"],
                row["title"],
                row["status"],
                " ".join(row["scope"]),
                " ".join(row["allowed"]),
                " ".join(row["forbidden"]),
                " ".join(row["requires_approval"]),
                " ".join(row["evidence"]),
            ]
        ).lower()
        if needle in haystack:
            result.append(row)
    return result


def query_action(action: str) -> dict[str, Any]:
    """Return matching doctrine for an explicit query without granting authority."""
    matches = search_doctrine(action)
    if not matches:
        matches_by_id: dict[str, dict[str, Any]] = {}
        ignored = {"approve", "approved", "enable", "start", "create", "run", "the", "and", "for"}
        tokens = [
            token.strip(".,:;!?()[]{}").lower()
            for token in action.split()
            if len(token.strip(".,:;!?()[]{}")) > 3
        ]
        for token in tokens:
            if token in ignored:
                continue
            for row in search_doctrine(token):
                matches_by_id[row["rule_id"]] = row
        matches = list(matches_by_id.values())
    if not matches:
        return {
            "result": "unknown",
            "reason": "No seed doctrine matched this query; operator review required.",
            "matches": [],
            "forbidden": [],
            "requires_approval": ["Unclassified action requires operator review."],
            "mode": "seed-doctrine-query-read-only",
        }

    forbidden = [item for row in matches for item in row["forbidden"]]
    requires_approval = [item for row in matches for item in row["requires_approval"]]
    return {
        "result": "matched",
        "reason": "Doctrine matches are advisory context only; existing safety gates remain authoritative.",
        "matches": matches,
        "forbidden": forbidden,
        "requires_approval": requires_approval,
        "mode": "seed-doctrine-query-read-only",
    }
