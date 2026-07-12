# WO-RUNTIME-IDENTITY-013 - Activation and Kill Switch

Only exact, case-sensitive `enabled` activates. Missing, malformed, or error
states resolve to disabled. Stop writes `disabled` before validating and
terminating the runtime-owned process, then stops the inert Docker proof host.
Status is read-only and remote state cannot alter activation.

Result: `PASS_DISABLED_FIRST_KILL_SWITCH`.
