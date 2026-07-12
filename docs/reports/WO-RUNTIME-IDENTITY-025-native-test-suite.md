# WO-RUNTIME-IDENTITY-025 - Native Supervisor Test Suite

Contract and isolated PowerShell fixtures cover disabled start, identity/auth
walls, plaintext fallback, stale/duplicate locks, malformed checkpoints, stale
base, unsafe paths, secret environment/material, retry exhaustion, merge gates,
budget exhaustion, audit tampering, and idle state. Kill/crash transition drills
remain repeated in the post-activation recovery Work Order.

The native self-test writes and recovers every declared checkpoint state,
disables through each transition, rejects duplicate and recovers stale locks,
preserves malformed state, proves terminal retry and budget exhaustion, and
verifies stable idempotency. Static tests additionally cover identity/auth
walls, unsafe paths, secret material, stale base, merge gates, duplicate PR
reconciliation, and zero-work disabled idle.

Result: `PASS_PREACTIVATION_TEST_MATRIX`.
