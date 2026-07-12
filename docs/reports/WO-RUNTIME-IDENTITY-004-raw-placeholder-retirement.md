# WO-RUNTIME-IDENTITY-004 - Raw Credential Placeholder Retirement

- Provisioning no longer creates raw credential placeholders.
- Zero-byte legacy files are removed using metadata only.
- Any non-empty legacy file or directory returns
  `MIGRATION_WALL_NONEMPTY_LEGACY_CREDENTIAL` without reading or printing it.
- Compose and the frozen supervisor have no credential mount or environment
  contract.
- The Docker image contains neither Codex CLI nor GitHub CLI and cannot become
  an identity host.
- The obsolete local cycle entry point is removed.

Result: `PASS_RAW_CREDENTIAL_CONTRACT_RETIRED`.
