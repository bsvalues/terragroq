# Work Order Template

Canonical goal: `GOAL-WOS-MULTI-AGENT-OPERATOR-001`

Every new operator Work Order must additionally declare:

```text
PROGRAM:
GOAL:
LOOP:
STATUS:
RISK_CLASS:
DEPENDS_ON:
PURPOSE:
CURRENT_TRUTH:
ALLOWED_FILES_OR_AREAS:
ALLOWED_ACTIONS:
BLOCKED:
DELIVERABLES:
ACCEPTANCE_CRITERIA:
VALIDATION:
REVIEW_REQUIREMENTS:
MERGE_AUTHORITY:
ROLLBACK_OR_REVERSAL:
STOP_CONDITIONS:
EVIDENCE_PATH:
NEXT_ON_PASS:
NEXT_ON_BLOCK:
```

One Work Order owns one coherent outcome. A discovered prerequisite becomes a
registered Work Order; it does not become silent scope expansion.

Use this template for governed Goal/Loop work. Fill every field before starting.

```text
WORK_ORDER:
TITLE:
GOAL:
REPO:
BASE:
BRANCH:

OBJECTIVE:

SCOPE:

OUT_OF_SCOPE:

FILES_ALLOWED:

FILES_FORBIDDEN:

BLOCKED_ACTIONS:

AUTHORITY_LEVEL:

AUTHORITY_GRANT:

AUTHORITY_DECISION_ID:

AUTHORITY_GRANT_REF:

AUTHORITY_STATUS_EVENT_REFS:

AUTHORITY_SUBJECT:

AUTHORITY_SCOPE_REQUIRED:

PROGRAM_ACTIVATION_GRANT_REF:

ACTIVE_AUTHORITY_EVIDENCE_REF:

OWNER_OPERATION_TOUCH_COUNT: 0

OWNER_CREDENTIAL_TOUCH_COUNT: 0

OWNER_DIAGNOSTIC_TOUCH_COUNT: 0

OWNER_ROUTINE_DECISION_COUNT: 0

OWNER_ROUTINE_CONTACT_COUNT: 0

OWNER_OPERATION_EVIDENCE_REF:

OWNER_OPERATION_CERTIFICATION_STATE: UNVERIFIED_ZERO_OWNER_OPERATIONS

COMMIT_ALLOWED:

PUSH_ALLOWED:

TAG_ALLOWED:

VALIDATION_REQUIRED:

ACCEPTANCE_CRITERIA:

SUCCESS_TRANSITION:

VALIDATION_FAILURE_TRANSITION:

REVIEW_TRANSITION:

MERGE_TRANSITION:

POST_MERGE_TRANSITION:

NEXT_WO_TRANSITION:

ESCALATION_RULES:
```

Authority references are verifier inputs, not authority created by a Work Order or coordinator. Before
an authority-gated action, verify that active recorded authority evidence covers the exact subject,
scope, risk, and action and has not been revoked or materially changed. Signed artifacts may strengthen
certification but are not required to re-authorize an already-recorded owner decision. A missing,
mismatched, or revoked authority record fails closed.

All five owner-touch/contact counters are mandatory evidence. Caller-supplied zeros remain
`UNVERIFIED_ZERO_OWNER_OPERATIONS`; this phase has no verifier capable of certification. Any
nonzero value records lifecycle state `FAILED_OWNER_BABYSITTING` with reason code
`FAIL_OWNER_BABYSITTING`; the reason code is not a state. A genuine owner authority decision is outside
routine-operation counts, while owner courier, credential, diagnostic, or routine implementation work
increments the applicable counter. Progress and status contact also increments
`OWNER_ROUTINE_CONTACT_COUNT`; communication is final-only unless a genuinely new authority decision
is required.

## Transition Defaults

```text
SUCCESS_TRANSITION:
If local validation passes and PR flow is allowed, push/open PR only when A8_PUSH
authority and the push gate are active.
If no PR is needed, continue directly to NEXT_WO_TRANSITION.

VALIDATION_FAILURE_TRANSITION:
Repair in the same WO if in scope.
If outside scope, create a narrow repair WO and continue there.

REVIEW_TRANSITION:
Patch in-scope blocking review comments.
Patch cheap in-scope nits.
Record non-blocking or out-of-scope nits as follow-up WOs.

MERGE_TRANSITION:
Merge automatically when standing merge rules pass and required authority/release
gates are active.
Escalate only when an escalation rule is met.

POST_MERGE_TRANSITION:
Fetch and verify `origin/main`.
Verify production/readiness if normal deployment occurred.
Continue to NEXT_WO_TRANSITION without returning to the owner unless escalation
is required.

NEXT_WO_TRANSITION:
Recompute the dependency-cleared eligible set under the active goal.
Dispatch every reservation-compatible Work Order within provider and risk budgets.
Generate a new Work Order only for a discovered prerequisite or approved scope gap;
never use numeric adjacency as a global mutex.
Close the goal only when every declared Work Order is complete or explicitly deferred.

RETURN_TO_OWNER:
Allowed only when ESCALATION_REQUIRED is YES.

FINAL_OWNER_REPORT:
Allowed only when ESCALATION_REQUIRED is YES, or when the active goal is complete
and no next WO exists.
```

## Standing Merge Rules

```text
An agent may merge automatically when all are true:
- Checks green.
- Merge state clean/mergeable.
- Diff within WO scope.
- Required authority grant covers the action.
- Required commit/push/merge gates are open.
- No secrets.
- No DB/data mutation.
- No auth policy change.
- No signup policy change.
- No deployment behavior change.
- No unresolved blocking review.
- Comments are addressed or non-blocking.
- Post-merge verification is possible.
```

## Standard Result Format

```text
RESULT:
WORK_ORDER:
GOAL:
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

Treat the result as transition evidence. Do not stop after PASS when
ESCALATION_REQUIRED is NO and another WO exists or can be generated.
