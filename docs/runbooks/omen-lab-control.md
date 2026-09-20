# WilliamOS lab-control runbook

Work Order: `WO-OMEN-COCKPIT-001`

## Purpose and boundary

OMEN is the operator cockpit for the five physical WilliamOS lab nodes: OMEN, HERMES, ATLAS,
AEGIS, and DAEDALUS. Lab-control performs bounded, read-only health probes. It does not start or
stop services, change Docker, modify SSH trust, distribute private keys, edit DNS, mutate application
data, or select autonomous work.

The management source is
`config/lab-control/lab-management-topology.v1.json`. It is a management-plane projection over the
existing `williamos-node-identity/1` contract; Azure remains an external capability envelope and is
not a physical lab node.

## Prerequisites

Run the installer and commands with PowerShell 7.5 or newer. The module uses the 7.5 strict JSON
date-mode control so topology and signed sync timestamps remain strings until the explicit UTC
validator accepts them. Older PowerShell versions fail before installation or module import.

## Current management routes

| Node | OMEN route | Account | Port | Credential owner |
|---|---|---:|---:|---|
| OMEN | local observation | current user | local | OMEN |
| HERMES | direct to `100.97.194.84` | `bs` | 22 | OMEN |
| ATLAS | strict OMEN-to-HERMES tunnel to `192.168.88.8` | `bs` | 22 | OMEN |
| AEGIS | OMEN to HERMES, then HERMES alias `aegis` to `192.168.88.7` | `bs` | 22 | HERMES |
| DAEDALUS | OMEN to HERMES, then HERMES alias `daedalus` to `192.168.88.6` | `daedalus` | 2222 | HERMES |

AEGIS and DAEDALUS deliberately use the HERMES resident relay. The ATLAS jump is constructed with
its own explicit batch, identity, trust, forwarding, and timeout controls because OpenSSH does not
inherit the destination's options into an implicit `ProxyJump` child. None of these routes transfer
HERMES credentials to OMEN. Do not copy HERMES private keys to OMEN and do not enable agent
forwarding to make the routes look simpler.

Strict read-only identity proofs refreshed on 2026-09-20 returned:

- HERMES: hostname `Hermes`, account `hermes\bs`, ED25519 fingerprint
  `SHA256:Iz+tH9Nr8AqGCRWzf2CDFGfii0V72zfvuiSijDBIhF0`.
- ATLAS: hostname `atlas`, account `bs`, ED25519 fingerprint
  `SHA256:0QsMN3STmqBsozY2oea4GU32dDIyCKV0jCbWI8n4fYw`.
- AEGIS through HERMES: hostname `aegis`, account `bs`, ED25519 fingerprint
  `SHA256:N+YNbMg3nUb0tX7ZYLJfJSt9f0dUOukBUNLyYb1WByo`.
- DAEDALUS through HERMES: hostname `daedalus-ThinkStation-P620`, account `daedalus`, ED25519
  fingerprint `SHA256:njnjHfmzEA8Azl5xOcNICR4V3OU7+DvUO4JLHW4AAf4`.

Fingerprints are evidence, not public keys. They cannot be converted into `known_hosts` entries.
The runtime still requires an existing strict `known_hosts` match. It accepts only ED25519, rejects
any conflicting ED25519 entry for the endpoint, copies only the exactly verified entry into an
ephemeral per-command trust file, and deletes that file after use. HERMES-resident relays apply the
same rule after proving that the effective alias resolves to the declared host, account, and port.
Every outer SSH process has a 30-second wall-clock ceiling in addition to connection and keepalive
timeouts.

## Route evidence freshness

Management routes are actionable only while their `VERIFIED` evidence is current. The runtime
rejects evidence observed more than five minutes in the future, evidence that is expired, and
attestation windows longer than seven days before it starts SSH. The current four route proofs were
observed at `2026-09-20T14:27:53Z` and expire at `2026-09-27T14:27:53Z`.

Refresh is an evidence operation, not a timestamp-only edit. From canonical OMEN, re-prove the local
hostname first. Then use strict, noninteractive SSH to prove each route's configured endpoint,
remote `hostname`, remote account (`whoami` or `id -un`), and negotiated ED25519 fingerprint. For
AEGIS and DAEDALUS, perform the endpoint/account/fingerprint proof from HERMES without copying its
credentials. Compare the negotiated fingerprint with the relevant managed `known_hosts` entry.
Only after all values agree may `observedAt` be advanced and `expiresAt` set no more than seven days
later. Run the topology tests, `lab-ssh-config`, and `lab-status` before installing the refreshed
manifest. Never refresh by using `accept-new`, disabling host-key checking, or merely extending the
expiry.

