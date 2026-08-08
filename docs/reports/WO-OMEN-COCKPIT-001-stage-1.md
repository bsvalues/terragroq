# WO-OMEN-COCKPIT-001 — OMEN cockpit Stage 1

```text
OMEN_COCKPIT_STAGE_1: BLOCKED
RESULT_STATE=BLOCKED_DEPENDENCY
REASON_CODE=HERMES_TCP_SERVICES_UNREACHABLE_AFTER_SUCCESSFUL_PROOF
```

## Work-order packet

```yaml
schemaVersion: 2
workOrderId: WO-OMEN-COCKPIT-001
programId: PROGRAM-OMEN-COCKPIT-001
goalId: GOAL-OMEN-COCKPIT-001
loopId: LOOP-OMEN-COCKPIT-STAGE-1
objective: Make OMEN the read-only operator and developer cockpit for Hermes and Atlas.
riskClass: R1
repositories: [bsvalues/terragroq]
baseRefs: [fa8b53fb0950999273e6e78156aab17a0d1b35ae]
dependencies: []
fanInGate: ALL
laneId: omen-lab-control-cli
teamRoles:
  coordinator: codex-root
  builder: codex-lab-cli-builder
  reviewer: independent-assurance
providerRequirements: [supported-hosted-codex]
preferredProviders: [codex]
fallbackProviders: []
reservations:
  paths:
    - scripts/lab-control/**
    - tests/lab-control-cli.test.ts
    - docs/runbooks/omen-lab-control.md
    - docs/reports/WO-OMEN-COCKPIT-001-stage-1.md
  contracts: [lab-status, lab-hermes, lab-atlas, lab-containers, lab-backups]
  environments: [OMEN-control-plane]
allowedActions:
  - inspect and configure OMEN control-plane files
  - perform bounded read-only SSH verification
  - implement and test the read-only lab CLI
forbiddenActions:
  - mutate Hermes or Atlas services, data, backups, source, Docker architecture, or hardware
  - expose or commit credentials, private keys, or secrets
  - disable SSH host-key checking globally
  - move beyond Stage 1
authorityGrantRefs: [owner-controlling-prompt-2026-08-07]
programActivationGrantRef: owner-controlling-prompt-2026-08-07
grantStatusEventRefs: []
requiredOutputs:
  - OMEN discovery and remote proof
  - VS Code Remote SSH proof
  - reusable lab-control commands
  - browser URL and RDP discovery
requiredValidation:
  - focused Vitest CLI contract suite
  - live bounded lab-status failure-path proof
reviewRequirements: [independent-scope-safety-evidence-review]
mergeMode: coordinator-owned-no-builder-commit
retryBudget: 1
remediationBudget: 3
reroutePolicy: return actionable findings to reserved builder
stopConditions: [remote-mutation-required, secret-exposure, scope-expansion]
evidenceTargets: [docs/reports/WO-OMEN-COCKPIT-001-stage-1.md]
ownerDecisionConditions: [new authority outside the recorded Hermes/Atlas handoff]
ownerOperationsAllowed: false
```

## Exact OMEN state discovered

- Hostname `OMEN`; HP OMEN Gaming Laptop 16-ap0xxx.
- Windows 11 Home 25H2, version `10.0.26200`, build `26200.8973`, x64.
- Ethernet 2 IPv4 `192.168.1.157`.
- PowerShell `7.6.4`, OpenSSH `9.5p2`, Git `2.55.0`, GitHub CLI `2.89.0`.
- GitHub CLI authenticated as `bsvalues` with SSH Git protocol.
- Stable VS Code `1.131.0` with official Remote SSH `0.124.0` and Remote Explorer installed and
  configured for Windows OpenSSH. VS Code Insiders remains installed but is not the proven surface.
- Existing SSH aliases target Hermes and Atlas and retain `StrictHostKeyChecking=ask`.

## Stage 1 status

- SSH to Hermes: **PROVEN, THEN DEGRADED**. The repaired server accepted the intended fingerprint;
  verbose proof records public-key authentication, hostname `Hermes`, and exit `0`. Later the same
  run lost all tested Hermes TCP reachability while ICMP remained responsive; three bounded SSH
  retries and a post-wait retry timed out before authentication.
- SSH to Atlas: **PROVEN**. `ssh -o BatchMode=yes atlas hostname` returns `atlas` with exit `0`.
- VS Code Remote SSH to Atlas: **PROVEN** using stable VS Code and the official extension. The resolver
  ran Windows OpenSSH, created the Atlas exec server, and started the user-scoped VS Code Server.
