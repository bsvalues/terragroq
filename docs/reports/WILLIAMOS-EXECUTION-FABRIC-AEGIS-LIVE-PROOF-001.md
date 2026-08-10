# WilliamOS Execution Fabric AEGIS Live Proof 001

Status: `PASS`

Work Order: `WO-EF-DISPATCH-AEGIS-001`

Issue: `#538`

## Result

The Execution Fabric completed one explicitly authorized, non-destructive `HASH_VERIFY`
operation on AEGIS through the bounded resident adapter. The operation ran from clean trusted
`main` commit `20ac37a9787856744f077fcb3252808a3697bd53`, consumed exactly one claim, acquired and
released exactly one lease, and produced a matching SHA-256 result for the 137-byte scoped input.

An immediate replay of the identical request failed closed with
`REQUEST_ALREADY_CONSUMED`. It did not acquire a second lease or attempt a second operation.

## Chronology

- Claim: `2026-08-10T20:51:15.115Z`
- Lease acquired: `2026-08-10T20:51:15.117Z`
- Operation started: `2026-08-10T20:51:15.174Z`
- Operation completed: `2026-08-10T20:51:15.175Z`
- Lease released: `2026-08-10T20:51:15.176Z`

## Evidence

- Request SHA-256: `f336d53449797d917a299f3ddc65936b38c5f946250b5f989fb0f21ff4406ef4`
- Receipt SHA-256: `25fcc3218f777a51f8856a45eb94f3a25f7b2e7f3b844eab829d80565e4aede8`
- Stable scope SHA-256: `02ff047e9e0979527a43c64305256d75cf5897912e4b5581073006a1f9d1e8fb`
- Expected and observed input SHA-256: `8142d6c2154446cabc944c77dfe99c1e2c986985a03d33f4f841395de3747e14`
- Claim ID: `claim-dce2320e5b737d481de2bc69`
- Lease ID: `lease-0a542442964a45d907079864`
- Runner evidence SHA-256: `5ae228e950792cfe9926c2615b83f25a6fa47d45317ac7a3855d3ef1feef57ad`

Retained artifacts:

- `docs/reports/bounded-dispatch/WO-EF-DISPATCH-AEGIS-001-request.json`
- `docs/reports/bounded-dispatch/WO-EF-DISPATCH-AEGIS-001-receipt.json`
- `docs/reports/bounded-dispatch/WO-EF-DISPATCH-AEGIS-001-claim.json`
- `docs/reports/bounded-dispatch/WO-EF-DISPATCH-AEGIS-001-result.json`
- `docs/reports/bounded-dispatch/WO-EF-DISPATCH-AEGIS-001-release.json`
- `docs/reports/bounded-dispatch/WO-EF-DISPATCH-AEGIS-001-replay.json`

## Failed-Closed Precursor Evidence

Before the successful claim, two attempts stopped before execution:

1. `PLACEMENT_UNPROVEN` exposed platform-dependent receipt bytes. The receipt was regenerated
   on AEGIS from trusted Linux `main`; no claim was consumed.
2. `EVIDENCE_STALE` exposed expiration before claim. HERMES, ATLAS, and AEGIS evidence was
   refreshed and repinned; no claim was consumed.

Neither rejection acquired a runtime lease or attempted the operation. The contract was not
weakened to obtain the passing result.

## Safety Boundary

- Global scheduler: `OFF`
- Autonomous dispatch: `false`
- AEGIS general compute placement authority: `NOT GRANTED`
- AEGIS storage/NAS/backup authority: `NOT GRANTED`
- Network access by the bounded operation: `false`
- Shell execution by the bounded operation: `false`
- Workload or output storage mutation: `false`
- Registry or authority mutation: `false`
- Fallback execution: `false`
- TerraFusion, county, and PACS systems touched: `false`

This proof authorizes no successor execution. Any further real workload requires a separately
recorded bounded authority decision.
