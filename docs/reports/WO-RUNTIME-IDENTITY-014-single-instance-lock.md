# WO-RUNTIME-IDENTITY-014 - Single-Instance Lock and Host Lease

The native lock uses atomic `CreateNew`, PID plus process-start validation,
stale-lock recovery, and runtime-owned removal. A fixture proved a second
instance receives `ACTIVE_SUPERVISOR_LOCK` before work.

Result: `PASS_SINGLE_INSTANCE`.
