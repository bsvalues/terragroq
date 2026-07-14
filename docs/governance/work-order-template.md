# Work Order Template

Canonical goal: `GOAL-WOS-CODEX-OPERATOR-001`

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

OWNER_OPERATION_TOUCH_COUNT: 0

OWNER_CREDENTIAL_TOUCH_COUNT: 0

OWNER_DIAGNOSTIC_TOUCH_COUNT: 0

OWNER_ROUTINE_DECISION_COUNT: 0

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
an authority-gated action, verify the immutable owner grant and its complete append-only owner-signed
status stream against the exact subject, scope, expiry, and current revocation state. A missing,
expired, untrusted, mismatched, or revoked grant fails closed. A program activation grant is separate
from implementation or merge authority and must be explicitly referenced when activation is in scope.

All four owner-touch counters are mandatory evidence. Any nonzero value records lifecycle state
`FAILED_OWNER_BABYSITTING` with reason code `FAIL_OWNER_BABYSITTING`; the reason code is not a state.

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
Start the next WO under the same goal immediately.
If no next WO exists and the active goal is not complete, generate one from the
active goal registry and start it.
Close the goal only when it is complete and no next WO exists.

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
