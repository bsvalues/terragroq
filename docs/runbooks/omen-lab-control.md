# OMEN lab-control runbook

Work Order: `WO-OMEN-COCKPIT-001`

## Boundary

OMEN is the cockpit. These commands perform bounded, read-only SSH probes against `hermes` and
`atlas`. They do not start or stop services, change Docker, mutate data, modify backups, copy source,
or disable host-key checking. Every SSH call uses `BatchMode=yes`, a five-second connect timeout, one
connection attempt, and bounded server-alive settings.

## Current OMEN truth (2026-08-07)

- Host: `OMEN`, HP OMEN Gaming Laptop 16-ap0xxx.
- OS: Microsoft Windows 11 Home, version `10.0.26200`, build `26200.8973`, x64, DisplayVersion `25H2`.
- LAN: Ethernet 2 IPv4 `192.168.1.157`.
- PowerShell: `7.6.4`; OpenSSH: `9.5p2`; Git: `2.55.0`; GitHub CLI: `2.89.0`.
- GitHub CLI is authenticated as `bsvalues` with Git operations configured for SSH.
- VS Code Insiders `1.129.0` is installed. Official Remote SSH `0.124.0`, Remote SSH Editing
  Configuration `0.87.0`, and Remote Explorer `0.5.0` are installed.
- Existing SSH aliases already map `hermes` to `bs@192.168.1.154` and `atlas` to
  `bs@192.168.1.156`, using `~/.ssh/id_ed25519`, `IdentitiesOnly yes`, and the default
  `StrictHostKeyChecking ask`. Do not replace the useful existing config with the included example.
- Existing public-key fingerprint offered for installation:
  `SHA256:yKY2L2DIR7KaYtgr4Vm5VXQrlzZmGk82GmU+2ARAWG8`.

## Install the commands

From this repository in PowerShell:

```powershell
pwsh -NoProfile -File .\scripts\lab-control\install-lab-control.ps1
```

The installer copies only its managed command files to
`%LOCALAPPDATA%\WilliamOS\LabControl\bin` and appends that directory to the user PATH only when it is
absent. It refuses to overwrite a changed managed file unless `-Force` is explicitly supplied. Open a
new terminal after the first install. For a review-only install:

```powershell
pwsh -NoProfile -File .\scripts\lab-control\install-lab-control.ps1 -WhatIf
```

The repository also contains `ssh_config.example` as a review aid. Merge entries; never replace the
whole SSH config.

On OMEN, the managed files are installed at
`C:\Users\bsval\AppData\Local\WilliamOS\LabControl\bin`, and that directory is present in the user
PATH. The installed `lab-status` entrypoint was resolved from that location and exercised successfully;
it exits `2` while the current SSH authorization blocker remains.

## Commands

- `lab-status`: concise Hermes, Atlas, backup, cross-node sync, and operator-blocker summary.
- `lab-hermes`: detailed read-only Hermes snapshot.
- `lab-atlas`: detailed read-only Atlas snapshot.
- `lab-containers`: read-only `docker ps` output from both hosts.
- `lab-backups`: bounded Atlas listing under common backup roots and explicit cross-node marker truth.

For `lab-status`, exit code `0` additionally requires all mandatory fields to carry usable evidence:
Hermes Docker/Ollama/GPU/disk, Atlas Docker/disk, protocol-level Postgres/Redis/Mongo probes, latest
backup, and cross-node sync. Reachable SSH with an `UNKNOWN`, unavailable, not-found, or unaccepted
service-evidence value exits `2` with `REQUIRED_EVIDENCE_INCOMPLETE`; it cannot false-green. Other
commands use exit code `0` when their required SSH operation completes and `2` for a typed blocker.

Atlas service lines are deliberately labeled **evidence**, not authoritative state inferred from a
loose container name. Postgres uses `pg_isready`; Redis uses `redis-cli ping` and distinguishes an
authentication-required reachable server; Mongo uses `mongosh` ping. Explicit Docker published-port
matches and container health, when present, appear as supplemental evidence in `lab-atlas`. A TCP
listener alone is reported as `TCP_LISTENER_ONLY` and does not satisfy green status.

The Atlas backup probe aggregates candidates from every known backup root, sorts the combined set by
mtime, and only then selects the global newest file. The path is preserved after its timestamp field,
including embedded spaces. No Linux probe was executed locally on OMEN; tests decode and inspect the
actual UTF-8 shell payload sent to the external SSH boundary.

## Current SSH blocker

Both targets accept TCP/22, and both aliases resolve to the intended hosts. Noninteractive SSH fails:

- Hermes: `Permission denied (publickey,password,keyboard-interactive).`
- Atlas: `Permission denied (publickey,password).`

`lab-status` therefore reports both as `SSH_AUTH_BLOCKED`, leaves remote service and backup fields
`UNKNOWN`, emits a clear `operator blocker`, and exits `2`. The public key matching the fingerprint
above must be authorized on both remote accounts by the separately authorized Hermes/Atlas lane. This
is routine operator work, not owner action. No private key, password, or secret belongs in this
repository.

After that remote-side authorization, verify from a new OMEN terminal:

```powershell
ssh hermes hostname
ssh atlas hostname
lab-status
lab-containers
lab-backups
```

Then use VS Code Insiders: **Remote-SSH: Connect to Host...** and select `hermes` or `atlas`. The
extension side is ready; connection proof is blocked on the same SSH authorization.

## Browser and RDP truth

Verified reachable OMEN URLs:

- Hermes Windows Device Portal: `http://192.168.1.154:50080/`
- Hermes Windows Device Portal TLS endpoint: `https://192.168.1.154:50443/`

Certificate/authentication usability was not proven. Atlas port `9001` identifies Portainer Agent
`2.39.5`, not a browser UI. No reachable Portainer UI, Open WebUI, Ollama HTTP endpoint, or common
monitoring/status URL was discovered, so none is guessed here.

OMEN has `mstsc.exe` and Hermes TCP/3389 is reachable. RDP is potentially useful for exceptional
Windows GUI administration, but login/usefulness was not tested and it is not required for normal
lab operation.
