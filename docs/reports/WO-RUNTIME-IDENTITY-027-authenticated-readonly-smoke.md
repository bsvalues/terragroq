# WO-RUNTIME-IDENTITY-027 - Authenticated Read-Only Smoke

Codex ChatGPT/keyring and GitHub browser/keyring readiness are proven through
sanitized adapters. Native identity and repository metadata reads pass. A
schema-bound Codex `NO_CHANGE` task against a disposable non-repository
snapshot is the final smoke proof; it creates no branch, issue, PR, comment,
merge, activation change, or raw credential.

Result: `BLOCKED_NESTED_CODEX_RUNTIME`. Status reads pass, but invoking a child
Codex CLI from an active Codex desktop task produced no schema result and left
the disposable working directory held by the desktop process. The active
desktop process was not terminated. Repeat the sanitized smoke from a separate
PowerShell session after Codex desktop is closed.
