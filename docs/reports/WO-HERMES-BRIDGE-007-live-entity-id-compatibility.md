# WO-HERMES-BRIDGE-007 - Live Entity ID Compatibility

## Result

The reviewed recovery command reached the live PostgreSQL store while activation remained disabled,
then failed closed because the deployed `governance_event.entityId` column is an integer while the
checked-in schema declares text. Neither the database outcome nor durable bridge state changed.

## Correction

All Hermes governance-event identity comparisons normalize `entityId` to text. This is compatible
with both the deployed integer column and the current text schema and does not require a database or
schema migration.

## Safety

The runtime remains disabled until this correction is reviewed and merged. No secret value was
printed or inspected, no owner operation was requested, and issue #357 remains rejected.
