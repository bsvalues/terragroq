# WilliamOS Execution Fabric probes

Issue: #531

These scripts build an evidence-backed resource registry. They are read-only by design. V0.1 does not schedule or mutate infrastructure.

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

`assemble-registry.mjs` overlays live discovered hardware/runtime facts onto the declared role/authority seed and emits:

```text
.artifacts/execution-fabric/registry.snapshot.json
```

Missing or stale probes add fail-closed scheduling constraints; they never silently promote capability.
Observed promotion also requires a canonical host-derived node ID and an exact match to the
trusted hashed machine-identity pin in the seed. A node with no pin remains declared and
unschedulable until onboarding records that pin through a reviewed evidence change.

AEGIS backup/archive promotion additionally requires a valid self-digest, exact producer schema,
fresh evidence inside the producer's declared threshold, `scheduler=OFF`, and READY backup/archive
axes. Missing, malformed, stale, future, hash-mismatched, or scheduler-enabled evidence fails those
capabilities closed without falsely changing node or compute health. NAS remains pending until a
separate file-share service and authority are proven.

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
  --seed config/execution-fabric/registry.seed.json \
  --evidence-dir .artifacts/execution-fabric \
  --out .artifacts/execution-fabric/registry.snapshot.json
```

The assembler preserves declared authority/role constraints while replacing hardware/runtime observations with live evidence. It fails closed on duplicate identities and architectural authority violations.
It validates complete nested resource data before promotion or publication and rejects probes
from unapproved probe implementations.

## Required live proof for v0.1

1. OMEN probe.
2. HERMES-NODE probe.
3. ATLAS probe.
4. AEGIS probe.
5. Assemble one registry snapshot.
6. Validate schema and semantic invariants.
7. Independently review the exact snapshot and scripts.
8. Record evidence in the work item/PR.

## Scheduler boundary

The registry is scheduler-ready, but scheduling remains disabled in v0.1. A later bounded Hermes work order may consume this registry to match workload requirements against healthy, fresh, authorized capabilities.

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

Proof fixtures must identify themselves as `proof-fixture` authority evidence. They are not grants
and cannot be consumed by Hermes or any node runtime. CLI evaluation cannot self-attest a completion
claim. A host integration must inject a verified evidence resolver backed by an independently trusted,
retained manifest; packet input cannot supply or override that resolver.

CLI exit status is fail-closed: `0` means `CONTRACT_READY`, `1` means `CONTRACT_BLOCKED`, and `2`
means `INPUT_REJECTED`.
