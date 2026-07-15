# WO-MAO-023 Eligible-Set Scheduler and Worker Pool

**Work Order:** `WO-MAO-023`

**Status:** `COMPLETE / REQUEST_CHANGES_REMEDIATED / REAL_PHASE2_STORES_PROVEN`

**Risk:** `R3`

**Depends on:** `WO-MAO-017` through `WO-MAO-022`

## Outcome

WilliamOS now has a durable scheduler that obtains the eligible set from the Phase 2 DAG resolver and
considers every derived eligible Work Order. A caller cannot submit an `eligibleWorkOrders` list or an
`allEligibleConsidered` assertion. Dispatch claims must match the resolver's exact complete eligible
set; missing, duplicate, extra, deferred, blocked, or dependency-incomplete claims fail closed.

The scheduler invokes the real Phase 2 contracts:

- DAG eligible-set resolver;
- provider capability and response validation;
- atomic reservation ledger;
- lane lease/checkpoint store with durable fencing;
- lifecycle transition validator; and
- append-only attributed evidence ledger.

The scheduler state remains a separate durable global-capacity/CAS ledger. Its manifest and every event
are SHA-256 chained and reverified before mutation. Filesystem locking, expected-version CAS, atomic
rename, file sync, and directory sync serialize contenders and reject stale writers.

## Opaque preconfigured trust registry

Candidate artifacts and scheduler callers provide no trust path, public key, signer fingerprint,
content hash, status head, freshness policy, or root map. The only accepted trust input is the opaque
`{registryId, registryVersion}` selector. An authenticated immutable registry record outside the request
owns the bundle, signer, pins, status chain, and freshness ceiling. The production registry has a
pinned source hash, zero active records, no mutable registration API, and fails closed until a record is
preconfigured through change control; tests replace only the loader module with a private fixture.

The registry record's immutable content hash is verified before use. Its signed bundle contains status,
issue/expiry window, trust roots, authority roots, and exact worker/provider/adapter/execution-surface
bindings. Every signed status event is sequence-, prior-hash-, scope-, and head-pinned; revocation is
terminal. Bundle signature, hash, signer fingerprint, freshness, active status, status-chain head, and
binding are verified before candidate evidence.
Status timestamps must be strictly increasing, no later than the registry's trusted evaluation time,
and fresh within the registry ceiling. Trust and authority key sets are compared by normalized DER
fingerprint, so alternate PEM encodings cannot disguise reuse of the same cryptographic key.
Tampered, stale, revoked, re-signed-but-unpinned, fingerprint-substituted, or status-chain-substituted
bundles fail before a reservation, lease, evidence event, or scheduler state exists.

Every candidate then requires a preventive trust artifact signed by a bundled trust root and a distinct
exact authority grant signed by a bundled authority root. Same-root trust/authority signing is rejected.
Trust forgery, expiry, revocation, provider substitution, and worker substitution fail before side
effects.

## Exact claim identity and configuration

The signed claim binds all of:

- program, goal, loop, Work Order, and lane;
- provider, adapter, worker, role, and execution surface;
- scheduler run ID and positive attempt number;
- exact repository set, risk class, and allowed actions;
- reservation-set identity and canonical content hash, including paths, contracts, environments,
  repositories, and protected resources;
- provider dispatch ID and the complete scheduler-configuration hash; and
- the complete signed trust-artifact hash.

The complete configuration hash covers scheduler/reservation/lease/evidence store identities and paths,
the opaque trust-registry selector, lease duration, reconciliation batch ceiling, lock timeout, and every
global/provider/repository/risk/combined budget. The claim's reservation worker and Work Order must
match the claim identity. Its normalized reservation content must exactly equal the DAG-validated
envelope reservation. The envelope's team-role identity and provider selection must also match.

The upstream lease fence is not accepted from the claim. After atomic reservation acquisition, the
scheduler acquires the Phase 2 lane lease and reads the durable fence/checkpoint back from the lease
store. The ACTIVE scheduler claim stores the complete identity/configuration, scheduler fence, durable
lease fence, durable reservation fence, attempt, and claim hashes.

## Side-effect order and ceilings

The enforced order is:

```text
OPAQUE TRUST REGISTRY -> TRUST -> AUTHORITY -> DAG/SCOPE -> CAPACITY
-> ATOMIC RESERVATION -> DURABLE LEASE -> LIFECYCLE CHECKPOINT -> EVIDENCE
```

Before the first cross-store mutation the scheduler durably records a fenced transaction intent in a
separate hash-verified journal. Reservation, lease, checkpoint, evidence, release, and scheduler-state
boundaries advance that intent. Schedule failures compensate by releasing any acquired Phase 2 claim;
outcome and reaper failures resume idempotently from the durable store state. The exported bounded
recovery operation reconciles interrupted intents and cannot leave an invisible active claim or an
ACTIVE scheduler entry pointing at released Phase 2 stores.

Lease operation identities bind the Work Order, lane, full identity hash, run, attempt, and operation
phase within the store's bounded key format. A batch failure on any candidate journals and compensates
all earlier applied candidates before returning. Recovery independently re-verifies every scheduler
ACTIVE/reconciliation projection against its exact reservation, lease fence, checkpoint identity, and
evidence event; missing or divergent stores are repaired or safely compensated rather than trusted.
Expired active leases are durably expired and reclaimed with a new fence before work resumes, while
unrecoverable divergence releases remaining capacity.

