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

`assemble-registry.mjs` overlays live discovered hardware/runtime facts onto the declared role/authority seed and emits:

```text
.artifacts/execution-fabric/registry.snapshot.json
```

Missing or stale probes add fail-closed scheduling constraints; they never silently promote capability.
Observed promotion also requires a canonical host-derived node ID and an exact match to the
trusted hashed machine-identity pin in the seed. A node with no pin remains declared and
unschedulable until onboarding records that pin through a reviewed evidence change.

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
