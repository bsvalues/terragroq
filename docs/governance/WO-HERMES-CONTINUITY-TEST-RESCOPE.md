# WO-HERMES-CONTINUITY-TEST-RESCOPE — re-scope `goal-operator-continuity` onto the governed work-contract runtime

**Status:** CLOSED — option A executed 2026-08-16 (owner decision). Test green; CI exclusion
removed.

**What changed in `tests/goal-operator-continuity.test.ts`:** the scenario now runs on the
registered contract via the *real* `resolveHermesWorkContract` (lane `ui`, registered intent
text; no injected resolver); the outcome carries a durable `queueBinding`; `changedPaths` is the
contract's first reservation and validators are the contract's three commands;
`PersistedRuntimeLedger.query` answers the canonical authorization SELECT
(`FROM goal AS contract_goal …`) with one row shaped like the sibling
`hermes-bridge-outcome-source` fixture, and answers the enriched `work_order` SELECT with the
`latest*` / `epoch_latest` LATERAL columns derived from its own recorded checkpoint events. The
continuity claim itself — interrupt → resume same thread → single fenced completion, projected
identically across Goal timeline / Runtime / Trace / Evidence — is unchanged.

Negative control recorded: removing `queueBinding` fails at
`HERMES_RUNTIME_PROJECTION_WALL ← OUTCOME_WORK_ORDER_AUTHORIZATION_WALL`, proving the new
authorization path is exercised, not bypassed.

## Symptom

`tests/goal-operator-continuity.test.ts` (WO #461, 2026-07-26, `04a2aa9`) expects the first
orchestrator cycle to reject with `APP_SERVER_TURN_INTERRUPTED`; it now rejects earlier with
`HERMES_WORK_CONTRACT_WALL` ("Outcome has no exact reviewed work contract").

## Root cause (proven, not a runtime defect)

Two commits on 2026-08-14 hardened the Hermes bridge and updated the *sibling* tests but not
this one:

1. `4c80e9a` "govern project outcome execution" — added `requireHermesWorkContract`
   (`scripts/hermes-bridge/orchestrator.mjs:296`), called in `cycle()` at `:1346`, **before**
   `client.runTurn` at `:1718`. `resolveHermesWorkContract` (`work-contract.mjs:56`) is
   deny-by-default: it matches exactly one pre-registered UI intent
   (`selected-thread-latest-evidence.v1`, lane `ui`). `hermes-bridge-orchestrator.test.ts` was
   given an injected `workContractResolver`; this file was not.
2. `6a3539a` "bind work orders to reviewed execution contract" — `projectOutcomeRuntimeCheckpoint`
   / `projectOutcomeRuntimeLease` (`outcome-source.mjs`) now require a durable
   `outcome.queueBinding` (`normalizeRuntimeExecutionBinding`, `:2033`) and a canonical Workbench
   authorization row; `exactAuthorizationContract` (`:2067-2088`) requires the receipt contract to
   equal **both** the caller's contract **and** the registered
   `HERMES_SELECTED_THREAD_LATEST_EVIDENCE_CONTRACT_{ID,DIGEST}` with `lane = goal.lane`.

Consequence: the persisted projectors accept exactly one work contract in existence, and it is
lane `ui`. This test's scenario is lane `read_model` with a `read_model` reservation, so **no
fixture injection alone can make it pass** — verified 2026-08-16: injecting a resolver moved the
failure from `HERMES_WORK_CONTRACT_WALL` to `HERMES_RUNTIME_PROJECTION_WALL` ←
`OUTCOME_WORK_ORDER_AUTHORIZATION_WALL` ("runtime execution binding is invalid"). Edit reverted.

## Decision required

Pick one; both are content changes to what WO #461 claims, so owner call:

- **A. Re-scope the scenario onto the registered UI contract.** Outcome becomes lane `ui`, the
  registered intent text, `changedPaths` = the contract's three reservations, validators = the
  contract's three commands; add a `queueBinding`; extend `PersistedRuntimeLedger.query` to answer
  the new authorization SELECT (goal/queue/receipt/acquisition/thread/project/grant JOIN, returns
  one row incl. `workContract` JSON), the new `work_order` SELECT with `latest*`/`epoch_latest`
  LATERALs, and the `allowedFiles`/`validators` INSERT params. Keeps the continuity proof
  (interrupt → resume → single fenced completion) on the real projectors. Est. 1–2 h.
- **B. Retire the test** as superseded by `hermes-bridge-orchestrator.test.ts` +
  `hermes-bridge-outcome-source.test.ts` (which cover the wall, the binding, and the projections
  separately) — but those use mocked projectors; the end-to-end continuity claim would be lost.

Recommendation: **A**.

## Acceptance

- `pnpm exec vitest run tests/goal-operator-continuity.test.ts` green.
- Remove the entry from `vitest.ci.config.ts`.
