# Hermes-to-Codex Live Bridge

Status: owner-authorized, bounded resident worker; current host liveness verified separately

## Purpose

The Hermes bridge consumes newly persisted, WilliamOS-native R0/R1 owner
outcomes and delegates one fenced execution at a time to the supported Codex
App Server protocol. Codex performs the bounded repository lifecycle while
Hermes retains policy, lease, checkpoint, kill-switch, and verification
authority.

This bridge is separate from the terminal adapter recorded in issue `#357`.
It does not invoke `codex exec`, import `scripts/runtime-operator/**`, copy an
authentication cache, inspect a credential, or place an API key or GitHub token
in the repository.

## Host Boundary

- Host: William's native, non-elevated Windows account on the HP OMEN.
- Identity: the existing Codex ChatGPT keyring and GitHub CLI system credential
  store; neither is mounted into Docker or copied into bridge state.
- Transport: Codex App Server JSON-RPC over a per-cycle stdio child process.
- Supervisor: current-user Windows Task Scheduler, one instance at a time.
- Persistence: local atomic JSON state under
  `~/.williamos/hermes-bridge/state`, outside the repository.

## Standing Authority

Only outcomes created after the local authority timestamp are selectable. The
standing grant covers repository `bsvalues/terragroq`, actor `bsvalues`, lanes
`docs`, `ui`, and `read_model`, risk `low` / R0 / R1, and authority A0-A2.
`requires_approval` outcomes inside that exact envelope may proceed under the
recorded standing owner authorization; this does not generalize to any other
lane or authority.

Every dispatch receives an owned `codex/hermes-*` branch and an isolated
worktree outside the primary checkout. State transitions use exclusive atomic
writes, idempotency keys, renewable leases, and fencing tokens. A restarted
cycle may adopt only the exact worktree path and branch recorded in its prior
checkpoint.

## Fail-Closed Rules

The bridge refuses external product scope, TerraFusion, TerraPilot, Property
Workbench, county/PACS or protected data, production mutation or deployment,
secrets and credential work, paid actions, destructive Git, releases, tags,
and any mention or reuse of issue `#357`.

Codex runs with `approvalPolicy=never`, a workspace-write sandbox restricted to
the owned worktree, and network access for the authorized GitHub/CI lifecycle.
Any approval request, user-input request, changed path outside the lane
reservation, unresolved review thread, failed check, missing merge evidence,
or origin/main mismatch becomes a typed wall.

The owner is never asked for routine Git, GitHub, test, CI, review, retry,
diagnostic, or restart work.

## Controls

```powershell
# Install disabled (default).
.\scripts\hermes-bridge\install-supervisor.ps1

# Independent read-only transport proof.
npm run hermes:smoke

# Owner-authorized activation.
.\scripts\hermes-bridge\install-supervisor.ps1 -Enable

# Immediate kill switch.
.\scripts\hermes-bridge\kill.ps1
```

The activation file is
`~/.williamos/hermes-bridge/control/activation`. `disabled` is fail-safe. The
supervisor checks every five minutes and remains silent when no eligible owner
outcome exists.

The kill switch first disables dispatch and stops the scheduled task. It then
reads the durable active lease, validates that the recorded holder PID is the
Node process running the absolute repository `scripts/hermes-bridge/cli.mjs`
`cycle` command, and stops only that verified process tree. A PID or command
mismatch fails closed instead of terminating an unrelated process.

## Certification

Infrastructure tests and a read-only App Server handshake are prerequisites,
not completion. The bounded lifecycle was certified by two ordinary-language
WilliamOS product outcomes:

- `GOAL-0001` reached merged PR `#440` at
  `c01751e3d0717952e93c550dfbbc2f7c3672cd2a`.
- Supervisor validation-isolation remediation reached merged PR `#445` at
  `6b37ceafbfd4b7d9443d09e86efa56fb8345bbc0`.
- `GOAL-0002` reached exact-head Codex review, green Vercel verification, and
  merged PR `#446` at `d4db455eefaecc2413668b9949f51a7a1e4130a7`.

Both outcome PRs record owner touch count `0` and blocked-scope crossing
`false`. This proves the bounded resident Hermes-to-Codex lifecycle; it does
not prove current host liveness, unrestricted autonomy, or authority outside
the standing WilliamOS-native R0/R1 envelope.
