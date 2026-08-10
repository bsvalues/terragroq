# WO-EF-SHADOW-002 and WO-EF-SHADOW-003 containment record

Issue: `#538`

Status: `CONTAINED_NOT_AUTHORIZED`

PR `#549` merged authority-registry entries for these Work Orders before the authority packet and
scope contract had been independently reviewed. A bounded local inference for WO-EF-SHADOW-002 was
then performed before this containment merged. That execution is quarantined and is not admissible
shadow evidence. WO-EF-SHADOW-003 did not execute. This record removes both entries from the
executable registry and preserves the fail-closed boundary.

## WO-EF-SHADOW-002

- Authority reference: `issue-538-phase2-shadow-002`
- Allowed node: `hermes-node`
- Workload: one fixed, benign local-LLM inference through the existing HERMES loopback service
- Authority state: `NOT_AUTHORIZED`
- Risk: `R0`
- Task template: `existing-loopback-llm-inference-v1`
- Repository scope: `bsvalues/terragroq`
- Environment scope: `hermes-loopback-ollama`
- Allowed actions: invoke the existing loopback LLM; read one bounded response
- Forbidden actions: protected-data access, secret inspection, model-inventory change, runtime mutation
- Data class: non-sensitive only
- Owner decision condition: a new authority boundary only

The prompt may contain no protected, county, PACS, production, credential, or repository-secret data.
The task may not change model inventory, runtime configuration, host configuration, or network
exposure.

### Quarantined execution

- Receipt SHA-256: `91e8ba65d178becc0109abb1574eff0c123626a423f8e358768eff2272875c50`
- Outcome SHA-256: `a52489e6da85ce520dd86b26427b092cf591ed7fb9e504bf7a8d72f06bd66556`
- Execution window: `2026-08-10T14:58:35.068Z` through `2026-08-10T14:59:00.817Z`
- Actual activity: one fixed benign prompt to the existing HERMES loopback Ollama service
- Runtime result: `COMPLETED / SUCCEEDED`
- Admission status: `QUARANTINED_NOT_ADMISSIBLE`
- Evidence delivery: PR `#552`, closed without merge

The execution used no scheduler, placement-engine launch, autonomous dispatch, external provider,
protected data, or remote mutation. Those safety facts do not cure the authority-sequencing defect,
so the receipt and outcome must not be added to the production trust registries or counted toward
the Phase 2 representative set.

## WO-EF-SHADOW-003

- Authority reference: `issue-538-phase2-shadow-003`
- Allowed node: `atlas`
- Workload: one read-only authoritative-state metadata query against the approved Forge root
- Authority state: `NOT_AUTHORIZED`
- Risk: `R0`
- Task template: `forge-root-metadata-query-v1`
- Repository scope: `bsvalues/terragroq`
- Environment scope: `atlas-forge-root-read-only`
- Allowed actions: read Forge-root metadata; report aggregate metadata
- Forbidden actions: protected-content access, secret inspection, database mutation, filesystem mutation
- Data class: non-sensitive metadata only
- Owner decision condition: a new authority boundary only

The task may query only bounded, read-only Forge metadata exposed by the approved Forge root; it is
not authority for arbitrary filesystem inspection. It may not read protected file contents, inspect
credentials, access county or PACS data, write state, mutate a database, or change ATLAS configuration.

## Preserved boundary

- Placement engine job launch: `false`
- Scheduler activation: `false`
- Autonomous dispatch: `false`
- AEGIS compute authority granted: `false`
- AEGIS storage, NAS, or backup authority granted: `false`
- Remote infrastructure mutation authority: `false`

Execution performed for WO-EF-SHADOW-002: `true, quarantined and not admissible`

Execution performed for WO-EF-SHADOW-003: `false`

Any future admission requires a separate reviewed contract that binds the exact authority scope,
followed by a separate future-dated activation merged before its effective time. Neither Work Order
may execute from PR `#549` or from this containment record.
