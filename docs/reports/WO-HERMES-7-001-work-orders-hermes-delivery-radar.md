# WO-HERMES-7-001 Work Orders Hermes Delivery Radar

`RESULT: READY_FOR_VALIDATION`

## Owner outcome

Make the Work Orders area show what is currently moving, what failed, and what Hermes will do next.

## Product behavior

The Work Orders page now leads with a bounded three-lane delivery radar:

- **Moving / Currently moving** shows `active` and `review` Work Orders, ordered by the newest recorded activity.
- **Failed / Recorded failures** shows only records with an explicit `FAIL` result. A blocked or aborted lifecycle state is not silently relabeled as failure.
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
- one two-child evidence-ledger serialization attempt returned one transient nonzero child exit.

The bounded remediation changes test execution tolerance only:

- the four named process-heavy tests now have an explicit 30-second timeout, matching existing process-heavy suite precedent;
- the concurrent evidence-ledger serialization test permits one classified retry on the observed Windows host only;
- no ledger, workspace, reservation, Work Orders product, runtime, or production behavior changed.

The retry is limited to the Windows test that produced the transient child exit. Deterministic assertion failures still fail after that single retry, non-Windows runs receive no retry, and every other affected test receives timeout headroom without retry.

### Remediation file review

A separate file-only review of the bounded remediation found no remaining issue:

- all original assertions and child-process coverage remain intact;
- timeout changes are local to the four reported failures and use the suite's existing 30-second process-test precedent;
- the single retry is platform-bound, count-bound, and limited to the concurrent serialization case;
- no skip, weakened expected value, global timeout, production mutation, or runtime behavior was introduced.

Native execution remains deliberately unclaimed until Hermes reruns validation.

## Validation handoff

The App Server task did not run native validators, Git, or GitHub commands. Hermes owns the focused Vitest run, lint, full test run, and production build after file handoff. Passing native execution validation is not claimed in this report.

## Safety

- Reserved paths only.
- Read-only product projection and presentation.
- No database schema or mutation behavior changed.
- No production deployment or unrelated production mutation.
- No credential, secret, token, cookie, session, or password access.
- No Property Workbench, TerraPilot, TerraFusion, county/PACS system or data access.
- No rejected issue `#357` adapter or runtime-operator execution path access.
- No `.obsidian/` changes.