- VS Code Remote SSH to Hermes: **PROVEN** before the later transport loss. Stable VS Code resolved
  `ssh-remote+hermes`, created/cached the exec server, installed the user-scoped Windows VS Code
  Server, and completed its install command. Subsequent new windows time out because Hermes TCP/22
  is no longer reachable.
- Commands created: `lab-status`, `lab-hermes`, `lab-atlas`, `lab-containers`, `lab-backups`, shared
  module, safe installer, command shims, and a sanitized SSH config example.
- Commands installed: managed files are at
  `C:\Users\bsval\AppData\Local\WilliamOS\LabControl\bin`, the directory is in the OMEN user PATH,
  and the installed `lab-status` command resolves and runs from that location.
- Status safety: reachable nodes do not produce a green result unless every required service and
  continuity field has accepted evidence. Missing or weak evidence produces
  `REQUIRED_EVIDENCE_INCOMPLETE` and exit `2`.
- Atlas service truth: Postgres/Redis/Mongo lines report protocol-probe evidence. Container evidence
  is supplemental and is tied to explicit published-port mappings plus inspected state/health; loose
  name matching does not establish authoritative state.
- Backup selection: the Atlas probe selects the global newest file after aggregating all known roots;
  spaces in paths remain intact.
- Installer safety: every managed-file conflict is preflighted before directory creation or copying,
  preventing a conflict from leaving a partial update.
- Live Atlas status: Ubuntu 24.04.4 LTS; Docker `29.7.2`; Postgres accepts `pg_isready`; Redis is
  reachable and requires authentication; Mongo ping succeeds; `641G` free of `685G`; the latest
  observed backup archive candidates by mtime are the 2026-08-08 03:00 UTC TerraFusion volume files
  under `/home/bs/backups`. File presence does not prove archive integrity or set completeness.
- RDP: `mstsc.exe` is present and Hermes TCP/3389 was open during initial discovery. It became
  unreachable with the later Hermes TCP outage. Authentication/usefulness was not tested;
  RDP is optional, not a normal-operations dependency.
- Backup directory visibility: **PROVEN** at `/home/bs/backups`; the latest three archives pass
  `gzip -t`. Cross-node sync for this run is **VERIFIED_BOTH_DIRECTIONS** by exact file metadata and
  SHA-256 comparison, with the routine scheduled-task signal deliberately labeled unverified.
- Hermes UI discovery: Open WebUI is healthy at container port `3000`, Portainer is up at `9000`, and
  Ollama `0.32.5` is at `11434`; all are wildcard-bound in Docker but direct OMEN LAN requests time
  out. A transient SSH tunnel proved Open WebUI at `http://127.0.0.1:13000/`, Portainer at
  `http://127.0.0.1:19000/`, and Ollama at `http://127.0.0.1:21434/`; the proof tunnel was stopped.
  No firewall or binding change was attempted. No current lab monitoring surface was found; port
  `8080` is a legacy EDB PEM landing page, not a verified operational radar.
- Cross-node sync source: Hermes scheduled task `HermesCrossNodeBackupSync`, daily 04:00 PDT, last
  run `2026-08-08T04:00:00-07:00`, result `0`. Exact filename/size/SHA-256 comparison verifies the
  current Atlas-to-Hermes three-file batch and Hermes-to-Atlas five-file batch in both directions.
  The task script creates no receipt/log and suppresses transfer errors, so task result `0` alone is
  labeled unverified by the routine cockpit.

## Validation evidence

```text
pnpm exec vitest run tests/lab-control-cli.test.ts
Test Files  1 passed (1)
Tests       13 passed (13)
```

Live, bounded read-only failure-path proof:

```text
HERMES
  reachable: YES
  Docker: 28.5.1
  Ollama: AVAILABLE 0.32.5
  GPU: NVIDIA GeForce RTX 3050
  disk: 308 GB free of 465 GB
ATLAS
  reachable: YES
  Docker: 29.7.2
  Postgres evidence: CONTAINER_PG_ISREADY_ACCEPTING
  Redis evidence: CONTAINER_REDIS_AUTH_REQUIRED_REACHABLE
  Mongo evidence: CONTAINER_MONGO_PING_OK
  disk: 641G free of 685G
LAB
  latest backup: 2026-08-08T03:00:12+00:00|/home/bs/backups/terrafusion_final_build_20250615_051930_redis_data-20260808_030001.tar.gz
  latest cross-node sync: UNVERIFIED_TASK_RESULT_0 last=2026-08-08T04:00:00.0000000-07:00
  operator blocker: REQUIRED_EVIDENCE_INCOMPLETE (inspect UNKNOWN/unavailable service or continuity fields above)
LAB_STATUS_EXIT=2
```

