# WO-EF-SHADOW-002 and WO-EF-SHADOW-003 proposed authority packet

Issue: `#538`

Status: `PENDING_REVIEWED_FUTURE_DATED_ACTIVATION`

Purpose: define two bounded, operator-selected executions needed to form a representative Phase 2
shadow-placement set. This packet is not active authority. A separate activation must be reviewed,
merged, and effective before either Work Order can begin.

## WO-EF-SHADOW-002

- Authority reference: `issue-538-phase2-shadow-002`
- Allowed node: `hermes-node`
- Workload: one fixed, benign local-LLM inference through the existing HERMES loopback service
- Valid from: `2026-08-10T14:42:00.000Z`
- Expires at: `2026-08-11T02:42:00.000Z`
- Authority source commit: `2c76da3aad0db472d261c2e0f4e0fac3bc9c3069`
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

## WO-EF-SHADOW-003

- Authority reference: `issue-538-phase2-shadow-003`
- Allowed node: `atlas`
- Workload: one read-only authoritative-state metadata query against the approved Forge root
- Valid from: `2026-08-10T14:42:00.000Z`
- Expires at: `2026-08-11T02:42:00.000Z`
- Authority source commit: `2c76da3aad0db472d261c2e0f4e0fac3bc9c3069`
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

The executable authority registry binds these exact scopes and rejects workload mismatch, missing or
extra scope fields, malformed scope values, duplicate scope values, and unsorted action/scope sets.

These proposed admissions are not execution receipts or Phase 2 pass claims. Each execution may
begin only after a future-dated activation is merged and its own fresh Phase 1 recommendation is
retained. Receipt and outcome settlement remain fail closed until separately retained, reviewed, and
admitted.
