# WilliamOS Experience V2 — Gate 1b Live Settlement 001

Status: `SETTLED_WITH_DEFECTS`

Continuation settled: `CONT-EXPV2-P0-RUNTIME-PROOF` (also carried as `CONT-EXPV2-GATE1B-SETTLEMENT`)

Program: `WILLIAMOS_EXPERIENCE_V2`, Gate 1b · Parent `#987` · Gate 1a `#993` · Gate 1 packet `#990`

Settled from: merged `main` `053a33bdb3bb1db57db6d85fff96163b68f11b22`

`OWNER_COURIER_ACTIONS = 0`. The owner was not asked to power on, report on, declare, or confirm
anything. The card was found, not announced.

## Result in one paragraph

HERMES came back with a **NVIDIA Tesla P40** installed. WilliamOS discovered it: the canonical
`probe-windows.ps1`, invoked through `brokeredExec` and byte-identical to merged `main`, returned a
structured accelerator record carrying UUID `GPU-4f7d4396-9304-d12f-7e9b-7f04d1236fc2`, PCI bus id
`00000000:02:00.0`, a measured 24 159 191 040-byte total VRAM and a measured 9 437 184-byte used
VRAM. The assembler promoted the node on an exact machine-identity match against the reviewed pin,
and the System Object projection rendered the card as `truthState: live`, `capability: "UNKNOWN"`,
under the brand-new `canonicalKey`
`accelerator:uuid:GPU-4f7d4396-9304-d12f-7e9b-7f04d1236fc2`. It inherited nothing from the RTX 3050
or the Quadro K2200, because the declared records it replaced never had a key to inherit. **Every
hop in the continuation's expected sequence passed on live hardware.** The defect this settlement
records sits one step beyond that sequence: nothing in the merged tree *compares* the new inventory
against the previous one, and nothing records "New accelerator discovered on HERMES." The system can
now see the P40. It still cannot say that it is new.

## Discipline this settlement held to

- **Discovery, not declaration.** No registry, seed, inventory, pin or canonical record was edited by
  hand. Nothing in this lane's tooling names a P40, a VRAM figure, or a UUID — grep it. The
  hardware facts in this report were read out of the probe's output after the fact.
- **No raw transport as evidence.** Both probes went through `brokeredExec`, and both appear in the
  lab's single audit ledger with `rc=0`. SSH was used only to carry files and to start `node` on
  HERMES; it produced no hardware fact in this report. The ledger is the proof of that, and it is
  retained: `GATE1B-broker-audit-excerpt.txt`.
- **Canonical bytes, verified.** All ten canonical files were digest-matched on both ends against
  `053a33bd` before anything ran, and the assembler's own
  `FABRIC_REGISTRY_ENTRYPOINT_WALL` re-checked the seed, schema and identity contract independently.
  See `GATE1B-canonical-file-digests.txt`.

## Per-hop results

| # | Hop | Result | Evidence |
| --- | --- | --- | --- |
| 1 | HERMES reachable at broker level | **PASS** | `brokeredExec("hermes", …)` resolved through `~/.williamos/fabric/nodes.json`, `transport: "local"`, and returned `rc=0`. Ledger 19628 → 19629 lines, the single new line being `hermes probe rc=0`. |
| 2 | Fresh canonical probe, brokered | **PASS** | `scripts/execution-fabric/probe-windows.ps1` (`fe07b7b7…`), `-NodeId hermes-node`, 13 246 ms, 21 021 bytes of structured stdout, `stderr: null`. `GATE1B-brokered-invocation.json`. |
| 3 | Observed hardware inventory | **PASS** | Per-device records for 1 CPU, 4 DIMMs (32 GiB), 2 GPUs, 3 disks (all SMART `Healthy`, all with serials), 8 NICs, 3 runtimes. `warnings: []`. `GATE1B-hermes-node-probe.json`. |
| 4 | P40 identity reconciliation | **PASS** | New `canonicalKey` `accelerator:uuid:GPU-4f7d4396-9304-d12f-7e9b-7f04d1236fc2`. `anyObservedKeyEqualsADeclaredKey: false`. `GATE1B-reconciliation.json`. |
| 5 | `P40 EXISTS = OBSERVED` | **PASS** | `evidence.confidence: "observed"`, `probe_version: "0.1"`, `observed_at: 2026-08-25T01:04:33.7176799Z`. Node promoted: *"observed machine identity matched the reviewed inventory pin."* |
| 6 | Health measurement | **PASS** | P40: 29 °C, 0 % utilization, driver `560.94`, total/used/headroom all `state: "measured"`, `source: "nvidia-smi"`. `GATE1B-health-summary.json`. |
| 7 | `P40 HEALTHY = measured` | **PASS** | Measured, not assumed. `truthState: "live"` — which under the shipped rule requires `confidence === "observed"` **and** freshness. |
| 8 | `capability = UNKNOWN`, no path raised it | **PASS** | Two independent walls, below. |
| 9 | *(collision map S7.6)* record the change | **FAIL — no implementation** | Typed as `CONT-EXPV2-HARDWARE-CHANGE-UNRECORDED`, below. |

