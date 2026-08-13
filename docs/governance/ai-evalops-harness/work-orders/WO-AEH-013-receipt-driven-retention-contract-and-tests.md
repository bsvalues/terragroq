# WO-AEH-013 — Receipt-driven retention contract and tests

Generated from [the canonical program](../../ai-evalops-harness-program.md). This is a standalone
structural draft. It is not dispatchable and creates no authority.


```text
WORK_ORDER: WO-AEH-013
TITLE: Receipt-driven retention contract and tests
PROGRAM: PROGRAM-WILLIAMOS-AI-EVALOPS-HARNESS-001
GOAL: GOAL-WILLIAMOS-DURABLE-AI-EXECUTION-001
LOOP: LOOP-WILLIAMOS-DURABLE-AI-EXECUTION-001
STATUS: DRAFT / NOT_ACTIVATED / BLOCKED_AUTHORITY / BLOCKED_RESERVATION
RISK_CLASS: R1
DEPENDS_ON: WO-AEH-001
REPO: HermesLab, terragroq
BASE: HermesLab=0481061acf1f683688a00b09795647d0288c7232 (review anchor; refresh at activation); terragroq=13709f5789c25dea408283730a6bd35e8fd894ab (review anchor; refresh at activation)
BRANCH: not assigned; draft packet

PURPOSE: Deliver exactly the outcome named by WO-AEH-013 without expanding authority or scope.
CURRENT_TRUTH: The program is not activated; dependencies, reservations, named roles, refreshed bases, and active authority must be verified before implementation.
OBJECTIVE: Newest successful, newest fully restore-verified and active recovery-point generations are protected by tested policy; no live pruning occurs in this WO.
SCOPE: Receipt-driven retention contract and tests; only the repository-qualified areas, contracts, environments, and protected resources in this packet.
OUT_OF_SCOPE: Any unlisted outcome, production or protected-data mutation, general shell, authority creation, and issue #357 retry/wrap/rename/reuse.
ALLOWED_FILES_OR_AREAS: HermesLab:aegis; HermesLab:atlas; HermesLab:hermes; terragroq:docs/reports/ai-evalops-harness
FILES_ALLOWED: HermesLab:aegis; HermesLab:atlas; HermesLab:hermes; terragroq:docs/reports/ai-evalops-harness
FILES_FORBIDDEN: Paths outside reservations; secrets/auth caches; protected data; historical evidence mutation; rejected runtime paths.
ALLOWED_ACTIONS: Read/plan now; implement, validate, and record evidence only after exact dependency, reservation, and authority gates pass.
BLOCKED: Dispatch, mutation, commit, push, merge, activation, deployment, or live proof before authority matching.
BLOCKED_ACTIONS: Authority self-assertion; unreserved writes; secret inspection; owner courier work; duplicate effects; issue #357 reuse.
DELIVERABLES: Newest successful, newest fully restore-verified and active recovery-point generations are protected by tested policy; no live pruning occurs in this WO.

AUTHORITY_LEVEL: R1 / exact-scope authority required
AUTHORITY_GRANT: none
AUTHORITY_DECISION_ID: not assigned
AUTHORITY_GRANT_REF: not assigned
AUTHORITY_STATUS_EVENT_REFS: none
AUTHORITY_SUBJECT: WO-AEH-013
AUTHORITY_SCOPE_REQUIRED: Exact documentation, read-only inspection, or reversible planning scope.
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

ACCEPTANCE_CRITERIA: Newest successful, newest fully restore-verified and active recovery-point generations are protected by tested policy; no live pruning occurs in this WO; every required validation below passes including fail-closed negatives; rollback is verified; evidence is immutable; and independent review has no blocking findings.
VALIDATION: focused unit and negative tests; changed-path and secret scan; git diff --check; independent review; prove exact declared outcome: Newest successful, newest fully restore-verified and active recovery-point generations are protected by tested policy; no live pruning occurs in this WO.
VALIDATION_REQUIRED: focused unit and negative tests; changed-path and secret scan; git diff --check; independent review; prove exact declared outcome: Newest successful, newest fully restore-verified and active recovery-point generations are protected by tested policy; no live pruning occurs in this WO.
REVIEW_REQUIREMENTS: Independent reviewer differs from builder, owns no builder reservation, validates scope/authority/risk/evidence, and closes all blocking findings.
ROLLBACK_OR_REVERSAL: Stop new activity; preserve the last restore-verified generation; restore the signed prior service, network, identity, or backup configuration; verify authorized access and evidence integrity.
STOP_CONDITIONS: Missing/stale/mismatched authority; dependency or reservation failure; secret/protected-data exposure; ambiguous identity/base/outcome; duplicate effect; evidence gap; issue #357 reuse.
EVIDENCE_PATH: terragroq:docs/reports/ai-evalops-harness/WO-AEH-013-receipt-driven-retention-contract-and-tests.md

SUCCESS_TRANSITION: Record the verified result and release only dependency successors (WO-AEH-014, WO-AEH-043) to fresh dependency, reservation, and AUTHORITY_MATCH evaluation; success grants no authority.
VALIDATION_FAILURE_TRANSITION: Repair within the same coherent outcome and budget; otherwise create a narrow prerequisite/remediation WO and remain blocked.
REVIEW_TRANSITION: Return blocking findings to the original builder; revalidate and obtain independent re-review.
MERGE_TRANSITION: Merge only under a separate active grant with green checks, exact scope, clean state, no secrets, and no unresolved review.
POST_MERGE_TRANSITION: Verify exact merged main and applicable staging/live evidence; retain rollback point and recompute eligible successors.
NEXT_WO_TRANSITION: Recompute the dependency-cleared, reservation-compatible set; numbering does not serialize work.
NEXT_ON_PASS: WO-AEH-014, WO-AEH-043
NEXT_ON_BLOCK: AUTHORITY_REQUIRED / DEPENDENCY_BLOCKED / RESERVATION_BLOCKED / VALIDATION_FAILED / POLICY_CHANGED with no unauthorized mutation.
ESCALATION_RULES: Escalate only for new spend/provider, credentials, live DB/host/network/sudo/backup mutation, destructive retention, reboot/fault injection, runtime activation, production cutover, or risk acceptance.
```

