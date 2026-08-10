# WO-EF-SHADOW-002 authority admission

Issue: `#538`

Purpose: admit one bounded, operator-selected HERMES local-inference validation for a second Phase 2 shadow observation after a fresh placement recommendation exists.

## Authority

- Work Order: `WO-EF-SHADOW-002`
- Workload: `gpu-local-inference`
- Authority reference: `issue-538-phase2-shadow-002`
- Allowed node: `hermes-node`
- Valid from: `2026-08-10T14:43:03.850Z`
- Expires at: `2026-08-10T20:01:38.777Z`
- Authority source commit: `380f9606527a9f3c698dbffe262102bda1db8e68`

The bounded workload may run only after a fresh Phase 1 recommendation is retained and selects an eligible local-inference target. It is limited to a non-sensitive local Ollama inference validation on HERMES with bounded input, timeout, and resource observation. It may not access authoritative state, county or PACS systems, protected data, secrets, paid services, external providers, or production mutation.

## Preserved boundary

- Placement engine job launch: `false`
- Scheduler activation: `false`
- Autonomous dispatch: `false`
- External provider authority granted: `false`
- AEGIS compute/storage/NAS/backup authority granted: `false`
- Remote infrastructure mutation authority: `false`

This admission is not a Phase 2 pass claim. It creates the reviewed authority prerequisite for one additional genuine observation. Receipt and outcome settlement remain fail closed until separately retained, reviewed, and admitted.
