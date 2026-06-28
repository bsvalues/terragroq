"""Governed DevOps playbook engine for /goal and /loop.

This module operationalizes the WilliamOS DevOps Work Order Playbook without
executing work. It classifies operator intent, caps authority, checks known
mistake patterns, builds draft work-order packets, and produces loop plans.
"""

from __future__ import annotations

import json
import subprocess
from dataclasses import asdict, dataclass
from datetime import datetime
from pathlib import Path
from typing import Any

import doctrine_registry
import work_order_registry


PROJECT_ROOT = Path(__file__).resolve().parent.parent.parent
DEVKIT_MANIFEST = PROJECT_ROOT / "WilliamOS" / "95_ReleaseGovernance" / "devkit" / "devkit-manifest.json"

LANES = [
    "County Official / Assessor",
    "TerraFusion Government Platform",
    "WilliamOS Personal Command Brain",
    "Private Commercial Sidecar / Atlas",
    "Personal Learning / Developer Growth",
    "Forensic Recovery / Repo Governance",
    "Public Communication / Reputation",
    "DevOps / Release Engineering",
]

MODES = ["THINK", "PLAN", "VERIFY", "EXECUTE", "RECOVER", "HOLD", "PUBLIC"]

AUTHORITY_LEVELS = [
    "A0_READ_ONLY",
    "A1_DRAFT_ONLY",
    "A2_LOCAL_MUTATION",
    "A3_TEST_AND_BUILD",
    "A4_COMMIT_LOCAL",
    "A5_PUSH_REMOTE",
    "A6_TAG_RELEASE",
    "A7_PRODUCTION_TOUCH",
    "A8_DATA_TOUCH",
    "A9_CANON_PROMOTION",
]

AUTHORITY_RANK = {level: index for index, level in enumerate(AUTHORITY_LEVELS)}

LOOP_TYPES = ["read", "verify", "plan", "execute", "evidence", "watch"]


@dataclass(frozen=True)
class MistakePattern:
    pattern_id: str
    title: str
    triggers: list[str]
    intervention: str

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


MISTAKE_PATTERNS = [
    MistakePattern(
        pattern_id="MP-001",
        title="Vision Outruns Evidence",
        triggers=["full system", "complete platform", "agent army", "production ready", "build it all"],
        intervention="Reduce to smallest safe work order. Require Current Truth and evidence gate.",
    ),
    MistakePattern(
        pattern_id="MP-002",
        title="Handoff Becomes Authorization",
        triggers=["continue from handoff", "what's next", "lets go", "let's go", "start from this packet"],
        intervention="Restate handoff is map, not authority. Require explicit release signal.",
    ),
    MistakePattern(
        pattern_id="MP-003",
        title="Repo Chaos Disguised As Progress",
        triggers=["clean it up", "merge the good stuff", "fix everything", "sync branches", "recover all useful code"],
        intervention="Require forensic classification before mutation.",
    ),
    MistakePattern(
        pattern_id="MP-004",
        title="Semantic Inflation",
        triggers=["constitution", "sovereign", "production", "ratified", "accepted", "canonical"],
        intervention="Check maturity label: idea, spec, implemented, validated, accepted, released.",
    ),
    MistakePattern(
        pattern_id="MP-005",
        title="Agent Over-Delegation",
        triggers=["let agents run it", "automatic improvements", "continuous ai", "self-improve"],
        intervention="Require agent permission matrix and explicit loop constraints.",
    ),
    MistakePattern(
        pattern_id="MP-006",
        title="Public/Private Lane Contamination",
        triggers=["county platform", "private saas", "public data product", "commercial sidecar"],
        intervention="Separate lanes, data boundaries, and authority.",
    ),
    MistakePattern(
        pattern_id="MP-007",
        title="Production Claim Trust",
        triggers=["go live", "production ready", "operational", "all systems go"],
        intervention="Require runtime evidence, deployment path, validators, and current date.",
    ),
    MistakePattern(
        pattern_id="MP-008",
        title="Repair Before Classification",
        triggers=["just fix it", "patch it", "remove junk", "clean stale files"],
        intervention="Classify before mutation.",
    ),
    MistakePattern(
        pattern_id="MP-009",
        title="Phase Expansion Drift",
        triggers=["phase 6", "autonomous", "scheduler", "worker", "auto-run"],
        intervention="Check Phase 6 lock and require explicit scoped authorization.",
    ),
    MistakePattern(
        pattern_id="MP-010",
        title="Validator Blindness",
        triggers=["tests passed", "green", "safe", "done"],
        intervention="Require what was tested, what was not tested, and known excluded failures.",
    ),
]


