"""SDLC roles built on the deterministic adapter.

worker      — implement a task by emitting structured edits; apply atomically; verify; repair.
review      — emit a strict PASS/FAIL verdict with a reason (no tools, no file writes).
remediate   — a worker whose task is derived from a review verdict.

Guarantees (the whole point of the tier):
  * The model NEVER edits files or runs commands directly — it only proposes structured edits.
  * Malformed / out-of-scope / unappliable / verification-failing output is REJECTED and fed back
    for a bounded number of repair attempts.
  * If no attempt verifies, the workspace is RESTORED to its pre-run state (fail-closed) — no
    silent partial writes, and the failure is reported honestly.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Callable

from .receipts import Receipt
from .schema import Edit, Verdict, parse_edits, parse_verdict
from .verify import Verifier, VerifyResult
from .workspace import Workspace

WORKER_SYSTEM = (
    "You are a precise software engineer. You DO NOT run tools, shells, or commands. "
    "You respond with ONLY a JSON object of the form "
    '{"edits":[{"file":"<path>","operation":"replace","old_text":"<verbatim unique snippet>",'
    '"new_text":"<replacement>"}]}. '
    "Rules: (1) old_text MUST be copied VERBATIM from the shown file and MUST be unique in it; "
    "(2) keep edits minimal; (3) use operation \"rewrite\" with a \"content\" field only to replace "
    "an entire small file; (4) only edit files you were shown. Output JSON only — no prose, no markdown."
)

REVIEW_SYSTEM = (
    "You are a strict, precise code reviewer. You respond with ONLY a JSON object "
    '{"verdict":"PASS"|"FAIL","reason":"<one concise line>","suggested_fix":"<one line or empty>"}. '
    "PASS only if the code fully meets the stated requirement. Output JSON only — no prose."
)

VerifierFactory = Callable[[list[str]], Verifier]


@dataclass
class RoleResult:
    role: str
    success: bool
    attempts: int
    detail: str
    edits_applied: list[dict] = field(default_factory=list)
    verify: VerifyResult | None = None
    verdict: Verdict | None = None
    receipt: dict | None = None

    def to_dict(self) -> dict:
        return {
            "role": self.role,
            "success": self.success,
            "attempts": self.attempts,
            "detail": self.detail,
            "edits_applied": self.edits_applied,
            "verify": {"ok": self.verify.ok, "summary": self.verify.summary()} if self.verify else None,
            "verdict": self.verdict.__dict__ if self.verdict else None,
            "receipt": self.receipt,
        }


def _file_block(ws: Workspace, files: list[str]) -> str:
    parts = []
    for f in files:
        body = ws.read(f) if ws.exists(f) else "(this file does not exist yet)"
        parts.append(f"### FILE: {f}\n{body}")
    return "\n\n".join(parts)


def _worker_prompt(task: str, targets: list[str], ws: Workspace, prior_error: str | None) -> str:
    p = (
        f"TASK: {task}\n\n"
        f"You may ONLY edit these files: {targets}\n\n"
        f"Current file contents:\n{_file_block(ws, targets)}\n\n"
        "Return the JSON edits that accomplish the task."
    )
    if prior_error:
        p += f"\n\nIMPORTANT — your previous attempt was rejected. Fix this and try again: {prior_error}"
    return p


def worker(task: str, targets: list[str], ws: Workspace, model,
           make_verifier: VerifierFactory, max_attempts: int = 3,
           receipt: Receipt | None = None) -> RoleResult:
    receipt = receipt or Receipt("worker")
    snap = ws.snapshot(targets)
    prior_error: str | None = None

    for attempt in range(1, max_attempts + 1):
        raw = model.chat(WORKER_SYSTEM, _worker_prompt(task, targets, ws, prior_error), json_mode=True)
        receipt.add("model_call", role="worker", attempt=attempt, response_chars=len(raw))

        edits, err = parse_edits(raw)
        if err:
            prior_error = f"invalid structured output: {err}"
            receipt.add("rejected", attempt=attempt, reason=prior_error)
            continue

        out_of_scope = sorted({e.file for e in edits if e.file not in targets})
        if out_of_scope:
            prior_error = f"you may only edit {targets}; you tried to edit {out_of_scope}"
            receipt.add("rejected", attempt=attempt, reason=prior_error)
            continue

        applied, msgs = ws.apply_edits(edits)
        if not applied:
            prior_error = f"edit could not be applied cleanly: {msgs[-1]}"
            receipt.add("apply_failed", attempt=attempt, reason=msgs[-1])
            continue

        vres = make_verifier(targets).run()
        receipt.add("verify", attempt=attempt, ok=vres.ok, summary=vres.summary())
        if vres.ok:
            return RoleResult("worker", True, attempt, "verified",
                              [e.__dict__ for e in edits], vres, None, receipt.to_dict())

        ws.restore(snap)
        prior_error = f"the edit applied but verification failed: {vres.summary()}"

    ws.restore(snap)
    return RoleResult(
        "worker", False, max_attempts,
        f"failed after {max_attempts} attempt(s); workspace restored. last error: {prior_error}",
        [], None, None, receipt.to_dict(),
    )


def review(target: str, requirement: str, ws: Workspace, model,
           max_attempts: int = 2, receipt: Receipt | None = None) -> RoleResult:
    receipt = receipt or Receipt("review")
    body = ws.read(target) if ws.exists(target) else "(missing file)"
    user = (
        f"REQUIREMENT: {requirement}\n\n"
        f"### FILE: {target}\n{body}\n\n"
        "Does the code fully meet the requirement? Return the JSON verdict."
    )
    err = None
    for attempt in range(1, max_attempts + 1):
        raw = model.chat(REVIEW_SYSTEM, user, json_mode=True)
        receipt.add("model_call", role="review", attempt=attempt, response_chars=len(raw))
        verdict, err = parse_verdict(raw)
        if verdict:
            receipt.add("verdict", attempt=attempt, verdict=verdict.verdict, reason=verdict.reason)
            return RoleResult("review", True, attempt, verdict.verdict,
                              verdict=verdict, receipt=receipt.to_dict())
        receipt.add("rejected", attempt=attempt, reason=err)
    return RoleResult("review", False, max_attempts,
                      f"could not obtain a valid verdict: {err}", receipt=receipt.to_dict())


def remediate(target: str, verdict: Verdict, ws: Workspace, model,
              make_verifier: VerifierFactory, max_attempts: int = 3,
              receipt: Receipt | None = None) -> RoleResult:
    task = (
        f"A reviewer found a defect and it must be fixed. Reviewer reason: {verdict.reason}. "
        f"Suggested fix: {verdict.suggested_fix or '(none given)'}. "
        f"Edit {target} to correct it while keeping all other behavior intact."
    )
    res = worker(task, [target], ws, model, make_verifier, max_attempts,
                 receipt or Receipt("remediate"))
    res.role = "remediate"
    return res
