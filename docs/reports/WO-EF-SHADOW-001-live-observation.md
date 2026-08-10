# WO-EF-SHADOW-001 live shadow observation

Issue: `#538`

TARGET: hermes-node

## Placement

- Recommendation evaluated at: `2026-08-10T14:07:37.340Z`
- Recommended node: `aegis`
- Actual known-safe node: `hermes-node`
- Divergence: `MANUAL_TARGET_DIFFERS_FROM_RECOMMENDATION`
- Constraint: `RECORDED_AUTHORITY_CONSTRAINT`
- Reason: AEGIS ranked first from fresh capability evidence, but AEGIS compute authority remained ungranted. HERMES ranked second, was fresh and eligible, and was the only node admitted by `issue-538-phase2-shadow-001`.

The placement engine did not launch the workload. Codex selected the already-authorized HERMES node after retaining the recommendation.

## Workload

The bounded validation cloned the exact reviewed `origin/main` history from a SHA-256-retained Git bundle into an owned disposable HERMES workspace, ran full strict Git object verification, and confirmed head `604d75049892f59989e3c63826e7817716078696`.

- Source bundle SHA-256: `a0767cd634dd6af0b41fbac94220c33138fa583fab8684d69dd586d75986db3c`
- Started at: `2026-08-10T14:08:02.476Z`
- Completed at: `2026-08-10T14:09:03.309Z`
- CPU load observed: `52 percent`
- RAM used observed: `16366403584 bytes`
- Scheduler: `OFF`
- Autonomous dispatch: `false`
- Placement-engine job launch: `false`

Two bounded attempts encountered native PowerShell handling failures before final verification: first a literal-path quoting error, then stderr promotion during a successful clone. Both failures remained inside the owned workspace. Recovery reused the same retained input, strict verification passed, and the exact owned workspace `C:\HermesLab\work\WO-EF-SHADOW-001` was removed after evidence capture.

## Result

PASS

LATENCY_MS: 60833

## Safety

- Authority reference: `issue-538-phase2-shadow-001`
- Authority outcome: `COMPLIANT`
- Actual target was eligible in the retained receipt: `true`
- Execution began before HERMES evidence expiry: `true`
- Authority violation: `false`
- Stale-evidence placement: `false`
- Silent fallback: `false`
- AEGIS execution performed: `false`
- AEGIS compute authority granted: `false`
- AEGIS storage, NAS, or backup authority granted: `false`
- County, PACS, protected data, and production mutation touched: `false`

This record is one genuine Phase 2 observation. It does not by itself certify the complete bounded observation set or enable Phase 3 dispatch.
