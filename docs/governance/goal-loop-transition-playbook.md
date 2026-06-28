# Goal/Loop Autonomous Transition Playbook

Work order: `WO-TERRAGROQ-030`  
Goal: Remove Owner as Middleman
Repository: `bsvalues/terragroq`

This playbook defines how agents continue through normal governed software work
states without using the owner as the workflow engine. The owner is an escalation
authority for exceptional risk, not a required approval hop for every successful
PASS, PR, review, merge, validation, post-merge, or next-work-order transition.

This playbook does not replace the authority model. Normal transitions are
automatic only inside the authority and release gates already granted by the
active work order. Approval is still not authority.

## Goal Model

Goals are business outcomes. A goal can contain one or more work orders.

Work Orders are execution units under goals. Each completed work order transitions
to the next work order unless the goal is complete or an escalation rule is met.

## Continuation Rule

A completed transition is not a stop. `RESULT: PASS`, `MERGED_POST_VERIFY_READY`,
`NEXT_WO_TRANSITION`, a selected next work order, or a completed transition chain
must not be treated as a return-to-owner condition.

Return to the owner only when `ESCALATION_REQUIRED: YES`.

If `ESCALATION_REQUIRED: NO` and `NEXT_WO` exists, start `NEXT_WO` immediately and
carry the prior result forward as evidence inside that next work order. Do not
emit a final owner-facing report first.

If `ESCALATION_REQUIRED: NO` and `NEXT_WO` does not exist, generate the next work
order from the active goal registry and start it.

Emit a final owner-facing report only when a true escalation is required or when
the active goal is fully complete and no next work order exists.

## Work Order Model

Every work order must include:

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

## Standard Loop

1. Sync base.
2. Confirm clean worktree.
3. Create or switch branch.
4. Implement scoped change.
5. Validate.
6. Repair validation failures when the repair stays in scope.
7. Commit only when `A7_COMMIT` authority and the commit gate are open.
8. Push and open PR only when `A8_PUSH` authority and the push gate are open.
9. Inspect checks and review comments.
10. Patch in-scope review comments.
11. Merge only when standing merge rules pass and merge authority is present.
12. Post-merge verify.
13. Generate or start the next work order.
14. Continue operating without returning to the owner unless escalation is required.

## Normal Transitions

| State | Trigger | Next transition |
| ----- | ------- | --------------- |
| `PASS_LOCAL_READY` | Local validation passes and scope is contained. | Push/open PR if PR flow and authority gates allow it; otherwise continue to `NEXT_WO_TRANSITION`. |
| `PR_OPEN_READY_FOR_REVIEW` | PR exists and checks/reviews need inspection. | Patch in-scope issues until `PR_READY_FOR_MERGE`, or escalate if a rule is met. |
| `PR_READY_FOR_MERGE` | Checks are green, review comments are addressed or non-blocking, and merge state is clean. | Merge if standing merge rules and authority gates pass; otherwise transition to repair/escalation. |
| `MERGED_POST_VERIFY_READY` | PR merged. | Fetch/verify `origin/main`, verify readiness if normal deployment occurred, then continue to `NEXT_WO_TRANSITION`. |
| `VALIDATION_FAILURE` | Validator fails. | Repair in same WO if in scope; otherwise create a narrow repair WO. |
| `SCOPE_DRIFT` | Diff exceeds allowed scope. | Narrow the diff or split into a new WO. |
| `REVIEW_NIT` | Non-blocking review feedback appears. | Patch if cheap and in scope; otherwise record follow-up WO. |

### PASS_LOCAL_READY

If PR is allowed and `A8_PUSH` plus the push gate are active, push the branch and
open a PR. If no PR is needed, continue to the next work order.

### PR_OPEN_READY_FOR_REVIEW

Inspect checks, comments, and review threads. Patch in-scope issues. Continue
until the PR is merge-ready or an escalation rule is met.

### PR_READY_FOR_MERGE

Merge automatically only when all standing merge rules pass and the active WO
also grants the required merge/release authority. Continue to post-merge
verification.

### MERGED_POST_VERIFY_READY

Verify `origin/main`. Verify production/readiness if normal deployment occurred.
Continue to the next work order immediately. Do not return a final report unless
escalation is required, or the active goal is complete and no next work order
exists.

### VALIDATION_FAILURE

Repair in the same work order if the fix is in scope. If the repair is outside
scope, create a repair work order and continue there.

### SCOPE_DRIFT

Narrow the diff when possible. Otherwise split the out-of-scope work into a new
work order and continue there.

### REVIEW_NIT

Patch if the change is cheap and in scope. Otherwise record a follow-up work
order and continue.

### NEXT_WO_TRANSITION

Start the selected next work order immediately. If no next work order exists and
the active goal is not complete, generate one from the active goal registry.
Return to the owner only if escalation is required. Emit a final owner-facing
report only if escalation is required or the active goal is complete and no next
work order exists.

## Standing Merge Rules

An agent may merge automatically when all are true:

- Checks are green.
- Merge state is clean and mergeable.
- Diff is within the active work-order scope.
- Required authority grant exists and covers the action.
- Required release gates are open (`commitAllowed`, `pushAllowed`, or equivalent
  merge gate for the active WO).
- No secrets are present.
- No database or production data mutation is introduced.
- No auth policy change is introduced.
- No signup policy change is introduced.
- No deployment behavior change is introduced.
- No unresolved blocking review remains.
- Review comments are addressed or explicitly non-blocking.
- Post-merge verification is possible.

## Escalation Only

Escalate to the owner only for:

- Secret or security risk.
- Production database or production data mutation.
- Auth or signup policy change.
- Manual production deployment.
- Deployment strategy change.
- Force push or history rewrite.
- Broad repository restructure.
- Legal, compliance, or business decision.
- Budget or vendor decision.

## Standard Result Format

Every result must include:

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

This result format is evidence carried between transitions. It is not, by itself,
an instruction to stop or report to the owner.

## Current Seed Lane

Current TerraGroq seed state:

- `WO-017`: complete.
- `WO-018B`: complete.
- `WO-018C`: complete.
- PR #17: ready candidate.

Under this playbook, the next transition is:

1. Re-check PR #17 standing merge rules.
2. Merge PR #17 if standing merge rules still pass.
3. Post-merge verify.
4. Continue to `WO-TERRAGROQ-019`.

## Acceptance Criteria

- Normal PASS, PR, review, merge, and post-merge states do not require owner
  intervention.
- Owner escalation is reserved for true governance exceptions.
- Future agents can transition from one work order to the next without asking
  when standing rules pass.
- PR #17 routing is unambiguous.
- Git publication never bypasses `A7_COMMIT`, `A8_PUSH`, or release-gate
  requirements.
