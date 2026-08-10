# WilliamOS Execution Fabric probes

Issue: #531

These scripts build an evidence-backed resource registry. They are read-only by design. V0.2 does not schedule or mutate infrastructure.

Generated `.artifacts/execution-fabric/` probe files are host-local and ignored by Git. Durable conclusions belong in reviewed reports such as `docs/reports/WILLIAMOS-EXECUTION-FABRIC-V0.1-LIVE-MATRIX.md`.

## Output model

Each node emits a local probe file:

```text
.artifacts/execution-fabric/omen.json
.artifacts/execution-fabric/hermes-node.json
.artifacts/execution-fabric/atlas.json
.artifacts/execution-fabric/aegis.json
```

Capability producers may additionally emit a separately digest-bound capability snapshot. The first
accepted producer contract is:

```text
.artifacts/execution-fabric/aegis-capability.json
schema: aegis-capability/1
canonicalization: jcs-rfc8785/1
```

Node probes describe machine identity and inventory. Capability snapshots describe independent
service readiness. Neither source grants execution authority.

`assemble-registry.mjs` is the only operational entrypoint. It pins the reviewed canonical v0.2
seed and schema digests, always uses the real system clock, and overlays live discovered
hardware/runtime facts onto the declared role/authority seed. `assemble-registry-core.mjs` exists
only for isolated fixture testing and is not an operator surface. The entrypoint emits:

```text
.artifacts/execution-fabric/registry.snapshot.json
```

Missing or stale probes add fail-closed scheduling constraints; they never silently promote capability.
Observed promotion also requires a canonical host-derived node ID and an exact match to the
trusted hashed machine-identity pin in the seed. A node with no pin remains declared and
unschedulable until onboarding records that pin through a reviewed evidence change.

AEGIS backup/archive promotion additionally requires exact capability and receipt byte hashes pinned
by reviewed policy, a valid self-digest, exact producer schemas, the exact trusted machine identity
and backup mounts, freshness inside the policy maximum, `scheduler=OFF`, and restore-verified source
and manifest evidence. Missing, malformed, stale, future, hash-mismatched, mount-mismatched, or
scheduler-enabled evidence fails those storage capabilities closed without changing overall node
health. Compute is classified independently from the fresh raw probe and running Docker runtime.
NAS remains pending until a separate file-share service and authority are proven.

## Windows

Run in an ordinary shell first:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/execution-fabric/probe-windows.ps1 `
  -NodeId omen `
  -OutputPath .artifacts/execution-fabric/omen.json
```

For HERMES-NODE use `-NodeId hermes-node`.

The probe inventories CPU, every populated DIMM exposed by SMBIOS, NVIDIA GPUs, physical disks/partitions, NICs/IPs, and read-only runtime health for Docker/WSL/SSH/Ollama when present.

Do not elevate merely for convenience. If Windows hides a field without elevation, emit unknown/warning rather than weakening security.

## Linux

```bash
bash scripts/execution-fabric/probe-linux.sh atlas .artifacts/execution-fabric/atlas.json
bash scripts/execution-fabric/probe-linux.sh aegis .artifacts/execution-fabric/aegis.json
```

The Linux probe uses `sudo -n` only for read-only SMBIOS/SMART evidence. If passwordless sudo is unavailable, those fields remain unknown and the warning is preserved.

## Assemble

From the repository root:

```bash
node scripts/execution-fabric/assemble-registry.mjs \
  --evidence-dir .artifacts/execution-fabric \
  --out .artifacts/execution-fabric/registry.snapshot.json
```

The assembler preserves declared authority/role constraints while replacing hardware/runtime observations with live evidence. It fails closed on duplicate identities and architectural authority violations.
It validates complete nested resource data before promotion or publication and rejects probes
from unapproved probe implementations.

## Required live proof for v0.2

1. OMEN probe.
2. HERMES-NODE probe.
3. ATLAS probe.
4. AEGIS probe.
5. Assemble one registry snapshot.
6. Validate schema and semantic invariants.
7. Independently review the exact snapshot and scripts.
8. Record evidence in the work item/PR.

## Scheduler boundary

The registry is scheduler-ready, but scheduling remains disabled in v0.2. A later bounded Hermes work order may consume this registry to match workload requirements against healthy, fresh, authorized capabilities.

William must not be asked to choose a node for normal work placement.

Capability health is not execution authority. A `READY` AEGIS backup or archive axis does not grant
Hermes permission to dispatch, does not create a worker identity, and does not weaken the disabled
scheduler boundary.

## Recommendation-only placement proof

`recommend-placement.mjs` consumes an exact, digest-bound registry snapshot and one bounded workload
from `config/execution-fabric/placement-workloads.json`. It reports recommendation eligibility,
ineligibility reasons, deterministic ranking evidence, confidence, and freshness. Recommendation
eligibility is analytical only: it does not mean the scheduler or a node has execution authority.

The proof must be evaluated inside the retained snapshot's evidence window. Supplying a later
timestamp correctly makes expired evidence ineligible instead of silently treating historical facts
as current.

```powershell
node scripts/execution-fabric/recommend-placement.mjs `
  --snapshot .artifacts/execution-fabric/registry.snapshot.json `
  --schema config/execution-fabric/registry.schema.json `
  --expected-snapshot-sha256 20B218E8F7AC6E78027FE31B2725FF14DD11339D818636F1FC44313C828FC9F9 `
  --workloads config/execution-fabric/placement-workloads.json `
  --workload cpu-heavy-build `
  --at 2026-08-10T03:38:05.166Z
