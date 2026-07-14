# WO-MAO-001 - Terminal Local Adapter Quarantine

## Result

`COMPLETE / MECHANICAL_QUARANTINE_ENFORCED / NO_OWNER_OPERATION_REQUIRED`

The rejected `local-nested-codex-exec` adapter is mechanically `QUARANTINED_TERMINAL`, and changing
the local activation file cannot dispatch it. The recorded terminal program decision is sufficient to
keep this historical adapter non-selectable; William is not assigned a signing, activation, or host task.

## Executable state

- Issue #357 remains terminal with reason `CODEX_NETWORK_WALL` and is not retryable.
- Issue #358 remains dependent on #357 and cannot execute through the legacy adapter.
- Both legacy authority records are `REVOKED_TERMINAL`, with execution and retry disabled.
- The native supervisor checks quarantine before authentication readiness or kernel invocation.
- The operational kernel checks the same invariant before queue inspection, leasing, workspace creation,
  or provider dispatch, including direct kernel invocation.

## Authority and hardening boundary

Existing signed-event verification remains available as defense-in-depth and future certification
evidence. It is not a prerequisite that converts the already-recorded terminal decision into owner
clerical work. No successful verifier result can reactivate this adapter, and absence of a newly issued
event cannot make the terminal adapter selectable.

## Safety

- Runtime activation was not changed.
- Neither issue was executed, leased, relabeled, or retried.
- No credential, keyring, session, token, or raw provider output was read or recorded.

```text
OWNER_OPERATION_TOUCH_COUNT=0
OWNER_CREDENTIAL_TOUCH_COUNT=0
OWNER_DIAGNOSTIC_TOUCH_COUNT=0
OWNER_ROUTINE_DECISION_COUNT=0
OWNER_ROUTINE_CONTACT_COUNT=0
```
