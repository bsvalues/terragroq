# WO-MAO-027 Concurrency Budgets, Priority, and Fairness

**Work Order:** `WO-MAO-027`

**Status:** `COMPLETE / DURABLE_SCHEDULER_ENFORCEMENT_PROVEN`

**Risk:** `R3`

**Depends on:** `WO-MAO-023` through `WO-MAO-026`

## Outcome

The durable eligible-set scheduler now enforces concurrency ordering and fairness inside the same
trust, authority, DAG, reservation, lease, lifecycle, evidence, and CAS boundary that owns admission.
No caller-authored active-state or queue-age projection is accepted.

The existing hard global, provider, repository, risk, combined, and provider-capability ceilings remain
authoritative. WO-MAO-027 adds trust-signed scheduling policy and per-lane claims, scheduler-derived
aging, durable starvation state, bounded security precedence, validated rate-limit backpressure, and
security drain requests that do not release capacity.

## Signed scheduling contract

Every schedule call must include exactly one fresh `MULTI_AGENT_SCHEDULING_POLICY_V1` and exactly one
fresh `MULTI_AGENT_SCHEDULING_CLAIM_V1` for every member of the DAG-derived eligible set. Both are
signed by a key pinned in the scheduler trust bundle.

The policy binds its identity, issuer, issue/expiry window, exact scheduler budgets, aging interval and
cap, starvation threshold, security burst ceiling, and rate-limit cooldown. The duplicate policy
budgets must exactly equal the scheduler budgets already bound into every signed authority claim.

Each scheduling claim binds the policy hash and exact program, goal, loop, Work Order, and lane. It
declares only `LOW`, `NORMAL`, `HIGH`, or `CRITICAL` priority plus trusted security and preemptibility
classifications. A security-critical claim must be nonpreemptible. Missing, duplicate, expired,
cross-lane, policy-divergent, malformed, or forged policy/claim records fail before scheduler lock or
Phase 2 store mutation.

Priority never creates or expands authority. Trust, exact signed Work Order authority, DAG eligibility,
provider capability, repository/risk/action scope, capacity, reservation compatibility, atomic
reservation, fenced lease, lifecycle, and evidence gates remain mandatory.

## Durable fairness

The scheduler state schema is now version `2`; it fails closed on legacy or partially populated state
instead of inventing queue age or backpressure history. The runtime is disabled and has no authorized
live scheduler state requiring migration.

The scheduler records the first eligible instant for capacity-, backpressure-, or collision-blocked
work in its hash-verified state. Repeated delivery cannot reset age or silently change the lane's
priority/security/preemptibility classification. A fresh trust-signed policy may rotate while
preserving that classification and first-eligible instant; the rebind is recorded in the state chain.
Ordering is deterministic:

1. bounded security precedence;
2. starvation-protected work;
3. signed base priority plus capped scheduler-derived age;
4. first eligible time; and
5. Work Order/lane identity.

The scheduler persists a consecutive-security admission counter. Once the signed policy burst ceiling
is reached, starved ordinary work receives the next compatible slot. Aging cannot bypass any upstream
eligibility, authority, capability, reservation, risk, or capacity wall.

## Backpressure and preemption

Only a `RATE_LIMIT` outcome carrying a fresh pinned-trust signature over an HTTP 429 observation can
create backpressure. That observation is exactly bound to the active provider, adapter, dispatch,
Work Order, lane, and reason; a missing, stale, substituted, or forged observation fails closed. The
cooldown comes from the signed scheduling policy. The resulting
`blockedUntil` record is stored in the scheduler hash chain. New work for that provider is deferred,
while unrelated providers remain eligible and the ambiguous rate-limited lane keeps its reservation,
lease, reconciliation fence, and consumed capacity.

Security-critical work that cannot fit may receive a deterministic `SECURITY_DRAIN_REQUIRED` result.
Victims must be active, non-security, and explicitly preemptible under their trust-signed scheduling
claims. Reconciliation-held work is never a victim and continues to consume capacity. Victims are
ordered by lowest priority, newest start, then stable identity.

A drain result performs no cancellation and does not remove projected or durable capacity. The
security lane remains pending until the normal terminal checkpoint, evidence, lease release,
reservation release, and scheduler-state transition make capacity genuinely available.

## Runtime and host boundary

This Work Order changes scheduler contracts and tests only. It does not activate a runtime, dispatch a
provider, execute a drain, grant authority, invoke GitHub, mutate production, handle credentials, or
contact the owner. The rejected issue #357 adapter remains terminal and was not retried, wrapped,
renamed, or reused.

The existing heartbeat worker now starts with an empty `execArgv` so test-runner or stdin-only parent
flags cannot invalidate the file worker entrypoint. The lock ownership, fencing, heartbeat, expiry,
quarantine, and durable-store rules are unchanged.

## Validation evidence

- complete scheduler suite, including trust forgery, every existing ceiling, real Phase 2 stores,
  recovery, replay, signed priority, durable starvation, bounded security drain, and pinned-signed 429
  backpressure;
- capability, registry, portfolio, and projection tests;
- targeted lint, full suite, build, diff, and secret scan before publication;
- independent assurance before commit and normal PR checks before merge.

## Next transition

`WO-MAO-001` through `WO-MAO-027`, `WO-MAO-029`, and `WO-MAO-032` are complete.
`WO-MAO-033` remains `DEFERRED / PROVIDER_UNAVAILABLE` and resumable. The only newly
dependency-cleared Work Order is `WO-MAO-028 - Scheduler simulation and model checking`.

## Owner-operation evidence

```text
OWNER_OPERATION_TOUCH_COUNT=0
OWNER_CREDENTIAL_TOUCH_COUNT=0
OWNER_DIAGNOSTIC_TOUCH_COUNT=0
OWNER_ROUTINE_DECISION_COUNT=0
OWNER_ROUTINE_CONTACT_COUNT=0
```
