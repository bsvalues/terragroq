# OMEN lab-control runbook

Work Order: `WO-OMEN-COCKPIT-001`

## Boundary

OMEN is the cockpit. These commands perform bounded, read-only SSH probes against `hermes` and
`atlas`. They do not start or stop services, change Docker, mutate data, modify backups, copy source,
or disable host-key checking. Every SSH call uses `BatchMode=yes`, a five-second connect timeout, one
connection attempt, and bounded server-alive settings.

## Current OMEN truth (refreshed 2026-08-08)

- Host: `OMEN`, HP OMEN Gaming Laptop 16-ap0xxx.
- OS: Microsoft Windows 11 Home, version `10.0.26200`, build `26200.8973`, x64, DisplayVersion `25H2`.
- LAN: Ethernet 2 IPv4 `192.168.1.157`.
- PowerShell: `7.6.4`; OpenSSH: `9.5p2`; Git: `2.55.0`; GitHub CLI: `2.89.0`.
- GitHub CLI is authenticated as `bsvalues` with Git operations configured for SSH.
- Stable VS Code `1.131.0` is installed with official Remote SSH `0.124.0`, Remote SSH Editing
  Configuration `0.87.0`, and Remote Explorer `0.5.0`. Its SSH path is explicitly set to Windows
  OpenSSH, with `hermes=windows` and `atlas=linux` platform mappings. VS Code Insiders remains
  installed, but its current product/extension combination is not the proven Remote SSH surface.
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
authentication-required reachable server; Mongo uses `mongosh` ping. If those clients are not present
on Atlas, the probe runs the same read-only client checks inside the explicitly port-mapped container.
Docker published-port matches and container health appear as supplemental evidence in `lab-atlas`.
A TCP listener alone is reported as `TCP_LISTENER_ONLY` and does not satisfy green status.

The Atlas backup probe includes the observed lab-backup root `/home/bs/backups`, excludes the generic
OS package-backup directory `/var/backups`, aggregates candidates from every configured lab root, and
only then selects the global newest file. It formats the selected epoch with `date`, so unsupported
`find` timezone directives cannot leak into the result. The path is preserved after its timestamp
field, including embedded spaces. Tests decode and inspect the actual UTF-8 shell payload sent to the
external SSH boundary.

## Current SSH state

Both targets accept TCP/22, and both aliases resolve to the intended hosts.

- Atlas: passwordless BatchMode SSH succeeds and returns hostname `atlas`.
- Hermes: BatchMode SSH still returns `Permission denied (publickey,password,keyboard-interactive).`
  Verbose client evidence shows OMEN offers fingerprint
  `SHA256:yKY2L2DIR7KaYtgr4Vm5VXQrlzZmGk82GmU+2ARAWG8`, but Hermes never accepts it.

The installed `lab-status` therefore reports Hermes as `SSH_AUTH_BLOCKED` and Atlas as reachable,
emits a clear operator blocker, and exits `2`. Atlas evidence includes Docker `29.7.2`, successful
read-only Postgres/Redis/Mongo protocol probes, `641G` free of `685G`, and the latest observed
TerraFusion backup archive candidate by mtime under `/home/bs/backups`. Archive integrity/completeness
is not inferred from file presence. Cross-node sync evidence remains `UNKNOWN`.
Hermes server-side key acceptance belongs to the separately authorized Hermes lane. No private key,
password, or secret belongs in this repository.

After that remote-side authorization, verify from a new OMEN terminal:

```powershell
ssh -o BatchMode=yes hermes hostname
lab-status
lab-containers
lab-backups
```

Stable VS Code Remote SSH is proven end-to-end for Atlas: the official resolver launched Windows
OpenSSH, connected to `atlas`, created its exec server, and installed/started the normal user-scoped
VS Code Server under `/home/bs/.vscode-server`. Hermes resolution is configured but cannot complete
until the same plain-SSH authorization blocker is cleared.

## Browser and RDP truth

Verified reachable OMEN URLs:

- Hermes Windows Device Portal: `http://192.168.1.154:50080/`
- Hermes Windows Device Portal TLS endpoint: `https://192.168.1.154:50443/`

Certificate/authentication usability was not proven. Atlas port `9001` identifies Portainer Agent
`2.39.5`, not a browser UI. No reachable Portainer UI, Open WebUI, Ollama HTTP endpoint, or common
monitoring/status URL was discovered, so none is guessed here. Localhost-vs-LAN binding and safe SSH
tunnel discovery on Hermes remain blocked by Hermes SSH authentication; no firewall or service
exposure was changed.

OMEN has `mstsc.exe` and Hermes TCP/3389 is reachable. RDP is potentially useful for exceptional
Windows GUI administration, but login/usefulness was not tested and it is not required for normal
lab operation.
