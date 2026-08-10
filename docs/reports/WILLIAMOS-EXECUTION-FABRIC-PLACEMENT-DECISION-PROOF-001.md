# WilliamOS Execution Fabric placement decision proof

Issue: `#533`
Work Order: `WO-FABRIC-PLACEMENT-001`
Status: `PLACEMENT_REASONING_PROVEN / RECOMMENDATION_ONLY / SCHEDULER_OFF`

## Evidence binding

The proof consumed the retained four-node registry snapshot from the merged Execution Fabric v0.1
lane without committing raw machine inventory.

- Snapshot SHA-256: `20B218E8F7AC6E78027FE31B2725FF14DD11339D818636F1FC44313C828FC9F9`
- Evaluation time: `2026-08-10T03:38:05.166Z`
- Physical node evidence: `observed / fresh` at the bound evaluation time
- Azure policy envelope: `declared / non-selectable`
- Scheduler: `disabled / not-granted`

The evaluator rejects a different snapshot digest. Re-evaluating after the 300-second evidence TTL
correctly returns no recommendation instead of treating the historical snapshot as live placement
evidence.

## Representative decisions

| Workload | Recommendation | Other recommendation-eligible nodes | Ineligible interpretation |
|---|---|---|---|
| CPU-heavy build, no GPU requirement, scratch-only | AEGIS | HERMES-NODE rank 2; OMEN rank 3 | ATLAS excluded because it carries authoritative-state responsibility; Azure lacks observed evidence and CPU inventory |
| Local GPU inference | HERMES-NODE | None | Other nodes lack the exact inference capability, authority, healthy Ollama runtime, or sufficient GPU evidence |
| Authoritative state operation | ATLAS | None | Other nodes lack database and authoritative durable-state authority |
| Interactive development | OMEN | None | Other nodes lack the exact interactive capability and authority |

These results are derived from requirements, registered capabilities, authority, runtime state,
resource evidence, availability class, confidence, and freshness. The evaluator source contains no
mapping from workload IDs to machine IDs. Ranking ends with a stable node-ID tie-breaker so input
order cannot change the result.

AEGIS is recommendation-eligible for the bounded CPU proof because the workload is scratch-only and
its observed compute-candidate evidence ranks highest. That conclusion is analytical only. It does
not grant AEGIS compute placement authority and does not weaken its unknown-disk, NVMe-reserve,
storage-pending, NAS, backup, or destructive-action fences.

## Fail-closed behavior

The proof rejects or fences:

- changed snapshot bytes or digest mismatch;
- malformed and contradictory requirements;
- duplicate node identity or conflicting authority;
- future-dated, stale, missing-TTL, or declared-only evidence;
- missing capability, authority, runtime, CPU, GPU, or storage semantics;
- scheduler state other than exactly `disabled / not-granted`;
- implicit Azure, cost, protected-data, county, or PACS placement.

Every node remains in the output with exact ineligibility reasons and consulted evidence paths. No
candidate silently disappears.

## Authority and mutation boundary

```text
PLACEMENT_REASONING: allowed
RECOMMENDATION_ONLY: true
SCHEDULER: disabled / not-granted
AUTONOMOUS_DISPATCH: forbidden
AUTHORITY_MUTATED: false
AEGIS_COMPUTE_AUTHORITY_GRANTED: false
AEGIS_STORAGE_AUTHORITY_GRANTED: false
AEGIS_NAS_AUTHORITY_GRANTED: false
AEGIS_BACKUP_AUTHORITY_GRANTED: false
REMOTE_SYSTEMS_MODIFIED: false
REJECTED_ISSUE_357_REUSED: false
OWNER_ACTION_REQUIRED: false
```

## Validation

- Focused placement and registry tests: `80 passed`.
- Real retained-snapshot proof: all four representative decisions matched the expected generic
  capability/authority conclusions.
- Broader suite excluding the separately host-dependent TerraFusion lab preflight: `262 files
  passed`, `2,696 tests passed`, `2 skipped`. The clean pass used two workers and a 30-second
  per-test ceiling after two unrelated process-timing tests exceeded their child-process timeout
  under an unconstrained concurrent run; both passed independently before the clean full rerun.
- Lint: PASS with no warnings or errors.
- Clean production build with private build worker and telemetry disabled: PASS.
- Exact-head assurance and PR checks: recorded at final review head before merge.
