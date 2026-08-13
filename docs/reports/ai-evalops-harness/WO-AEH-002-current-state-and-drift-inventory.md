# WO-AEH-002 — Current-State and Drift Inventory

Status: `COMPLETE / INDEPENDENT_REVIEW_PASS / READ_ONLY_INVENTORY / NO_RUNTIME_AUTHORITY`

Observed at: `2026-08-11T14:53:14Z`

Repositories:

- `terragroq` at `13709f5789c25dea408283730a6bd35e8fd894ab`, detached and dirty
- `HermesLab` at `0481061acf1f683688a00b09795647d0288c7232`, branch `master` and dirty

## Outcome

A deterministic, source-attributed local inventory now records repository state, the Hermes host's
declared and observed services, relevant listener bindings, runtime image tags, and the freshness of
retained Hermes, Atlas, and AEGIS capability snapshots. It captures no environment values,
credentials, container labels, process command lines, prompts, completions, or protected payloads.

This Work Order performed no service, container, network, host, database, backup, scheduler, worker,
or repository mutation outside its reserved script and report/evidence paths.

## Current truth

The local machine identifies as `Hermes`, Windows build `10.0.19045`, with an Intel i7-5960X,
16 logical CPUs, and 34,263,711,744 bytes of physical memory. This is a live local observation from
the Node.js OS interface, not a remote-node probe.

Docker reported five running Hermes containers:

| Service | Image | Observed publish |
| --- | --- | --- |
| Ollama | `ollama/ollama:latest` | `127.0.0.1:11434` |
| Open WebUI | `ghcr.io/open-webui/open-webui:main` | all host interfaces on `3000` |
| Portainer | `portainer/portainer-ce:latest` | all host interfaces on `9000` |
| PostgreSQL | `postgres:16` | all host interfaces on `5433` |
| Redis | `redis:7` | all host interfaces on `6379` |

Source: read-only `docker ps` minimal fields and `Get-NetTCPConnection` restricted to the five
declared lab ports. Container labels and command lines were deliberately excluded.

## Scheduled operations and identities

Three root-path Hermes scheduled tasks were observed. Task actions and arguments were excluded so
the inventory cannot capture command-line secrets:

| Task | State | Principal | Logon / run level | Last result |
| --- | --- | --- | --- | ---: |
| `HermesCrossNodeBackupSync` | Ready | `bs` | Interactive / Limited | 0 |
| `HermesLabHealth` | Ready | `bs` | Interactive / Limited | 0 |
| `HermesVolumeBackup` | Ready | `bs` | Interactive / Limited | 0 |

The evidence also records last/next run timestamps from `Get-ScheduledTaskInfo`. Container
`Config.User` declarations are recorded without inspecting environments, profiles, groups, or
credential stores. Open WebUI declares `0:0`; Ollama, Portainer, PostgreSQL, and Redis leave the
image-default user unspecified. An unspecified image user is not proof of non-root execution.

## Installed model inventory

Read-only `ollama list` through the running container reported one installed model:

| Model | Digest prefix | Reported size |
| --- | --- | ---: |
| `llama3.2:3b` | `a80c4f17acd5` | 2.0 GB |

This proves only the model-list response at capture time. It does not prove the complete immutable
blob digest, template identity, runtime fit, model health, or authority to execute inference.

## Local disks and mounts

`Get-Volume` reported six drive-letter volumes. Free space is rounded down to whole GiB so the
inventory remains stable across its two evidence writes.

| Drive | Filesystem | Health / operational | Size bytes | Free GiB floor |
| --- | --- | --- | ---: | ---: |
| C | NTFS | Healthy / OK | 498,963,906,560 | 256 |
| D | NTFS | Healthy / OK | 119,926,681,600 | 85 |
| E | Unknown | Healthy / OK | 104,660,992 | 0 |
| F | NTFS | Healthy / OK | 1,000,169,226,240 | 931 |
| H | NTFS | Healthy / OK | 366,583,214,080 | 0 |
| I | NTFS | Healthy / OK | 125,570,121,216 | 29 |

Volume health is an operating-system claim, not SMART evidence or a write/read verification. The H
volume's zero whole-GiB floor is a capacity warning, not an authorization to delete or move data.

## Reconciled drift

1. `SERVICE-MAP.md` declares Hermes PostgreSQL and Redis `STOPPED` and non-authoritative, while both
   containers were observed running. This is `HIGH` configuration/status drift. It does not prove
   that either service holds authoritative data or has active clients.
2. `README.md` says Open WebUI and Portainer images were not pulled, while both services were
   observed running. This is `MEDIUM` documentation drift.
3. Open WebUI, Portainer, PostgreSQL, and Redis have broad host listener bindings. This inventory
   records exposure shape only; it did not test remote reachability, authentication, or firewall
   enforcement.
