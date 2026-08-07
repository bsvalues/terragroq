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
- the presented request and its digest bind the exact outcome key, queue
  version, terminal event, risk class, authority tuple, approval decision,
  authority grant, allowed choices, and recommendation;
- protected or explicitly blocked outcome text is rejected;
- the response must come from the declared Primary ChatGPT account in a root
  Codex task for the same Git repository;
- the response turn must immediately follow the assistant turn that presented
  the exact request-specific challenge marker;
- only an exact `APPROVE` or `DENY` response is recognized; `DECLINE` is
  accepted as an alias for `DENY`;
- responses expire one hour after the exact challenge is presented, even when
  the underlying terminal wall is older, and duplicate candidates fail closed;
- the existing transactional owner-decision contract provides stale-state,
  active-lease, replay, conflict, and exactly-once fencing;
- the locked recording transaction rechecks that complete presented snapshot
  and rejects any intervening queue, approval, or grant change before insert;
- non-secret request and response digests are persisted in the decision
  evidence and audit records;
- a resident cycle without a bound response remains inert and returns the
  exact expiring request instead of advancing the queue.

No transcript text, credentials, cookies, tokens, session values, or secrets
are returned or persisted by the bridge.

## Product surface

The Goal Console decision card keeps both choices and their consequences
together and now states that the same exact request can be answered in the
authenticated Codex task. The existing browser action remains available and
continues to use the same database decision transaction.

The canonical request shows the owner the outcome key, observed queue version,
terminal event, exact authority scope, approval and grant references, allowed
choices, system recommendation, and both consequences before consent.
The recommendation is derived by an explicit default-deny policy with a visible
rationale; WilliamOS does not bias the owner toward granting new authority.

Pending intake now requires the same live approval and authority-grant state as
queue acquisition, and the resident CLI emits only the canonical request text
when a decision is pending. The binding insert uses one database wall-clock
instant to fence both consent and grant expiry and persists that instant as a
UTC wall timestamp in `decidedAt`. The root Codex entrypoint requires the
canonical stdout to become the complete assistant response before the owner
reply is eligible. The request digest and recording transaction are also bound
to the exact queue row, preventing authority from a sibling history row from
authorizing the request.

## Validation

- focused bridge, App Server, decision store, CLI, and Goal Console remediation
  tests: 149 passed;
- ESLint: passed with no warnings or errors;
- full Vitest suite: 2,553 passed, 2 skipped (the final run used a 15-second
  per-test timeout after unrelated process-concurrency tests exceeded their
  default timeout under host contention);
- resident database request projection: passed with
  `NO_PENDING_PRIMARY_DECISION` and no mutation;
- Next.js production build with `NEXT_PRIVATE_BUILD_WORKER=0` and telemetry
  disabled: passed;
- `git diff --check`: passed;
- changed-file secret-like-value scan: passed.

The first build retry encountered a missing pnpm-linked Next worker file. The
damaged generated package material was quarantined, the unchanged frozen
lockfile was rematerialized in the isolated worktree, and the build then
passed. No dependency declaration changed.

## Boundaries

No TerraFusion, Property Workbench, TerraPilot, county/PACS system, protected
data, production mutation, paid overage, destructive action, auth bypass,
public signup, blanket future approval, self-granted authority, or rejected
Issue #357 path was introduced.
