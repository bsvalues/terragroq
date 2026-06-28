"""Preview-only Commit Readiness Reviewer.

Phase 5P inspects the current repository state and produces decision support for
whether a local commit candidate is ready. It never stages, commits, pushes,
executes validators, schedules work, activates MCP, or writes production data.
"""

from __future__ import annotations

from pathlib import Path
from typing import Any

import evidence_pack_generator
import validation_runbook_registry


REPO_ROOT = Path(__file__).resolve().parents[2]
DIST_PREFIX = "control-center/frontend/dist/"

NON_AUTHORIZATIONS = [
    "no git add",
    "no commit",
    "no push",
    "no PR creation/update",
    "no merge",
    "no release",
    "no tag",
    "no automatic validator execution",
    "no scheduler",
    "no autonomy",
    "no MCP activation",
    "no production/data write",
]


def _parse_status_line(line: str) -> dict[str, str]:
    code = line[:2]
    path = line[3:] if len(line) > 3 else line
    return {"code": code, "path": path}


def _candidate_files(status_lines: list[str]) -> list[dict[str, str]]:
    return [_parse_status_line(line) for line in status_lines if line.strip()]


def _required_runbooks(files: list[dict[str, str]]) -> list[dict[str, Any]]:
    paths = [item["path"] for item in files]
    ids = ["scope-safety"]
    if any(path.startswith("control-center/backend/") for path in paths):
        ids.append("backend-full")
    if any(path.startswith("control-center/frontend/src/") or path.startswith(DIST_PREFIX) for path in paths):
        ids.append("frontend-build")
    if any(path.startswith("scripts/") for path in paths):
        ids.append("runtime-smoke")
    unique_ids = list(dict.fromkeys(ids))
    return [
        runbook
        for runbook_id in unique_ids
        if (runbook := validation_runbook_registry.get_validation_runbook(runbook_id))
    ]


def _dist_status(files: list[dict[str, str]]) -> dict[str, Any]:
    dist_files = [item for item in files if item["path"].startswith(DIST_PREFIX)]
    deleted = [item["path"] for item in dist_files if "D" in item["code"]]
    added = [item["path"] for item in dist_files if item["code"] == "??" or "A" in item["code"]]
    modified = [item["path"] for item in dist_files if "M" in item["code"]]
    expected_triplet = len(deleted) == 1 and len(added) == 1 and "control-center/frontend/dist/index.html" in modified
    return {
        "present": bool(dist_files),
        "files": dist_files,
        "deleted": deleted,
        "added": added,
        "modified": modified,
        "complete_matching_triplet": expected_triplet,
        "decision": "owner-review-required" if dist_files and not expected_triplet else "ok",
    }


def _decision(files: list[dict[str, str]], dist: dict[str, Any]) -> tuple[str, list[str]]:
    blockers: list[str] = []
    if not files:
        blockers.append("No candidate files are present.")
    if dist["present"] and not dist["complete_matching_triplet"]:
        blockers.append("Tracked dist changes are present but do not form a complete matching triplet.")
    if any(path.startswith(".env") for path in [item["path"] for item in files]):
        blockers.append("Environment or secret-like file path is part of the candidate.")
    if blockers:
        return "NOT_SAFE_TO_COMMIT", blockers
    return "SAFE_TO_COMMIT_CANDIDATE", []


def current_commit_readiness() -> dict[str, Any]:
    packet = evidence_pack_generator.current_evidence_packet()
    files = _candidate_files(packet["git_status"])
    dist = _dist_status(files)
    decision, blockers = _decision(files, dist)
    required_runbooks = _required_runbooks(files)
    return {
        "ok": True,
        "mode": "preview-only-commit-readiness-reviewer",
        "repo": packet["repo"],
        "branch": packet["branch"],
        "head": packet["head"],
        "short_head": packet["short_head"],
        "decision": decision,
        "safe_to_commit": decision == "SAFE_TO_COMMIT_CANDIDATE",
        "candidate_files": files,
        "candidate_count": len(files),
        "dist_status": dist,
        "required_validators": required_runbooks,
        "validators_run_by_reviewer": False,
        "blockers": blockers,
        "reasons": [
            "Reviewer inspects git status only.",
            "Commit still requires explicit owner action outside this endpoint.",
            "Validators are recommended from metadata runbooks and are not executed.",
        ],
        "safety": {
            "read_only_reviewer": True,
            "would_stage": False,
            "would_commit": False,
            "would_push": False,
            "would_execute_validators": False,
            "scheduler_enabled": False,
            "autonomy_enabled": False,
            "mcp_activation": False,
            "production_write": False,
        },
        "non_authorizations_preserved": NON_AUTHORIZATIONS,
    }
