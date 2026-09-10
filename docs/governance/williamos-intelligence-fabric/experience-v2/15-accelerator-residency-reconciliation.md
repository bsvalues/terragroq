# 15 — Accelerator Reservation / Model Residency Reconciliation

## Finding

IF-08 is not wholly greenfield.

Current WilliamOS already contains a durable reservation subsystem with properties directly relevant to accelerator ownership:

- normalized reservation sets;
- atomic compatibility checks;
- a first-class `protectedResources` reservation collection;
- `PROTECTED_RESOURCE_COLLISION` semantics;
- a durable reservation ledger;
- holder-token digests;
- monotonically allocated fencing tokens;
- corruption detection;
- durable temp-write/fsync/rename behavior;
- process-aware stale-lock recovery;
- explicit acquire/release records;
- no authority minted by reservation state.

These mechanisms live under the multi-agent operator reservation system and are used to prevent concurrent workers from claiming colliding repository/contracts/environments/protected resources.

Execution Fabric and the governed embedding evaluator also contain narrower exclusive runtime leases/fencing patterns.

## Architecture consequence

Do not build an independent GPU lock/lease system.

The existing generic reservation substrate should be evaluated as the ownership/fencing foundation for accelerator reservations, while IF-08 adds the quantitative and lifecycle semantics that do not exist today.

Likely layering:

```text
existing reservation identity + collision + fencing ledger
        |
        +-- protected resource: accelerator/<node>/<device-id>
        |
        v
IF-08 accelerator capacity extension
  total VRAM
  reserved weights
  reserved KV/cache
  runtime overhead
  headroom policy
  fractional/share policy when proven safe
        |
        v
IF-08 model residency manager
  ABSENT -> LOADING -> WARM -> ACTIVE -> IDLE -> EVICTING -> ABSENT
                         |       |
                         +-- bounded preemption / priority
```

## What is already reusable

### Reservation identity

`reservation-set.mjs` already treats `protectedResources` as a collision domain. An accelerator can therefore be represented as a protected resource without adding a new reservation authority model.

Exact naming must be canonical and broker-derived, not caller-invented. Example shape only:

`accelerator/hermes-node/<canonical-device-id>`

The actual identifier must come from admitted compute inventory.

### Atomic ownership/fencing

`reservation-ledger.mjs` already provides durable atomic acquisition, unique fencing tokens, holder-token binding, release records, corruption walls and lock recovery. IF-08 should reuse or narrowly generalize these primitives rather than introduce another JSON lease ledger.

### Existing execution leases

Execution Fabric bounded dispatch and embedding bakeoff contain process/runtime-specific exclusive leases. These remain specialist execution guards. IF-08 must decide whether they become consumers of the common accelerator reservation or remain nested narrower leases; it must not silently replace them.

## What is genuinely missing unless current-main/live evidence proves otherwise

The current reservation set is boolean/exclusive: two work items either collide on the same protected resource or they do not. It does not establish:

- quantitative VRAM reservation;
- model weight memory accounting;
- KV/cache memory accounting;
- runtime/framework overhead accounting;
- context-dependent memory prediction;
- multi-model residency inventory;
- warm/idle/evict lifecycle;
- load/unload cost measurement;
- priority/preemption semantics;
- safe fractional accelerator sharing;
- reconstruction of loaded-model truth after runtime/host restart;
- NUMA/PCIe-aware accelerator choice.

Those are the legitimate IF-08 additions.

## Safety rule: reservation is not capacity evidence

Owning `accelerator/hermes-node/gpu0` does not prove a requested model fits.

Admission must require both:

1. a valid exclusive/shared reservation contract; and
2. fresh capacity evidence proving the model/runtime/configuration fits inside governed memory/headroom limits.

A stale capacity observation cannot be rescued by a valid reservation.

## Quantitative extension rule

Do not overload `protectedResources` strings with unverifiable capacity claims such as `gpu0:12GB`.

Keep resource identity/fencing separate from quantitative capacity records. If fractional reservations are introduced, they require a versioned typed contract with deterministic sum/accounting and must not weaken existing exclusive-collision behavior.

V1 should prefer exclusive accelerator reservation unless measured concurrency demonstrates that sharing is safe and materially valuable.

## Residency doctrine

Residency state is an optimization, not canonical work/context state.

- Evicting a model may cost load latency but may not lose a Thread or Work Order.
- A process crash must invalidate uncertain residency rather than assume a model is still loaded.
- Runtime-reported loaded-model state is observation, not authority.
- Model load/pull/download are different actions: residency management may load an already admitted artifact; it may not download a new artifact without separate admission/policy.
- Preemption cannot kill non-preemptible active work silently.

## Priority intent

Initial priority should distinguish at least:

1. interactive owner-facing inference;
2. active governed delivery work;
3. evaluation/benchmark;
4. background indexing/batch.

Policy should preserve enough headroom that HERMES supervision does not deadlock itself by filling the accelerator with low-priority work.

## Required IF-08 reconciliation

Before implementation classify:

- multi-agent `reservation-set.mjs`;
- multi-agent `reservation-ledger.mjs`;
- Execution Fabric bounded-dispatch leases;
- embedding-bakeoff lease/fence ledger;
- current Ollama loaded-model observation/control surfaces;
- any Docker/runtime concurrency guards;
- any newer accelerator reservation owner on current main/open PRs.

Each must be classified `REUSE_AS_IS`, `EXTEND_EXISTING`, `ADAPT_AT_BOUNDARY`, `SPECIALIST_ONLY`, `SUPERSEDED_BY_CURRENT_MAIN`, or `GENUINELY_MISSING`.

## Acceptance

`IF_ACCELERATOR_RESIDENCY_PREDECESSORS_RECONCILED: PASS` only when:

- no second lock/fence authority is introduced;
- canonical accelerator identity comes from admitted compute inventory;
- current protected-resource reservation semantics remain valid;
- quantitative capacity is distinct from resource ownership;
- exclusive V1 behavior fails closed;
- residency state cannot become canonical Thread/work state;
- model load is separated from model download/admission;
- crash/restart invalidates or reconstructs residency safely;
- existing specialist leases are explicitly preserved, adapted or superseded with proof.

Failure state: `FAILED_ACCELERATOR_RESERVATION_PREDECESSORS_NOT_RECONCILED`.
