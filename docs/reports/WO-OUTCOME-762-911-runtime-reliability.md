# WO-OUTCOME-762-911 — Runtime Reliability Remediation Record

`RESULT: READY_FOR_VALIDATION`

## Structured record

```text
RECORD_FORMAT: WILLIAMOS_RUNTIME_RELIABILITY_REMEDIATION_V1
RECORD_ID: WO-OUTCOME-762-911
RECORD_REVISION: 2
DISPATCH_WORK_ORDER: WO-HERMES-OUTCOME-28
AUTHORITY_SOURCE: GOAL-0024
PARENT_OUTCOME: OUTCOME-762
TRACKED_ISSUE: 911
ISSUE_BINDING_SOURCE: HERMES_DISPATCH_PACKET_AND_REPOSITORY_REGRESSION_SPECIFICATIONS
REPOSITORY: bsvalues/terragroq
BASE_COMMIT: 6e21e4dc280e77d0db6afb5d78787fe53b1d0ff0
BRANCH: codex/hermes-goal-0024-28
RESERVED_PATH: docs/reports/WO-OUTCOME-762-911-runtime-reliability.md
WORK_CONTRACT_ID: issue-911-runtime-reliability-evidence.v1
WORK_CONTRACT_VERSION: hermes-work-contract.v1
PROJECTION_COMPLETION_OWNED: false
RECORD_KIND: CONTROL_PLANE_RELIABILITY_REMEDIATION_EVIDENCE
RECORD_STATE: IMPLEMENTED_PENDING_HERMES_VALIDATION
REMEDIATION_DOMAIN: HERMES_RUNTIME_FINDING_CONTROL_PLANE
DEFECT_CLASS: ROUTINE_FINDING_MISROUTED_TO_OWNER
IMPLEMENTATION_MODE: REPOSITORY_EVIDENCE_RECONCILIATION_ONLY
HOST_RUNTIME_MUTATION_AUTHORIZED: false
HOST_RUNTIME_MUTATION_PERFORMED: false
RUNTIME_OPERATOR_EXECUTION_PATH_USED: false
REJECTED_ISSUE_357_ADAPTER_USED: false
CURRENT_RUNTIME_HEALTH_CLAIMED: false
CURRENT_HOST_INVENTORY_CLAIMED: false
ISSUE_CLOSURE_CLAIMED: false
TAG_OR_RELEASE_ACTION_AUTHORIZED: false
VALIDATION_STATE: PENDING_HERMES_HOST
INDEPENDENT_FILE_REVIEW_STATE: COMPLETE_FINDINGS_REMEDIATED
HERMES_EXACT_HEAD_REVIEW_STATE: PENDING_HERMES_HOST
OWNER_TOUCH_COUNT: 0
BLOCKED_SCOPE_CROSSED: false
```

## Owner outcome and exact boundary

The dispatched outcome requests a structured record of issue `#911` reliability remediation and
expressly excludes host mutation. The registered contract confines implementation to this report,
projects issue `911` without transferring issue-completion ownership, permits ordinary repository
implementation, and forbids tag operations. The near-match that asks for host mutation is rejected by
the contract regression.

This revision corrects the prior record's domain. Repository specifications identify `#911` as a
control-plane reliability defect in the handling of findings discovered during an authorized outcome.
The earlier record instead centered a June 2026 Ollama release-hardening decision that no inspected
source independently binds to `#911`. That material is retained below only as separate historical
context. Stale pull-request receipt and head state from the previous dispatch is not current state for
this Work Order and has been removed.

## #911 defect statement

The defect was not a missing inventory or an unanswered implementation choice. The system could find
and order the next work, but still stopped at an owner-facing “awaiting your direction” message for
work whose active authority and policy classification already allowed it. A derivation function that
is never consumed does not close that loop: the finding must be classified, durably settled, and—when
ordinary—materialized as eligible child work without making the owner a dispatcher.

The required behavior is therefore:

```text
FINDING_DISCOVERED: CLASSIFY_EACH_FINDING_INDEPENDENTLY
ORDINARY_AUTHORIZED_FINDING: DERIVE_AND_QUEUE_WITHOUT_OWNER_CONTACT
GENUINE_NEW_AUTHORITY_BOUNDARY: RECORD_TYPED_OWNER_GATE
GATED_SIBLING_EFFECT_ON_ORDINARY_WORK: NONE
MALFORMED_OR_UNBOUND_FINDING: FAIL_CLOSED
DERIVED_AUTHORITY_ROOT: VERIFIED_ACTIVE_PARENT_AUTHORITY_ONLY
CHILD_GRANT_SCOPE: MECHANICALLY_NARROWED_AND_PARENT_BOUND
RESERVATION_ESCAPE: REFUSED
DURABLE_SETTLEMENT_REQUIRED: true
OWNER_AS_DISPATCHER: false
```

