# Neon → ATLAS cutover package

The controlled procedure to (optionally migrate and) cut WilliamOS over from Neon to the
sovereign `williamos-postgres` on ATLAS. **Nothing here runs automatically.** No live
`DATABASE_URL` switch happens until (a) #650 is merged and (b) the Neon state is
conclusively classified and recorded.

## Roles / secret boundary

- The **operator** holds the Neon secret and runs the read-only state probe locally. The
  probe (`scripts/db/neon-state-probe.mjs`) prints only table names/counts/timestamps and a
  manifest hash — never the connection string. The Neon `DATABASE_URL` is never pasted into
  chat, committed, or copied into evidence.
- All ATLAS-side steps run from AEGIS against `williamos-postgres` (loopback `:15432`).

## Preconditions (hard gates)

1. #650 merged (atomic single-client schema bootstrap; fresh-pgvector rollback proof green).
2. Neon state classified and the manifest recorded (see Track B).

## Step 0 — Neon state truth (Track B, read-only, run once)

```bash
# operator's local environment, secret only in env:
DATABASE_URL="postgres://…neon…" node scripts/db/neon-state-probe.mjs > neon-state-$(date -u +%Y%m%dT%H%M%SZ).json
```

Records: `observed_at`, database identity (name + version), table list, per-table row
counts, selected canonical IDs/counts, `classification_candidate`, `manifest_sha256`.

**Classification rule (strict):**

```
if every canonical table is empty AND all auth users are provable scaffold:
    NO_CANONICAL_STATE
else:
    MIGRATION_REQUIRED
```

Record the chosen classification and the `manifest_sha256` as the decision receipt. No
inference from memory — only from the manifest.

## Branch A — NO_CANONICAL_STATE (skip restore)

1. Confirm ATLAS holds the reviewed empty schema:
   `ATLAS_URL=… node scripts/db/verify-cutover.mjs validate` → all canonical tables 0.
2. No restore. Proceed to Step 7 (cutover) with a fresh sovereign DB.

## Branch B — MIGRATION_REQUIRED (export → hash → restore → compare)

1. Export from Neon (operator, holds secret):
   `pg_dump --format=custom --no-owner --no-privileges --file williamos-neon.dump "$NEON_URL"`
2. `sha256sum williamos-neon.dump` → record.
3. Restore into ATLAS: `TARGET_URL=… DUMP_PATH=… bash scripts/db/restore-dump.sh`.
4. Exhaustive compare (row-by-row content, per #655):
   - `DATABASE_URL="$NEON_URL" node scripts/db/db-state-manifest.mjs > neon.json` (operator)
   - `DATABASE_URL="$ATLAS_URL" node scripts/db/db-state-manifest.mjs > atlas.json`
   - `node scripts/db/db-state-manifest.mjs --compare neon.json atlas.json` → must be `IDENTICAL`.

## Step 7 — Cutover (both branches converge here)

1. **Validation mode** (read-only, no switch):
   `ATLAS_URL=… node scripts/db/verify-cutover.mjs validate` — ATLAS reachable, schema/counts as expected.
2. **Neon quiescence baseline**: capture a Neon state probe now (`neon-before.json`).
3. **Switch `DATABASE_URL`** in the app/runtime environment to the ATLAS connection string.
   (Self-hosted runtime env only; no third-party dashboard.)
4. **Prove writes land on ATLAS**: `ATLAS_URL=… node scripts/db/verify-cutover.mjs canary`
   → `ATLAS_WRITE_CONFIRMED`, and the app's own next write appears in the ATLAS manifest delta.
5. **Prove Neon receives no new writes**: capture `neon-after.json`, then
   `node scripts/db/verify-cutover.mjs quiescence neon-before.json neon-after.json`
   → `NEON_QUIESCENT`.
6. Keep Neon **read-only** for a short rollback window.

## Rollback

If any check fails: revert the app/runtime `DATABASE_URL` to the previous value (kept in the
operator environment), restart, and re-run `validate`. No data on ATLAS is destroyed;
investigate before retrying.

## Archive / hash receipt (after acceptance)

1. Final export of the live ATLAS DB:
   `pg_dump --format=custom --no-owner --no-privileges --file williamos-atlas-<ts>.dump "$ATLAS_URL"`
2. `sha256sum` it; store the dump + hash on AEGIS backup.
3. Record the receipt: classification, `manifest_sha256`(Neon), dump hash, cutover timestamp.
4. Only then retire Neon (operator, dashboard).

## Notes

- Credentials live only in the runtime environment / operator secret store, never in the
  repo or evidence. Every script here reads connection strings from the environment and
  prints none.
- The `_cutover_canary` table created by the canary proof is disposable — drop it after
  acceptance.
