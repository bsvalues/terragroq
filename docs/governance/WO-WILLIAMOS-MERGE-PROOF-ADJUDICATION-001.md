# WO-WILLIAMOS-MERGE-PROOF-ADJUDICATION-001 — merge admission is adjudicated, not asserted

**Status:** REVIEW REMEDIATION APPLIED, AWAITING FRESH INDEPENDENT REVIEW · **Raised:** 2026-08-25 ·
**Source:** owner directive in session 2026-08-25 ("start the merge-gate P0 slice one
implementation"), following owner-authored specification in the same session
**Provider lane:** Claude Code, separate lane per `AGENTS.md` ("separate repository or isolated suite
reservation, branch/worktree, validation, evidence, and reviewer")
**Risk class:** R1 — WilliamOS-native, reversible, no production or protected-authority mutation

## Authority basis

This Work Order **records** an owner directive; it does not mint authority. The owner specified the
slice-one scope, the evidence-preservation boundary, the eleven-case adversarial matrix, and the
`checksGreen` seam to replace. Ratification is through review of this branch.

## The defect

`scripts/hermes-bridge/repository-lifecycle.mjs` accepted `SKIPPED` and `NEUTRAL` as successful
(`SUCCESSFUL_CHECKS`, line 12), derived `checksGreen` from whatever checks the provider happened to
return, and gated `mergePullRequest` on that scalar. Consequences:

- A required proof that never reported was **invisible**, not failing.
- `checks.length > 0` was the only floor, so **one skipped advisory check** could satisfy the entire
  gate while every required proof was absent.
- `effectiveCheckState` **upgraded** a rate-limited (non-executed) check to `SUCCESS` when a review
  existed — substituting one assurance for another.
- `failedChecks` also treated those states as not-failed, so telemetry agreed with the wrong verdict.

Root invariant violated: *nothing is admissible on the strength of its own assertion.*

## Slice one scope (deliberately narrow)

Answers only: **did every proof required by the contract exist, execute, and pass for the bound
subject?** It does **not** answer whether a proof exercised the correct target, project, or
environment — that is proof-semantic adequacy and belongs to a later layer.

Explicitly out of scope: documents, OMEN, authority graphs, search archaeology, the truth tuple.

## Reservation

| Path | Change |
|---|---|
| `config/hermes-bridge/required-proof-set.json` | NEW — locally declared required-proof contract |
| `scripts/hermes-bridge/proof-adjudication.mjs` | NEW — pure adjudicator, no I/O, no provider calls |
| `scripts/hermes-bridge/repository-lifecycle.mjs` | seam only: import, attach `mergeAdmission`, gate `mergePullRequest` on it |
| `tests/hermes-proof-adjudication.test.ts` | NEW — adversarial matrix |
| `tests/hermes-repository-lifecycle.test.ts` | one fixture updated (see below) |

No other reservation is taken. `checksGreen` is **retained unchanged** for existing advisory and
selection callers (`cli.mjs`, `orchestrator.mjs`); only the *merge-admission* use is replaced.

## Design

```
Proof Contract (locally declared requiredProofSet)
  -> raw provider check contexts (de-duplicated, NOT pre-digested)
  -> Proof Adjudicator   presence · execution state · success · head binding
  -> Adjudication Receipt
  -> repository lifecycle   MERGE_ADMISSIBLE | MERGE_INADMISSIBLE
```

The adapter preserves evidence: `SKIPPED`, `NEUTRAL`, `CANCELLED`, `TIMED_OUT`, `PENDING`,
`NOT_REPORTED` and `FAILED` remain **distinct inputs**. The adjudicator — never the adapter — decides
whether a required proof executed and passed. Only `SUCCEEDED` satisfies. An unrecognised provider
state is classified `FAILED`, never assumed benign. Adjudication reads the raw contexts, **not**
`effectiveCheckState`, so no review can substitute for a check that did not run.

## Fixture change and why it is not a weakening

`tests/hermes-repository-lifecycle.test.ts` merge test previously used
`statusCheckRollup: [{ conclusion: "SUCCESS" }, { state: "SUCCESS" }]` — two **anonymous** checks and
**no required proof**. It passed because `checksGreen` was true. That fixture encoded the defect. It
now names the three required proofs as succeeding and retains the two anonymous checks, which
additionally proves extra irrelevant checks do not block. The assertion is unchanged.

## Validation

- `tests/hermes-proof-adjudication.test.ts` — 19 tests, adversarial matrix, **PASS**
- All four suites importing the changed modules (`hermes-proof-adjudication`,
  `hermes-repository-lifecycle`, `hermes-derived-aegis-cycle`, `hermes-kernel-client`) —
  **126 passed, 1 skipped**
- Full deterministic suite run on this branch and on clean `origin/main` for baseline comparison;
  see evidence section of the pull request. Pre-existing failures unrelated to this reservation must
  be identical on both.

## Adversarial matrix — only one case may merge

required proof absent · skipped · neutral · cancelled · pending · failed ·
**all required proofs successful** · optional assurance unavailable · extra irrelevant checks ·
duplicate/ambiguous proof identity · substitution of a review/another check for an unexecuted proof.
Plus: lone skipped advisory check only · lone success with all required absent · unbound head SHA ·
contract declaring no required proofs.

## Independent review

Required and not yet sourced. This lane's author may not review it. Review must confirm at minimum:
(1) no provider state that represents non-execution can satisfy a required proof; (2) the adapter
does not pre-digest evidence; (3) `checksGreen` semantics are unchanged for non-merge callers;
(4) the fixture change preserves the original assertion.

## Follow-on, explicitly not in this slice

Proof-semantic adequacy (did the proof exercise the declared target/scope), and generalisation of
this adjudication primitive into fabric role/authority reconciliation by
`PRESENT_AS -> GENERALIZE` rather than a second adjudicator.

## Review remediation — 2026-08-25

Independent review of `788b31f7` returned `CHANGES_REQUIRED` with two blocking proof-identity
defects. Both are fixed; no redesign was needed.

### Finding 1 — the contract was not fail-closed against malformed declarations

`readRequiredProofs()` silently `.filter()`-ed out entries missing `proofId` or `matchName`, and did
not reject duplicates. **A typo in `matchName` therefore deleted a required proof**, and two
declarations sharing a name let one check satisfy two proof ids. Fail-open, in the component built to
fail closed.

Replaced by `parseContract()`, which **accumulates errors instead of dropping entries** and refuses:
`ENTRY_MISSING_PROOF_ID` · `ENTRY_MISSING_MATCH_NAME` · `ENTRY_INVALID_KIND` ·
`ENTRY_MISSING_WORKFLOW_NAME` (CheckRun) · `DUPLICATE_PROOF_ID` · `DUPLICATE_PROOF_IDENTITY` ·
`CONTRACT_DECLARES_NO_REQUIRED_PROOFS`. Errors surface as `CONTRACT_INVALID:<reason>` blocking
reasons, so a malformed contract yields `MERGE_INADMISSIBLE` rather than a quietly smaller required
set. All errors are reported, not just the first.

### Finding 2 — a required proof was matched by display name alone

The adapter retains `__typename` and `workflowName`; the adjudicator ignored them. A different
workflow, or a `StatusContext` sharing the name, could substitute for the real proof — a direct
violation of the no-substitution invariant.

Proof identity is now **(kind, workflowName, matchName)**. Contract v2 declares all three per proof.
Observed identity is derived the same way, with `StatusContext` carrying an empty workflow. A check
that resolves to no known kind matches nothing. An impostor sharing a required display name is
classified as *optional assurance*, never as the required proof.

Identity values were taken from the live rollup on PR #1022 rather than guessed: all three required
proofs are `CheckRun`, workflows `work context` and `ci`.

### Tests added (12)

Contract validation: missing proofId · missing matchName · invalid kind · CheckRun without
workflowName · duplicate proof id · duplicate identity · all-errors-reported · shipped contract valid.
Identity: same-name different workflow · same-name StatusContext · unresolvable kind · impostor
classified as optional.

`tests/hermes-proof-adjudication.test.ts` 31 passed. Four suites importing changed modules:
**138 passed, 1 skipped** (was 126).

### Fixture note

`tests/hermes-repository-lifecycle.test.ts` merge fixture now carries `__typename` and `workflowName`
on the three required checks, because identity is no longer the display name. The two anonymous
checks are retained and continue to prove irrelevant checks do not block.

## Work-context receipt provenance — READ THIS

The `#831` receipt attached to PR #1022 was issued in **`local` provenance**, not `ledger`:
cockpit issuance was unavailable (`~/.williamos/device-credential.json` absent). Per
`docs/governance/claude-code-work-context-gate.md`, `local` means **authority was NOT checked and the
claim was NOT recorded** — it stops drift and scope creep, not a determined forger. This must not be
read as stronger evidence than it is.