## Encoded #911 change set

The repository's regression specification records five cases. These are evidence classifications,
not actions performed by this Work Order.

| Sequence | Recorded case | Required disposition | This lane |
| ---: | --- | --- | --- |
| 1 | Reconcile the declared compose/Ollama arrangement under reversible, in-scope effects. | Ordinary engineering proceeds under the active objective without an owner gate. | Recorded only; no compose, container, service, model, or host state was changed. |
| 2 | Determine whether another copy of `williamos-sea` exists. | Read-only investigation proceeds without an owner gate. | Recorded only; no host or storage inventory was performed. |
| 3 | Relocate service paths that are pinned by reviewed policy. | Stop at a typed `POLICY` boundary. | Recorded only; no path or policy was changed. |
| 4 | Retire a stale duplicate. | `DESTRUCTIVE` while no other copy is verified; ordinary cleanup only after the declared copy is verified and every other control passes. | Recorded only; no file, directory, or copy was inspected, moved, or deleted. |
| 5 | Leave `pilot0` unchanged. | No action and no owner decision. | Recorded only; the named system was not touched. |

The case descriptions come from regression fixtures. They do not establish current host facts, make a
host action safe, or widen this report-only reservation.

## Repository-backed remediation

The current sovereign remediation is represented by the neutral runtime-finding policy, its durable
database consumer, and the HERMES queue integration—not by activating the retired
`scripts/runtime-operator/**` execution path.

| Reliability control | Repository evidence | Recorded behavior |
| --- | --- | --- |
| Canonical owner gates | `scripts/runtime-findings/policy.mjs:1-24` | Only financial, destructive, production, protected, unresolved legal/privacy/security, credential, reviewed-policy, scope, and competing-priority effects create owner gates. |
| Fail-closed effect classification | `scripts/runtime-findings/policy.mjs:47-95` | Missing, non-object, or malformed effects do not silently become ordinary work. Unverified destruction remains gated. |
| Parent authority and reservation confinement | `scripts/runtime-findings/policy.mjs:104-183`, `scripts/runtime-findings/db-consumer.mjs:552-649` | An exact consumer child derives only from verified approved, active, unexpired parent authority and paths wholly inside allowed and outside forbidden reservations; explicit commit/push denial blocks derivation. The durable consumer then creates child implementation and queue grants mechanically narrowed to that child and bound to the verified parent evidence, without creating broader authority. |
| Independent sibling progress | `scripts/runtime-findings/policy.mjs:186-206` | Every finding is classified separately into `dispatch` or `gated`; one genuine gate does not stall an ordinary sibling. |
| Durable serialized consumption | `scripts/runtime-findings/db-consumer.mjs:924-936`, `scripts/runtime-findings/db-consumer.mjs:1065-1091` | The consumer runs in a serializable transaction with an advisory transaction lock, derives ordinary children, persists typed owner gates, and commits one result set. |
| Active HERMES integration | `scripts/hermes-bridge/outcome-queue-runtime.mjs:1243-1248`, `scripts/hermes-bridge/cli.mjs:211-220` | The outcome queue owns the runtime-finding consumer. Queue drain consumes backlog before cycling and consumes newly recorded findings after each cycle; a queued child keeps the healthy drain moving. |
| Source and replay integrity | `tests/runtime-findings-db-consumer.test.ts:398-438`, `tests/runtime-findings-db-consumer.test.ts:508-618` | Regression cases reject corrupt lineage or duplicate settlement and require exact replay rather than duplicate child creation. |

Compatibility modules under `scripts/runtime-operator/**` re-export the neutral policy for retired
callers. Tests bearing the old directory name remain useful specifications, but neither those modules
nor the rejected issue `#357` adapter are represented here as an active execution surface.

## Canonical classification contract

```text
spendsMoney: FINANCIAL
irreversible: DESTRUCTIVE
mutatesProductionData: PRODUCTION
releaseOrCutover: PRODUCTION
protectedResource: PROTECTED
unresolvedLegalPrivacyOrSecurityRisk: LEGAL
touchesCredentials: CREDENTIALS
changesReviewedPolicy: POLICY
outsideObjectiveScope: SCOPE
competesWithPriority: PRIORITY
destroys[].verifiedCopyElsewhere != true: DESTRUCTIVE
missing_null_nonobject_or_array_effects: SCOPE_UNCLASSIFIABLE
malformed_destroys_declaration: DESTRUCTIVE_UNCLASSIFIABLE
direct_effect_flag_other_than_false_or_undefined: ASSOCIATED_CANONICAL_GATE
path_outside_parent_reservation: SCOPE
path_inside_parent_forbidden_reservation: SCOPE
inactive_revoked_expired_or_unapproved_parent: SCOPE_UNCLASSIFIABLE
ordinary_bounded_engineering: PROCEED_WITH_REVIEW_AND_VALIDATION
```

