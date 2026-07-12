# Local Runtime Operator Boundary

Goal: `GOAL-RUNTIME-OPERATOR-LOCAL-IDENTITY-001`

Canonical playbook:
`docs/governance/local-identity-runtime-operator-playbook.md`

## Host Decision

The HP OMEN is the only authorized Phase 1 operator host. GitHub remains the
source repository, pull-request system, and CI validator. It is not authorized
to host the autonomous WilliamOS operator.

The Phase 1 identity-bearing runtime executes natively under William's normal,
non-elevated Windows user account. This is required because Codex and GitHub
authentication are held by the operating-system credential store for that user.

Docker is validation-only. It may receive repository content and validation
commands, but it may not receive OpenAI or GitHub credentials, auth caches,
browser state, environment tokens, credential-store access, or activation
authority.

The dedicated Ubuntu host is the Phase 2 migration target. It is not activated
by this goal.

## Phase 1 Controls

- Activation defaults to `disabled` and can be changed only by William.
- Codex CLI uses ChatGPT login with `forced_login_method = "chatgpt"`.
- Codex CLI uses `cli_auth_credentials_store = "keyring"`.
- GitHub CLI uses its browser flow and the system credential store.
- No `OPENAI_API_KEY`, `GH_TOKEN`, `GITHUB_TOKEN`, PAT file, copied
  `auth.json`, Docker secret, or repository secret is accepted.
- The runtime refuses plaintext fallback.
- The supervisor refuses SYSTEM, administrator, service-account, or unexpected
  user contexts.
- Phase 1 may start at user logon, not at boot without login.
- One serialized supervisor leases only registered, policy-eligible R0/R1 Work
  Orders.
- Exact changed paths, secret scanning, tests, lint, build, checks, and review
  gates remain mandatory.
- Durable local state and append-only sanitized audit evidence survive restart.
- The kill switch disables activation before terminating work.
- Remote issues, PRs, prompts, and portfolio decisions cannot activate the
  operator.

## Owner Gates

Owner-only actions are:

1. complete `codex login` locally;
2. complete `gh auth login` locally;
3. verify both identities use secure storage;
4. explicitly enable or disable activation;
5. revoke or renew authentication;
6. administer the physical host or approve elevation.

The runtime must never ask William to paste a token or key into a file, terminal
transcript, issue, PR, report, chat, or Docker secret.

## Phase 2 Migration

Phase 2 requires a new owner decision covering service identity, boot-time
operation, Linux credential storage, rotation, backup, and single-active-host
enforcement. The OMEN must be disabled before any Ubuntu activation. No auth
cache or raw credential may be copied between hosts under this goal.
