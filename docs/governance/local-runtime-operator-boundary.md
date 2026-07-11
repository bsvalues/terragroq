# Local Runtime Operator Boundary

Goal: `GOAL-RUNTIME-OPERATOR-LOCAL-FIRST-REMEDIATION-001`

## Host decision

The HP OMEN Docker runtime is the only authorized Phase 1 operator host.
GitHub remains the source repository, pull-request system, and CI validator. It
is not authorized to host the autonomous WilliamOS operator. A future change to
that boundary requires a new, explicit owner decision and cannot be inferred by
the portfolio resolver, `/goal`, or `/loop`.

The dedicated Ubuntu host is the Phase 2 migration target. It is not activated
by this goal.

## Phase 1 controls

- The container starts only through an owner-controlled local Compose command.
- The activation file must contain exactly `enabled`; the default is
  `disabled`.
- OpenAI and GitHub credentials are Docker secrets sourced from files under
  `%USERPROFILE%\.williamos\runtime-operator\secrets` on the OMEN.
- Credentials are never stored in the repository, GitHub Actions, checkpoints,
  issue comments, audit events, screenshots, or reports.
- The GitHub credential must be a fine-grained token limited to
  `bsvalues/terragroq` with Contents, Issues, and Pull requests read/write and
  Checks read. It must not grant Actions administration, repository
  administration, secrets administration, or access to other repositories.
- One serialized supervisor leases only policy-eligible R0/R1 Work Orders.
- Codex runs with a read-only sandbox and emits a schema-bound patch.
- Exact changed paths, secret scanning, tests, lint, and build gate publishing.
- Durable Docker volumes retain workspace, checkpoints represented on the
  issue, and append-only hash-chained JSONL audit events across restarts.
- `scripts/local/williamos-operator-stop.ps1` disables the activation file and
  stops the container immediately.

## Phase 2 migration

Move the same Compose contract and external secret directory to the dedicated
Ubuntu host. Rotate both credentials, re-establish least-privilege file
permissions, restore only the operator state/audit volumes, validate the kill
switch, and keep the OMEN instance disabled before activating Ubuntu. Do not
run both hosts concurrently.
