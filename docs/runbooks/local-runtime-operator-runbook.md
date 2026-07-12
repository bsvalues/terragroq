# Local Runtime Operator Runbook

Status: redesign in progress; activation prohibited.

Canonical playbook:
`docs/governance/local-identity-runtime-operator-playbook.md`

## Immediate Safe State

- Leave activation `disabled`.
- Do not populate `openai_api_key` or `github_token`.
- Do not add `OPENAI_API_KEY` or any other operator credential to GitHub.
- Do not copy Codex auth caches or GitHub tokens into Docker.
- Do not start the identity-bearing Docker operator.

The existing credential placeholders were created empty. They are superseded
and do not need values.

## Current Status

```powershell
.\scripts\local\williamos-operator-status.ps1
```

Status inspection must not change activation or display credential values,
environment dumps, browser state, or auth-cache contents.

## Current Kill Switch

```powershell
.\scripts\local\williamos-operator-stop.ps1
```

This writes `disabled` before stopping the existing container. Use it whenever
runtime state is uncertain.

## Corrective Authentication Target

The corrective implementation will use two interactive local sign-ins:

```powershell
codex login
gh auth login --hostname github.com --git-protocol https
```

Do not run these until their corresponding Work Orders are implemented and the
status adapter is ready. William completes both browser flows personally.

Codex must be configured to require ChatGPT login and Windows keyring storage.
GitHub CLI must confirm secure credential-store use. Plaintext fallback is a
stop condition.

The runtime will verify readiness with:

```powershell
codex login status
gh auth status --hostname github.com
```

Only readiness and authentication method may enter evidence. Tokens, fragments,
cache files, environment variables, and full transcripts may not.

## Native Runtime Target

The identity-bearing supervisor will run under William's normal non-elevated
Windows account. Docker may run validation only and receives no authentication
material.

Phase 1 may be scheduled at user logon. It may not run as SYSTEM, administrator,
another user, or a boot-time service without a new owner decision.

## Activation

Activation remains unavailable until
`WO-RUNTIME-IDENTITY-001` through `WO-RUNTIME-IDENTITY-028` pass and William
completes `WO-RUNTIME-IDENTITY-029`.

No remote command, issue, PR, portfolio result, or Codex output may enable it.

## Recovery

If any instruction asks for a key, PAT, token file, copied `auth.json`, Docker
secret, GitHub secret, or environment token:

1. keep activation disabled;
2. stop the operator;
3. record a sanitized architecture failure;
4. return to the active Work Order;
5. do not paste or create the credential.
