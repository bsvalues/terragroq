# WO-WOS-V1.3-001 - Secure Primary Decision Intake

## Result

Implementation is ready for reviewed delivery under Issue #527.

WilliamOS can now consume one exact `APPROVE` or `DENY` response from the
authenticated Primary Operator's direct Codex task. The bridge derives scope,
identity, request version, and repository identity from WilliamOS state and the
Codex App Server. Callers cannot provide those values.

## Security properties

- exactly one current WilliamOS-native R0/R1 request must be actionable;
- the queue item must remain blocked, approved, and authority-verified;
- protected or explicitly blocked outcome text is rejected;
- the response must come from the declared Primary ChatGPT account in a root
  Codex task for the same Git repository;
- only an exact `APPROVE`, `DENY`, or `DECLINE` response is recognized;
- responses expire after one hour and duplicate candidates fail closed;
- the existing transactional owner-decision contract provides stale-state,
  active-lease, replay, conflict, and exactly-once fencing;
- non-secret request and response digests are persisted in the decision
  evidence and audit records;
- a resident cycle without an authenticated Codex task remains inert.

No transcript text, credentials, cookies, tokens, session values, or secrets
are returned or persisted by the bridge.

## Product surface

The Goal Console decision card keeps both choices and their consequences
together and now states that the same exact request can be answered in the
authenticated Codex task. The existing browser action remains available and
continues to use the same database decision transaction.

## Validation

- focused bridge, App Server, decision store, CLI, and Goal Console tests:
  131 passed;
- ESLint: passed with no warnings or errors;
- full Vitest suite: 2,532 passed, 2 skipped;
- Next.js production build with `NEXT_PRIVATE_BUILD_WORKER=0` and telemetry
  disabled: passed;
- `git diff --check`: passed;
- changed-file secret-like-value scan: passed.

The first build retry encountered a missing pnpm-linked Next worker file. The
unchanged frozen lockfile was rematerialized in the isolated worktree and the
build then passed. No dependency declaration changed.

## Boundaries

No TerraFusion, Property Workbench, TerraPilot, county/PACS system, protected
data, production mutation, paid overage, destructive action, auth bypass,
public signup, blanket future approval, self-granted authority, or rejected
Issue #357 path was introduced.
