"""Structured decision register for WilliamOS governance.

Read-only seed register for Phase 5G. It does not create official decision
notes, mutate canon, or enforce commands. Enforcement can be layered later.
"""

from __future__ import annotations

from dataclasses import asdict, dataclass
from typing import Any


@dataclass(frozen=True)
class DecisionRecord:
    decision_id: str
    title: str
    status: str
    decision: str
    reason: str
    owner: str
    created_at: str
    review_at: str
    scope: list[str]
    evidence: list[str]
    supersedes: list[str]
    superseded_by: str | None
    authority: str

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


SEED_DECISIONS: list[DecisionRecord] = [
    DecisionRecord(
        decision_id="DEC-WILLIAMOS-PHASE6-BLOCKED",
        title="Phase 6 remains an intentionally blocked expansion gate",
        status="active",
        decision="Phase 6 proactive intelligence is blocked until explicitly authorized.",
        reason="WilliamOS governance must mature before proactive behavior is allowed.",
        owner="Bill",
        created_at="2026-06-26",
        review_at="2026-07-26",
        scope=["phase-6", "governance", "operator-authority"],
        evidence=[
            "WilliamOS/95_ReleaseGovernance/devkit/100_ENTERPRISE_SECOND_BRAIN_DEV_PLAYBOOK.md",
            "WilliamOS/95_ReleaseGovernance/reports/Phase 5F Memory Governance Closure - 2026-06-26.md",
        ],
        supersedes=[],
        superseded_by=None,
        authority="operator-governance",
    ),
    DecisionRecord(
        decision_id="DEC-WILLIAMOS-RESEARCH-INTAKE-NONCANON",
        title="Research Drop Zone is intake-only until reviewed",
        status="active",
        decision="Research intake preserves originals and creates unreviewed notes; it does not promote content to canon.",
        reason="Enterprise second-brain trust depends on separating unreviewed intake from accepted knowledge.",
        owner="Bill",
        created_at="2026-06-26",
        review_at="2026-07-26",
        scope=["research-intake", "canon", "provenance"],
        evidence=[
            "WilliamOS/95_ReleaseGovernance/devkit/40_RESEARCH_DROP_ZONE.md",
            "WilliamOS/95_ReleaseGovernance/devkit/100_ENTERPRISE_SECOND_BRAIN_DEV_PLAYBOOK.md",
        ],
        supersedes=[],
        superseded_by=None,
        authority="operator-governance",
    ),
    DecisionRecord(
        decision_id="DEC-WILLIAMOS-WORKERS-PROPOSAL-ONLY",
        title="External workers are proposal-only",
        status="active",
        decision="External workers may propose work but do not receive write, commit, promote, push, or release authority by default.",
        reason="WilliamOS is the control plane and Bill approves controlled actions.",
        owner="Bill",
        created_at="2026-06-26",
        review_at="2026-07-26",
        scope=["workers", "delegation", "authority"],
        evidence=[
            "WilliamOS/95_ReleaseGovernance/devkit/50_AGENT_DOCK_EXTERNAL_WORKERS.md",
            "WilliamOS/95_ReleaseGovernance/devkit/100_ENTERPRISE_SECOND_BRAIN_DEV_PLAYBOOK.md",
        ],
        supersedes=[],
        superseded_by=None,
        authority="operator-governance",
    ),
    DecisionRecord(
        decision_id="DEC-WILLIAMOS-RUNTIME-14B-DEFAULT",
        title="14B is production default and 7B is override-only",
        status="active",
        decision="The production chat model remains qwen2.5:14b-instruct-q4_K_M; qwen2.5:7b-instruct is available only by environment override.",
        reason="14B was accepted for governance routing reliability after 7B mis-routed live governance paths.",
        owner="Bill",
        created_at="2026-06-26",
        review_at="2026-07-26",
        scope=["runtime", "model-default", "copilot"],
        evidence=[
            "WilliamOS/95_ReleaseGovernance/reports/Release Notes - v1.3.1 - 2026-06-26.md",
            "WilliamOS/95_ReleaseGovernance/devkit/60_MODEL_RUNTIME_ADAPTER_PLAN.md",
        ],
        supersedes=[],
        superseded_by=None,
        authority="runtime-governance",
    ),
    DecisionRecord(
        decision_id="DEC-WILLIAMOS-NO-CLOUD-FALLBACK",
        title="Cloud/model fallback is disabled unless explicitly approved",
        status="active",
        decision="WilliamOS does not silently switch model runtimes or fall back to cloud/external providers.",
        reason="Runtime transparency and local-first privacy require explicit operator selection.",
        owner="Bill",
        created_at="2026-06-26",
        review_at="2026-07-26",
        scope=["runtime", "cloud", "privacy"],
        evidence=[
            "WilliamOS/95_ReleaseGovernance/devkit/60_MODEL_RUNTIME_ADAPTER_PLAN.md",
            "WilliamOS/95_ReleaseGovernance/devkit/100_ENTERPRISE_SECOND_BRAIN_DEV_PLAYBOOK.md",
        ],
        supersedes=[],
        superseded_by=None,
        authority="runtime-governance",
    ),
    DecisionRecord(
        decision_id="DEC-WILLIAMOS-V130-STABLE-BASELINE",
        title="v1.3.0 is the stable production baseline",
        status="active",
        decision="The v1.3.0 tag remains the frozen stable local operator baseline.",
        reason="Post-v1.3.0 hardening must not rewrite the accepted baseline.",
        owner="Bill",
        created_at="2026-06-26",
        review_at="2026-07-26",
        scope=["release", "baseline", "v1.3.0"],
        evidence=[
            "WilliamOS/95_ReleaseGovernance/reports/Release Notes - v1.3.0 - 2026-06-24.md",
            "WilliamOS/95_ReleaseGovernance/reports/Production Acceptance - v1.3.0 - 2026-06-25.md",
        ],
        supersedes=[],
        superseded_by=None,
        authority="release-governance",
    ),
    DecisionRecord(
        decision_id="DEC-WILLIAMOS-V131-RUNTIME-HARDENING",
        title="v1.3.1 is the runtime hardening baseline",
        status="active",
        decision="The v1.3.1 tag records Ollama startup/runtime reliability hardening without moving v1.3.0.",
        reason="Runtime reliability was accepted as a patch baseline after green gates.",
        owner="Bill",
        created_at="2026-06-26",
        review_at="2026-07-26",
        scope=["release", "runtime", "v1.3.1"],
        evidence=[
            "WilliamOS/95_ReleaseGovernance/reports/Release Notes - v1.3.1 - 2026-06-26.md",
            "WilliamOS/95_ReleaseGovernance/reports/Phase 5F Memory Governance Closure - 2026-06-26.md",
        ],
        supersedes=[],
        superseded_by=None,
        authority="release-governance",
    ),
]


def list_decisions(status: str | None = None) -> list[dict[str, Any]]:
    rows = [record.to_dict() for record in SEED_DECISIONS]
    if status:
        rows = [row for row in rows if row["status"] == status]
    return rows


def get_decision(decision_id: str) -> dict[str, Any] | None:
    needle = decision_id.strip().lower()
    for record in SEED_DECISIONS:
        if record.decision_id.lower() == needle:
            return record.to_dict()
    return None


def search_decisions(query: str) -> list[dict[str, Any]]:
    needle = query.strip().lower()
    if not needle:
        return list_decisions()
    result = []
    for row in list_decisions():
        haystack = " ".join(
            [
                row["decision_id"],
                row["title"],
                row["decision"],
                row["reason"],
                row["authority"],
                " ".join(row["scope"]),
                " ".join(row["evidence"]),
            ]
        ).lower()
        if needle in haystack:
            result.append(row)
    return result
