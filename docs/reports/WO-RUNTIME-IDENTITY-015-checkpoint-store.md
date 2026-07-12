# WO-RUNTIME-IDENTITY-015 - Durable Checkpoint Store

Checkpoints use schema version 1, the declared state vocabulary, required
lineage fields, temporary-file atomic replacement, and explicit prohibited
field gates. Corruption is preserved and fails closed. A local isolated
fixture proved write/read recovery without credential material.

Result: `PASS_DURABLE_CHECKPOINT`.
