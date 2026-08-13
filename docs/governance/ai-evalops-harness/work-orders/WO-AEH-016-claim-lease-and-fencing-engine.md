# WO-AEH-016 — Claim, lease and fencing engine

Generated from [the canonical program](../../ai-evalops-harness-program.md). This is a standalone
structural draft. It is not dispatchable and creates no authority.


```text
WORK_ORDER: WO-AEH-016
TITLE: Claim, lease and fencing engine
PROGRAM: PROGRAM-WILLIAMOS-AI-EVALOPS-HARNESS-001
GOAL: GOAL-WILLIAMOS-DURABLE-AI-EXECUTION-001
LOOP: LOOP-WILLIAMOS-DURABLE-AI-EXECUTION-001
STATUS: DRAFT / NOT_ACTIVATED / BLOCKED_AUTHORITY / BLOCKED_RESERVATION
RISK_CLASS: R2
DEPENDS_ON: WO-AEH-015
REPO: terragroq
BASE: terragroq=13709f5789c25dea408283730a6bd35e8fd894ab (review anchor; refresh at activation)
BRANCH: not assigned; draft packet

PURPOSE: Deliver exactly the outcome named by WO-AEH-016 without expanding authority or scope.
CURRENT_TRUTH: The program is not activated; dependencies, reservations, named roles, refreshed bases, and active authority must be verified before implementation.
OBJECTIVE: Atomic claims, TTL renewal, fence increment, stale-fence rejection and one-active-claimant property tests.
SCOPE: Claim, lease and fencing engine; only the repository-qualified areas, contracts, environments, and protected resources in this packet.
OUT_OF_SCOPE: Any unlisted outcome, production or protected-data mutation, general shell, authority creation, and issue #357 retry/wrap/rename/reuse.
ALLOWED_FILES_OR_AREAS: terragroq:scripts; terragroq:components; terragroq:lib; terragroq:tests; terragroq:config; terragroq:docs; terragroq:docs/reports/ai-evalops-harness
FILES_ALLOWED: terragroq:scripts; terragroq:components; terragroq:lib; terragroq:tests; terragroq:config; terragroq:docs; terragroq:docs/reports/ai-evalops-harness
FILES_FORBIDDEN: Paths outside reservations; secrets/auth caches; protected data; historical evidence mutation; rejected runtime paths.
ALLOWED_ACTIONS: Read/plan now; implement, validate, and record evidence only after exact dependency, reservation, and authority gates pass.
BLOCKED: Dispatch, mutation, commit, push, merge, activation, deployment, or live proof before authority matching.
BLOCKED_ACTIONS: Authority self-assertion; unreserved writes; secret inspection; owner courier work; duplicate effects; issue #357 reuse.
DELIVERABLES: Atomic claims, TTL renewal, fence increment, stale-fence rejection and one-active-claimant property tests.

AUTHORITY_LEVEL: R2 / exact-scope authority required
AUTHORITY_GRANT: none
AUTHORITY_DECISION_ID: not assigned
AUTHORITY_GRANT_REF: not assigned
AUTHORITY_STATUS_EVENT_REFS: none
AUTHORITY_SUBJECT: WO-AEH-016
AUTHORITY_SCOPE_REQUIRED: Exact repository paths, contracts, test environments, and any non-live integration resources.
PROGRAM_ACTIVATION_GRANT_REF: not assigned
ACTIVE_AUTHORITY_EVIDENCE_REF: not assigned

OWNER_OPERATION_TOUCH_COUNT: 0
OWNER_CREDENTIAL_TOUCH_COUNT: 0
OWNER_DIAGNOSTIC_TOUCH_COUNT: 0
OWNER_ROUTINE_DECISION_COUNT: 0
OWNER_ROUTINE_CONTACT_COUNT: 0
OWNER_OPERATION_EVIDENCE_REF: pending execution evidence
OWNER_OPERATION_CERTIFICATION_STATE: UNVERIFIED_ZERO_OWNER_OPERATIONS

COMMIT_ALLOWED: false
PUSH_ALLOWED: false
TAG_ALLOWED: false
MERGE_AUTHORITY: none in draft; separate active authority required
MERGE_MODE: NONE_DRAFT_ONLY
RETRY_BUDGET: 2
REMEDIATION_BUDGET: 2
REROUTE_POLICY: compatible independent provider only; never route owner operations

ACCEPTANCE_CRITERIA: Atomic claims, TTL renewal, fence increment, stale-fence rejection and one-active-claimant property tests; every required validation below passes including fail-closed negatives; rollback is verified; evidence is immutable; and independent review has no blocking findings.
VALIDATION: focused unit and negative tests; changed-path and secret scan; git diff --check; independent review; migration, concurrency, idempotency, and restart tests; prove exact declared outcome: Atomic claims, TTL renewal, fence increment, stale-fence rejection and one-active-claimant property tests.
VALIDATION_REQUIRED: focused unit and negative tests; changed-path and secret scan; git diff --check; independent review; migration, concurrency, idempotency, and restart tests; prove exact declared outcome: Atomic claims, TTL renewal, fence increment, stale-fence rejection and one-active-claimant property tests.
REVIEW_REQUIREMENTS: Independent reviewer differs from builder, owns no builder reservation, validates scope/authority/risk/evidence, and closes all blocking findings.
ROLLBACK_OR_REVERSAL: Use backward-compatible expand/contract changes, a verified pre-change backup, and forward repair after writes; fence old coordinators and reconcile attempts before restoring service.
STOP_CONDITIONS: Missing/stale/mismatched authority; dependency or reservation failure; secret/protected-data exposure; ambiguous identity/base/outcome; duplicate effect; evidence gap; issue #357 reuse.
EVIDENCE_PATH: terragroq:docs/reports/ai-evalops-harness/WO-AEH-016-claim-lease-and-fencing-engine.md

SUCCESS_TRANSITION: Record the verified result and release only dependency successors (WO-AEH-017, WO-AEH-018, WO-AEH-020) to fresh dependency, reservation, and AUTHORITY_MATCH evaluation; success grants no authority.
VALIDATION_FAILURE_TRANSITION: Repair within the same coherent outcome and budget; otherwise create a narrow prerequisite/remediation WO and remain blocked.
REVIEW_TRANSITION: Return blocking findings to the original builder; revalidate and obtain independent re-review.
MERGE_TRANSITION: Merge only under a separate active grant with green checks, exact scope, clean state, no secrets, and no unresolved review.
POST_MERGE_TRANSITION: Verify exact merged main and applicable staging/live evidence; retain rollback point and recompute eligible successors.
NEXT_WO_TRANSITION: Recompute the dependency-cleared, reservation-compatible set; numbering does not serialize work.
NEXT_ON_PASS: WO-AEH-017, WO-AEH-018, WO-AEH-020
NEXT_ON_BLOCK: AUTHORITY_REQUIRED / DEPENDENCY_BLOCKED / RESERVATION_BLOCKED / VALIDATION_FAILED / POLICY_CHANGED with no unauthorized mutation.
ESCALATION_RULES: Escalate only for new spend/provider, credentials, live DB/host/network/sudo/backup mutation, destructive retention, reboot/fault injection, runtime activation, production cutover, or risk acceptance.
```

