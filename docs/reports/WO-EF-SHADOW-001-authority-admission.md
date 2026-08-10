# WO-EF-SHADOW-001 authority admission

Issue: `#538`

Purpose: admit one bounded, operator-selected HERMES execution for Phase 2 shadow observation after a fresh placement recommendation exists.

## Authority

- Work Order: `WO-EF-SHADOW-001`
- Authority reference: `issue-538-phase2-shadow-001`
- Allowed node: `hermes-node`
- Valid from: `2026-08-10T14:01:38.777Z`
- Expires at: `2026-08-10T20:01:38.777Z`
- Authority source commit: `83b9d699e90dfb2296f8cb3b9ae775661c6a941f`

The bounded workload may run only after a fresh Phase 1 recommendation is retained. It may exercise repository validation on HERMES using disposable workspace state. It may not access authoritative state, county or PACS systems, protected data, secrets, paid services, or production mutation.

## Preserved boundary

- Placement engine job launch: `false`
- Scheduler activation: `false`
- Autonomous dispatch: `false`
- AEGIS compute authority granted: `false`
- AEGIS storage, NAS, or backup authority granted: `false`
- Remote infrastructure mutation authority: `false`

This admission is not a Phase 2 pass claim. It creates the reviewed authority prerequisite for one genuine observation. Receipt and outcome settlement remain fail closed until separately retained, reviewed, and admitted.