```

The command rejects a changed snapshot digest, malformed workload, and any registry whose scheduler
is not exactly `disabled / not-granted`. It marks stale or non-observed nodes ineligible while fresh,
independent candidates remain evaluable. It performs no dispatch,
lease, reservation, remote connection, authority update, or scheduler mutation.

## Bounded dispatch-contract proof

`evaluate-dispatch-contract.mjs` evaluates a fully bound, static proof packet describing what would
have to be true before one placement recommendation could become one authorized job. It binds the
canonical output of `recommend-placement.mjs` and its snapshot/workload digests to an R1 workload
envelope, authority tuple, path reservation,
single-writer lease/fencing token, checkpoint, bounded recovery policy, and completion evidence.

The evaluator returns `CONTRACT_READY`, `CONTRACT_BLOCKED`, or `INPUT_REJECTED`. `CONTRACT_READY`
means only that the static packet satisfies the contract. Every result keeps
`execution_authorized=false` and `dispatch_allowed=false`; the script has no queue, worker, remote
connection, command-execution, live lease, authority-write, or scheduler-activation adapter.
Placement readiness additionally requires a host-injected verifier for the exact placement artifact,
snapshot digest, and workload digest. Packet fields and CLI arguments cannot manufacture that trust.

```powershell
node scripts/execution-fabric/evaluate-dispatch-contract.mjs `
  --contract <local-proof-packet.json> `
  --at <evaluation-time-utc>
```

## Phase 3 resident HERMES bounded dispatch

`bounded-dispatch/resident-hermes-bounded-dispatch.mjs` is the single-shot runtime boundary for the
first Phase 3 class: `LOCAL_LLM_INFERENCE` on HERMES-NODE. It consumes only the exact
`hermes.local-llm-inference.v1` template. The adapter is selected by code, calls only the fixed
loopback Ollama surface, permits only the reviewed model allowlist, and has no caller-provided
executable, remote address, storage path, or replacement node.

Preparation independently requires:

- a fresh Phase 1 receipt reproduced in-process from the exact RFC 8785 snapshot bytes while still
  binding the reviewed reference-verifier digest;
- an exact Agent Forge permission-set digest;
- an exact reviewed non-active authority-scope artifact;
- a later active authority-registry entry whose complete bytes are on trusted `main`;
- exact Work Order, template, HERMES node, input, limits, risk, and one-attempt bindings.

The first authority is retained as `CONSUMED_REJECTED`, and the runtime policy is disabled. An
admitted scope does not activate authority. A separate future-dated activation must merge before its
effective time and explicitly enable only that authority reference. The hardened wrapper requires a
pre-provisioned, scope-bound durable ledger, origin/main provenance, monotonic fencing, a persisted
request-intent transition, redirect rejection, and durable completion settlement before stdout.

```powershell
npm run fabric:bounded-dispatch -- `
  --request docs/reports/bounded-dispatch/<request>.json `
  --receipt docs/reports/bounded-dispatch/<receipt>.json
```

The production wrapper does not accept a caller clock, ledger location, interpreter, model service
address, authority registry, template registry, or alternate node. The scheduler remains off;
`dispatch_performed=true` can be emitted only for the one exact claimed invocation. AEGIS templates
remain absent and fail closed until a resident AEGIS adapter and separately reviewed authority are
available.

### Static proof boundary (continued)

Proof fixtures must identify themselves as `proof-fixture` authority evidence. They are not grants
and cannot be consumed by Hermes or any node runtime. CLI evaluation cannot self-attest a completion
claim. A host integration must inject a verified evidence resolver backed by an independently trusted,
retained manifest; packet input cannot supply or override that resolver.

CLI exit status is fail-closed: `0` means `CONTRACT_READY`, `1` means `CONTRACT_BLOCKED`, and `2`
means `INPUT_REJECTED`.

## Pinned-evidence placement recommendation (v0.2)

`recommend-pinned-placement.mjs` is the Phase 1 bridge from immutable capability feeds to the
recommendation-only evaluator. It requires the exact Hermes, Atlas, and AEGIS snapshot references,
executes the producer-owned `verify_snapshot.py` reference verifier, overlays only observed
capability health and resource facts onto the committed registry, and preserves the registry's
authority lists byte-for-byte.

The policy pins the SHA-256 of that exact reference-verifier implementation. Supplying a different
script that merely exits successfully is rejected before snapshot content is used.
It also binds each required node to one exact feed schema and freshness TTL. Referenced bytes are
copied into a private temporary verification set, verified there, checked for byte stability, and
then parsed from those same staged bytes. Canonical integrity therefore cannot be confused with
schema validity or separated from the bytes used by the decision.
The already-hashed verifier bytes are staged alongside the evidence and that staged copy is the one
executed. The interpreter name is constrained to Python, and successful output must enumerate the
exact expected node/hash prefixes and snapshot count.

The receipt records sorted `evidence_snapshot[]` references, the placement-policy version, hashes of
the registry/schema/policy/catalog inputs, and `decision_input_sha256`. Identical workload, explicit
evaluation time, policy artifacts, and verified snapshot set therefore produce the same decision.
Missing, renamed, cross-schema, structurally malformed, future-dated, stale, unverifiable, or
scheduler-enabled evidence fails
closed. Staleness makes nodes ineligible; verifier or contract failure rejects the input entirely.

```powershell
node scripts/execution-fabric/recommend-pinned-placement.mjs `
  --snapshot-root C:\HermesLab\snapshots `
  --verifier C:\HermesLab\tools\verify_snapshot.py `
  --python py `
  --registry config/execution-fabric/registry.seed.json `
  --schema config/execution-fabric/registry.schema.json `
  --policy config/execution-fabric/pinned-evidence-policy.json `
  --workloads config/execution-fabric/placement-workloads.json `
  --workload cpu-heavy-build `
  --at 2026-08-10T07:00:00.000Z `
  --evidence hermes-node=<sha256> `
  --evidence atlas=<sha256> `
  --evidence aegis=<sha256>