## Repository-qualified reservations

These are preliminary maximum area bounds, not executable write reservations. Before activation the
coordinator must replace them with exact collision-checked relative paths, named contracts,
environments, protected resources, and a single writer. Until then the packet remains
`BLOCKED_RESERVATION`.

Paths:
- `terragroq:scripts`
- `terragroq:components`
- `terragroq:lib`
- `terragroq:tests`
- `terragroq:config`
- `terragroq:docs`
- `terragroq:docs/reports/ai-evalops-harness`

Contracts:
- `wo-aeh-016-outcome`
- `durable-job-attempt-lease-fence`

Environments:
- `repository-test`
- `disposable-integration`

Protected resources:
- `historical-evidence`
- `issue-357-quarantine`
- `Atlas-control-database`

## Required evidence targets

- Exact evidence report, base/head, authority freshness, reservations, validation, and rollback proof
- All five owner-touch counters with verifier evidence
- Maturity state before and after, with an explicit non-proof statement
- Independent reviewer identity, findings, and closure
- Immutable configuration, image, model, input, and output digests where applicable
- Live worker, boot, claim, lease, and fence evidence where applicable

## Draft structural envelope

The repository's executable authority validator is expected to stop at the authority wall for this
draft. Structural validation is non-authorizing and must never be cited as dispatch readiness.

