# WO-MAO-028 Scheduler Simulation and Model Checking

**Work Order:** `WO-MAO-028`

**Status:** `COMPLETE / PURE_STATIC_BOUNDED_MODEL_CHECK_PROVEN`

**Risk:** `R3`

**Depends on:** `WO-MAO-017` through `WO-MAO-027`

## Outcome

WO-MAO-028 adds a deterministic, repository-local scheduler model-check harness and focused tests.
The harness models work-order dependencies, reservation compatibility, bounded concurrency, priority,
starvation aging, expiry, cancellation, idempotent event delivery, deadlock classification, and replay.
Its bounded breadth-first explorer generates legal transitions, deduplicates canonical semantic state
hashes, and enforces explicit depth, state-count, and model-time ceilings.

The model covers the acceptance cases named by the canonical playbook: DAG fan-in, cycle rejection,
reservation collision, duplicate delivery, expiry, starvation, deadlock, cancellation, and byte-stable
replay. It records invariant violations and deterministic terminal state without invoking any provider,
runtime, worker registry, GitHub surface, production system, credential path, or owner operation.

Incomplete exploration is not proof. A depth frontier, state ceiling, or truncated search returns
`MODEL_EXPLORATION_INCONCLUSIVE` with `coverageComplete=false`; zero-transition bounded input cannot
return pass. Delayed identical delivery is deduplicated before event-time ordering, conflicting
cancellation/completion terminal outcomes fail without changing terminal state, and malformed
reservation input produces a typed rejection rather than an unhandled exception.

## Static boundary

The model is deliberately pure and effect-free. A simulated `SCHEDULE` transition changes only the
in-memory model state. The report explicitly records `runtimeActivated=false` and
`dispatchPerformed=false`; those fields are assertions about the harness boundary, not claims about a
live provider or durable WilliamOS runtime.

This evidence proves the bounded model-check claim only. It does not prove provider execution, adapter
conformance, runtime activation, automated GitHub delivery, durable unattended scheduling, or final
multi-agent certification. The local nested Codex adapter from issue #357 remains rejected, terminal,
disabled, and unretried.

## Evidence

- `scripts/multi-agent-operator/scheduler-model-check.mjs`
- `tests/scheduler-model-check.test.ts`
- `components/operator/multi-agent-capability-registry.ts`
- `components/operator/multi-agent-operator-registry.ts`
- 20 focused model-check assertions plus capability, registry, portfolio, and surface assertions

## Next transition

`WO-MAO-001` through `WO-MAO-029` and `WO-MAO-032` are complete. `WO-MAO-033` remains
`DEFERRED / PROVIDER_UNAVAILABLE` and resumable. The only newly dependency-cleared Work Order is
`WO-MAO-030 - Hosted Codex coordinator adapter`; later nodes remain pending on their declared
dependencies.

## Owner-operation evidence

```text
OWNER_OPERATION_TOUCH_COUNT=0
OWNER_CREDENTIAL_TOUCH_COUNT=0
OWNER_DIAGNOSTIC_TOUCH_COUNT=0
OWNER_ROUTINE_DECISION_COUNT=0
OWNER_ROUTINE_CONTACT_COUNT=0
```