def _run_git(args: list[str]) -> str:
    try:
        result = subprocess.run(
            ["git", *args],
            cwd=str(PROJECT_ROOT),
            capture_output=True,
            text=True,
            timeout=5,
        )
    except Exception:
        return ""
    if result.returncode != 0:
        return ""
    return result.stdout.strip()


def _load_manifest() -> dict[str, Any]:
    try:
        return json.loads(DEVKIT_MANIFEST.read_text(encoding="utf-8"))
    except Exception:
        return {}


def _normalize_authority(authority: str | None) -> str:
    value = (authority or "A0_READ_ONLY").strip().upper()
    return value if value in AUTHORITY_RANK else "A0_READ_ONLY"


def _cap_authority(requested: str) -> str:
    # The playbook app may draft packets by default, but it never grants mutation.
    if AUTHORITY_RANK[requested] <= AUTHORITY_RANK["A1_DRAFT_ONLY"]:
        return requested
    return "A0_READ_ONLY"


def _classify_lane(text: str) -> str:
    lower = text.lower()
    if any(word in lower for word in ["terrafusion", "county platform", "government platform"]):
        return "TerraFusion Government Platform"
    if any(word in lower for word in ["assessor", "appraisal", "county official", "parcel"]):
        return "County Official / Assessor"
    if any(word in lower for word in ["atlas", "sidecar", "saas", "commercial"]):
        return "Private Commercial Sidecar / Atlas"
    if any(word in lower for word in ["learn", "training", "developer growth"]):
        return "Personal Learning / Developer Growth"
    if any(word in lower for word in ["recover", "restore", "forensic", "repo", "branch", "merge", "git"]):
        return "Forensic Recovery / Repo Governance"
    if any(word in lower for word in ["public", "speech", "report", "communication", "reputation"]):
        return "Public Communication / Reputation"
    if any(word in lower for word in ["release", "devops", "work order", "loop", "goal", "validator"]):
        return "DevOps / Release Engineering"
    return "WilliamOS Personal Command Brain"


def _classify_mode(text: str) -> str:
    lower = text.lower()
    if any(word in lower for word in ["hold", "pause", "handoff", "decision packet"]):
        return "HOLD"
    if any(word in lower for word in ["verify", "audit", "check", "validate", "test"]):
        return "VERIFY"
    if any(word in lower for word in ["implement", "build", "fix", "patch", "edit", "write code", "run", "automatic"]):
        return "EXECUTE"
    if any(word in lower for word in ["recover", "restore", "classify stale", "quarantine"]):
        return "RECOVER"
    if any(word in lower for word in ["draft", "plan", "work order", "packet", "sequence"]):
        return "PLAN"
    if any(word in lower for word in ["publish", "public", "speech", "press"]):
        return "PUBLIC"
    return "THINK"


def _estimate_risk(text: str, mode: str, lane: str, requested: str) -> str:
    lower = text.lower()
    if any(word in lower for word in ["production", "live county data", "push", "tag", "release", "phase 6"]):
        return "P0"
    if lane in {"TerraFusion Government Platform", "County Official / Assessor"}:
        return "HIGH"
    if mode in {"EXECUTE", "RECOVER"} or AUTHORITY_RANK[requested] >= AUTHORITY_RANK["A2_LOCAL_MUTATION"]:
        return "MEDIUM"
    return "LOW"


def match_mistake_patterns(text: str) -> list[dict[str, Any]]:
    lower = text.lower()
    matches = []
    for pattern in MISTAKE_PATTERNS:
        matched = [trigger for trigger in pattern.triggers if trigger in lower]
        if matched:
            row = pattern.to_dict()
            row["matched_triggers"] = matched
            matches.append(row)
    return matches


def current_truth() -> dict[str, Any]:
    manifest = _load_manifest()
    branch = _run_git(["branch", "--show-current"]) or "unknown"
    head = _run_git(["rev-parse", "HEAD"]) or "unknown"
    tags = _run_git(["tag", "--points-at", "HEAD"])
    status = _run_git(["status", "--short"])
    active = work_order_registry.active_work_orders()
    phase_6 = manifest.get("phase_6_status", "blocked")
    dirty = bool(status.strip())
    posture = "HOLD" if dirty else "READY"
    blocked = [
        "Phase 6 proactive behavior",
        "External worker direct write/commit/promote authority",
        "Silent cloud/model fallback",
        "Remote push, release tag, or production touch without explicit approval",
    ]
    if dirty:
        blocked.append("Mutation from generated packets while worktree has unclassified changes")
    return {
        "repo": str(PROJECT_ROOT),
        "branch": branch,
        "head": head,
        "tag": tags.splitlines() if tags else [],
        "phase": manifest.get("phase", "unknown"),
        "phase_6_status": phase_6,
        "active_work_orders": [row["wo_id"] for row in active],
        "posture": posture,
        "worktree_dirty": dirty,
        "worktree_status": status.splitlines() if status else [],
        "allowed": [
            "Read current state",
            "Classify goals",
            "Draft work orders",
            "Produce loop plans",
            "Collect read-only evidence",
        ],
        "blocked": blocked,
        "last_evidence": [
            "WilliamOS/95_ReleaseGovernance/devkit/150_DEVOPS_WORK_ORDER_PLAYBOOK.md",
            "WilliamOS/95_ReleaseGovernance/devkit/devkit-manifest.json",
        ],
        "next_valid_move": "Classify operator intent, draft a scoped work order, or run a read-only verifier.",
        "future_william_warning": "Do not treat a goal, handoff, or generated packet as mutation authority.",
    }


