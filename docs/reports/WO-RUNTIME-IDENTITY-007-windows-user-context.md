# WO-RUNTIME-IDENTITY-007 - Windows User-Context Runtime Decision

The identity-bearing runtime is restricted to William's expected,
non-elevated Windows user session. SYSTEM, service identities, administrators,
and unexpected users fail closed without recording a SID or full account name.
Codex and GitHub CLI remain native. Boot-time and logged-out operation are
deferred to Phase 2.

Result: `PASS_NATIVE_USER_CONTEXT`.
