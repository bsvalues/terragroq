# WO-OMEN-COCKPIT-001 — OMEN cockpit Stage 1

```text
OMEN_COCKPIT_STAGE_1: BLOCKED
RESULT_STATE=BLOCKED_DEPENDENCY
REASON_CODE=SSH_AUTHORIZATION_REQUIRED_ON_REMOTE_NODES
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
- VS Code Insiders `1.129.0` with official Remote SSH/Remote Explorer extensions installed.
- Existing SSH aliases target Hermes and Atlas and retain `StrictHostKeyChecking=ask`.

## Stage 1 status

- SSH to Hermes: **BLOCKED**. TCP/22 reachable; alias correct; BatchMode authentication rejected.
- SSH to Atlas: **BLOCKED**. TCP/22 reachable; alias correct; BatchMode authentication rejected.
- VS Code Remote SSH: client/extensions configured; connection proof blocked by the same SSH auth.
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
- Browser URLs: Hermes Device Portal at `http://192.168.1.154:50080/` and
  `https://192.168.1.154:50443/`; usability not proven. Atlas `:9001` is a Portainer Agent, not UI.
  Portainer UI, Open WebUI, Ollama HTTP, and monitoring URLs remain unverified/not discovered.
- RDP: `mstsc.exe` is present and Hermes TCP/3389 is open. Authentication/usefulness was not tested;
  RDP is optional, not a normal-operations dependency.
- Backup directory visibility and cross-node sync status: **UNKNOWN** because Atlas SSH auth is blocked.

## Validation evidence

```text
pnpm exec vitest run tests/lab-control-cli.test.ts
Test Files  1 passed (1)
Tests       12 passed (12)
```

Live, bounded read-only failure-path proof:

```text
HERMES
  reachable: NO (SSH_AUTH_BLOCKED)
ATLAS
  reachable: NO (SSH_AUTH_BLOCKED)
LAB
  latest backup: UNKNOWN
  latest cross-node sync: UNKNOWN
  operator blocker: SSH authentication is not configured for one or more aliases
LAB_STATUS_EXIT=2
```

The suite executes the real PowerShell entrypoints through a fake external SSH process. It verifies
BatchMode/timeouts, authentication classification, incomplete-evidence nonzero status, UTF-16LE
Windows and UTF-8 POSIX payload decoding, invocation paths containing spaces, global backup ordering
command shape, install paths containing spaces, and no-copy conflict preflight. Linux command
availability is not claimed from OMEN; the remote POSIX payload is contract-tested at the SSH
boundary and awaits Atlas execution after authentication.

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

Resolved review findings: `5`. Unresolved review findings: `0`.

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

Commit hash: `null` (builder was instructed not to commit or push).

## Exact remaining blocker

The public key already selected by OMEN must be authorized for user `bs` on both remote nodes. That
remote-side change belongs to the separately authorized Hermes/Atlas lane, not this OMEN-only builder
reservation. Until both BatchMode connections succeed, remote service state, backup visibility,
browser application URLs, and VS Code Remote SSH cannot be fully proven.

Owner action required: `false`. The coordinator should hand public-key authorization to the already
authorized Hermes/Atlas operator lane; William must not act as credential or command courier.

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
commit=null
pr=null
merge=null
owner_operation_touch_count=0
owner_credential_touch_count=0
owner_diagnostic_touch_count=0
owner_routine_decision_count=0
owner_routine_contact_count=0
scope_violation_count=0
review_finding_count=0
```
