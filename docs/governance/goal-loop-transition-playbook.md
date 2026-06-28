# Goal/Loop Autonomous Transition Playbook

Work order: `WO-TERRAGROQ-030`  
Goal: Remove Owner as Middle Man  
Repository: `bsvalues/terragroq`

This playbook defines how agents continue through normal governed software-work
states without using the owner as the workflow engine. The owner is an escalation
authority for exceptional risk, not a required approval hop for every successful
PASS, PR, review, merge, validation, post-merge, or next-work-order transition.

## Goal Model

Goals are business outcomes. A goal can contain one or more work orders.

Work Orders are execution units under goals. Each completed work order transitions
to the next work order unless the goal is complete or an escalation rule is met.

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
VALIDATION_REQUIRED:
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
7. Commit.
8. Push and open PR when PR flow is part of the transition.
9. Inspect checks and review comments.
10. Patch in-scope review comments.
11. Merge when standing merge rules pass.
12. Post-merge verify.
13. Generate or start the next work order.

## Normal Transitions

### PASS_LOCAL_READY

If PR is allowed, push the branch and open a PR. If no PR is needed, continue to
the next work order.

### PR_OPEN_READY_FOR_REVIEW

Inspect checks, comments, and review threads. Patch in-scope issues. Continue
until the PR is merge-ready or an escalation rule is met.

### PR_READY_FOR_MERGE

Merge automatically when all standing merge rules pass. Continue to post-merge
verification.

### MERGED_POST_VERIFY_READY

Verify `origin/main`. Verify production/readiness if normal deployment occurred.
Continue to the next work order.

### VALIDATION_FAILURE

Repair in the same work order if the fix is in scope. If the repair is outside
scope, create a repair work order and continue there.

### SCOPE_DRIFT

Narrow the diff when possible. Otherwise split the out-of-scope work into a new
work order and continue there.

### REVIEW_NIT

Patch if the change is cheap and in scope. Otherwise record a follow-up work
order and continue.

## Standing Merge Rules

An agent may merge automatically when all are true:

- Checks are green.
- Merge state is clean and mergeable.
- Diff is within the active work-order scope.
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
