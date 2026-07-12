# WO-RUNTIME-IDENTITY-002 - Credential-Custody Failure Record

Credential custody and operator-host selection are separate owner authority
decisions. Neither may be inferred from authorization to build a bounded
operator.

| Custody model | Classification | Reason |
| --- | --- | --- |
| GitHub secret custody | prohibited | Gives the cloud CI host custody and recreates the unauthorized host boundary. |
| Raw local file custody | prohibited | Leaves owner-managed bearer material available to processes and Docker mounts. |
| OS keyring custody | authorized contract, owner login pending | Keeps identity under William's native, non-elevated Windows account and system credential store. |
| Runtime identity | native Windows only | Codex and GitHub CLI authenticate as William; Docker receives no identity. |

The executable resolver now represents credential custody explicitly. Raw
GitHub and raw local-file custody are non-selectable. Native Windows plus
keyring is the only Phase 1 contract, and interactive login remains an owner
gate.

No credential value, prefix, cache, environment dump, screenshot, or secret
inventory was inspected or recorded.

Result: `PASS_GOVERNED_CUSTODY`.