Evidence lookup is performed only through the canonical Phase 2 evidence-ledger verifier. It verifies
the manifest plus every event filename, request digest, previous hash, event hash, timestamp, and
attribution before returning the selected event. The scheduler then requires exact program/goal/loop/
Work Order/lane/run, worker/role/provider/adapter/trust identity, configuration and claim hashes,
reservation content/fence, lease fence, checkpoint sequence, and checkpoint-evidence hash. A reclaim
appends a new attributed evidence event for its new durable fence and recovery selects that projection;
a second recovery is healthy and idempotent. Tampered, missing, or cross-Work-Order-substituted evidence
and missing/divergent lease, reservation, or checkpoint stores are journaled and safely compensated.

The scheduler charges active and reconciliation-held claims against global, provider, every repository,
risk, provider/repository/risk combined, and provider-declared concurrency ceilings. The focused suite
executes each ceiling against real Phase 2 reservations and proves only the first claimant acquires a
reservation/lease. Reservation collisions occur before lifecycle handoff.

## Provider outcomes and ambiguity

Provider responses pass through the common provider-response validator before any outcome mutation.
Exact provider, adapter, dispatch, Work Order, and lane attribution is required. `ACCEPTED` followed by
`RUNNING`, plus repeated `RUNNING`, is monotonic and lifecycle-idempotent while retaining capacity.
Direct terminal delivery is valid: `SUCCEEDED` follows the complete legal Phase 2 success sequence to
`DEPENDENTS_RELEASED`; `FAILED` and `CANCELLED` reach `FAILED_TERMINAL`. The terminal lifecycle is
durable before evidence, lease release, reservation release, and the final scheduler release projection.
The released-result ledger retains the exact original claim, terminal-delivery hash, and result. An
identical terminal replay under current scheduler CAS returns that result idempotently; any differing
replay fails closed.

`UNKNOWN`, transport, authentication, rate-limit, server, timeout, malformed-response, and attribution-
mismatch outcomes are delivery-ambiguous unless an independently provable no-execution contract exists.
WO-MAO-023 does not accept a caller boolean as that proof, so these outcomes always retain capacity,
reservation, and an active fenced lease. They move to `REROUTE_PENDING` and require a future deadline
plus a signed owner proof bound to the exact scheduler run, attempt, full claim hash, scheduler fence,
lease fence, and reservation fence. The proof must remain valid through the reconciliation deadline;
its exact expiry and hash become a durable owner grant so a post-deadline reaper remains live even if
wall-clock proof freshness has since elapsed. Raw or secret-shaped provider evidence is rejected.

## Exact bounded reaper

The reaper accepts no arbitrary sweep. It prevalidates the complete batch before the first mutation.
Every requested entry must provide:

- the exact reconciliation identity, scheduler run, attempt, full claim hash, scheduler fence, and
  lease fence and reservation fence;
- the original signed reconciliation-owner proof whose hash was recorded at ambiguity time;
- a reached per-entry deadline;
- a current scheduler-state CAS version; and
- a nonempty batch within both the request maximum and configured batch ceiling.

Only then does the reaper checkpoint the real Phase 2 lane to its terminal state, append evidence,
release the real lease and reservation, update the final scheduler state, and recover capacity. Wrong
owner, proof, claim, attempt, either store fence, proof-expiry/deadline relation, batch, or CAS fails
without release.
The batch has one durable transaction intent; a later release failure resumes all remaining entries and
commits the scheduler projection only after the complete batch reaches a consistent terminal result.

## Mechanical proof

The 60-test scheduler integration/adversarial suite covers registry/bundle forgery/freshness/revocation/
substitution, candidate trust forgery/staleness/revocation/substitution, complete identity/configuration/
reservation mutations, exact DAG-derived selection, all capacity ceilings, real reservation/lease/
checkpoint/evidence stores, every provider state and delivery-error class, malformed responses,
attribution mismatch, ambiguity retention, proof-bound bounded reaping, every cross-store injected
failure boundary, deterministic journal recovery, reservation-fence substitution, post-expiry reaper
liveness, two-Work-Order idempotency isolation, candidate-two rollback, all-before-any reaper validation,
later-release recovery, missing-store compensation, expired-lease reclaim, terminal replay, final store
consistency, canonical evidence-chain tampering, missing/substituted evidence, checkpoint/config/fence
substitution, idempotent reclaim projection, and production CLI fail-closed behavior.

Validation:

- focused Vitest: `2 files / 79 tests`, PASS;
- repository-wide Vitest: `162 files / 1,046 tests`, PASS;
- repository ESLint and production build: PASS;
- Node syntax and `git diff --check`: PASS.

No provider network request, credential inspection, runtime activation, GitHub write, production write,
or owner operation occurred.

## Owner-operation evidence

```text
OWNER_OPERATION_TOUCH_COUNT=0
OWNER_CREDENTIAL_TOUCH_COUNT=0
OWNER_DIAGNOSTIC_TOUCH_COUNT=0
OWNER_ROUTINE_DECISION_COUNT=0
OWNER_ROUTINE_CONTACT_COUNT=0
```