Current installed-cockpit degradation proof after Hermes TCP loss:

```text
HERMES
  reachable: NO (SSH_TIMEOUT)
ATLAS
  reachable: YES
  Docker: 29.7.2
  Postgres evidence: CONTAINER_PG_ISREADY_ACCEPTING
  Redis evidence: CONTAINER_REDIS_AUTH_REQUIRED_REACHABLE
  Mongo evidence: CONTAINER_MONGO_PING_OK
  disk: 641G free of 685G
LAB
  latest backup: 2026-08-08T03:00:12+00:00|/home/bs/backups/terrafusion_final_build_20250615_051930_redis_data-20260808_030001.tar.gz
  latest cross-node sync: UNKNOWN
  operator blocker: one or more lab nodes are unreachable; inspect the typed SSH result above
CURRENT_INSTALLED_LAB_STATUS_EXIT=2
```

The suite executes the real PowerShell entrypoints through a fake external SSH process. It verifies
BatchMode/timeouts, authentication classification, incomplete-evidence nonzero status, UTF-16LE
Windows and UTF-8 POSIX payload decoding, invocation paths containing spaces, global backup ordering
command shape, install paths containing spaces, and no-copy conflict preflight. Linux command
availability is not claimed from OMEN; the remote POSIX payload is contract-tested at the SSH
boundary and has also executed successfully against Atlas.

OMEN installation proof:

```text
INSTALL_ROOT=C:\Users\bsval\AppData\Local\WilliamOS\LabControl\bin
USER_PATH_HAS_INSTALL=True
COMMAND_SOURCE=C:\Users\bsval\AppData\Local\WilliamOS\LabControl\bin\lab-status.ps1
INSTALLED_LAB_STATUS_EXIT=2
```

## Independent review remediation

Five findings were received and remediated in the builder reservation:

1. false-green status on unknown/unavailable required evidence;
2. per-root rather than global-newest backup selection;
3. loose container-name inference represented as authoritative service state;
4. insufficient command-shape/decode/quoting coverage;
5. installer conflict detection after partial copying had begun.

Resolved review findings: `6` (including continuation wording that had overstated backup proof).
Unresolved review findings: `0`.

## Files changed

- `scripts/lab-control/LabControl.psm1`
- `scripts/lab-control/install-lab-control.ps1`
- `scripts/lab-control/lab-status.ps1` and `.cmd`
- `scripts/lab-control/lab-hermes.ps1` and `.cmd`
- `scripts/lab-control/lab-atlas.ps1` and `.cmd`
- `scripts/lab-control/lab-containers.ps1` and `.cmd`
- `scripts/lab-control/lab-backups.ps1` and `.cmd`
- `scripts/lab-control/ssh_config.example`
- `tests/lab-control-cli.test.ts`
- `docs/runbooks/omen-lab-control.md`
- `docs/reports/WO-OMEN-COCKPIT-001-stage-1.md`

Initial implementation commit: `98eebedf9f335eec1afbc8e511f4cbcfbdb46e1c`.
Continuation evidence/remediation commit: pending coordinator commit.
Draft PR: `#529`.

## Exact remaining blocker

Hermes trust, UI tunnels, and VS Code Remote SSH were all proven. The new blocker is current Hermes
transport availability: ICMP responds, but TCP `22`, `3389`, `445`, `50080`, and `50443` all fail,
and bounded SSH retries time out before authentication. Until TCP/22 is stably reachable again,
OMEN cannot perform normal operator work or keep the proven UI tunnels open.

Owner action required: `false`. Recovery of Hermes TCP/network-service availability belongs to the
already authorized Hermes operator lane; William must not act as diagnostic or command courier.

## Owner-touch counters

```text
OWNER_OPERATION_TOUCH_COUNT=0
OWNER_CREDENTIAL_TOUCH_COUNT=0
OWNER_DIAGNOSTIC_TOUCH_COUNT=0
OWNER_ROUTINE_DECISION_COUNT=0
OWNER_ROUTINE_CONTACT_COUNT=0
```

## Validation handoff

```text
READY_FOR_VALIDATION
commit=98eebedf9f335eec1afbc8e511f4cbcfbdb46e1c
pr=529
merge=null
owner_operation_touch_count=0
owner_credential_touch_count=0
owner_diagnostic_touch_count=0
owner_routine_decision_count=0
owner_routine_contact_count=0
scope_violation_count=0
review_finding_count=0
```