Hops 1–8 are the sequence the continuation names. Hop 9 is the additional step the Phase 0 collision
map's S7.6 acceptance sequence requires, and it is where this settlement stops being a pass.

## The P40, as the system now holds it

Read straight out of `GATE1B-projection-live.json`. Nothing here was typed by this lane:

```json
{
  "kind": "ACCELERATOR",
  "objectId": "accelerator:uuid:GPU-4f7d4396-9304-d12f-7e9b-7f04d1236fc2",
  "canonicalKey": "accelerator:uuid:GPU-4f7d4396-9304-d12f-7e9b-7f04d1236fc2",
  "nodeId": "hermes-node",
  "identity": { "resolved": true, "kind": "uuid", "value": "GPU-4f7d4396-9304-d12f-7e9b-7f04d1236fc2" },
  "vendor": "NVIDIA",
  "model": "Tesla P40",
  "truthState": "live",
  "memory": {
    "total":    { "state": "measured", "bytes": 24159191040, "source": "nvidia-smi" },
    "used":     { "state": "measured", "bytes": 9437184,     "source": "nvidia-smi" },
    "headroom": { "state": "measured", "bytes": 24149753856, "source": "nvidia-smi" }
  },
  "capability": "UNKNOWN",
  "annotations": []
}
```

`annotations` is empty, and that is a result rather than an omission: `IDENTITY_UNRESOLVED` is absent
because the card arrived with a real UUID, and `VRAM_LOWER_BOUND_ONLY` is absent because
`nvidia-smi` measured its VRAM rather than `Win32_VideoController` estimating it. The OMEN
accelerator in the same projection, from the same code in the same run, carries
`["IDENTITY_UNRESOLVED"]` and reports all three memory figures as `unknown` — so the empty list is
the projection distinguishing measurement from declaration, not failing to annotate.

### Identity did not leak across the swap

| Side | Model | uuid | pci_bus_id | canonicalKey |
| --- | --- | --- | --- | --- |
| declared (seed) | GeForce RTX 3050 | `null` | `null` | `null` |
| declared (seed) | Quadro K2200 | `null` | `null` | `null` |
| observed | NVIDIA GeForce RTX 3050 | `GPU-6d9ae165-…` | `00000000:01:00.0` | `accelerator:uuid:GPU-6d9ae165-7272-a38c-06b1-7276869e980f` |
| observed | Tesla P40 | `GPU-4f7d4396-…` | `00000000:02:00.0` | `accelerator:uuid:GPU-4f7d4396-9304-d12f-7e9b-7f04d1236fc2` |

Both observed cards are **new identities**; the declared side contributes no key at all. Gate 1a
predicted exactly this and the prediction held under live conditions. Note the second-order
consequence, which is the honest reading: the RTX 3050 is also a new object. It was in the machine
before and it is in the machine now, but the system has no continuous record of it, because a
declared record with `uuid: null` was never an identity to continue from. Identity for HERMES's
accelerators begins at this probe.

### `capability` could not have been raised

Two walls, checked separately:

1. **In the projection, by type.** `AcceleratorObject.capability` is declared `capability: "UNKNOWN"`
   — a literal type, not a string field (`lib/system/system-object.ts:104`). The only assignment in
   the file is the matching literal at `:342`. No other value type-checks, so "no path raised it" is
   enforced by the compiler rather than by inspection.
2. **In the assembler, by scope.** `hermes-node` kept the seed's
   `capability_health.compute = { state: "UNKNOWN", reason: "LIVE_CAPABILITY_EVIDENCE_REQUIRED" }`
   through a fully observed, fresh, docker-running probe. The `READY`/`DEGRADED` classifier exists,
   but `assemble-registry-core.mjs:655` applies it only to `aegis`. A fresh probe and a running
   Docker daemon on HERMES therefore raised nothing.

`capabilities: ["local-llm-inference", "gpu-batch", "agent-runtime", "cuda", "ssh-control"]` also
appears on the node in the snapshot. That is the seed's **declared authority envelope**, carried
through unchanged; it is not a measurement and must not be read as one. Bench evidence remains the
only thing that can raise capability, and this settlement produced none.

