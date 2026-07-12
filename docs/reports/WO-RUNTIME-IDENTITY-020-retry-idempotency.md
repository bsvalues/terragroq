# WO-RUNTIME-IDENTITY-020 - Retry, Recovery, and Idempotency

Stable SHA-256 idempotency keys bind repository, WO, and base SHA. Authority,
authentication, scope, and secret failures never retry. Recoverable retries
stop at the configured ceiling, and checkpoints define restart state before
any future write reconciliation.

Result: `PASS_IDEMPOTENCY_POLICY`.
