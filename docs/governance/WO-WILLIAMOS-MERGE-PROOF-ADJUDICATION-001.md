# WO-WILLIAMOS-MERGE-PROOF-ADJUDICATION-001 — merge admission is adjudicated, not asserted

**Status:** IMPLEMENTED, AWAITING INDEPENDENT REVIEW · **Raised:** 2026-08-25 ·
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
