# WilliamOS Standard Result Classifier

Work order: `WO-OPS-003`
Goal: `GOAL-OPS-001 - Codex Operator Mode`
Type: Governance / Classifier
Risk: Low, documentation only

## Purpose

This classifier gives Codex a standard result vocabulary for every WilliamOS
work-order loop. It prevents vague handoffs and makes the next operator action
explicit.

The classifier is a governance document. It does not implement runtime behavior,
automate execution, or mutate data.

## Rules

- Every loop result must use exactly one primary `RESULT`.
- A result must name the next operator action.
- A blocked result must name the owner gate or safety gate.
- Pending checks are not a stopping point when monitoring is authorized.
- Review threads after merge require immediate classification and remediation
  when they are substantive and in scope.
- Secret exposure always stops the loop.
- Every stop or completion result carries all five owner-touch/contact counters, the
  independent evidence reference when one exists, and the resulting
  certification state.
- Genuine consequential owner authority decisions are excluded from
  `OWNER_ROUTINE_DECISION_COUNT`. Routine owner courier, diagnostic,
  credential, implementation, or progress contact disqualifies certification.
- Caller-supplied zero counters remain `UNVERIFIED_ZERO_OWNER_OPERATIONS`
  because that input path does not invoke the independent context-bound evidence verifier.
- A surface with no selected run or Work Order reports `NO_OWNER_OPERATION_EVIDENCE`
  and `not recorded` counters rather than invented zeros.

## Result Classes

### `RESULT: PASS`

Meaning: the work order completed, validation passed, no owner decision remains,
and no PR/merge step is required.

Required evidence:

- files changed or `none`
- validation result
- safety posture
- next recommended work order

Operator action:

- continue to the next authorized loop

### `RESULT: PASS_PENDING_CHECKS`

Meaning: local work passed and a PR is open, but remote checks are still
pending.

Legacy note: older reports may use `PASS_PENDING_PR`. Treat that as a deprecated
alias for `PASS_PENDING_CHECKS`. New reports must use `PASS_PENDING_CHECKS`.

Required evidence:

- PR URL
- local validation result
- pending check names
- review-thread status if available

Operator action:

- continue monitoring checks
- do not return to William unless a gate fails or owner authority is missing

### `RESULT: PR_OPEN`

Meaning: a PR was opened and the next action is PR gate monitoring.

Required evidence:

- PR URL
- files changed
- validation result
- safety posture

Operator action:

- monitor checks
- inspect review threads
- remediate in-scope review issues
- merge only if merge authority exists and gates are clean

### `RESULT: MERGED`

Meaning: PR merged, `origin/main` verified, and required production or read-only
checks completed.

Required evidence:

- PR URL
- merge commit
- `origin/main`
- check summary
- review-thread summary
- production verification when required
- next recommended work order

Operator action:

- continue to the next authorized loop unless the active goal is complete

### `RESULT: MERGED_WITH_REMEDIATION_REQUIRED`

Meaning: PR merged, but a substantive gate issue was found afterward.

Examples:

- unresolved substantive review thread appeared after merge
- production verification exposed a regression
- evidence packet shows incomplete validation

Required evidence:

- merged PR URL
- merge commit
- issue classification
- file or surface affected
- safety posture

Operator action:

- immediately create a narrow remediation loop if the fix is in scope
- stop for owner authority if remediation requires scope expansion

### `RESULT: BLOCKED_OWNER_DECISION`

Meaning: only William can decide the next move.

Examples:

- product doctrine decision
- owner identity decision
- safety exception
- scope expansion
- merge authority missing

Required evidence:

- decision needed
- why Codex cannot proceed safely
- options
- recommended option
- safe default

Operator action:

- return an owner decision packet

### `RESULT: BLOCKED_OWNER_MANUAL_ACTION_REQUIRED`

Meaning: the next step requires private owner action that Codex must not perform
or observe in secret-bearing form.

Examples:

- credential entry
- secret rotation
- manual account recovery
- external account approval

Required evidence:

- action category
- safe observation boundary
- what Codex will verify after owner action

Operator action:

- stop
- never request the secret value

### `RESULT: BLOCKED_SECRET_EXPOSURE_ROTATION_REQUIRED`

Meaning: a password, token, cookie, session value, DB URL, private key, or other
secret may have been exposed.

Required evidence:

