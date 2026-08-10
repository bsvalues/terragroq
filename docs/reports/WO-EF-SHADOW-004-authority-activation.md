# WO-EF-SHADOW-004 authority activation

Issue: `#538`

This activation is separate from the reviewed scope packet merged at
`b1a275e62349d02d00557fbb853f53ae38fe497a`.

## Exact binding

- Scope contract: `config/execution-fabric/shadow-authority-scopes/WO-EF-SHADOW-004.json`
- Scope contract SHA-256: `21abaac4676e1f58bdf7a3da6601eae6ef592548549e1440ec93ace1330260f8`
- Authority reference: `issue-538-phase2-shadow-004`
- Work Order: `WO-EF-SHADOW-004`
- Allowed node: `hermes-node`
- Valid from: `2026-08-10T15:20:00.000Z`
- Expires at: `2026-08-11T03:20:00.000Z`
- Reviewed scope commit: `b1a275e62349d02d00557fbb853f53ae38fe497a`

This activation must merge before `valid_from`. It authorizes only the exact one-call, 60-second,
operator-selected local proof defined in the reviewed scope contract. It does not activate a
scheduler, autonomous dispatch, an Agent Forge runtime, a worker loop, or external-provider access.
No receipt may be retained and no execution may begin before both the merge and `valid_from`.
