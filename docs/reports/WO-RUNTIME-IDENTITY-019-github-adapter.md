# WO-RUNTIME-IDENTITY-019 - GitHub CLI Adapter

The adapter binds every operation to `bsvalues/terragroq`, requires the
sanitized active `bsvalues` keyring identity, exposes only issue/PR reads,
checks, PR creation, and gated R0/R1 squash merge. Merge requires green checks
and resolved threads. No generic CLI, settings, secrets, variables, workflows,
collaborators, release, tag, or other-repository operation exists.

Result: `PASS_GITHUB_ALLOWLIST`.
