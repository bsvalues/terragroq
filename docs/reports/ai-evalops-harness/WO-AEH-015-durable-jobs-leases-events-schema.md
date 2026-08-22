# WO-AEH-015 — Durable jobs, leases, events, and outbox schema

Status: `COMPLETE / CONTRACT_VERIFIED / INDEPENDENT_REVIEW_PASS / DISPOSABLE_POSTGRESQL_ONLY`.

## Outcome

The repository now contains an additive Atlas PostgreSQL control-schema migration and a matching TypeScript identity contract. Immutable admitted job intent is separated from mutable `job_projection`; attempts, digest-bound events, and evidence references are append-only; leases carry worker instance/boot identity, renewal sequence, expiry, and a positive per-domain fence; jobs and outbox effects are idempotent within an effect domain; workers, evidence references, and typed terminal classifications are persisted.

The migration adds database constraints and transition triggers rather than relying only on application checks: unique job and outbox idempotency, unique attempt ordinals and claims, same-job projection/event/outbox attempts, same-domain attempt leases, outbox-to-current-lease/fence binding, unique domain/fence pairs, one unreleased lease per domain, immutable lease identity, monotonic renewal with no reopen after release, contiguous per-job event chains, typed terminal receipt evidence, digest shapes, worker identity foreign keys, and immutable-ledger triggers.

## Migration integration

`0002_durable_control_schema` is truthfully an additive `expand` migration. WO-AEH-009's checker was minimally generalized to permit later numeric additive expansions after an independently gated contract migration. Contract migrations still require their own old-reader drain, rollback metadata, backup receipt, and allowed recovery policy. The canonical regression expectation is now `expand -> contract -> expand`; migration IDs remain strictly ordered and every SQL file remains manifest-exact.

Rollback is explicitly limited to disposable or pre-write reversal. After durable writes, recovery must be a reviewed forward fix or restore; deleting control tables is not represented as safe live rollback.

## Validation

- `node --test tests/ai-evalops-harness-schema-drift.test.mjs tests/ai-evalops-harness-durable-schema.test.mjs` — 21/21 pass: 11 WO-AEH-015 contracts/properties and 10 WO-AEH-009 regression/negative tests.
- The cached local `postgres:16` image was used without a pull or network access. The migration was applied to a uniquely named ephemeral container; real PostgreSQL negatives rejected cross-job projections, events, and outbox rows even within the same effect domain, plus lease identity rewrites, non-monotonic renewal, reopening a released lease, wrong/released outbox fences, broken event chains, and non-receipt terminal evidence. The fixture created synthetic domain, worker, job, attempt, lease, event, and evidence-reference rows and attempted rejected outbox/receipt transitions. The container was removed in the test's `finally` path and no matching container remains.
- `node scripts/ai-evalops-harness/schema-drift-check.mjs migrations/ai-evalops-harness` — pass in `disposable-static` mode with three manifest-bound migrations.
- `node --check scripts/ai-evalops-harness/schema-drift-check.mjs` — pass.
- Scoped `git diff --check` — pass.

Evidence and exact artifact hashes are recorded in `evidence/WO-AEH-015-durable-control-schema-validation.json`.

## Scope and rollback

WO-AEH-015 owns the new type contract, `0002` migration and rollback, new native test, report, and evidence. The manifest plus the checker and WO-AEH-009 regression assertion are narrow integration edits. Rollback removes the new files, removes only the `0002` manifest entry, and restores the checker/test integration lines after confirming no later migration depends on them. Existing `0000`/`0001` files and historical evidence remain untouched.

## Non-proof

No live database, dependency installation, image pull, network, service, host worker, external effect, durable evidence store, outbox delivery, or live state was accessed or mutated. SQL and synthetic control rows—including jobs, attempts, a lease/fence, event, and evidence reference—existed only in a removed ephemeral PostgreSQL container. This proves selected database constraints and triggers execute, but does not prove external execution or receipt, concurrent transaction isolation, runtime adapter enforcement, restore, soak, Atlas readiness, or production readiness.

```text
OWNER_OPERATION_TOUCH_COUNT: 0
OWNER_CREDENTIAL_TOUCH_COUNT: 0
OWNER_DIAGNOSTIC_TOUCH_COUNT: 0
OWNER_ROUTINE_DECISION_COUNT: 0
OWNER_ROUTINE_CONTACT_COUNT: 0
OWNER_OPERATION_CERTIFICATION_STATE: UNVERIFIED_ZERO_OWNER_OPERATIONS
```

Independent reviewer `/root/packet_schema` reran all 21 tests, the migration
checker and disposable PostgreSQL negatives, verified relational invariants,
cleanup, rollback, manifest integration and seven hashes, and returned `PASS`
with no blockers. Release only declared successors to fresh dependency and
authority evaluation.