4. Ollama, Open WebUI, and Portainer use floating `latest` or `main` tags in the observed runtime.
   This is provenance drift/risk, not proof that their current immutable image digests are unknown
   elsewhere.

Declared-source digests:

| Source | SHA-256 |
| --- | --- |
| `C:\HermesLab\README.md` | `b53935af53efa092bad7f0eaf06fc645d6bb77b45c2d3acb0bc931677950f1af` |
| `C:\HermesLab\SERVICE-MAP.md` | `18b58edd6c57a41e603c62dbbd1e54ac9427806b2546317a3431f3c40235dff7` |
| `C:\HermesLab\hermes\docker-compose.yml` | `2ffc6ccddb650f215a5328a0a2464863bc5ab2bf8ef4067d663d04bc86542c7e` |

## Capability evidence freshness

All retained node snapshots exceeded their declared five-minute readiness TTL at the inventory
time:

| Node | Snapshot time | Age | Scheduler | Classification |
| --- | --- | ---: | --- | --- |
| Hermes | `2026-08-10T20:46:16Z` | 65,218 seconds | `OFF` | `STALE` |
| Atlas | `2026-08-10T14:07:15Z` | 89,159 seconds | `OFF` | `STALE` |
| AEGIS | `2026-08-10T20:46:18Z` | 65,216 seconds | `OFF` | `STALE` |

Atlas and AEGIS entries are retained repository claims, not live probes from this local-only run.
Historical `OK` or `READY` fields therefore do not establish current dispatch readiness. All three
snapshots declare the scheduler `OFF`.

Any snapshot timestamp later than the explicit inventory observation time is now classified
`CLOCK_AMBIGUOUS_FUTURE`, with no age and no fresh/readiness result. Future clock ambiguity therefore
fails closed rather than being clamped to an apparent age of zero.

The retained AEGIS snapshot identifies backup generation `20260810T061501Z`, the same retained last
backup and restore-verification timestamp, a computed age of 117,493 seconds, and a 48-hour claimed
threshold. It is classified `WITHIN_RETAINED_THRESHOLD`, but remains a repository snapshot rather
than a live backup probe. This does not validate its `READY` capability claim or the restore.

Snapshot source hashes are retained in the JSON evidence.

## Dirty-state preservation

Both repositories were already dirty. The evidence records every `git status --short` entry visible
at capture time, excluding only the reserved WO-AEH-002 output names so repeated generation remains
stable. No foreign modification or untracked artifact was normalized, deleted, staged, or rewritten.

Notable foreign/shared state includes active registry/program packet work in `terragroq` and
placement, backup, proof, snapshot, and bounded-dispatch artifacts in `HermesLab`. Dirty state makes
the recorded heads review anchors rather than complete content identities.

## Determinism and validation

The inventory was generated twice with the same explicit observation timestamp. Both byte streams
have SHA-256:

`66796f1a9857d9b34f2b258699fc1ce4ebdd993b8a95f888c5b644646b5465a5`

Evidence:

- `docs/reports/ai-evalops-harness/evidence/WO-AEH-002-current-state-inventory-run1.json`
- `docs/reports/ai-evalops-harness/evidence/WO-AEH-002-current-state-inventory-run2.json`

Validation included JSON parsing, byte-identical double generation, SHA-256 comparison, reserved
path inspection, secret-value exclusion by construction, and `git diff --check`.

## What this does not prove

- It does not prove Atlas or AEGIS live health, reachability, capacity, or current service state.
- It does not prove a broad listener is reachable beyond the host or lacks authentication/firewall
  protection.
- It does not establish model fit, workload admission, placement eligibility, execution authority,
  backup correctness, restore correctness, or production authorization.
- It does not activate a scheduler, worker, coordinator, model, backup, or monitoring system.

## Transition

WO-AEH-002 may release WO-AEH-003, WO-AEH-004, WO-AEH-005, and WO-AEH-049 only to fresh dependency,
reservation, and authority evaluation. The observed service-map drift should inform WO-AEH-006 and
remain unmodified until the separately authorized WO-AEH-007/046 remediation lanes.

The previous assurance review blocked completion because scheduled tasks, models, disks, backup
metadata, runtime identities, and future-clock handling were incomplete. Those fields are now
present. Independent reviewer `/root/packet_schema` reran three read-only captures, reproduced the
retained digest, verified all required categories, exercised future-clock fail-closed behavior, and
returned `PASS` with no blockers. Successors are released only to fresh dependency, reservation,
and authority evaluation.

```text
OWNER_OPERATION_TOUCH_COUNT: 0
OWNER_CREDENTIAL_TOUCH_COUNT: 0
OWNER_DIAGNOSTIC_TOUCH_COUNT: 0
OWNER_ROUTINE_DECISION_COUNT: 0
OWNER_ROUTINE_CONTACT_COUNT: 0
OWNER_OPERATION_CERTIFICATION_STATE: UNVERIFIED_ZERO_OWNER_OPERATIONS
```