The contract is deliberately effect-driven. Finding prose cannot authorize itself, declare an
escaping path in scope, bypass a blocked action, turn an inactive grant into authority, or convert an
unverified destructive target into routine cleanup.

## Reliability acceptance contract

This remediation is correctly represented only while all of these invariants hold:

1. Every finding carries stable source identity, sequence, task, exact paths, and readable declared
   effects before it can become child work.
2. Ordinary work derives only from verified approved, active, unexpired parent authority. Explicit
   commit/push denial blocks derivation; durable child grants are mechanically narrowed and bound to
   the parent evidence, while the child contract preserves the applicable risk, reservation,
   validation, and delivery constraints.
3. Path confinement is mechanical; an exact file reservation is not a prefix, subtree reservations
   do not admit near-miss directories, and inherited forbidden paths remain forbidden.
4. Every genuine owner boundary is persisted as a typed gate. It does not create a child and it does
   not hold ordinary siblings behind it.
5. Missing or malformed effects, authority, lineage, settlement, or replay evidence fail closed before
   child creation.
6. Ordinary child creation and gate settlement are durable and idempotent; replay validates the exact
   existing graph instead of duplicating work.
7. The owner decision is surfaced only when the bounded ordinary sibling work has completed and the
   true gated finding remains actionable.
8. Issue projection remains non-owning. Completing this report or a derived child does not close
   issue `#911`.
9. The rejected `#357` nested adapter and the retired `scripts/runtime-operator/**` execution path
   remain unused.
10. No statement in this record grants host, production, protected-resource, credential, release,
    destructive, financial, legal-risk, policy-change, or out-of-scope authority.

## Regression evidence retained, not rerun

Repository tests encode the behavior at three levels:

| Evidence | Source-encoded assertion | Current-run status |
| --- | --- | --- |
| #911 policy cases | `tests/runtime-operator-owner-gate-policy.test.ts:25-92` distinguishes routine cases, true policy/destructive gates, and no-action cases. | Inspected only; not executed by Codex. |
| Derivation and sibling isolation | `tests/runtime-operator-derive-remediation.test.ts:9-13`, `tests/runtime-operator-derive-remediation.test.ts:218-235` identifies the owner-routing defect and requires ungated siblings to dispatch beside a gated finding. | Inspected only; not executed by Codex. |
| Durable consumer | `tests/runtime-findings-db-consumer.test.ts:343-365` expects one derived child and one owner-gated settlement in the same consumption pass. | Inspected only; not executed by Codex. |
| Supported HERMES end to end | `tests/hermes-runtime-finding-end-to-end.test.ts:222-245`, `tests/hermes-runtime-finding-end-to-end.test.ts:296-333`, `tests/hermes-runtime-finding-end-to-end.test.ts:399-415` specifies one durable ordinary child, one policy gate, no premature owner decision, and a decision only after the ordinary child completes. | Inspected only; database-backed test was not executed by Codex. |
| Exact dispatch confinement | `tests/hermes-work-contract.test.ts:72-119` verifies the one reserved report, two host validators, non-owning issue projection, tag prohibition, and rejection of host-mutation near matches. | Pending the exact Hermes host command below. |

These tests are repository evidence of the intended and implemented control-plane contract. With the
exception of the focused work-contract command assigned to Hermes, this Work Order does not claim a
fresh test run or live runtime observation.

## Separate historical v1.3.1 context

`DEC-WILLIAMOS-V131-RUNTIME-HARDENING` and the 2026-06-26 v1.3.1 release artifacts record Ollama
startup hardening, the 14B default model, disabled cloud fallback, and dated cold-start and gate
results. They remain valid historical evidence for that release record. No inspected source other than
the prior revision of this report binds those artifacts to issue `#911`, so this revision does not use
them as the #911 defect statement, remediation, current health evidence, or issue-closure evidence.

No June 2026 command, health response, tag check, cold start, smoke suite, or production-readiness gate
was rerun in this lane.

## Truth boundary

- The dispatch packet supplies the current `GOAL-0024`, `WO-HERMES-OUTCOME-28`, base commit, branch,
  and issue projection. Those current identifiers are not inferred from older repository fixtures.
