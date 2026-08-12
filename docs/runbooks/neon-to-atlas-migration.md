# Neon → ATLAS migration runbook (WilliamOS state)

Move WilliamOS state (goals, outcome queue, decisions, authority grants, governance /
evidence events, embeddings) off cloud Neon onto a self-hosted, lab-controlled Postgres on
ATLAS. **Preserve everything and verify exhaustively; Neon is retired only after the state is
copied, verified, cut over, and rollback-proven** — never merely because the schema exists on
ATLAS.

## Roles and the secret boundary

- **Owner** holds the Neon credentials and runs the Neon export (Step 2), sets Neon read-only
  (Step 9), and retires Neon (Step 10, dashboard). Secrets are never dumped into evidence
  artifacts or committed.
- **Operator (controller on AEGIS)** runs everything between the dump and cutover — restore,
  exhaustive verification, validation-mode run, archive + hash — against ATLAS over SSH.

## Target

A dedicated `williamos-postgres` container on ATLAS (`deploy/atlas/williamos-postgres.compose.yaml`,
image `pgvector/pgvector:pg16`), host port **15432**, its own volume and credentials — physically
separate from TerraFusion's `tf-postgres` on `:5432`, which is never touched.

## Steps

1. **Freeze writes / cutover boundary.** Confirm no live WilliamOS runtime is writing to Neon
   (stop any resident Hermes cycle / app pointed at Neon). Record the boundary time.
2. **Export from Neon (owner).** From a host with the Neon secret:
   ```bash
   pg_dump --format=custom --no-owner --no-privileges \
     --file williamos-neon-$(date +%Y%m%dT%H%M%SZ).dump "$NEON_DATABASE_URL"
   ```
   Copy the dump to AEGIS (e.g. `scp` to `~/migration/`). Do not paste the Neon URL anywhere.
3. **Hash the export.** `sha256sum williamos-neon-*.dump` → record in evidence.
4. **Restore into ATLAS.** Bring up the container, then:
   ```bash
   TARGET_URL="postgres://williamos:<pw>@<atlas>:15432/williamos" \
   DUMP_PATH=~/migration/williamos-neon-*.dump  bash scripts/db/restore-dump.sh
   ```
5. **Verify exhaustively.** Build a state manifest of BOTH databases and compare — this checks
   the table set (schema), per-table row counts, primary-key ranges, and a per-table content
   hash covering every row (goals, queue, decisions, authority grants, governance/evidence):
   ```bash
   DATABASE_URL="$NEON_DATABASE_URL"  node scripts/db/db-state-manifest.mjs > src.json   # owner-run
   DATABASE_URL="$ATLAS_URL"          node scripts/db/db-state-manifest.mjs > dst.json
   node scripts/db/db-state-manifest.mjs --compare src.json dst.json   # exit 0 == IDENTICAL
   ```
   Investigate any difference. Clearly synthetic/demo rows are classified separately and excluded
   only if provably non-canonical; canonical/audit/authority rows must match.
6. **Validation-mode run.** Start WilliamOS against ATLAS read-side only and confirm goals, queue
   state, decisions, and grants render correctly. No writes yet.
7. **Switch `DATABASE_URL`** to the ATLAS connection string in the app/runtime environment.
8. **Prove new writes land only on ATLAS.** Perform one bounded write and confirm it appears on
   ATLAS and not on Neon; re-run the manifest to see the ATLAS delta.
9. **Rollback window.** Keep Neon **read-only** for a short acceptance window.
10. **Retire Neon.** After acceptance: export a final archive, hash it, store on AEGIS backup, then
    retire the Neon project (owner).

## Notes

- Credentials live only in a git-ignored env file (`*.env`) / the runtime environment, never in
  the repo or evidence. `restore-dump.sh` and `db-state-manifest.mjs` read connection strings from
  the environment and never echo them.
- The ATLAS database must have the `vector` extension (the `pgvector/pgvector` image ships it);
  `restore-dump.sh` ensures it before restoring.
