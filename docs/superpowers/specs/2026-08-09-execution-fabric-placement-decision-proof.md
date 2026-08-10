# Execution Fabric Placement Decision Proof

Issue: #533
Work Order: `WO-FABRIC-PLACEMENT-001`

## Purpose

This contract defines deterministic, recommendation-only placement reasoning over a verified
Execution Fabric snapshot and the workload catalog at
`config/execution-fabric/placement-workloads.json`. It reports which nodes satisfy a workload,
why every other node does not, and how eligible nodes rank. It never dispatches work or changes the
snapshot, a node, authority, or scheduler state.

Workload classes are generic requirement records. They do not name, reserve, or imply a preferred
physical node. A changed capability, authority, runtime, resource, availability, or evidence claim
can therefore change a recommendation without changing the workload definition.

## Inputs and binding

An evaluation accepts exactly:

- one snapshot valid against `config/execution-fabric/registry.schema.json`;
- the catalog with `schema_version = 0.1-placement-workloads` and
  `recommendation_only = true`;
- one workload ID present exactly once in the catalog;
- an explicit UTC evaluation timestamp; and
- the caller's expected snapshot digest.

Before evaluation, compute `snapshot_digest` as SHA-256 over the exact retained snapshot bytes. This
matches the digest in the independently reviewed live-matrix report and detects any whitespace,
ordering, or content change to that artifact. The expected and computed digests must match. The
result repeats the computed digest, workload ID, catalog schema version, workload digest, and
evaluation timestamp. The evaluator treats both parsed inputs as immutable and must not rewrite,
enrich, sort, or persist either input.

## Global fail-closed gates

Return `INPUT_REJECTED`, with no eligible nodes or recommendation, for any of these conditions:

- malformed JSON, schema failure, unknown fields where the governing schema forbids them, or an
  unsupported schema version;
- a missing or duplicate workload ID, duplicate node ID, invalid timestamp, invalid TTL, or
  non-finite numeric resource value;
- a missing expected digest or snapshot digest mismatch;
- `recommendation_only` is not exactly `true`;
- snapshot scheduler state is not exactly `disabled`, or scheduler authority is not exactly
  `not-granted`;
- an authority value occurs in both `allow` and `deny` for one node;
- duplicate claims conflict about node identity, runtime state, capabilities, authority, resources,
  or evidence time; or
- requirements or preferences are internally contradictory or cannot be evaluated deterministically.

Unknown, missing, stale, declared-only, or insufficient facts about an otherwise valid individual
node make that node ineligible; they are never guessed from role, hostname, another node, or a
preferred availability class. A stale node does not invalidate fresh, independent candidates.

## Eligibility

Evaluate every snapshot node in ascending node-ID order. Hard gates are conjunctive and always run
before ranking. An eligible node must satisfy all of the following:

1. Every `capabilities_all` value is present exactly in `node.capabilities`.
2. Every `authority_all` value is present exactly in `node.authority.allow` and absent from
   `node.authority.deny`.
3. No `excluded_authority` value is present in `node.authority.allow`.
4. For every `runtimes_all` entry, at least one runtime has the exact `kind` and a state included in
   the entry's `states`. Missing, `unknown`, `degraded`, `stopped`, or `unavailable` state fails
   unless explicitly allowed by that workload entry.
5. Total CPU threads, summed across the node's physical CPU records, meets
   `minimum_cpu_threads` when non-null. Missing or contradictory CPU inventory is insufficient.
6. At least one GPU has known VRAM meeting `minimum_gpu_vram_bytes` when non-null. VRAM is not
   summed across GPUs, and unknown VRAM is insufficient.
7. `observed_evidence_required` requires confidence `observed` or `proven`; `declared` and `unknown`
   are insufficient.
8. `fresh_evidence_required` requires a non-null `ttl_seconds` and
   `evaluated_at <= observed_at + ttl_seconds`. Future-dated evidence is conflicting input. Evidence
   is stale immediately after its inclusive expiry instant.
9. `scratch-only` requires no durable-state placement and no persistent-output assumption;
   `authoritative-state` requires `authoritative-durable-state` in `authority.allow` in addition to
   the workload's explicit requirements; `none` creates no storage requirement or authority.