The shipped JSON Schema pins the exact ordered node tuples and route bindings. Timestamp ordering,
future skew, expiry, and the seven-day maximum window are semantic checks performed by the runtime
and covered by behavior tests; JSON Schema `date-time` validation alone cannot express them.

## DNS and service naming

The lab does not currently have one authoritative internal DNS zone. `williamos.lan` is a service
name for the HERMES-hosted WilliamOS runtime, while SSH management uses the explicit, validated
routes above. MagicDNS, the Windows hosts file, mDNS, and raw LAN addresses must not be treated as
interchangeable sources of truth.

This contract makes management deterministic without pretending the DNS project is complete. A
future DNS rollout should generate records from the same node identities and must be validated
separately before it replaces explicit management endpoints.

## Install

From the repository in PowerShell:

```powershell
pwsh -NoProfile -File .\scripts\lab-control\install-lab-control.ps1
```

The installer copies its command shims, module, topology, schema, and node-identity contract to
`%LOCALAPPDATA%\WilliamOS\LabControl\bin`. It refuses to overwrite a changed managed file unless
`-Force` is explicitly supplied. Sources are preflighted and hash-verified in a sibling staging
directory, then the complete directory is swapped into place with rollback of the previous install
if activation fails. Unmanaged files already in the install directory are preserved. Review without
writing. If the process or machine stops between the two directory renames, the next installer run
automatically restores one unambiguous sibling backup before preflight; multiple remnants fail
closed for operator review.

```powershell
pwsh -NoProfile -File .\scripts\lab-control\install-lab-control.ps1 -WhatIf
```

## Commands

- `lab-status`: all five nodes, ATLAS/HERMES continuity evidence, and one operator-blocker result.
- `lab-hermes`: detailed read-only HERMES snapshot.
- `lab-atlas`: detailed read-only ATLAS snapshot.
- `lab-aegis`: detailed read-only AEGIS snapshot through the HERMES resident relay.
- `lab-daedalus`: detailed read-only DAEDALUS snapshot through the HERMES resident relay.
- `lab-containers`: read-only `docker ps` output from HERMES and ATLAS.
- `lab-backups`: bounded ATLAS backup listing plus the same continuity classifier as `lab-status`.
- `lab-ssh-config`: deterministic OMEN SSH candidate on stdout. It never edits active SSH files.

Capture and review the SSH candidate with:

```powershell
lab-ssh-config > $env:TEMP\williamos-ssh-config.candidate
ssh -F $env:TEMP\williamos-ssh-config.candidate -G hermes
ssh -F $env:TEMP\williamos-ssh-config.candidate -G atlas
```

The renderer emits active blocks only for OMEN-owned HERMES and ATLAS credentials. AEGIS and
DAEDALUS appear as relay routes because their trust and credentials remain on HERMES. The generated
candidate enforces public-key-only, batch, strict host-key checking, no agent forwarding, no
forwarding, ED25519-only host keys, bounded connection attempts, and the controlled OMEN
`known_hosts` path.

## Status rules

Exit `0` means all five required nodes were observed and all mandatory evidence was usable. Exit `2`
means a typed SSH failure, invalid topology, missing service evidence, or invalid continuity evidence.
SSH reachability alone cannot produce green status.

HERMES requires Docker, Ollama, GPU, and disk evidence. ATLAS requires Docker, disk, backup,
protocol-level Postgres/Redis/Mongo evidence, and valid cross-node continuity. AEGIS requires
hostname, account, OS, uptime, Docker, and disk evidence; its GPU is informative. DAEDALUS is the
resident GPU worker and additionally requires usable GPU evidence.

The public continuity states remain `SYNC_OK`, `SYNC_STALE`, `SYNC_FAILED`, and `SYNC_UNKNOWN`.
Only `SYNC_OK` permits green status. The canonical ATLAS receipt and bound HERMES task evidence must
agree on run ID, hashes, direction records, task result, and timestamps.

## Routine verification

```powershell
lab-ssh-config
lab-status
lab-hermes
lab-atlas
lab-aegis
lab-daedalus
```

If topology validation fails, lab-control stops before any SSH process is started. If one relay
fails, inspect that node's typed failure; do not weaken `StrictHostKeyChecking`, use `accept-new`,
copy a private key, or enable agent forwarding as a shortcut.