## The two shipped invariants, under live conditions

**`live` requires observed *and* fresh.** Re-projected the identical observed bytes with the clock
advanced 301 s against the snapshot's 300 s ttl, changing nothing else:

| | `truthState` | `reason` | `promotion.promoted` |
| --- | --- | --- | --- |
| live mode (`+1 s`) | `live` | `null` | `true` |
| stale mode (`+301 s`) | `stale` | `evidence age 301s exceeds ttl 300s` | `true` |

Both accelerators degrade with the node. Promotion stays `true` in both — the machine is still the
machine the pin names — which is the separation the design intends: *who this is* and *how recently
we looked* are different questions, and only the second one aged out. `GATE1B-projection-stale.json`.

**A client can enumerate accelerators without parsing presentation strings.** Both halves of this
were run live, through the broker, three and a half minutes apart:

- The canonical path returns `graph.objects.filter(o => o.kind === "ACCELERATOR")` — typed records
  with numeric `bytes`, a `source`, a resolved `identity`, and a `canonicalKey`.
- `GET /api/fabric/nodes`'s own `WINDOWS_PROBE` — reproduced verbatim and verified by digest against
  `route.ts` — returned its accelerators as the single field
  `"gpu": "NVIDIA Tesla P40;NVIDIA GeForce RTX 3050"`.

A consumer of that string can recover two model names by splitting on `;` and nothing else: no UUID,
no VRAM, no used memory, no temperature, and no way to tell which card is which across a reboot. The
structured path is not a nicer rendering of the same information; it is the only path that carries
the information at all. `GATE1B-route-nodes-probe.json`.

That run also stands as the live check on invariant 12: the `GET /api/fabric/nodes` probe body
reached HERMES through `brokeredExec` and was written to the ledger, on a node whose transport is
`local` — the case the route's own comment says used to bypass the broker entirely.

## Where this retype is recorded, and where it is not

`CONT-EXPV2-P0-RUNTIME-PROOF` is durably tracked in two places, and this settlement reaches only one
of them.

**Reached.** This report is the settlement record. The continuation is discharged here as
`settled-with-defects`, with the per-hop evidence, the retained artifacts and the successor defect
all in one document. Pointer comments carry it to `#990`, `#993` and parent `#987`.

**Not reached — deliberately.** The typed block in
`docs/governance/williamos-experience-v2-phase0-collision-map.md` §9 still reads
`type: BLOCKED_DEPENDENCY`, `reason: WAITING_EXTERNAL_ENVIRONMENT`, `condition: HERMES_REACHABLE`.
That file is the sole file of **open PR `#994`**, which is a live builder reservation. Editing it
from this lane would claim another builder's reservation — a forbidden action, and one that stays
forbidden while `#994` is blocked on `AUTHORITY_REVIEW_THREADS_OPEN`, because a blocked reservation
is still a reservation. `#994`'s single hunk sits at map lines 1607–1681 and does not textually
overlap the block at ~1425–1452, so this is a reservation boundary rather than a merge conflict —
which is exactly why it must be honoured rather than reasoned around.

```
CONT-EXPV2-GATE1B-MAP-RETYPE
  type:      BLOCKED_DEPENDENCY
  reason:    FILE_RESERVED_BY_OPEN_PR
  reserved:  docs/governance/williamos-experience-v2-phase0-collision-map.md -- PR #994
  blocks:    nothing. The settlement itself is complete and recorded here.
  action:    retype the S9 CONT-EXPV2-P0-RUNTIME-PROOF block from
             BLOCKED_DEPENDENCY / WAITING_EXTERNAL_ENVIRONMENT to
             SETTLED_WITH_DEFECTS, pointing at this report, and open
             CONT-EXPV2-HARDWARE-CHANGE-UNRECORDED as its successor.
  pickup:    the lane holding the #994 reservation, folded into that PR; or any lane once #994
             lands or is closed. Not an owner task.
```

Until that edit lands, the map's §9 entry is **stale, not wrong about the world** — it describes a
condition that has since been met. A reader who follows its `pickup:` line arrives at this report,
which is the outcome that line was written to produce.

## Defects and observations, typed

### `CONT-EXPV2-HARDWARE-CHANGE-UNRECORDED` — REAL DEFECT

```
type:                  TYPED_DEFECT
failing hop:           9 -- collision map S7.6 step 5-6
affected phase:        Experience V2 Gate 1b (settlement), S7.6 acceptance sequence
blocksGate1b-settlement: NO  (hops 1-8, the continuation's stated sequence, all passed)
blocks:                the S7.6 claim "WilliamOS records 'New accelerator discovered on HERMES'"
mustResolveBefore:     any surface or gate that claims to NOTIFY about hardware change
```

