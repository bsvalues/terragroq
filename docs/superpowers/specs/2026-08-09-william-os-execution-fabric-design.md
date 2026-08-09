# WilliamOS Execution Fabric v0.1

Issue: #531

## Purpose

The Execution Fabric is the evidence-backed resource layer beneath Hermes. William expresses outcomes to WilliamOS; Hermes decides which approved capability can perform bounded work. William never chooses machines, GPUs, ports, or queue placement.

```text
William -> WilliamOS -> Hermes -> Codex/agents -> GitHub delivery
                         |
                         v
                  Execution Fabric
             OMEN / HERMES-NODE / ATLAS
                  T5810-2 / Azure
```

Hermes the software subsystem is distinct from HERMES-NODE, the current X99 execution host.

## V0.1 boundary

V0.1 discovers, normalizes, validates, and advertises resources. It does **not** activate autonomous placement or infrastructure mutation.

The registry must fail closed when evidence is stale, conflicting, incomplete, or unsupported.

## Canonical nodes

- `omen`: operator cockpit, interactive development, optional burst compute; not authoritative state and not assumed always-on.
- `hermes-node`: local AI/GPU execution worker; current Ollama/agent compute; not durable-state authority.
- `atlas`: durable state, databases, Forge, retrieval, protected-data services; noisy batch work is disfavored.
- `t5810-2`: secondary CPU/batch/NAS/backup worker candidate; exact inventory is discovered, never assumed.
- `azure`: future approved production/external capability envelope; no implicit authority.
- frontier providers are represented only when explicitly approved, with cost/data/authority constraints.

## Resource model

Every snapshot contains:

1. **Identity** — node id, hostname, OS, boot id where available.
2. **CPU** — every physical processor, model, cores, threads, NUMA/socket information where available.
3. **DIMMs** — every populated memory device: locator, capacity, type, speed, manufacturer, part number, serial when exposed.
4. **GPUs** — every GPU: vendor/model, PCI id/bus, VRAM, driver/runtime, compute capability where exposed.
5. **Disks** — every physical disk: model, serial, capacity, transport, health evidence, filesystem/UUID/mount relationships where available.
6. **Network** — every relevant NIC/link: MAC, IPs, link state, speed, duplex, route role.
7. **Runtimes** — Docker/WSL/SSH/Ollama/database/Forge and other explicitly registered capabilities.
8. **Authority** — what the node is allowed and forbidden to do.
9. **Health/freshness** — observed time, TTL, probe source, confidence, warnings.
10. **Provenance** — exact probe/command family supporting each claim.

No secret, credential, private key, token, raw protected-data content, or county/PACS record belongs in the registry.

## Workload classes

V0.1 defines scheduler-ready classes without enabling scheduling:

- `interactive-development`
- `local-llm-inference`
- `gpu-batch`
- `cpu-batch`
- `ci-build-test`
- `etl-transform`
- `hash-verify`
- `backup-archive`
- `database-state`
- `retrieval-index`
- `protected-data-read`
- `frontier-escalation`

A later Hermes work order may match workload requirements to capabilities only when both authority and health/freshness gates pass.

## Placement constraints

Hard constraints outrank performance:

- Atlas is authoritative for durable state; compute workers must not silently become state authority.
- HERMES-NODE may run local AI/agents but does not receive durable-state authority by convenience.
- OMEN is interactive/burst and may disappear; critical always-on state cannot depend on it.
- T5810-2 may absorb CPU-heavy/batch/backup work once discovered and approved.
- Protected county/PACS systems remain non-selectable without explicit authority.
- Frontier/cloud execution requires explicit provider, cost, data-classification, and authority permission.

## Scoring contract for later scheduling

After hard constraints pass, a future scheduler may score candidates using:

- required accelerator/runtime present;
- free VRAM / RAM headroom;
- CPU cores/threads and load;
- disk class/free space/I/O role;
- network path/speed;
- node availability class;
- data locality;
- estimated latency/cost;
- workload interference policy;
- evidence freshness.

The score never overrides a forbidden authority edge.

## Evidence and freshness

Each probe snapshot must include `observed_at`, `probe_version`, node identity, and raw evidence summaries. Static identity (serials, model numbers, UUIDs) may have long TTLs; dynamic health/load/runtime claims require short TTLs.

Recommended starting TTLs:

- hardware identity: 30 days
- disk SMART summary: 24 hours
- runtime/service state: 5 minutes
- network link state: 1 minute
- CPU/RAM/GPU load: 30 seconds

A consumer must label stale evidence rather than silently treating it as current.

## V0.1 acceptance

A generated snapshot can truthfully answer:

- every discovered CPU, populated DIMM, GPU, physical disk, and relevant network link;
- every registered runtime capability and current health/freshness;
- what each node may and may not do;
- which claims are proven vs unknown;
- what evidence backs each claim.

V0.1 is complete only after live probes run on OMEN, HERMES-NODE, ATLAS, and T5810-2 (when online), their outputs validate against the schema, and an independently reviewed merged registry snapshot is produced.

## Explicit non-goals

- no scheduler activation;
- no Kubernetes or cluster-manager build-out;
- no automatic service mutation;
- no production/county/PACS authority expansion;
- no owner-facing hardware dashboard requirement;
- no secrets in Git or registry output.
