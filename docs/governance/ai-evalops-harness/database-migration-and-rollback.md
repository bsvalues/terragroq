# AI Eval-Ops Database Migration and Rollback Workflow

Status: `IMPLEMENTED / DISPOSABLE_STATIC_PROOF / NO_LIVE_APPLICATION`

The checked-in lane is `migrations/ai-evalops-harness`. Its manifest orders immutable SQL files,
labels expand/contract phases, requires a backup receipt for every change, requires old-reader drain
before contract, and binds required contract rollback/recovery metadata and fixtures by SHA-256. It
requires exact equality between manifest-owned SQL and the directory, derives migration and rollback
filenames exactly from each migration ID, and accepts only the two declared recovery contracts. It
rejects extra, missing, renamed, swapped, reused, duplicate, non-canonical, or path-escaping entries.
The checker refuses any `DATABASE_URL` or
`AEH_DATABASE_URL`; it parses files only and opens no network or database connection.

## Release workflow

1. Generate SQL from the reviewed schema into a clean branch; never use push/sync against a target.
2. Review SQL, assign expand/contract/forward-fix phase, update manifest digests, and run the static
   checker and native tests.
3. In a separately authorized disposable database, restore a fixture or empty baseline, apply all
   migrations for the fresh test, then apply only new migrations to the prior release for upgrade.
4. Compare catalog/schema snapshots to the expected checked-in schema. Any unowned object,
   checksum mismatch, ordering gap, or unexpected generated SQL is drift and blocks release.
5. Before a live migration, require a fresh complete backup receipt and independent restore receipt
   bound to the exact target, pre-change schema digest, migration set, and time window.
6. Expand first with backward-compatible nullable/additive objects. Deploy dual-read/write behavior,
   backfill idempotently, reconcile counts/digests, and prove old and new readers concurrently.
7. Fence and drain old coordinators/readers, prove no old version remains, then apply contract SQL.
8. Record migration ledger, post-schema digest, health, reconciliation, and terminal evidence.

## Recovery decision

Before application writes, a failed migration may use the checked-in inverse only when disposable
testing proves exact restoration and no irreversible statement ran. After writes, prefer a reviewed
forward fix that preserves new data. Restore is a last resort requiring stopped admission, fenced
writers, reconciled attempts, an exact restore-verified pre-change generation, and explicit R3
authority. Contract migration never proceeds without the old-reader drain proof.

The included SQL is a workflow fixture, not the WO-AEH-015 durable job schema and not authorization
to create `ai_evalops` objects anywhere. Live, staging, shared, developer, Atlas, Hermes, Neon, and
production databases are outside this proof.

Repository: bsvalues/terragroq
Version: 13709f5789c25dea408283730a6bd35e8fd894ab