The S7.6 sequence reads `… -> compared against previous hardware truth in the snapshot -> WilliamOS
records "New accelerator discovered on HERMES" -> capability remains UNKNOWN`. The comparison step
has no implementation on `main`. Searching `lib/`, `scripts/execution-fabric/`, `app/` and `tests/`
for a snapshot-diff, a prior-snapshot read, or a discovery event returns nothing. Two consequences
were observed directly in this run, not inferred:

1. **The P40's arrival produced no event.** It is present in the projection and absent from the
   previous one, and nothing anywhere states the difference. Only a human or an agent holding both
   documents can see that a card appeared. The owner did not have to say "I installed a P40" — that
   half of the requirement holds — but WilliamOS did not say it either.
2. **The Quadro K2200 disappeared silently.** It is declared in `registry.seed.json` and is not in
   the observed inventory. `assemble-registry-core.mjs` replaces observed hardware wholesale, so the
   card simply stops existing in the snapshot with no annotation, no warning and no record that
   anything was removed. A device vanishing is at least as consequential as one appearing, and it is
   currently the quieter of the two.

There is also nowhere for such a comparison to read from: `assemble-registry.mjs --out` overwrites a
single snapshot file, and no prior version is retained. Change detection needs a durable previous
truth before it needs a differ, and the settlement records that ordering so a later lane does not
build the second half onto nothing.

Not fixed here. This report is docs-and-evidence only, and the fix is a design question about where
hardware history lives — a gate owns that, not a settlement.

### `CONT-EXPV2-HERMES-OLLAMA-NOT-OBSERVED` — OBSERVATION, unrelated subsystem

```
type:                  TYPED_OBSERVATION
blocksGate1b-settlement: NO
blocks:                nothing
```

`registry.seed.json` declares HERMES running `ollama`, `state: "healthy"`, at
`http://127.0.0.1:11434`. The canonical probe queries `/api/tags` on that endpoint with a 2-second
timeout (`probe-windows.ps1:275-276`) and did not observe it; the assembled snapshot's runtimes are
`docker` (29.7.2, running), `wsl` (running) and `ssh` (running), with no `ollama` row.

The honest claim is *not observed by the canonical probe at 2026-08-25T01:04:33Z* — not "Ollama is
down". Recording it because the system did the right thing here: observation replaced declaration
and the stale "healthy" claim vanished on contact with evidence. Whether Ollama should be serving on
HERMES is an operational question for the lane that owns local inference. Typed, not fixed:
diagnosing an unrelated subsystem is exactly the scope creep the terminal protocol forbids.

### `CONT-EXPV2-BASELINE-RAW-TRANSPORT` — carried forward unchanged

Still open, still `mustResolveBefore: Gate 2`, and untouched by this settlement.
`lib/fabric/run-baseline.mjs` calls `exec("powershell", …)` / `exec("ssh", …)` outside `brokeredExec`.
This settlement exercised the `GET /api/fabric/nodes` path, which is the narrow form invariant 12
covers; it says nothing about baseline, and no claim here should be read as clearing it.

## What Gate 2 may now claim

**May claim:**

- Gate 1b is settled on live hardware. `CONT-EXPV2-P0-RUNTIME-PROOF` is discharged as
  `settled-with-defects`; it is no longer `WAITING_EXTERNAL_ENVIRONMENT` and no longer blocks Gate 2's
  terminal acceptance on the ground of an unobserved node.
- The canonical brokered probe path works end to end on a Windows node whose transport is `local`,
  and it writes to the audit ledger.
- `EXISTS` and `HEALTHY` for HERMES's accelerators are established by observation and measurement,
  with `capability` held at `UNKNOWN` by the type system.
- The two shipped invariants hold on live data, not only in fixtures.

**May NOT claim:**

- That WilliamOS *notices* or *reports* hardware change. It does not.
  `CONT-EXPV2-HARDWARE-CHANGE-UNRECORDED` is open, and any Gate 2 surface phrased as "WilliamOS told
  me a new accelerator appeared" would be false.
- Any capability statement about the P40 — Pascal support, a model at a context length, usable
  headroom for a workload. `24149753856` bytes of measured headroom is a measurement of free memory
  at 01:04 UTC, not a promise that anything fits.
- Continuity of accelerator history before this probe. Identity for these cards starts here.
- That `truthState: live` will still hold when a Gate 2 surface renders it. It expires 300 s after
  the observation; a surface that wants `live` has to probe, which is the design.

## Reproduction