```yaml
schemaVersion: 1
artifactType: DRAFT_WORK_ORDER_PACKET
validationOnly: true
dispatchReadiness: BLOCKED_AUTHORITY_AND_RESERVATION
dispatchPerformed: false
authorityGranted: false
workOrderId: WO-AEH-016
programId: PROGRAM-WILLIAMOS-AI-EVALOPS-HARNESS-001
goalId: GOAL-WILLIAMOS-DURABLE-AI-EXECUTION-001
loopId: LOOP-WILLIAMOS-DURABLE-AI-EXECUTION-001
objective: "Atomic claims, TTL renewal, fence increment, stale-fence rejection and one-active-claimant property tests."
riskClass: R2
repositories:
  - "terragroq"
checkoutBindings:
  - id: terragroq
    repository: bsvalues/terragroq
    root: C:\Users\bs\terragroq-review
    reviewAnchor: 13709f5789c25dea408283730a6bd35e8fd894ab
baseRefs:
  - checkoutId: terragroq
    sha: 13709f5789c25dea408283730a6bd35e8fd894ab
    status: REVIEW_ANCHOR_REFRESH_REQUIRED_AT_ACTIVATION
dependencies:
  - "WO-AEH-015"
fanInGate: ALL
laneId: wo-aeh-016-draft
teamRoles:
  coordinator: UNASSIGNED
  builder: UNASSIGNED
  reviewer: UNASSIGNED_INDEPENDENT
providerRequirements:
  - repository-read
  - repository-write-scoped-to-reservations
  - deterministic-validation
preferredProviders:
  - supported-hosted-codex-session
fallbackProviders: []
reservations:
  status: PRELIMINARY_AREA_BOUNDS_REFINEMENT_REQUIRED
  paths:
    - "terragroq:scripts"
    - "terragroq:components"
    - "terragroq:lib"
    - "terragroq:tests"
    - "terragroq:config"
    - "terragroq:docs"
    - "terragroq:docs/reports/ai-evalops-harness"
  contracts:
    - "wo-aeh-016-outcome"
    - "durable-job-attempt-lease-fence"
  environments:
    - "repository-test"
    - "disposable-integration"
  protectedResources:
    - "historical-evidence"
    - "issue-357-quarantine"
    - "Atlas-control-database"
allowedActions:
  - inspect-within-declared-scope
  - implement-only-after-authority-match
  - validate-and-record-evidence
forbiddenActions:
  - authority-minting-or-self-activation
  - secret-credential-or-protected-data-access-without-exact-authority
  - issue-357-retry-wrap-rename-or-reuse
  - general-shell-or-unbounded-command-runner
authorityGrantRefs: []
programActivationGrantRef: null
grantStatusEventRefs: []
authorityScopeRequired: "Exact repository paths, contracts, test environments, and any non-live integration resources."
requiredOutputs:
  - "Atomic claims, TTL renewal, fence increment, stale-fence rejection and one-active-claimant property tests."
requiredValidation:
  - "focused unit and negative tests"
  - "changed-path and secret scan"
  - "git diff --check"
  - "independent review"
  - "migration, concurrency, idempotency, and restart tests"
  - "prove exact declared outcome: Atomic claims, TTL renewal, fence increment, stale-fence rejection and one-active-claimant property tests."
reviewRequirements:
  - reviewer-differs-from-builder
  - all-blocking-findings-resolved
  - authority-and-scope-independently-verified
mergeMode: NONE_DRAFT_ONLY
retryBudget: 2
remediationBudget: 2
reroutePolicy: compatible-independent-provider-only
stopConditions:
  - missing-stale-mismatched-or-revoked-authority
  - reservation-collision-or-foreign-change
  - ambiguous-base-worker-lease-fence-input-or-outcome
  - duplicate-effect-or-evidence-gap
  - issue-357-reuse
evidenceTargets:
  - "terragroq:docs/reports/ai-evalops-harness/WO-AEH-016-claim-lease-and-fencing-engine.md"
  - exact-base-head-and-reservation-record
  - authority-freshness-and-validation-results
  - rollback-or-reversal-verification
  - all-five-owner-touch-counter-evidence
  - maturity-state-before-and-after
  - explicit-non-proof-statement
  - independent-reviewer-identity-findings-and-closure
  - immutable-config-image-model-input-output-digests-as-applicable
  - live-worker-boot-claim-lease-fence-evidence-as-applicable
ownerDecisionConditions:
  - "new-spend-account-or-provider"
  - "credential-or-secret-use"
  - "live-database-host-network-sudo-or-backup-mutation"
  - "reboot-outage-or-fault-injection"
  - "runtime-worker-scheduler-or-production-activation"
ownerTouchBudget:
  operation: 0
  credential: 0
  diagnostic: 0
  routineDecision: 0
  routineContact: 0
ownerOperationsAllowed: false
communicationPolicy: FINAL_ONLY
```

## Safety state at creation

```text
VALIDATION_ONLY: true
DISPATCH_READINESS: BLOCKED_AUTHORITY_AND_RESERVATION
AUTHORITY_GRANTED: false
DISPATCH_PERFORMED: false
RUNTIME_ACTIVATED: false
SCHEDULER_ACTIVE: false
HOST_OR_DATABASE_MUTATION_PERFORMED: false
PRODUCTION_DEPLOYMENT_PERFORMED: false
REJECTED_ISSUE_357_RETRIED: false
SECRETS_EXPOSED: false
MATURITY_PROMOTED: false
```

## Explicit non-proof statement

Creating or structurally validating this packet does not prove the implementation, adapter,
recovery, soak, production authority, or owner-touch certification described by the Work Order.

## Standard result format

```text
RESULT:
WORK_ORDER: WO-AEH-016
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
