# WO-MAO-016 - Work-Order Envelope v2

## Verdict

`COMPLETE / STRICT_PROVIDER_NEUTRAL_ENVELOPE_V2_PROVEN`

The mandatory Work Order packet is now an executable, canonical validation contract. It reuses the
Phase 1 dispatch-envelope validator for repository, base-ref, dependency, role, provider, reservation,
action, review, retry, remediation, reroute, and merge-policy semantics. The v2 contract adds an exact
artifact boundary, final-only communication, all five zero-owner budgets, recorded-authority evidence,
and required owner-counter evidence.

## Delivered artifacts

- `scripts/multi-agent-operator/work-order-envelope-v2.mjs`
- `scripts/multi-agent-operator/work-order-envelope-v2-cli.mjs`
- `tests/multi-agent-work-order-envelope-v2.test.ts`

The validator rejects missing and unknown fields, unsupported versions, contradictory provider or
role declarations, unsafe path reservations, privileged zero-owner actions, absent authority
references, absent owner-counter evidence, nonzero owner budgets, and `ANY` fan-in with no dependency.
Set-like fields are normalized before a SHA-256 content hash is produced.

Success is validation-only and explicitly records:

```text
validationOnly=true
dispatchPerformed=false
authorityGranted=false
communicationPolicy=FINAL_ONLY
```

## Authority and claim boundary

Packet fields describe and constrain authority; they do not create it. The contract requires a
recorded authority reference but does not resolve grants, claim reservations, lease a worker, contact
a provider, write GitHub state, or dispatch work. Those are later Work Orders.

## Validation

- focused Vitest: `2` files and `32` tests passed across WO-MAO-016/017;
- scoped ESLint: passed for all four implementation files and both test files;
- Node syntax checks: passed for all four executable modules;
- `git diff --check`: passed.

## Owner evidence

```text
OWNER_OPERATION_TOUCH_COUNT=0
OWNER_CREDENTIAL_TOUCH_COUNT=0
OWNER_DIAGNOSTIC_TOUCH_COUNT=0
OWNER_ROUTINE_DECISION_COUNT=0
OWNER_ROUTINE_CONTACT_COUNT=0
```
