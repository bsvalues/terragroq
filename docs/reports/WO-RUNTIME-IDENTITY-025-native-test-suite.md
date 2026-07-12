# WO-RUNTIME-IDENTITY-025 - Native Supervisor Test Suite

Contract and isolated PowerShell fixtures cover disabled start, identity/auth
walls, plaintext fallback, stale/duplicate locks, malformed checkpoints, stale
base, unsafe paths, secret environment/material, retry exhaustion, merge gates,
budget exhaustion, audit tampering, and idle state. Kill/crash transition drills
remain repeated in the post-activation recovery Work Order.

Result: `IN_PROGRESS`. Static and isolated fixtures pass; kill-at-every-state,
crash/restart, and duplicate publication drills remain required before this WO
can close.
