# Work Order Template

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
is required or the active goal is complete.

NEXT_WO_TRANSITION:
Start the next WO under the same goal immediately. If no next WO exists, generate
one from the active goal registry. Close the goal only when complete.

RETURN_TO_OWNER:
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
