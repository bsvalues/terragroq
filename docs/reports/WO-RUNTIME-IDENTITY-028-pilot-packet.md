# WO-RUNTIME-IDENTITY-028 - Pilot Work Order Packet

The canonical packet is
`runtime-operator/native/pilot-envelope.json`. It permits exactly one new
documentation evidence file, blocks runtime/auth/workflow/config/package and
product paths, requires diff/secret/evidence validation, has a one-file revert,
and derives idempotency from repository + WO + activation-time base SHA. It
contains no county, PACS, protected, or production data.

Result: `PREPARED_DEPENDENCY_BLOCKED` pending WOs 025–027.