Each ineligible node reports all applicable reason codes in ascending lexical order, with structured
`required`, `observed`, and `evidence_ref` values where relevant. Stable reason codes are:

```text
CAPABILITY_REQUIRED
AUTHORITY_REQUIRED
AUTHORITY_DENIED
AUTHORITY_EXCLUDED
RUNTIME_REQUIRED
RUNTIME_STATE_INELIGIBLE
CPU_THREADS_INSUFFICIENT
CPU_THREADS_UNKNOWN
GPU_VRAM_INSUFFICIENT
GPU_VRAM_UNKNOWN
OBSERVED_EVIDENCE_REQUIRED
EVIDENCE_TTL_REQUIRED
EVIDENCE_STALE
STORAGE_SEMANTICS_INELIGIBLE
```

One failed hard gate can never be offset by preference or resource score.

## Ranking

Rank only eligible nodes. The deterministic rank key is the following lexicographic tuple, compared
in order:

1. count of listed preferred capabilities present, descending;
2. availability position in `availability_order`, ascending, with unlisted classes after all listed
   classes;
3. total CPU threads, descending, only when `higher_cpu_threads` is true;
4. highest single-GPU VRAM bytes, descending, only when `higher_gpu_vram` is true; and
5. node ID by ascending Unicode code-point order as the final stable tie-breaker.

The result exposes the tuple as `rank_basis`; it does not collapse unlike units into an opaque score.
Preferences are ranking signals only. An unlisted availability class remains eligible if all hard
gates pass.

## Evidence, confidence, and freshness

Every eligible and ineligible node result includes:

- `node_id`, `eligible`, and either a one-based `rank` or `rank = null`;
- exact reason codes;
- the capability, authority, runtime, CPU-thread, GPU-VRAM, availability, and storage facts actually
  consulted;
- evidence probe, probe version, observed time, TTL, expiry time, and confidence; and
- freshness state `fresh`, `stale`, or `insufficient`, calculated at the bound evaluation timestamp.

Candidate confidence is the node evidence confidence after all required facts are proven to come
from that same non-conflicting evidence envelope. Recommendation confidence is the least confidence
among facts used by the top-ranked candidate, ordered `proven > observed > declared > unknown`.
Because every catalog workload requires observed evidence, a recommendation can be only `proven` or
`observed`. Confidence never repairs missing authority or stale evidence.

The complete result has status `RECOMMENDED` when at least one node is eligible,
`NO_ELIGIBLE_NODE` when valid input produces none, or `INPUT_REJECTED` when a global gate fails.
`recommended_node_id` is the rank-1 node only for `RECOMMENDED`; otherwise it is `null`. Eligible and
ineligible collections are both emitted so no candidate silently disappears.

## Representative conclusions

The four catalog records establish these capability-driven conclusions:

- `cpu-heavy-build` accepts only fresh, observed nodes with at least eight CPU threads, excludes
  nodes carrying authoritative durable-state authority, uses scratch only, and prefers declared
  build/batch/bounded/burst capabilities before availability and CPU capacity.
- `gpu-local-inference` requires local-inference capability and authority, a healthy or running
  Ollama runtime, and at least 4 GiB on one GPU; resident availability and then higher VRAM rank
  eligible candidates.
- `authoritative-state-operation` requires database capability and authority plus explicit durable
  state authority; stateful availability is preferred.
- `interactive-development` requires matching capability and authority; interactive availability is
  preferred.

These are expected rules, not expected machine names. A declared-only seed snapshot correctly yields
no eligible node because all four workloads require observed, fresh evidence.

## Non-authority boundary

This proof is a pure decision projection. It grants and performs none of the following:

- dispatch, execution, queue acquisition, reservation, lease, retry, reroute, or scheduling;
- scheduler activation; scheduler remains `disabled / not-granted`;
- authority creation, mutation, inheritance, inference, or delegation;
- AEGIS compute authority or AEGIS storage, NAS, or backup authority;
- remote host, runtime, service, filesystem, database, network, cloud, or GitHub mutation;
- county/PACS access, protected-data scope, cloud spending, or implicit Azure placement; or
- reuse, retry, wrapping, or renaming of the rejected issue #357 adapter.

A recommendation is evidence for a later separately authorized decision only. It is never a command,
grant, reservation, or proof that execution occurred.
