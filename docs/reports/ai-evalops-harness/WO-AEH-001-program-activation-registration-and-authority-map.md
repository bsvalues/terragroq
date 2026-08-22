# WO-AEH-001 - Program Activation, Registration, and Authority Map

Result: `COMPLETE / PROGRAM_REGISTERED / R2_R3_AUTHORITY_REQUIRED`

Decision ID: `OWNER-DIRECTION-2026-08-11-AEH-EXECUTE-001`

Grant reference: `AUTHORITY-GRANT-AEH-2026-08-11-R1-REGISTRATION-001`

Status event: `AUTHORITY-STATUS-AEH-2026-08-11-ACTIVE-R1-001`

Recorded at: `2026-08-11T07:46:29-07:00`

## Owner decision

The authenticated owner statement was:

> Execute on my authority

The statement is interpreted in the immediate context of the completed AEH plan
and packet set. It authorizes WO-AEH-001's R1 repository-governance registration
and expresses intent to proceed through the declared program. It is not treated
as an exact R2 or R3 dispatch grant.

## Subject and exact active scope

Subject:

- `PROGRAM-WILLIAMOS-AI-EVALOPS-HARNESS-001`
- `GOAL-WILLIAMOS-DURABLE-AI-EXECUTION-001`
- `LOOP-WILLIAMOS-DURABLE-AI-EXECUTION-001`
- `WO-AEH-001`

Writable reservations for this registration:

- `docs/governance/active-program-queue.md`
- `docs/governance/goal-registry.md`
- `docs/governance/loop-registry.md`
- `docs/reports/ai-evalops-harness/WO-AEH-001-program-activation-registration-and-authority-map.md`
- `tests/active-program-queue-header.test.ts`

Read-only sources include the program, WO-AEH-001 packet, both checkout states,
and controlling governance doctrine. No HermesLab file is writable under this
grant.

Allowed actions are registry reconciliation, authority recording, baseline
refresh, packet and DAG validation, and independent read-only review. Commit,
push, tag, merge, runtime activation, and deployment are not inferred.

## Refreshed checkout truth

- terragroq: `13709f5789c25dea408283730a6bd35e8fd894ab`, detached; AEH planning artifacts were untracked before activation.
- HermesLab: `0481061acf1f683688a00b09795647d0288c7232`; checkout contains pre-existing modified and untracked operator evidence and was kept read-only.

Material change check: no base movement occurred during registration. Existing
dirty state was preserved and not adopted as program output.

## Authority walls retained

R2 requires a child-specific active record covering exact repository paths,
contracts, and non-live test environments after collision-checked reservation.

R3 requires a fresh grant naming exact hosts, actions, protected resources, and
time window. This includes database, firewall/port, sudo/identity, service,
backup, credential/off-site-provider, reboot/fault, worker/scheduler, canary,
soak, deployment, and production actions. WO-AEH-042 remains a separate cutover
decision.

Issue #357 remains `FAILED_TERMINAL / QUARANTINED_TERMINAL / NON_SELECTABLE` and
may not be retried, wrapped, renamed, or reused.

## Dependency and transition result

The canonical graph contains 53 nodes and 90 edges and is acyclic. WO-AEH-001 is
complete. WO-AEH-002, WO-AEH-011, and WO-AEH-013 are released only to fresh
dependency, reservation, and authority matching. None is marked dispatch-ready
by this result.

Maturity before: `MODEL_VERIFIED planning / NOT_ACTIVATED`.

Maturity after: `PROGRAM_REGISTERED / no runtime capability promotion`.

## Safety and owner boundary

```text
RUNTIME_ACTIVATED: false
SCHEDULER_ACTIVE: false
BACKGROUND_WORKER_ACTIVE: false
HOST_OR_DATABASE_MUTATION_PERFORMED: false
NETWORK_OR_BACKUP_MUTATION_PERFORMED: false
PRODUCTION_DEPLOYMENT_PERFORMED: false
SECRETS_EXPOSED: false
OWNER_OPERATION_TOUCH_COUNT: 0
OWNER_CREDENTIAL_TOUCH_COUNT: 0
OWNER_DIAGNOSTIC_TOUCH_COUNT: 0
OWNER_ROUTINE_DECISION_COUNT: 0
OWNER_ROUTINE_CONTACT_COUNT: 0
OWNER_OPERATION_CERTIFICATION_STATE: UNVERIFIED_ZERO_OWNER_OPERATIONS
```

The direct owner authority decision is excluded from routine-operation counters.
This report does not prove implementation, recovery, soak, unattended execution,
or production authorization.

## Validation and independent review

- Refreshed bases: terragroq `13709f5789c25dea408283730a6bd35e8fd894ab`; HermesLab `0481061acf1f683688a00b09795647d0288c7232`.
- Draft packet validator: `PASS_LEXICAL_DRAFT_COMPLETENESS_NON_AUTHORIZING`; 52 Markdown packets, 52 matching envelopes, 53 nodes, 90 edges, acyclic.
- Changed-path review: limited to the three registries, the matching queue-header test, the AEH program/packet/generator artifacts, and this evidence report. HermesLab remained read-only.
- `git diff --check`: pass.
- Queue-header test assertion was reconciled to the newly selected AEH outcome while retaining standing Owner Outcome Delivery assertions. Runtime execution is pending dependency installation; no dependency download was authorized or attempted during registration.
- Independent reviewer: `/root/packet_assurance`.
- Independent verdict: `PASS after evidence closure`; zero blocking findings remain.
- Reviewer confirmed the R1-only authority interpretation, exact dirty-checkout preservation, R2/R3 walls, successor non-dispatch posture, standing owner-outcome preservation, zero owner-operation counters, and issue #357 terminal quarantine.
