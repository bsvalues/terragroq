# Local Runtime Operator Runbook

## Provision disabled

```powershell
.\scripts\local\williamos-operator-provision.ps1
$env:WILLIAMOS_OPERATOR_HOME = "$env:USERPROFILE\.williamos\runtime-operator"
docker compose -f .\runtime-operator\compose.yaml config
```

Provisioning creates the external directory, a `disabled` activation file, and
zero-byte credential placeholders required for disabled Compose validation. It
does not create, discover, print, or validate credentials.

## Owner credential gate

The owner creates these two files manually on the OMEN:

```text
%USERPROFILE%\.williamos\runtime-operator\secrets\openai_api_key
%USERPROFILE%\.williamos\runtime-operator\secrets\github_token
```

Do not paste either value into Codex, a terminal transcript, GitHub, a report,
or a committed file. Restrict both files to the owner account. The OpenAI key
belongs only in the first file. The GitHub token must follow the least-privilege
permissions in the boundary document.

## Build and disabled proof

```powershell
.\scripts\local\williamos-operator-start.ps1
.\scripts\local\williamos-operator-status.ps1
```

With `activation` set to `disabled`, the audit log records `disabled` and the
container sleeps without contacting OpenAI or leasing work.

## Activate

After credential files and the pilot Work Order have been independently
verified, the owner writes exactly `enabled` to the activation file and starts
the service. This is a consequential owner action.

## Kill switch

```powershell
.\scripts\local\williamos-operator-stop.ps1
```

This writes `disabled` before stopping the container. Re-starting the container
cannot resume work until the owner explicitly restores `enabled`.
