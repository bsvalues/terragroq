# WilliamOS Runtime Operator Program

Program: `PROGRAM-WILLIAMOS-LOCAL-IDENTITY-RUNTIME-001`

Supersedes:
`PROGRAM-WILLIAMOS-RUNTIME-OPERATOR-001`

Historical goal:
`GOAL-RUNTIME-OPERATOR-LOCAL-IDENTITY-001`

Historical loop:
`LOOP-RUNTIME-OPERATOR-LOCAL-IDENTITY-001`

Status: `REJECTED / TERMINAL / DISABLED / NON_SELECTABLE`.

Successor: `PROGRAM-WILLIAMOS-MULTI-AGENT-OPERATOR-001`.

## Terminal decision

Issue #357 ended `FAILED_TERMINAL` after bounded `CODEX_NETWORK_WALL`
attempts. It will not be retried. Issue #358 is dependency-blocked. The nested
local `codex exec` adapter, supervisor, and activation path are quarantined and
must not be renamed, wrapped, or reused as a prerequisite for hosted work.

William has no activation, login, smoke-test, diagnostic, or runtime-repair
task. Historical implementation and sanitized evidence are preserved only for
audit and rejected-architecture learning.

## Historical authority

The owner formerly authorized a bounded background operator hosted locally on
the HP OMEN. That program is now terminal and its authority is no longer an
executable route. GitHub may still provide source, issues, pull requests,
reviews, and CI validation for supported hosted agent work.

The superseded program is not active or selectable. Its earlier GitHub Actions
control-plane design is removed. No OpenAI credential may be added to GitHub.

Its later raw local secret-file design is also superseded. William is not
required to populate `openai_api_key` or `github_token`. Those empty
placeholder paths do not confer authority and may not be used for activation.

## Rejected runtime design record

Phase 1 uses the normal Windows user context on the HP OMEN:

- Codex CLI signs in through ChatGPT subscription access.
- Codex credentials must use the Windows credential store through
  `cli_auth_credentials_store = "keyring"`.
- GitHub CLI uses its browser login and system credential store.
- The identity-bearing supervisor runs natively under William's non-elevated
  Windows account.
- Docker may perform validation only and receives no authentication material.
- Activation remains disabled permanently for this adapter.

Canonical playbook:
`docs/governance/local-identity-runtime-operator-playbook.md`

## Owner operations

No operation is requested from the owner for this terminal program. A future,
materially different service architecture would require a new explicit owner
decision; it cannot reopen this adapter implicitly.

Credential values, cached auth files, token output, and browser data never enter
GitHub, Docker, repository evidence, prompts, logs, checkpoints, screenshots, or
reports.

## Standing Boundaries

The runtime is not authorized for PACS, county systems, protected data,
TerraFusion production, deployments, releases, tags, database/schema/data
mutation, secrets administration, permission changes, other repositories,
destructive operations, or autonomous scope expansion.

The dedicated Ubuntu host remains an inactive Phase 2 migration target.