def handoff_banner() -> dict[str, str]:
    return {
        "HANDOFF_AUTHORITY": "NONE unless explicitly stated",
        "MUTATION_AUTHORITY": "NO unless explicitly stated",
        "NEXT_VALID_ACTION": "decision, verification, or scoped work order",
        "FUTURE_WILLIAM_WARNING": "do not treat this as release authority",
    }


def classify_goal(
    goal: str,
    lane: str | None = None,
    mode: str | None = None,
    authority: str | None = None,
) -> dict[str, Any]:
    text = goal.strip()
    requested = _normalize_authority(authority)
    classified_lane = lane.strip() if lane and lane.strip() else _classify_lane(text)
    classified_mode = mode.strip().upper() if mode and mode.strip().upper() in MODES else _classify_mode(text)
    granted = _cap_authority(requested)
    truth = current_truth()
    doctrine = doctrine_registry.query_action(text)
    patterns = match_mistake_patterns(text)
    risk = _estimate_risk(text, classified_mode, classified_lane, requested)
    conflicts = []
    if doctrine.get("result") == "matched":
        conflicts.extend(doctrine.get("forbidden", []))
    if truth["phase_6_status"] == "blocked" and "phase 6" in text.lower():
        conflicts.append("Phase 6 is blocked until explicit operator authorization.")
    if truth["worktree_dirty"] and AUTHORITY_RANK[requested] >= AUTHORITY_RANK["A2_LOCAL_MUTATION"]:
        conflicts.append("Worktree is dirty; mutation authority cannot be inferred.")

    recommended = "Draft a scoped work order and wait for explicit operator approval."
    if classified_mode == "VERIFY":
        recommended = "Run a read-only verifier loop and record evidence."
    if conflicts or patterns or granted != requested:
        recommended = "Hold execution; produce a scoped packet with authority, stop conditions, and evidence requirements."

    goal_date = datetime.now().strftime("%Y%m%d")
    goal_id = f"GOAL-{goal_date}-DRAFT"
    wo_id = f"WO-WILLIAMOS-DEVOPS-{goal_date}-DRAFT"
    return {
        "ok": True,
        "mode": "devops-goal-classifier-non-executing",
        "GOAL_ID": goal_id,
        "GOAL": text,
        "LANE": classified_lane,
        "MODE": classified_mode,
        "AUTHORITY_REQUESTED": requested,
        "AUTHORITY_GRANTED": granted,
        "RISK": risk,
        "CURRENT_LOCKS": truth["blocked"],
        "DOCTRINE_CONFLICTS": conflicts,
        "MISTAKE_PATTERN_MATCHES": patterns,
        "RECOMMENDED_NEXT_MOVE": recommended,
        "current_truth": truth,
        "handoff_banner": handoff_banner(),
        "work_order_draft": {
            "WO_ID": wo_id,
            "TITLE": text[:90],
            "LANE": classified_lane,
            "MODE": classified_mode,
            "AUTHORITY_LEVEL": granted,
            "STATUS": "draft",
            "OPERATOR_INTENT": text,
            "SCOPE": ["Classify request", "Prepare scoped work order", "Collect read-only evidence"],
            "EXPLICIT_EXCLUSIONS": truth["blocked"],
            "ALLOWED_ACTIONS": truth["allowed"],
            "BLOCKED_ACTIONS": truth["blocked"],
            "RISK_CLASS": risk,
            "ACCEPTANCE_CRITERIA": [
                "Scope is clear.",
                "Authority level is explicit.",
                "Validators and evidence requirements are declared.",
                "Operator approval exists before mutation.",
            ],
            "VALIDATION_COMMANDS": [
                "git status --short",
                "git branch --show-current",
                "git rev-parse HEAD",
            ],
            "EVIDENCE_REQUIREMENTS": [
                "Repo, branch, HEAD, and worktree state.",
                "Doctrine conflicts and mistake-pattern matches.",
                "Explicit non-authorizations.",
            ],
            "STOP_CONDITIONS": [
                "Authority is ambiguous.",
                "Scope expands.",
                "Doctrine conflict appears.",
                "Production, external, or data touch is required.",
            ],
            "FUTURE_WILLIAM_WARNING": "This draft is not execution authority.",
        },
    }


