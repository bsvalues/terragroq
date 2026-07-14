# WO-MAO-001 - Terminal Local Adapter Quarantine

## Result

`BLOCKED_OWNER_SIGNED_REVOCATION_EVENT / MECHANICAL_QUARANTINE_COMPLETE`

The rejected `local-nested-codex-exec` adapter is mechanically `QUARANTINED_TERMINAL`, and changing
the local activation file cannot dispatch it. WO-MAO-001 is not complete until the Owner independently
issues the two required signed legacy-revocation events in the owner-controlled local store.

## Executable state

- Issue #357 remains terminal with reason `CODEX_NETWORK_WALL` and is not retryable.
- Issue #358 remains dependent on #357 and cannot execute through the legacy adapter.
- Both legacy authority records are `REVOKED_TERMINAL`, with execution and retry disabled.
- The native supervisor checks quarantine before authentication readiness or kernel invocation.
- The operational kernel checks the same invariant before queue inspection, leasing, workspace creation,
  or provider dispatch, including direct kernel invocation.

## Owner revocation event boundary

No owner-signed revocation event was created or inferred in this Work Order. The registry records that
the event is required and pending. When activation is changed, the supervisor and direct kernel entry
point both require the same externally stored `legacy-revocation-events.json` and
`trusted-owner-keys.json` stream to verify as `VERIFIED_REVOKED` before ending at
`QUARANTINED_TERMINAL`. A successful verifier result corroborates revocation but cannot reactivate this
terminal adapter.

The verifier validates an immutable, append-only owner-signed event for both legacy authority records.
Until those owner-issued artifacts exist, the authority event gate and quarantine both remain
fail-closed.

## Safety

- Runtime activation was not changed.
- Neither issue was executed, leased, relabeled, or retried.
- No credential, keyring, session, token, or raw provider output was read or recorded.
