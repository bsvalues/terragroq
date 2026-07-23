# WO-HERMES-7-001 Work Orders Hermes Delivery Radar

`RESULT: READY_FOR_VALIDATION`

## Owner outcome

Make the Work Orders area show what is currently moving, what failed, and what Hermes will do next.

## Product behavior

The Work Orders page now leads with a bounded three-lane delivery radar:

- **Moving / Currently moving** shows `active` and `review` Work Orders, ordered by the newest recorded activity.
- **Failed / Recorded failures** shows only records with an explicit `FAIL` result, ordered by `updatedAt` so a result recorded after terminal closure appears as the newest failure. A blocked or aborted lifecycle state is not silently relabeled as failure.
- **Next / Hermes next** shows expected continuation for open `approved`, `active`, `blocked`, and `review` Work Orders. Recovery is ordered before blocked, review, active, and approved continuation.

Each lane preserves its complete count while displaying at most four rows. The full Work Orders register and existing detail surfaces remain below the radar.

## Truth boundary

The Work Order record contains lifecycle status, result, evidence, stop conditions, and timestamps. It does not contain a live Hermes lease, checkpoint, or `nextState`.

The panel therefore states that Hermes-next guidance is derived from recorded Work Order state and is not live worker telemetry. It does not manufacture runtime state:

- a recorded stop condition is identified as a stop condition;
- an ordinary Work Order description is never presented as a stop boundary;
- description-only blocked work receives generic recover, reroute, or held guidance;
- terminal Work Orders are excluded from Hermes-next continuation;
- no run, retry, merge, authority, scheduler, or production controls are added.

## Files

- `app/(shell)/work-orders/page.tsx`
- `components/work-orders/active-work-queue.ts`
- `components/work-orders/active-work-queue-panel.tsx`
- `tests/active-work-queue.test.ts`
- `docs/reports/WO-HERMES-7-001-work-orders-hermes-delivery-radar.md`

## Focused coverage

The changed focused test covers:

- motion versus explicit failure classification;
- blocked and aborted records not being mislabeled as failures;
- case-insensitive explicit `FAIL` normalization;
- recovery-first Hermes-next ordering;
- stop-condition versus ordinary-description semantics;
- full counts with bounded displayed rows;
- independent empty states;
- input non-mutation;
- read-only safety and the no-live-telemetry claim.

## Independent review

An independent read-only Codex assurance lane reviewed the exact changed page, projection, panel, and focused test.

The first review requested one important correction: description-only blocked work was being described as though the ordinary description were a formal stop boundary. The projection and focused test were corrected. The same remediation also clarified failure-card context.

The reviewer inspected the bounded remediation and returned `READY` with no remaining Critical, Important, or Minor findings.

A backup assurance lane was provider-unavailable at the Windows process-spawn boundary and made no review claim. The healthy independent review lane completed normally.

## Native-host remediation

The first Hermes native-host full-suite run rejected the handoff after four process-heavy tests failed under host contention:

- three CLI/workspace tests exceeded Vitest's default five-second timeout;
- one two-child evidence-ledger serialization attempt returned one nonzero child exit.

The next native-host run cleared those four cases and exposed one adjacent isolated-workspace rollback test that still used the five-second default. It now uses the same local process-test timeout precedent.

The bounded remediation changes test execution tolerance only:

- the five named process-heavy tests now have an explicit 30-second timeout, matching existing process-heavy suite precedent;
- the concurrent evidence-ledger serialization test preserves both child exits exactly as observed;
- no ledger, workspace, reservation, runtime, or production behavior changed by the test-harness correction.

The test body and child appends are never retried. Both child exit codes and the final ledger-integrity assertion remain directly observable, so a lock, no-clobber, head-conflict, or serialization regression cannot be converted into a passing serial retry.

### Remediation file review

A separate file-only review of the bounded remediation found no remaining issue:

- all original assertions and child-process coverage remain intact;
- timeout changes are local to the five reported process-heavy failures and use the suite's existing 30-second process-test precedent;
- concurrent child failures remain visible and cannot be replaced by a later serial append;
- no skip, weakened expected value, global timeout, production mutation, or runtime behavior was introduced.

The final exact-head remediation was validated after removing the child retry.

## Pull-request review remediation

Two actionable review findings were accepted and corrected:

- failed Work Orders now sort by `updatedAt`, rather than preferring an older terminal timestamp, with a five-row regression fixture proving a newly recorded terminal failure remains inside the four-row briefing;
- the evidence-ledger test retries neither the Vitest case nor either child append; the original exit-code and ledger-integrity assertions run exactly once.

Direct file review found no remaining issue in either remediation.

## Final validation

- `npx vitest run tests/active-work-queue.test.ts tests/multi-agent-evidence-ledger.test.ts tests/multi-agent-isolated-workspace-manager.test.ts tests/multi-agent-reservation-ledger.test.ts`: 4 files, 71 tests passed.
- `npm run lint`: passed with no warnings or errors.
- `npm test -- --run`: 214 files passed; 1,714 tests passed and 2 skipped.
- `NEXT_PRIVATE_BUILD_WORKER=0 NEXT_TELEMETRY_DISABLED=1 npm run build`: passed after removing only stale generated `.next` output and restoring the lockfile-pinned validation dependencies.
- `git diff --check`: passed.

## Safety

- Reserved paths only.
- Read-only product projection and presentation.
- No database schema or mutation behavior changed.
- No production deployment or unrelated production mutation.
- No credential, secret, token, cookie, session, or password access.
- No Property Workbench, TerraPilot, TerraFusion, county/PACS system or data access.
- No rejected issue `#357` adapter or runtime-operator execution path access.
- No `.obsidian/` changes.
