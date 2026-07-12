# Local Runtime Operator Runbook

Status: redesign in progress; activation prohibited.

Canonical playbook:
`docs/governance/local-identity-runtime-operator-playbook.md`

## Immediate Safe State

- Leave activation `disabled`.
- Run `williamos-operator-provision.ps1` to retire zero-byte legacy
  placeholders. A non-empty legacy path stops at a migration wall and is never
  read, printed, moved, or deleted automatically.
- Do not add `OPENAI_API_KEY` or any other operator credential to GitHub.
- Do not copy Codex auth caches or GitHub tokens into Docker.
- Do not start the identity-bearing Docker operator.

The legacy credential placeholders are superseded and must not exist after
safe retirement.

## Current Status

```powershell
.\scripts\local\williamos-operator-status.ps1
```

Status inspection must not change activation or display credential values,
environment dumps, browser state, or auth-cache contents.

## Current and Target Kill Switch

The mandatory order is:

1. write exactly `disabled` to the local activation file;
2. stop the native WilliamOS supervisor process;
3. disable and stop its at-logon scheduled task when installed;
4. stop the legacy Docker identity supervisor or validation container if it is
   running;
5. verify no runtime-owned child `codex`, `gh`, Git, npm, or Docker process
   remains.

Until the native supervisor Work Orders are implemented, use:

```powershell
.\scripts\local\williamos-operator-stop.ps1
```

The corrective implementation must extend this command to perform the native
process/task termination above while preserving disable-before-terminate.
Use it whenever runtime state is uncertain.

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
2. stop the native supervisor, scheduled task, child processes, and any legacy
   Docker operator;
3. if any credential may have been copied or exposed, revoke the affected Codex
   or GitHub identity through the official provider UI;
4. preserve sanitized evidence only—never the value, fragment, cache, browser
   state, environment dump, or full auth transcript;
5. record the architecture or exposure failure;
6. refuse automatic resumption;
7. return to the active Work Order and require a new owner login/revocation
   gate;
8. do not paste or create the credential.
