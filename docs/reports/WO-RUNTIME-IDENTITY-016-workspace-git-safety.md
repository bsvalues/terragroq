# WO-RUNTIME-IDENTITY-016 - Workspace and Git Safety

Runtime work uses a verified `bsvalues/terragroq` origin and a detached,
runtime-owned worktree keyed by WO and 40-character base SHA. Existing user
worktree dirt is classified, never reset or cleaned. Force push, tags,
releases, submodules, and cleanup outside the runtime root have no adapter.

Result: `PASS_WORKSPACE_ISOLATION`.
