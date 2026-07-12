# WO-RUNTIME-IDENTITY-003 - Inert Docker Operator Freeze

The legacy Docker identity host is frozen as
`SUPERSEDED_IDENTITY_HOST / DISABLED`.

- The supervisor never leases, invokes Codex, authenticates, publishes, or
  retries work.
- Every activation input is ignored; the process records superseded status and
  sleeps indefinitely.
- Restart cannot bypass the freeze.
- Compose mounts only the non-secret activation marker and requires no
  credential file to prove disabled state.
- The container remains available only as evidence while Docker is reduced to
  a validation-only boundary.

Result: `PASS_INERT_FREEZE`.
