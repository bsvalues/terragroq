# WO-EF-SHADOW-002 and WO-EF-SHADOW-003 authority admission

Issue: `#538`

Purpose: admit two bounded, operator-selected executions needed to form a representative Phase 2
shadow-placement set after a fresh recommendation exists for each Work Order.

## WO-EF-SHADOW-002

- Authority reference: `issue-538-phase2-shadow-002`
- Allowed node: `hermes-node`
- Workload: one fixed, benign local-LLM inference through the existing HERMES loopback service
- Valid from: `2026-08-10T14:42:00.000Z`
- Expires at: `2026-08-11T02:42:00.000Z`
- Authority source commit: `ace709f88752d1e270c3d369b14259c9872e89e7`

The prompt may contain no protected, county, PACS, production, credential, or repository-secret data.
The task may not change model inventory, runtime configuration, host configuration, or network
exposure.

## WO-EF-SHADOW-003

- Authority reference: `issue-538-phase2-shadow-003`
- Allowed node: `atlas`
- Workload: one read-only authoritative-state metadata query against the approved Forge root
- Valid from: `2026-08-10T14:42:00.000Z`
- Expires at: `2026-08-11T02:42:00.000Z`
- Authority source commit: `ace709f88752d1e270c3d369b14259c9872e89e7`

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

These admissions are prerequisites for genuine observations, not execution receipts or Phase 2 pass
claims. Each execution may begin only after its own fresh Phase 1 recommendation is retained. Receipt
and outcome settlement remain fail closed until separately retained, reviewed, and admitted.
