# WilliamOS Runtime Operator Program

Program: `PROGRAM-WILLIAMOS-RUNTIME-OPERATOR-001`

Corrective program:
`PROGRAM-WILLIAMOS-LOCAL-IDENTITY-RUNTIME-001`

Active goal:
`GOAL-RUNTIME-OPERATOR-LOCAL-IDENTITY-001`

Active loop:
`LOOP-RUNTIME-OPERATOR-LOCAL-IDENTITY-001`

Status: runtime disabled; local-identity remediation required before activation.

## Authority

The owner authorized a bounded background operator hosted locally on the HP
OMEN. GitHub Actions is prohibited as the autonomous runtime host unless a
future owner decision names that host explicitly. GitHub may provide source,
issues, pull requests, reviews, and CI validation.

The earlier GitHub Actions control-plane design is removed. No OpenAI
credential may be added to GitHub.

The later raw local secret-file design is also superseded. William is not
required to populate `openai_api_key` or `github_token`. Those empty
placeholder paths do not confer authority and may not be used for activation.

## Corrective Runtime Contract

Phase 1 uses the normal Windows user context on the HP OMEN:

- Codex CLI signs in through ChatGPT subscription access.
- Codex credentials must use the Windows credential store through
  `cli_auth_credentials_store = "keyring"`.
- GitHub CLI uses its browser login and system credential store.
- The identity-bearing supervisor runs natively under William's non-elevated
  Windows account.
- Docker may perform validation only and receives no authentication material.
- Activation remains disabled until the corrective playbook reaches its
  explicit owner activation gate.

Canonical playbook:
`docs/governance/local-identity-runtime-operator-playbook.md`

## Owner-Only Actions

Owner authority is required only for:

- interactive `codex login`;
- interactive `gh auth login`;
- changing the local activation switch;
- credential revocation or reauthentication;
- physical or elevated administration of the OMEN;
- any future Phase 2 host or service-identity decision.

Credential values, cached auth files, token output, and browser data never enter
GitHub, Docker, repository evidence, prompts, logs, checkpoints, screenshots, or
reports.

## Standing Boundaries

The runtime is not authorized for PACS, county systems, protected data,
TerraFusion production, deployments, releases, tags, database/schema/data
mutation, secrets administration, permission changes, other repositories,
destructive operations, or autonomous scope expansion.

The dedicated Ubuntu host remains an inactive Phase 2 migration target.
