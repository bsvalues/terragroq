"""Read-only Evidence Pack Generator.

Phase 5L creates repeatable handoff packets from current repository state and
declared validator expectations. It does not run validators, write evidence
files, mutate the repository, activate MCP, or enable autonomous behavior.
"""

from __future__ import annotations

import subprocess
from dataclasses import asdict, dataclass
from datetime import datetime
from pathlib import Path
from typing import Any


REPO_ROOT = Path(__file__).resolve().parents[2]


@dataclass(frozen=True)
class ValidatorExpectation:
    id: str
    command: str
    purpose: str
    required_for: list[str]
    last_result: str = "not-run-by-generator"

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


VALIDATORS = [
    ValidatorExpectation(
        id="backend-tests",
        command="python -m pytest control-center/backend/tests -q",
        purpose="Validate backend API, registries, governance surfaces, and safety behavior.",
        required_for=["backend_change", "governance_change", "commit_candidate"],
    ),
    ValidatorExpectation(
        id="frontend-build",
        command="cd control-center/frontend && npm run build",
        purpose="Validate Control Center TypeScript and synchronized tracked dist output.",
        required_for=["frontend_change", "dist_change", "commit_candidate"],
    ),
    ValidatorExpectation(
        id="control-center-smoke",
        command="python scripts/william.py control-center-smoke",
        purpose="Validate live Control Center routes and operator surfaces.",
        required_for=["runtime_evidence", "release_candidate"],
    ),
    ValidatorExpectation(
        id="production-readiness",
        command="python scripts/william.py production-readiness",
        purpose="Validate production-readiness gate without granting release authority.",
        required_for=["release_candidate", "tag_candidate"],
    ),
]


def _run_git(args: list[str]) -> tuple[bool, str]:
    try:
        result = subprocess.run(
            ["git", *args],
            cwd=str(REPO_ROOT),
            capture_output=True,
            text=True,
            timeout=5,
        )
    except Exception as exc:  # pragma: no cover - defensive guard for local git failures
        return False, str(exc)
    output = result.stdout.strip() if result.returncode == 0 else (result.stderr.strip() or result.stdout.strip())
    return result.returncode == 0, output


def _git_lines(args: list[str]) -> list[str]:
    ok, output = _run_git(args)
    if not ok or not output:
        return []
    return output.splitlines()


def _git_value(args: list[str], fallback: str = "unknown") -> str:
    ok, output = _run_git(args)
    return output if ok and output else fallback


def _classify_status(lines: list[str]) -> dict[str, Any]:
    tracked_modified = []
    untracked = []
    deleted = []
    staged = []
    for line in lines:
        if not line:
            continue
        code = line[:2]
        path = line[3:] if len(line) > 3 else line
        if code == "??":
            untracked.append(path)
        elif "D" in code:
            deleted.append(path)
        elif code[0] != " ":
            staged.append(path)
        else:
            tracked_modified.append(path)
    return {
        "tracked_modified": tracked_modified,
        "untracked": untracked,
        "deleted": deleted,
        "staged": staged,
        "clean": not lines,
    }


def current_evidence_packet() -> dict[str, Any]:
    status_lines = _git_lines(["status", "--short"])
    status = _classify_status(status_lines)
    clean = status["clean"]
    branch = _git_value(["branch", "--show-current"])
    head = _git_value(["rev-parse", "HEAD"])
    short_head = _git_value(["rev-parse", "--short", "HEAD"])
    recent_commits = _git_lines(["log", "--oneline", "-5"])
    diff_stat = _git_lines(["diff", "--stat"])
    staged_stat = _git_lines(["diff", "--cached", "--stat"])
    next_gate = "Owner decision on next scoped work order." if clean else "Classify dirty work before mutation or commit."
    safety = {
        "read_only_generator": True,
        "would_execute_validators": False,
        "would_write_files": False,
        "autonomy_enabled": False,
        "mcp_activation": False,
        "production_write": False,
        "push_pr_merge_release": False,
    }
    return {
        "ok": True,
        "mode": "read-only-evidence-pack-preview",
        "packet_id": f"EVIDENCE-{datetime.now().strftime('%Y%m%d-%H%M%S')}-{short_head}",
        "generated_at": datetime.now().isoformat(timespec="seconds"),
        "repo": str(REPO_ROOT),
        "branch": branch,
        "head": head,
        "short_head": short_head,
        "worktree_clean": clean,
        "git_status": status_lines,
        "dirty_files": status,
        "diff_stat": diff_stat,
        "staged_stat": staged_stat,
        "recent_commits": recent_commits,
        "validators": [validator.to_dict() for validator in VALIDATORS],
        "build_result": "not-run-by-generator",
        "test_result": "not-run-by-generator",
        "safety": safety,
        "non_authorizations_preserved": [
            "no push",
            "no PR creation",
            "no merge",
            "no release",
            "no MCP activation",
            "no autonomy",
            "no production/data write",
            "no validator execution by generator",
        ],
        "next_valid_gate": next_gate,
    }
