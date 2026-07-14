# WO-MAO-001 - Terminal Local Adapter Quarantine

## Result

The rejected `local-nested-codex-exec` adapter is mechanically `QUARANTINED_TERMINAL`.
Changing the local activation file cannot dispatch this adapter.

## Executable state

- Issue #357 remains terminal with reason `CODEX_NETWORK_WALL` and is not retryable.
- Issue #358 remains dependent on #357 and cannot execute through the legacy adapter.
- Both legacy authority records are `REVOKED_TERMINAL`, with execution and retry disabled.
- The native supervisor checks quarantine before authentication readiness or kernel invocation.
- The operational kernel checks the same invariant before queue inspection, leasing, workspace creation,
  or provider dispatch, including direct kernel invocation.

## Owner revocation event boundary

No owner-signed revocation event was created or inferred in this Work Order. The registry records that
the event is required and pending. The supervisor accepts an optional verifier script that must return
exactly `OWNER_REVOCATION_EVENT=VERIFIED`; the kernel accepts a verifier callback that must return
`VERIFIED_REVOKED`. A successful verifier result corroborates revocation but cannot reactivate this
terminal adapter.

The separately implemented verifier must validate an immutable, append-only owner-signed event for
both legacy authority records and must not be writable by the coordinator or adapter. Until that
integration exists, quarantine remains fail-closed.

## Safety

- Runtime activation was not changed.
- Neither issue was executed, leased, relabeled, or retried.
- No credential, keyring, session, token, or raw provider output was read or recorded.