def run_loop_plan(
    target: str,
    loop_type: str = "verify",
    authority: str | None = None,
    max_iterations: int = 1,
    stop_on: str = "",
    evidence: str = "",
) -> dict[str, Any]:
    normalized_type = loop_type.strip().lower() if loop_type else "verify"
    if normalized_type not in LOOP_TYPES:
        normalized_type = "verify"
    requested = _normalize_authority(authority)
    granted = _cap_authority(requested)
    truth = current_truth()
    target_record = work_order_registry.get_work_order(target)
    blockers = []
    if normalized_type == "execute" and AUTHORITY_RANK[granted] < AUTHORITY_RANK["A2_LOCAL_MUTATION"]:
        blockers.append("Execute loop requires explicit A2_LOCAL_MUTATION or higher authority.")
    if not target_record and target.upper().startswith("WO-"):
        blockers.append("Target Work Order was not found in the registry.")
    if truth["worktree_dirty"] and AUTHORITY_RANK[requested] >= AUTHORITY_RANK["A2_LOCAL_MUTATION"]:
        blockers.append("Worktree is dirty; mutation loop cannot proceed.")

    actions = {
        "read": ["Read target state", "Read Current Truth", "Return evidence summary"],
        "verify": ["Read target state", "Check scope", "Check acceptance criteria", "Check doctrine conflicts"],
        "plan": ["Draft work order packet", "Sequence validators", "Declare stop conditions"],
        "execute": ["No execution performed by this planner", "Return approval requirements"],
        "evidence": ["Collect evidence fields", "Normalize evidence record"],
        "watch": ["Check condition changes", "Report posture only"],
    }[normalized_type]

    if blockers:
        stop_reason = "BLOCKED: " + "; ".join(blockers)
    elif max_iterations <= 1:
        stop_reason = "STOP: max iterations reached after non-executing plan."
    else:
        stop_reason = "STOP: planner emits one bounded iteration; rerun requires operator decision."

    return {
        "ok": True,
        "mode": "devops-loop-planner-non-executing",
        "LOOP_ID": f"LOOP-{datetime.now().strftime('%Y%m%d')}-DRAFT",
        "TARGET": target,
        "ITERATION": 1,
        "LOOP_TYPE": normalized_type.upper(),
        "AUTHORITY_REQUESTED": requested,
        "AUTHORITY": granted,
        "ACTIONS_TAKEN": actions,
        "EVIDENCE_COLLECTED": {
            "current_truth": truth,
            "target_work_order": target_record,
            "evidence_path": evidence,
        },
        "FINDINGS": [
            "Loop request was classified without executing commands.",
            "A handoff or loop request is not mutation authority.",
            "Existing safety gates remain authoritative.",
        ],
        "BLOCKERS": blockers,
        "STOP_REASON": stop_reason,
        "NEXT_VALID_MOVE": "Get operator approval for a scoped work order before mutation." if blockers else "Record evidence or request explicit next-loop authority.",
        "STOP_ON": stop_on,
        "handoff_banner": handoff_banner(),
    }


def playbook_summary() -> dict[str, Any]:
    return {
        "ok": True,
        "mode": "devops-playbook-operational",
        "lanes": LANES,
        "modes": MODES,
        "authority_levels": AUTHORITY_LEVELS,
        "loop_types": LOOP_TYPES,
        "mistake_patterns": [pattern.to_dict() for pattern in MISTAKE_PATTERNS],
        "current_truth": current_truth(),
        "handoff_banner": handoff_banner(),
        "first_slices": [
            {"wo_id": "WO-WILLIAMOS-DEVOPS-001", "purpose": "Add /goal classifier and work order draft output"},
            {"wo_id": "WO-WILLIAMOS-DEVOPS-002", "purpose": "Add /loop read-only verifier shell"},
            {"wo_id": "WO-WILLIAMOS-DEVOPS-003", "purpose": "Add Current Truth Panel dependency check"},
            {"wo_id": "WO-WILLIAMOS-DEVOPS-004", "purpose": "Add Mistake Pattern Registry check"},
            {"wo_id": "WO-WILLIAMOS-DEVOPS-005", "purpose": "Add Handoff Authority Banner"},
        ],
        "non_authorization": "This app classifies, drafts, and verifies. It does not execute from a goal or handoff.",
    }
