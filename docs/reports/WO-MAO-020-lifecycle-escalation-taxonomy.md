# WO-MAO-020 Canonical Lifecycle and Escalation Taxonomy

**Work Order:** `WO-MAO-020`

**Status:** `COMPLETE`

**Risk:** `R3`

**Depends on:** `WO-MAO-016` through `WO-MAO-019`

## Outcome

WilliamOS now has a deterministic, pure canonical state machine and failure classifier in
`scripts/multi-agent-operator/lifecycle-state-machine.mjs`. It uses the playbook's sixteen success
states and fourteen typed non-success states. Stable reason codes remain separate from lifecycle
state names.

The clean success path is explicit from `PLANNED` through `DEPENDENTS_RELEASED`, with
`INDEPENDENT_REVIEW -> MERGE_ELIGIBLE`. Review may instead enter `REMEDIATING`, but remediation must
return through `VALIDATING` or `INDEPENDENT_REVIEW`; it can never transition directly to merge
eligibility. Illegal jumps and self-transitions fail closed. Terminal states have no outgoing
transitions and every attempted transition from one raises
`LIFECYCLE_TERMINAL_IMMUTABILITY_WALL`.

## Typed failure behavior

The classifier consumes explicit bounded attempt/reroute counters, compatible providers,
portfolio-healthy providers, and an authority-gap record. It produces one deterministic resolution:

- transient transport, rate-limit, and provider-server failures receive bounded retry, then bounded
  compatible-provider reroute, then affected-lane defer or block;
- authentication failures receive no same-provider retry and never request credential repair;
- provider-unavailable work reroutes only to a compatible provider or defers/blocks only that lane;
- unrelated healthy portfolio providers remain explicitly eligible;
- worker/coordinator death uses bounded retry/reroute/defer behavior;
- validation and review findings return to the original builder within budget, then become typed
  validation/review terminal states;
- flaky CI and stale-base recovery terminate after their bounded retry is exhausted;
- dependency and reservation failures block in their own states before unsafe work;
- policy change blocks without bypass, duplicate delivery becomes an idempotent no-op, and security
  boundary failure becomes `FAILED_SECURITY_TERMINAL`.

`rerouteProviderIds` contains compatible providers only. `portfolioHealthyProviderIds` separately
preserves unrelated healthy lanes, preventing an unavailable provider from serializing the portfolio.

## Owner-decision wall

Transport, network, authentication, rate-limit, provider, GitHub/CI-class, worker, and coordinator
failures all emit `ownerDecisionRequired=false` and `ownerContactAllowed=false`.

`OWNER_DECISION_REQUIRED` is possible only for failure class `OWNER_AUTHORITY_GAP` with a complete,
non-null authority-gap record naming one of the constitution's genuine conditions and an attributable
condition reference. A non-authority failure carrying an authority-gap payload is rejected as a
contradiction. The transition API independently enforces the same evidence requirement, so a caller
cannot relabel `CODEX_NETWORK_WALL` or `PROVIDER_UNAVAILABLE` as an owner decision.

## Adversarial proof

`tests/multi-agent-lifecycle-state-machine.test.ts` covers:

- the complete canonical vocabulary, clean success sequence, and remediation/re-review loop;
- illegal jumps, self-transitions, and terminal immutability;
- transport/network/authentication/rate-limit/provider failures never becoming owner decisions;
- retry and reroute exhaustion;
- authentication quarantine without same-provider retry;
- provider-unavailable lane deferral while healthy portfolio providers continue;
- dependency, reservation, policy, duplicate, security, validation, and review classifications;
- complete genuine authority evidence, incomplete evidence, and spoofed operational authority gaps;
- exceeded budgets and contradictory fields;
- deterministic CLI success and typed failure.

## Boundary retained

The classifier and CLI are local decision contracts. They schedule no retry, dispatch no provider,
claim no reservation or lease, persist no checkpoint, and create no authority. Those side effects
remain the responsibility of later guarded scheduler and ledger Work Orders.

## Owner-operation evidence

```text
OWNER_OPERATION_TOUCH_COUNT=0
OWNER_CREDENTIAL_TOUCH_COUNT=0
OWNER_DIAGNOSTIC_TOUCH_COUNT=0
OWNER_ROUTINE_DECISION_COUNT=0
OWNER_ROUTINE_CONTACT_COUNT=0
```
