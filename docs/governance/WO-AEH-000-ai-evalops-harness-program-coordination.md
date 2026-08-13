# WO-AEH-000 — AI Eval-Ops and Durable Harness Program Coordination

```text
WORK_ORDER: WO-AEH-000
TITLE: AI Eval-Ops and Durable Harness Program Coordination
PROGRAM: PROGRAM-WILLIAMOS-AI-EVALOPS-HARNESS-001
GOAL: GOAL-WILLIAMOS-DURABLE-AI-EXECUTION-001
LOOP: LOOP-WILLIAMOS-DURABLE-AI-EXECUTION-001
STATUS: DRAFT / NOT_ACTIVATED / AUTHORITY_REQUIRED_FOR_IMPLEMENTATION
RISK_CLASS: R1 planning; child WOs range R0-R3
DEPENDS_ON: none

REPO:
  - bsvalues/terragroq
  - C:\HermesLab
BASE:
  - terragroq: 13709f5789c25dea408283730a6bd35e8fd894ab
  - HermesLab: 0481061acf1f683688a00b09795647d0288c7232
BRANCH: not assigned; draft planning artifact only

PURPOSE:
Coordinate the dependency, authority, reservation, evidence, validation, rollback,
and certification lifecycle for PROGRAM-WILLIAMOS-AI-EVALOPS-HARNESS-001.

CURRENT_TRUTH:
- The prior MAO program is CLOSED_CERTIFICATION_REJECTED.
- Durable background dispatch and unattended operation are NOT_ACTIVE.
- The issue #357 nested local adapter is QUARANTINED_TERMINAL.
- Narrow bounded HERMES and AEGIS adapters exist, but a durable general harness is not proven.
- Planning does not authorize implementation or activation.

OBJECTIVE:
Maintain one truthful, dependency-driven implementation program that delivers a
restart-safe bounded AI lane, corrects identified infrastructure hazards, and
admits certification only after real recovery and soak evidence.

SCOPE:
- Program charter and 52 coherent child WOs.
- Cross-repository dependency and reservation coordination.
- Authority, risk, evidence, maturity, SLO, rollback and stop-condition gates.
- Independent assurance and final certification rollup.

OUT_OF_SCOPE:
- Performing any child implementation under this umbrella packet.
- Activating a runtime, scheduler, worker, provider, deployment or production path.
- Host, network, database, backup-retention, credential or destructive mutation.
- Purchasing hardware, storage or provider services.
- Reusing, wrapping, renaming or retrying issue #357.
- County, PACS, protected-data or production-data work.

ALLOWED_FILES_OR_AREAS:
- docs/governance/ai-evalops-harness-program.md
- docs/governance/WO-AEH-000-ai-evalops-harness-program-coordination.md
- Future child packets under docs/governance/ only after dependency and authority review.
- Future evidence under docs/reports/ai-evalops-harness/ only from executing WOs.

FILES_ALLOWED:
- The two draft governance artifacts named above for WO-AEH-000.

FILES_FORBIDDEN:
- runtime-operator/**
- scripts/runtime-operator/**
- live database data or migration state
- host service, firewall, sudoers, scheduled-task or Docker runtime configuration
- secrets, credentials, tokens, auth caches and protected data
- historical evidence mutation

ALLOWED_ACTIONS:
- Read-only repository and host inventory.
- Draft and review program/WO documentation.
- Validate identifiers, links, dependency graph and packet completeness.
- Produce a non-activating independent assurance report.

BLOCKED:
- Active-program queue, goal registry or loop registry activation.
- Schema/data mutation.
- Runtime, command runner, scheduler or background worker activation.
- Network/firewall/port/sudo/service mutation.
- Backup deletion, pruning or off-site account creation.
- Fault injection, restart, reboot or outage.
- Commit, push, PR, merge, release, deploy or tag without separate active authority.

BLOCKED_ACTIONS:
- Any action listed under BLOCKED.
- Any action that treats this planning request as blanket R2/R3 authority.
- Any retry or derived use of the rejected issue #357 adapter.

DELIVERABLES:
- Canonical program document with architecture, 52 WOs, DAG and phase gates.
- Complete umbrella Work Order packet.
- Fifty-two standalone child Work Order packets and draft structural envelopes.
- Deterministic materializer, non-authorizing validator, packet index and validation report.
- Risk and authority matrix.
- SLO, validation, rollback, evidence and certification requirements.
- Independent assurance review before activation.

AUTHORITY_LEVEL: A1_PLAN_ONLY
AUTHORITY_GRANT: none created by this packet
AUTHORITY_DECISION_ID: not assigned
AUTHORITY_GRANT_REF: not assigned
AUTHORITY_STATUS_EVENT_REFS: none
AUTHORITY_SUBJECT: planning artifacts only
AUTHORITY_SCOPE_REQUIRED: repository documentation only
PROGRAM_ACTIVATION_GRANT_REF: not assigned
ACTIVE_AUTHORITY_EVIDENCE_REF: not assigned

OWNER_OPERATION_TOUCH_COUNT: 0
OWNER_CREDENTIAL_TOUCH_COUNT: 0
OWNER_DIAGNOSTIC_TOUCH_COUNT: 0
OWNER_ROUTINE_DECISION_COUNT: 0
OWNER_ROUTINE_CONTACT_COUNT: 0
OWNER_OPERATION_EVIDENCE_REF: not yet generated
OWNER_OPERATION_CERTIFICATION_STATE: UNVERIFIED_ZERO_OWNER_OPERATIONS

COMMIT_ALLOWED: false under this draft packet
PUSH_ALLOWED: false
TAG_ALLOWED: false

ACCEPTANCE_CRITERIA:
- Every recommendation from the AI eval-ops/harness review maps to at least one child WO.
- Each child has one coherent outcome, dependencies, risk, deliverable and measurable gate.
- Repository, host, database, network, credential and protected-resource boundaries are explicit.
- Planning work is separated from R2/R3 application and activation.
- Maturity states cannot be promoted by prose or predecessor success.
- SLOs, failure injection, rollback and evidence requirements are measurable.
- Canary activation, the 72-hour pilot, seven additional soak days, independent
  certification, and production authorization are separate gates.
- The prior MAO rejection and issue #357 quarantine remain intact.
- No active queue or runtime truth is changed by drafting this packet.

VALIDATION:
- Compare against docs/governance/work-order-template.md.
- Compare against docs/governance/multi-agent-operator-playbook.md.
- Verify identifiers are unique with repository search.
- Verify all 000-052 Work Orders are present and dependency references resolve.
- Verify all review recommendations have coverage.
- Check Markdown links and git diff --check.
- Independent assurance reviews authority, recovery, rollback, test and certification gates.

VALIDATION_REQUIRED:
- Template-field completeness check.
- Work-order dependency graph validation.
- Risk/authority coverage review.
- Recommendation-to-WO traceability review.
- Secret/credential scan on changed files.
- git diff --check.

REVIEW_REQUIREMENTS:
- One independent reviewer who did not author the final packet.
- Review must cover governance conformance, technical architecture, SRE gates,
  security boundaries, rollback, owner-only counters and non-activation truth.
- All blocking findings resolved before a separate activation packet is proposed.

MERGE_AUTHORITY:
None under this draft. A separate repository Work Order and active authority are
required to commit, push, open a PR or merge these artifacts.

MERGE_MODE: no merge under WO-AEH-000 draft
RETRY_BUDGET: 2 documentation-validation repairs
REMEDIATION_BUDGET: 2 independent-review cycles
REROUTE_POLICY: reviewer unavailability may reroute to another independent read-only reviewer

ROLLBACK_OR_REVERSAL:
- Revert only the two owned draft files if they are rejected before activation.
- Do not modify active queue, goal, loop or historical evidence to roll back a draft.
- Preserve the rejected draft and review record if it influenced a later decision.

STOP_CONDITIONS:
- The packet appears to grant host/runtime/production authority.
- A child WO silently combines unrelated outcomes or unbounded mutation.
- Any required owner decision is replaced with assumed authority.
- Any reference proposes reuse of issue #357.
- A secret, credential, protected datum or live mutable state is included.
- Existing dirty or foreign changes would be overwritten.

EVIDENCE_PATH:
- docs/governance/ai-evalops-harness-program.md
- docs/governance/WO-AEH-000-ai-evalops-harness-program-coordination.md
- Future activation evidence is owned by WO-AEH-001, not this draft packet.

SUCCESS_TRANSITION:
Complete as PLANNING_ACCEPTED / NOT_ACTIVATED after validation and independent
assurance. Release WO-AEH-001 only to AUTHORITY_MATCH evaluation. WO-AEH-001
remains BLOCKED_AUTHORITY until a separate matching activation grant verifies
current baselines, exact scope and reservations; planning acceptance is not that grant.

VALIDATION_FAILURE_TRANSITION:
Repair documentation in WO-AEH-000 when in scope. Create a narrow prerequisite
planning WO if the failure exposes a new independent outcome.

REVIEW_TRANSITION:
Resolve blocking comments in this packet. Record out-of-scope implementation
requests as child-WO amendments; do not implement them here.

MERGE_TRANSITION:
No merge under this draft packet.

POST_MERGE_TRANSITION:
Not applicable until a separately authorized repository delivery WO exists.

NEXT_WO_TRANSITION:
Materialize WO-AEH-001 for authority evaluation. If a separate matching activation
grant exists, refresh both bases and proceed with registration; otherwise record
BLOCKED_AUTHORITY with no queue or runtime mutation. Do not use numeric adjacency
as a mutex.

NEXT_ON_PASS:
Separate program activation and authority-record Work Order.

NEXT_ON_BLOCK:
Typed AUTHORITY_REQUIRED, DEPENDENCY_BLOCKED, RESERVATION_BLOCKED, or
POLICY_CHANGED record with no runtime action.

ESCALATION_RULES:
Escalate only for a genuinely new decision concerning spend/account/provider,
credentials, live DB mutation, network/firewall exposure, sudo/root policy,
destructive retention, reboot/outage injection, worker/scheduler activation,
off-site storage, production cutover or risk acceptance.
```

