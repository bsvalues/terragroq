# WO-MAO-018 — Reservation ledger

**Status:** COMPLETE

**Scope:** local machine contract only

**Authority effect:** none (`authorityGranted=false`)

## Result

WilliamOS now has a real cross-process reservation ledger instead of a planning-only compatibility
claim. A holder can atomically acquire one normalized set containing repository-relative paths,
contracts, environments, whole repositories, and protected resources. The complete set is committed
or none of it is. Collision is a typed pre-dispatch result.

The implementation is intentionally provider-neutral and local:

- `scripts/multi-agent-operator/reservation-ledger.mjs` owns validation, locking, durable persistence,
  acquire, release, fencing, inspection, and stable collision evidence;
- `scripts/multi-agent-operator/reservation-ledger-cli.mjs` exposes only local-file `acquire`,
  `release`, and `inspect` operations;
- `tests/multi-agent-reservation-ledger.test.ts` proves the required safety properties with direct and
  real child-process calls.

It performs no runtime activation, network request, GitHub operation, provider dispatch, credential
inspection, or authority expansion.

## Safety contract

1. Every candidate is normalized and validated by the existing
   `MULTI_AGENT_RESERVATION_SET` contract before the ledger lock is taken.
2. An atomic directory lock serializes readers that mutate the ledger across processes. Lock-holder
   attribution uses the operating system hostname rather than mutable environment variables. A bounded
   timeout fails closed. Abandoned same-host locks are recovered only after the configured stale
   interval and only when their recorded PID is no longer alive; a live holder is never broken.
3. The mutation is written to a mode-`0600` temporary file, file-synced, atomically renamed, and then
   directory-synced. An incomplete temporary write never replaces the last complete ledger.
4. Requests, reservation/path objects, and persisted ledger records use exact-field schemas: unknown
   fields fail closed. The persisted ledger is schema-checked on every operation. Invalid JSON,
   duplicate active set IDs, duplicate fencing tokens, invalid stored reservation sets, colliding
   active entries, and invalid version/fence state produce `RESERVATION_LEDGER_CORRUPT` without repair
   or overwrite.
5. Every successful new acquire increments the ledger version and receives a monotonically increasing
   fencing token. The next fence must be reachable from the mutation version; active and released
   identities cannot overlap. Optional expected-version checks provide compare-and-swap protection.
   An exact repeat from the same holder is idempotent and does not advance either value.
6. Release requires the active reservation-set ID, the exact holder token, and its fencing token. The
   holder is the assigned worker/lane, not William. Wrong holders and stale fences fail with
   `RESERVATION_RELEASE_NOT_HOLDER`. Exact repeated release is idempotent. Reacquisition receives a
   greater fence.
7. Raw holder tokens are never persisted or returned. The ledger stores only a SHA-256 digest and the
   inspection projection omits even that digest. Worker, Work Order, lane, acquisition time, and
   normalized reservation scope remain attributable.
8. A successful reservation satisfies only the reservation gate. Every result remains
   `localLedgerOnly=true` and `authorityGranted=false`; dispatch still requires all independent
   dependency, provider, lifecycle, and authority gates.

## Repository and path behavior

Paths use the canonical structured form `{ repository, path }`, with the path normalized relative to
its named repository. This permits disjoint paths in the same repository and equal path suffixes in
different repositories. An entry in the `repositories` collection is an exclusive whole-repository
reservation and conflicts with every structured path in that repository using
`REPOSITORY_PATH_COLLISION`. Legacy string paths retain the explicit implicit-repository marker; when
compared with a whole-repository claim they fail closed as `REPOSITORY_PATH_CONTEXT_UNRESOLVED` instead
of guessing a repository or throwing an I/O wall.

## Verification

Focused verification completed in the isolated WO worktree:

```text
node --check scripts/multi-agent-operator/reservation-ledger.mjs
node --check scripts/multi-agent-operator/reservation-ledger-cli.mjs
vitest run tests/multi-agent-reservation-ledger.test.ts tests/multi-agent-reservation-set.test.ts

Test Files  2 passed (2)
Tests      35 passed (35)
```

The complete multi-agent contract suite also passed: 8 files and 111 tests.

The suite includes a simultaneous two-process acquisition of ancestor-colliding paths and proves
exactly one `RESERVATION_ACQUIRED` winner and one `RESERVATION_COLLISION` loser. It also covers
all-or-none collision behavior, repository-scoped paths, whole-repository exclusion, release and
reacquire, holder and fencing enforcement, compare-and-swap, idempotence, crash-safe temporary-write
survival, stale/live lock handling, corrupt/duplicate ledger walls, typed CLI exits, and absence of raw
holder tokens from durable state.

## WO acceptance mapping

| Acceptance requirement | Evidence |
| --- | --- |
| Atomic reservations for all five resource classes | One locked acquire commits the normalized full set; focused coverage exercises every class |
| Collision before dispatch | Collision result has `dispatchReservationGateSatisfied=false`; no provider interface exists here |
| Cross-process safety | Atomic lock plus simultaneous child-process race with exactly one winner |
| Stable typed evidence | Sorted blocker IDs, reason codes, and reservation-set conflict records |
| Holder attribution and owner-only release | Worker/WO/lane persisted; exact holder-token digest and fence required for release |
| Fencing / CAS | Monotonic fencing tokens and optional expected ledger version |
| Stale, corrupt, and duplicate defense | Stale-lock liveness check; fail-closed schema/invariant validation; duplicate active IDs rejected |
| No raw secrets | Token digest only; no token in ledger, inspection, or result |
| No authority grant | Every result contains `authorityGranted=false` |

All five owner touch/contact counters for this Work Order remain zero. No owner operation or routine
decision was requested.