- The repository contains regression specifications for the #911 control-plane defect, but no
  canonical issue body, issue date, current host inventory, or issue-closure evidence.
- Test fixtures establish expected classification behavior. They do not establish that any named host,
  path, service, container, model, or copy currently exists or is safe to mutate.
- Static source inspection establishes intended code behavior, not current database state, queue
  health, host health, or production condition.
- The database-backed end-to-end regression is environment-dependent and was not run in this lane.
- The focused Hermes work-contract test validates dispatch confinement. It does not parse this report,
  prove its substantive claims, establish live runtime reliability, or close issue `#911`.
- Prior `#831` pull-request receipt and head results belong to an earlier dispatch. They are not
  carried forward as current PR, validation, or review state.

## No-runtime-host-mutation ledger

```text
REPOSITORY_WRITE_LIMITED_TO_RESERVED_REPORT: true
READ_ONLY_REPOSITORY_COMMANDS_EXECUTED: rg
BOUNDED_FILE_EDIT_TOOL_USED: apply_patch
VALIDATOR_EXECUTED_BY_CODEX: false
GIT_OR_GITHUB_OPERATION_PERFORMED_BY_CODEX: false
HOST_MUTATING_COMMAND_EXECUTED: false
HOST_RUNTIME_PROCESS_STARTED_OR_STOPPED: false
SERVICE_CONTAINER_SCHEDULER_OR_DATABASE_CHANGED: false
HOST_OR_STORAGE_INVENTORY_PERFORMED: false
FILE_DIRECTORY_OR_COPY_MOVED_OR_DELETED: false
OLLAMA_PROBED_STARTED_STOPPED_OR_CONFIGURED: false
MODEL_PULLED_OR_SELECTED: false
RUNTIME_OR_PROVIDER_STATE_CHANGED: false
NETWORK_OR_PORT_STATE_CHANGED: false
ENVIRONMENT_OR_PACKAGE_CHANGED: false
PRODUCTION_DATA_OR_DEPLOYMENT_CHANGED: false
SECRET_CREDENTIAL_TOKEN_COOKIE_SESSION_OR_PASSWORD_INSPECTED: false
PAID_OVERAGE_OR_CREDIT_PURCHASED: false
DESTRUCTIVE_ACTION_PERFORMED: false
RELEASE_OR_TAG_CREATED_MOVED_PUSHED_OR_DELETED: false
PROPERTY_WORKBENCH_TERRAPILOT_TERRAFUSION_COUNTY_OR_PACS_TOUCHED: false
REJECTED_ISSUE_357_ADAPTER_USED: false
SCRIPTS_RUNTIME_OPERATOR_EXECUTION_PATH_USED: false
SCRIPTS_RUNTIME_OPERATOR_PATH_MODIFIED: false
OBSIDIAN_CHANGED: false
OWNER_OPERATION_OR_CONTACT_REQUIRED: false
```

This ledger describes actions initiated by this bounded delivery lane. It makes no claim about
unobserved activity elsewhere on the host.

## Independent file review

Two separate read-only evidence lanes checked the #911 source binding and the exact report/work-
contract boundary before implementation. A separate assurance context then reviewed the revised file
against the dispatch, cited sources, current contract, truth boundary, and no-host-mutation ledger. It
found one Medium overstatement of authority inheritance and one Low review-state contradiction. The
record now distinguishes verified parent authority from mechanically narrowed child implementation
and queue grants, and its structured review state agrees with the READY handoff. Exact-candidate
recheck confirmed both findings resolved and reported no new finding.

## Hermes host validation handoff

Codex did not run validators, Git, GitHub, interpreters, package managers, runtime commands, or host
operations. Hermes owns the exact post-handoff validation and repository lifecycle declared by this
Work Order:

```text
git diff --check: PENDING_HERMES_HOST
npx vitest run tests/hermes-work-contract.test.ts: PENDING_HERMES_HOST
commit: null
prUrl: null
merged: false
mergeCommit: null
```

The Vitest command verifies the exact registered #911 contract and its no-host-mutation confinement;
it does not parse the Markdown body. Substantive assurance is supplied by independent file review.
A normal repository revert of this single report is the complete rollback; no host rollback is
needed.

## Safety

- The only modified path is the exact reserved report.
- The report records the #911 control-plane remediation without executing the cases it describes.
- Historical Ollama release evidence is preserved as separate context and is not upgraded into current
  runtime truth.
- No blocked scope was crossed, no new authority was inferred, and no owner touch occurred.
- Host validation, exact-head review, commit, pull request, merge, verification, and cleanup remain
  owned by Hermes after this file handoff.