```bash
# on HERMES, from a directory holding the ten digest-verified canonical files
node run-canonical-probe.mjs hermes hermes-node
node scripts/execution-fabric/assemble-registry.mjs \
  --evidence-dir .artifacts/execution-fabric \
  --out .artifacts/execution-fabric/registry.snapshot.json

# anywhere, over the retained evidence
node GATE1B-project-system-objects.mjs <worktree-root> <evidence-dir> live
node GATE1B-project-system-objects.mjs <worktree-root> <evidence-dir> stale
```

The projection driver pins its clock to the observation timestamp rather than reading the wall
clock, so both projections reproduce byte-for-byte from the retained evidence at any future date.

Deterministic suites on this tree, `vitest run --config vitest.ci.config.ts`:

```
✓ tests/system-object-projection.test.ts   (42 tests)
✓ tests/fabric-broker.test.ts              (7 tests)
✓ tests/execution-fabric-registry.test.ts  (129 tests)
  Test Files  3 passed (3)
       Tests  178 passed (178)
```

## Retained artifacts

All under `docs/reports/experience-v2-gate1b/`.

| File | SHA-256 |
| --- | --- |
| `GATE1B-brokered-invocation.json` | `cbcb12242f93128dea951701d98f3397fdd48746d77354000e7667aa3558314e` |
| `GATE1B-hermes-node-probe.json` | `722350f2f8e2a26cc3642192eeaaa3aa5fc2b57bb9e6269ea0604551cd961086` |
| `GATE1B-registry-snapshot.json` | `ecc45b232fa253c798ec3177a6830c38807fb0a67baadc3d67d8314656c62336` |
| `GATE1B-transport-registry.json` | `8f48c17cacb087ee5483f57c636dfbbedf2fe25a85a329570372c6cefa9157e9` |
| `GATE1B-projection-live.json` | `513cf5b42457512d0a5207d58723a09f6c68a394834e8062404cb9edc10625d5` |
| `GATE1B-projection-stale.json` | `fb4c45ff1dc325d5e2d8fd82651ea3a9c5fd3a7304f1773de3c77866bd0ae4f3` |
| `GATE1B-reconciliation.json` | `355b4538619bb900226394736fc6254f7e593f779c355411c83e4e7b584a2351` |
| `GATE1B-health-summary.json` | `4c7988bb71dcd0fc2d266d3e529e2b19b2bc6ccb664e4022a10019dc68787683` |
| `GATE1B-route-nodes-probe.json` | `29c64118cc1752f5023286b8d3e100c652e77cfb0d3d13679441a7b7ad08dbaf` |
| `GATE1B-broker-audit-excerpt.txt` | `8a16a8eae1f08c1a218ffd1317cde7aeb0d089d2c94b1b769165a8f0e2405e7b` |
| `GATE1B-canonical-file-digests.txt` | `2f3df9944bbd7b19e6c4ff70667ef76df97731b5316bb1e5fc3ef0cbec50bb13` |
| `GATE1B-run-canonical-probe.mjs` | `539eb2d1ba6b5f63effabab6273e9f9cfef1ef2471e4f26c4493aa8895da76fa` |
| `GATE1B-run-route-probe.mjs` | `1f182becf105114c9ccc6c7c4394bc60686fe2df651c67533eabb2b69f9b7b60` |
| `GATE1B-project-system-objects.mjs` | `d426b65b0bcd4d535a60707c826eac3aa8f0a95d5eab90c7e5238c0c9026c5ab` |
| `GATE1B-reconcile.mjs` | `3840e36e651665913cbaea273bc4f78c89f938f0304e34c3ee5ad4964e680da3` |

`GATE1B-hermes-node-probe.json` is retained whole, including NIC MAC addresses and disk serial
numbers. Those are load-bearing: disk serial presence is what keeps
`not-schedulable-ambiguous-disk-identity` off this node's constraints, and an inventory edited for
tidiness stops being evidence.

## Chronology

- `2026-08-25T01:04:33.374Z` — `brokeredExec` invoked, node `hermes`, action `probe`
- `2026-08-25T01:04:33.7176799Z` — probe's own `observed_at`; the P40 read
- `2026-08-25T01:04:46.632Z` — brokered call returned `rc=0`, 21 021 bytes, ledger line 19629
- `2026-08-25T01:05` — snapshot assembled: `hermes-node: cpu=1 dimm=4 gpu=2 disk=3 nic=8 runtime=3 evidence=observed`
- `2026-08-25T01:07` — projection run, live and stale
- `2026-08-25T01:08:18.520Z` — `GET /api/fabric/nodes` `WINDOWS_PROBE` invoked through the broker
- `2026-08-25T01:10` — 178 deterministic tests pass on this tree