## Child packet rule

The program document is the planning register. Before a child WO starts, the coordinator must
materialize a complete packet using the canonical template, including exact base, branch, files,
contracts, environments, protected resources, authority references, retry/remediation budgets,
rollback point, evidence targets and owner counters. A row in the program table is not executable
authority.

Cross-repository reservations must name the repository and then use a path relative to that
repository root, for example `terragroq:scripts/execution-fabric/**` or
`HermesLab:hermes/docker-compose.yml`. Absolute host paths may identify environments or evidence
locations, but they do not replace repository-scoped path reservations.

## Canonical v2 envelope

```yaml
schemaVersion: 2
workOrderId: WO-AEH-000
programId: PROGRAM-WILLIAMOS-AI-EVALOPS-HARNESS-001
goalId: GOAL-WILLIAMOS-DURABLE-AI-EXECUTION-001
loopId: LOOP-WILLIAMOS-DURABLE-AI-EXECUTION-001
objective: >-
  Produce and independently assure the non-activating implementation program and
  child Work Order register for a durable bounded AI execution lane.
riskClass: R1
repositories:
  - id: terragroq
    path: C:\Users\bs\terragroq-review
  - id: HermesLab
    path: C:\HermesLab
baseRefs:
  terragroq: 13709f5789c25dea408283730a6bd35e8fd894ab
  HermesLab: 0481061acf1f683688a00b09795647d0288c7232
dependencies: []
fanInGate: ALL
laneId: ai-evalops-harness-program-planning
teamRoles:
  coordinator: root
  builder: none
  reviewer: independent-assurance
providerRequirements:
  - repository-read
  - repository-write-scoped-to-reservations
  - document-create-or-edit
  - deterministic-document-validation
preferredProviders:
  - supported-hosted-codex-session
fallbackProviders: []
reservations:
  paths:
    - terragroq:docs/governance/ai-evalops-harness-program.md
    - terragroq:docs/governance/WO-AEH-000-ai-evalops-harness-program-coordination.md
  contracts:
    - work-order-template-v2
    - ai-evalops-program-identifiers
  environments: []
allowedActions:
  - read-only-inspection
  - documentation-create-or-edit
  - deterministic-validation
forbiddenActions:
  - runtime-activation
  - scheduler-or-background-worker-activation
  - host-network-database-or-backup-mutation
  - secret-or-credential-access
  - issue-357-retry-wrap-rename-or-reuse
authorityGrantRefs: []
programActivationGrantRef: null
grantStatusEventRefs: []
requiredOutputs:
  - docs/governance/ai-evalops-harness-program.md
  - docs/governance/WO-AEH-000-ai-evalops-harness-program-coordination.md
requiredValidation:
  - canonical-field-completeness
  - unique-identifiers
  - dependency-reference-resolution
  - acyclic-topological-graph
  - recommendation-traceability
  - independent-assurance
  - secret-scan
  - git-diff-check
reviewRequirements:
  - reviewer-is-not-the-author
  - all-blocking-findings-resolved
  - authority-and-non-activation-truth-confirmed
mergeMode: NONE_DRAFT_ONLY
retryBudget: 2
remediationBudget: 2
reroutePolicy: independent-reviewer-only
stopConditions:
  - authority-minted-by-packet
  - out-of-scope-mutation
  - secret-or-protected-data-exposure
  - issue-357-reuse
evidenceTargets:
  - work-order-field-check
  - work-order-id-and-dag-check
  - independent-assurance-result
  - git-diff-check-result
ownerDecisionConditions:
  - new-spend-account-or-provider
  - credential-or-secret-use
  - live-database-host-network-sudo-or-backup-mutation
  - reboot-outage-or-fault-injection
  - runtime-worker-scheduler-or-production-activation
ownerOperationsAllowed: false
```

## Safety state

```text
RUNTIME_ACTIVATED: false
SCHEDULER_ACTIVE: false
BACKGROUND_WORKER_ADDED: false
HOST_MUTATION_PERFORMED: false
NETWORK_MUTATION_PERFORMED: false
DB_SCHEMA_DATA_CHANGED: false
BACKUP_RETENTION_CHANGED: false
OFFSITE_ACCOUNT_OR_CREDENTIAL_CREATED: false
PRODUCTION_DEPLOYMENT_PERFORMED: false
REJECTED_ISSUE_357_RETRIED: false
SECRETS_EXPOSED: false
ACTIVE_QUEUE_CHANGED: false
```

## Standard result format

```text
RESULT:
WORK_ORDER: WO-AEH-000
GOAL: GOAL-WILLIAMOS-DURABLE-AI-EXECUTION-001
BASE:
HEAD_AFTER:
FILES_CHANGED:
VALIDATION:
PR:
MERGE_STATE:
TRANSITION_TAKEN:
NEXT_WO:
ESCALATION_REQUIRED:
```
