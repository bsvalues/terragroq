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
- Stable VS Code `1.132.0` is installed with official Remote SSH `0.124.0`, Remote SSH Editing
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
PATH. The installed `lab-status` entrypoint was resolved from that location and exercised successfully.
The current verified run reports `SYNC_OK`, operator blocker `NONE`, and exits `0`.

## Commands

- `lab-status`: concise Hermes, Atlas, backup, cross-node sync, and operator-blocker summary.
- `lab-hermes`: detailed read-only Hermes snapshot.
- `lab-atlas`: detailed read-only Atlas snapshot.
- `lab-containers`: read-only `docker ps` output from both hosts.
- `lab-backups`: bounded Atlas listing under common backup roots and the same strict cross-node sync
  receipt classifier used by `lab-status`.

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

Both aliases resolve to the intended hosts, and both accepted passwordless SSH during proof.

- Atlas: passwordless BatchMode SSH succeeds and returns hostname `atlas`.
- Hermes trust is proven: verbose client evidence shows the server accepts fingerprint
  `SHA256:yKY2L2DIR7KaYtgr4Vm5VXQrlzZmGk82GmU+2ARAWG8`; public-key authentication succeeds, hostname is
  `Hermes`, and the command exits `0`.

The verified `lab-status` reports both nodes reachable. Hermes evidence includes Docker `28.5.1`,
Ollama `0.32.5`, the RTX 3050, and disk status. Atlas evidence includes Docker `29.7.2`, successful
read-only Postgres/Redis/Mongo protocol probes, `641G` free of `685G`, and the latest observed
TerraFusion backup archive candidate by mtime under `/home/bs/backups`. Archive integrity/completeness
is not inferred from file presence. Cross-node status is now derived from the Atlas canonical
receipt, bound Hermes completed-task evidence, and the Windows scheduled-task state/result rather
than task result or receipt existence alone.

## Cross-node sync receipt truth

Atlas is the sole canonical durable receipt authority. Hermes executes and verifies both directions;
OMEN consumes the resulting evidence read-only.

- Atlas canonical receipt: `/home/bs/from-hermes/crossnode-sync-receipt.json`
- Hermes completed-task evidence: `D:\CrossNodeBackups\crossnode-sync-task-evidence.json`
- Scheduled task: `HermesCrossNodeBackupSync`
- Freshness threshold: 30 hours

One immutable UUID `run_id` must match in the Atlas receipt, both direction records, and Hermes task
evidence. Both directions must report `SHA256_PASS` with positive file counts. Hermes evidence must
contain the SHA-256 of the exact Atlas receipt bytes, and Task Scheduler must report state `Ready` and
result `0`. A receipt file alone is never success.

The public states are:

- `SYNC_OK`: the canonical receipt, both direction records, Hermes completed-task evidence, task
  result, hashes, `run_id`, and timestamps all validate, and the completion is no more than 30 hours
  old.
- `SYNC_STALE`: the evidence is otherwise a valid completed success but is older than 30 hours.
- `SYNC_FAILED`: an explicit failure, nonzero task result, incomplete evidence after publication,
  mismatch, malformed evidence, failed verification, or invalid ordering/binding exists.
- `SYNC_UNKNOWN`: no trustworthy canonical evidence exists from which to determine the state.

Windows Task Scheduler's observed `LastRunTime` is accepted only from five minutes before the bound
receipt start through five minutes after Hermes task-evidence completion. This accounts for the live
Windows observation being recorded after script completion while retaining a narrow fail-closed
binding. Exact receipt/task-evidence timestamps still have to match and be internally ordered.

Only `SYNC_OK` permits `lab-status` exit `0`. `SYNC_STALE`, `SYNC_FAILED`, and `SYNC_UNKNOWN` produce
`REQUIRED_EVIDENCE_INCOMPLETE` and exit `2`. `lab-backups` applies the same state and exit rule.

The live verified run used `run_id` `a14a4724-6fbe-4f5e-b91b-aef6dde55847`. It proved task result
`0`, both directions `SHA256_PASS`, 6 of 6 Atlas-to-Hermes files and 15 of 15 Hermes-to-Atlas files
matching by filename, size, and SHA-256, and installed `lab-status`/`lab-backups` exit `0`.

Hermes temporarily stopped accepting TCP connections after the initial proof while still responding
to ICMP. That condition recovered. Final passwordless SSH, tunnel, and VS Code Remote SSH proofs all
established fresh connections without changing any private key, password, firewall, or service
setting. Routine verification from a new OMEN terminal is:

```powershell
ssh -o BatchMode=yes hermes hostname
lab-status
lab-containers
lab-backups
```

Stable VS Code Remote SSH is proven end-to-end for Atlas and Hermes: the official resolver launched Windows
OpenSSH, connected to `atlas`, created its exec server, and installed/started the normal user-scoped
VS Code Server under `/home/bs/.vscode-server`. For Hermes it resolved the Windows platform, created
and cached the exec server, and installed the user-scoped server under `C:\Users\bs\.vscode-server`.
A fresh post-recovery proof with stable VS Code `1.132.0` parsed the Windows x64 server listener,
resolved `ssh-remote+hermes`, and created/cached its exec server.

## Browser and RDP truth

OMEN web-management URLs discovered during the initial LAN scan:

- Hermes Windows Device Portal: `http://192.168.1.154:50080/`
- Hermes Windows Device Portal TLS endpoint: `https://192.168.1.154:50443/`

Atlas port `9001` identifies Portainer Agent `2.39.5`, not a browser UI. Hermes Docker publishes Open
WebUI on `0.0.0.0:3000`, Portainer on `0.0.0.0:9000`, and Ollama on `0.0.0.0:11434`, but direct OMEN
LAN requests time out. The safe proven access path is a local-only tunnel:

```powershell
ssh -N -L 127.0.0.1:13000:127.0.0.1:3000 -L 127.0.0.1:19000:127.0.0.1:9000 -L 127.0.0.1:21434:127.0.0.1:11434 hermes
```

While it runs, bookmark Open WebUI at `http://127.0.0.1:13000/`, Portainer at
`http://127.0.0.1:19000/`, and the Ollama API at `http://127.0.0.1:21434/`. Each endpoint returned
HTTP 200 during the transient proof, then the exact tunnel process was stopped. No current lab
monitoring service was found. Port `8080` is legacy EDB PEM Apache, and ports `50080`/`50443` are
Windows web management; neither is represented as the current operational radar.

The tunnel endpoints were revalidated after Hermes recovered: Open WebUI, Portainer, and Ollama each
returned HTTP `200`; Ollama reported version `0.32.5`. The exact proof tunnel was then stopped and all
three OMEN loopback ports were released.

OMEN has `mstsc.exe`; Hermes TCP/3389 was reachable during initial discovery and temporarily became
unreachable with the broader recovered TCP outage. RDP is potentially useful for exceptional Windows GUI
administration, but login/usefulness was not tested and it is not required for normal lab operation.
