# WO-AEH-004 — Target architecture and protocol ADR

Result: `ACCEPTED_DESIGN / INDEPENDENT_REVIEW_PASS / NOT_IMPLEMENTED`

Base and head: `13709f5789c25dea408283730a6bd35e8fd894ab` (detached review checkout).

## Delivered

The accepted ADR is
[`architecture-and-protocol-adr.md`](../../governance/ai-evalops-harness/architecture-and-protocol-adr.md).
It selects an Atlas PostgreSQL durable pull-worker architecture and specifies:

- immutable jobs and append-only attempts;
- atomic claims, database-time leases, and monotonic fencing;
- transactional outbox delivery with effect-domain idempotency;
- persisted restart-safe settlement descriptors;
- idempotent reconciliation with typed ambiguous outcomes;
- digest-bound events, receipts, and off-worker evidence references;
- pull-only fixed Hermes/AEGIS adapters with no general command runner;
- transaction boundaries, invariants, threats, SRE objectives, and downstream WO traceability;
- explicit rejection of Redis authority, inbound SSH/shell, Kafka, Kubernetes, advisory-lock state,
  process-local settlement, OMEN continuity, and issue `#357` reuse.

## Scope and validation

Only the ADR and this evidence report were created. Repository sources were inspected read-only. No
runtime code, database, schema, queue, worker, scheduler, service, host, network, credential,
deployment, or production state was changed.

Validation:

- Work Order, program, goal, and successor identifiers matched the canonical program.
- All required architecture subjects and rejected alternatives are explicit.
- Relative links resolve within the repository.
- Secret-marker scan and `git diff --check` passed on the reserved files.
- Rollback is removal of the two new, uncommitted files; historical evidence and foreign dirty state
  remain untouched.

The architecture guidance shaped this ADR's explicit context, decision, options, trade-offs,
consequences, and implementation gates.

Independent reviewer `/root/packet_matrix` verified the complete architecture,
transaction boundaries, 12 invariants, threat and SRE traceability, rejected
alternatives, links, rollback, and non-proof posture and returned `PASS` with no
blocking findings. Implementation advisories for immutable intent separation,
transactional expired-lease retirement, signing/key rotation, and effect-domain
derivation are carried forward to WO-AEH-015/016.

## Non-proof

Design acceptance grants no authority and proves no implementation, migration, service availability,
worker execution, recovery, SLO, soak, or production readiness. `WO-AEH-009` and `WO-AEH-015` are
released only to fresh dependency, reservation, and authority evaluation after independent review.

```text
OWNER_OPERATION_TOUCH_COUNT: 0
OWNER_CREDENTIAL_TOUCH_COUNT: 0
OWNER_DIAGNOSTIC_TOUCH_COUNT: 0
OWNER_ROUTINE_DECISION_COUNT: 0
OWNER_ROUTINE_CONTACT_COUNT: 0
OWNER_OPERATION_CERTIFICATION_STATE: UNVERIFIED_ZERO_OWNER_OPERATIONS
```