```

This command performs no dispatch, lease acquisition, reservation, remote mutation, authority
change, or scheduler activation.

## Shadow placement observation (Phase 2)

### Genuine-outcome admission

`admission/compile-shadow-admission.mjs` is the fail-closed bridge between a completed,
known-safe producer outcome and the reviewed shadow registries. The resident producer must first
retain a Phase 1 receipt before execution, then retain canonical outcome, delivery, and independent
review evidence. The compiler verifies exact bytes, chronology, authority coverage, canonical node
identity, and that the reviewed commit is on trusted `main` and contains the exact receipt, delivery,
and outcome artifacts.

```powershell
npm run fabric:shadow-admit -- --candidate docs/reports/shadow-admission/<candidate>.json
```

Its output is a review-ready observation and registry-entry proposal. It never edits a registry,
launches work, schedules, dispatches, grants authority, or accesses a remote system. A separate
reviewed repository change must admit the proposal. Missing pre-execution receipt or producer facts
remain pending; completed work is never retrofitted or fabricated.

`evaluate-shadow-placement.mjs` compares one immutable Phase 1 placement receipt with one recorded
observation of where real work ran. It is an offline comparison surface for issue #538. It never
launches work, selects a replacement target, calibrates policy, activates a scheduler, or grants
execution authority.

The receipt is the JSON result produced by `recommend-pinned-placement.mjs`. Production evaluation
accepts it only when its exact byte digest is admitted by the repository-owned reviewed registry at
`config/execution-fabric/shadow-receipt-registry.json`. The production CLI does not accept caller
paths for registries, policies, schemas, workload catalogs, verifiers, interpreters, or trust roots.
Each receipt admission also binds the exact Work Order; a reviewed recommendation cannot be reused
as evidence for a different Work Order.
The reported trust-registry digest is derived from the selected reviewed receipt binding plus the
registry and policy schema versions, so later append-only admissions do not rewrite historical
replay identity.

Outcome settlement is independently pinned by the repository-owned reviewed registries at
`config/execution-fabric/shadow-outcome-registry.json` and
`config/execution-fabric/shadow-authority-registry.json`. The first binds the immutable outcome
artifact to the Work Order, actual node, retained source, authority reference, and reviewed commit.
The second binds that authority reference to the Work Order, allowed nodes, validity window, and
reviewed commit. Empty registries fail closed.

The observation binds the exact receipt bytes, a retained delivery record, and a canonical immutable
outcome-evidence JSON artifact. That artifact binds the Work Order, actual node, terminal result,
authority outcome, chronology, and resource observations; latency is derived from timestamps rather
than declared by the caller. A different target requires an explicit classified divergence reason.

```powershell
node scripts/execution-fabric/evaluate-shadow-placement.mjs `
  --receipt .artifacts/execution-fabric/phase1-receipt.json `
  --observation .artifacts/execution-fabric/shadow-observation.json
```

The evaluator executes no subprocess. It rejects unadmitted receipts, changed source or outcome
bytes, pre-recommendation execution/observation chronology, authority violations, malformed resource
facts, secrets, executable fields, duplicate sources or outcomes, ineligible actual targets,
unreviewed outcome/authority bindings, and unexplained target divergence.

Results are `OBSERVED` or `INPUT_REJECTED`; test-fixture APIs emit only `TEST_OBSERVED` / `TEST_PASS`.
Every result remains observation-only with job launch, scheduler activation, authority mutation,
remote access, and shell execution false. Phase 2 observations are evidence for later review; they
are not a claim that placement policy is calibrated or safe to dispatch.
