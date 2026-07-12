# WO-RUNTIME-IDENTITY-022 - Cost, Rate, and Run Budgets

The runtime pins hourly/daily cycle counts, Codex calls, remediation attempts,
elapsed minutes, changed files, patch bytes, and rate-limit cooldown. Usage at
or above any ceiling returns a typed `BUDGET_EXHAUSTED_*` stop before a new
lease.

Result: `PASS_BOUNDED_CONSUMPTION`.