- exposure class without repeating the secret
- affected surface or artifact
- rotation requirement
- unsafe artifacts to avoid

Operator action:

- stop
- rotate before continuing
- do not reuse the exposed value
- do not commit or report the secret

### `RESULT: FAILED_VALIDATION`

Meaning: a required local, PR, build, review, or production validation failed.

Required evidence:

- failing command or check
- failure summary
- whether a narrow in-scope fix exists
- safety posture

Operator action:

- apply a narrow in-scope fix when authorized
- otherwise return a blocker with required authority

### `RESULT: FAILED_OWNER_BABYSITTING`

Meaning: the run required at least one routine owner operation, credential
touch, diagnostic touch, routine decision, or routine contact. A genuine owner-only authority
decision is consequential governance and is not counted as a routine decision.

Required evidence:

- all five owner-touch/contact counters
- the nonzero counter or counters
- `FAIL_OWNER_BABYSITTING` reason code
- independent evidence reference when available
- safe next operator action

Operator action:

- do not certify the run
- remove the routine owner dependency before a later certification attempt
- do not reinterpret owner courier, diagnostic, or credential work as authority

### `RESULT: CERTIFIED_ZERO_OWNER_OPERATIONS`

Meaning: a terminal run's exact context and five zero counters were signed by an owner-approved,
purpose-restricted assurance recorder and committed once in the complete assurance checkpoint chain
whose current head was independently anchored. The trusted host also verified the complete source event
chain through the authoritative run boundary. The standalone artifact validator cannot emit this result.

Required evidence:

- preregistered run ID and manifest hash
- exact program, goal, loop, Work Order, decision, and action context
- complete source-log observation bounds and classification-policy hash
- assurance evidence content hash and signature
- checkpoint chain, sequence, commitment, and independently sourced current head
- all five validated counters equal zero

Operator action:

- record the post-run certification as evidence only
- do not treat certification as dispatch, write, merge, release, or activation authority

### `RESULT: BLOCKED_SAFETY`

Meaning: continuing would violate the work order, product doctrine, or safety
posture.

Examples:

- unapproved auth behavior change
- DB/schema/env/package/Vercel change required
- public account-creation behavior might return
- autonomy or worker activation is implicated
- production write behavior is introduced

Required evidence:

- violated gate
- why it is outside scope
- safe default

Operator action:

- stop
- return the specific safety blocker

## Required Return Fields

Every non-blocked loop should report:

```text
RESULT:
WORK_ORDER:
GOAL:
BASE:
BRANCH:
COMMIT:
PR:
MERGED:
origin/main:
FILES_CHANGED:
VALIDATION:
REVIEW_THREADS:
PRODUCTION_VERIFICATION:
SAFETY_POSTURE:
OWNER_DECISION_REQUIRED:
NEXT_RECOMMENDED_WO:
OWNER_OPERATION_TOUCH_COUNT:
OWNER_CREDENTIAL_TOUCH_COUNT:
OWNER_DIAGNOSTIC_TOUCH_COUNT:
OWNER_ROUTINE_DECISION_COUNT:
OWNER_ROUTINE_CONTACT_COUNT:
OWNER_OPERATION_EVIDENCE_REF:
OWNER_OPERATION_CERTIFICATION_STATE:
```

Every owner-blocked loop should report:

```text
RESULT:
WORK_ORDER:
BLOCKER:
WHY_BLOCKED:
SAFE_TO_CONTINUE:
OWNER_DECISION_NEEDED:
NEXT_VALID_ACTION:
OWNER_OPERATION_TOUCH_COUNT:
OWNER_CREDENTIAL_TOUCH_COUNT:
OWNER_DIAGNOSTIC_TOUCH_COUNT:
OWNER_ROUTINE_DECISION_COUNT:
OWNER_ROUTINE_CONTACT_COUNT:
OWNER_OPERATION_EVIDENCE_REF:
OWNER_OPERATION_CERTIFICATION_STATE:
```

## Safe Defaults

- If checks are pending, monitor.
- If review threads are substantive and in scope, remediate.
- If review threads require scope expansion, stop.
- If production health fails after merge, classify and remediate or stop.
- If a secret appears, stop and rotate.
- If owner authority is not explicitly granted, stop.
- If the next loop is authorized and no gate exists, continue.

## Maintenance

Update this classifier only through a governance work order. Runtime result
handling, UI presentation, or persistence must be separately authorized.