## Repository-qualified reservations

These are preliminary maximum area bounds, not executable write reservations. Before activation the
coordinator must replace them with exact collision-checked relative paths, named contracts,
environments, protected resources, and a single writer. Until then the packet remains
`BLOCKED_RESERVATION`.

Paths:
- `HermesLab:aegis`
- `HermesLab:atlas`
- `HermesLab:hermes`
- `terragroq:docs/reports/ai-evalops-harness`

Contracts:
- `wo-aeh-013-outcome`
- `backup-or-host-safety-boundary`

Environments:
- `repository-validation`

Protected resources:
- `historical-evidence`
- `issue-357-quarantine`
- `last-restore-verified-generation`
- `management-access`
- `authoritative-state`

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
workOrderId: WO-AEH-013
programId: PROGRAM-WILLIAMOS-AI-EVALOPS-HARNESS-001
goalId: GOAL-WILLIAMOS-DURABLE-AI-EXECUTION-001
loopId: LOOP-WILLIAMOS-DURABLE-AI-EXECUTION-001
objective: "Newest successful, newest fully restore-verified and active recovery-point generations are protected by tested policy; no live pruning occurs in this WO."
riskClass: R1
repositories:
  - "HermesLab"
  - "terragroq"
checkoutBindings:
  - id: HermesLab
    repository: bsvalues/terragroq
    root: C:\HermesLab
    reviewAnchor: 0481061acf1f683688a00b09795647d0288c7232
  - id: terragroq
    repository: bsvalues/terragroq
    root: C:\Users\bs\terragroq-review
    reviewAnchor: 13709f5789c25dea408283730a6bd35e8fd894ab
baseRefs:
  - checkoutId: HermesLab
    sha: 0481061acf1f683688a00b09795647d0288c7232
    status: REVIEW_ANCHOR_REFRESH_REQUIRED_AT_ACTIVATION
  - checkoutId: terragroq
    sha: 13709f5789c25dea408283730a6bd35e8fd894ab
    status: REVIEW_ANCHOR_REFRESH_REQUIRED_AT_ACTIVATION
dependencies:
  - "WO-AEH-001"
fanInGate: ALL
laneId: wo-aeh-013-draft
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
    - "HermesLab:aegis"
    - "HermesLab:atlas"
    - "HermesLab:hermes"
    - "terragroq:docs/reports/ai-evalops-harness"
  contracts:
    - "wo-aeh-013-outcome"
    - "backup-or-host-safety-boundary"
  environments:
    - "repository-validation"
  protectedResources:
    - "historical-evidence"
    - "issue-357-quarantine"
    - "last-restore-verified-generation"
    - "management-access"
    - "authoritative-state"
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
authorityScopeRequired: "Exact documentation, read-only inspection, or reversible planning scope."
requiredOutputs:
  - "Newest successful, newest fully restore-verified and active recovery-point generations are protected by tested policy; no live pruning occurs in this WO."
requiredValidation:
  - "focused unit and negative tests"
  - "changed-path and secret scan"
  - "git diff --check"
  - "independent review"
  - "prove exact declared outcome: Newest successful, newest fully restore-verified and active recovery-point generations are protected by tested policy; no live pruning occurs in this WO."
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
  - "terragroq:docs/reports/ai-evalops-harness/WO-AEH-013-receipt-driven-retention-contract-and-tests.md"
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
WORK_ORDER: WO-AEH-013
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
