# WO-866 — AEGIS_BACKUP_ACTIVATION

**Work order:** https://github.com/bsvalues/terragroq/issues/866 (child of #862, landed as #865)

**Work context receipt:** `a0528594dc2d420fc7150819248cea158c86a5163163a3bdf99f270b0ea7455b`
against `origin/main = d9b92c1577ad6e03a9a80e6e9243c954b8f9c46a`, provenance **local** — no device
credential is enrolled, so authority was NOT checked and the claim was NOT ledger-recorded.

## One cause, three machines

`backup-v1.sh` on AEGIS carried **two** stale addresses: `ATLAS=bs@192.168.1.156` and
`HH=bs@192.168.1.154` for HERMES. Those are the same dead addresses that broke
`HermesCrossNodeBackupSync` and `lab-health.ps1` in #862.

The lab's LAN moved subnets and every node's scripts kept the old addresses. ATLAS is `192.168.88.5`,
HERMES is `192.168.88.9`, AEGIS is `192.168.88.6`. **One network change silently disabled the backup
system on three machines**, and each failure surfaced as something unrelated — a red cron result on
HERMES, an hourly health alert nobody read, and on AEGIS simply nothing at all, because it had never
been scheduled to fail loudly in the first place.

Correcting the two addresses alone revived AEGIS: it immediately pulled from ATLAS again
(`dump bytes=901`) and completed the forge crown-jewel (`38976 files, 3.15 GB, bundles_ok=9/9`).

## What was already good, and kept

`backup-v1.sh` is well built and was **extended, not replaced**: `pg_dumpall --no-role-passwords`
(schema+data, no secrets), rsync with SHA-256 manifests, dual-disk crown-jewel copies with a set-hash
comparison across both disks, per-generation retention, and — the strongest part — restore proof that
**bare-clones every git bundle** rather than merely hashing it. Its deliberate exclusion of the heavy
corpus (`/forge/databases`, `/forge/sources`) is a sound crown-jewel strategy and was left alone.

## Defects fixed

1. **Stale addresses** (above). Original preserved as `backup-v1.sh.bak-20260818`.
2. **The WilliamOS brain was backed up by nothing.** The script dumped `atlas:tf-postgres`, which is
   empty — its own receipts recorded `dbs=[icondo] app_db=icondo user_tables=0 approx_rows=0`, a
   truthfully verified restore of an empty database. Added `atlas:williamos-postgres`
   (superuser `williamos`) with a 10 KB fail-closed size floor.
3. **The restore proof would have silently lost a table.** `williamos` has an
   `embedding vector(1024)` column. The existing proof spins `postgres:15`, where
   `CREATE EXTENSION vector` fails, `document_chunk` is never created, and the restore still looks
   broadly plausible — exactly the trap that caught the HERMES drill in #862. The williamos proof
   uses `pgvector/pgvector:pg16` and asserts **both** structure and extension
   (`tables >= 30 AND vector_ext = 1`) before claiming `RESTORE_VERIFIED`.
4. **`"scheduler":"OFF"` was hardcoded** in the receipt, so the field could never become true no
   matter what was scheduled. Now derived from the actual crontab.
5. **`protected_sources` in `backup-state.json` is a separate list from the receipt's `jobs`**, so
   covering williamos in one left the health surface still advertising the old, smaller scope. Both
   updated.
6. **The script had no `exit` statement at all.** Its last command was an `echo`, so a run in which
   every source `FAILED` still exited **0**. Scheduling that would have reproduced on AEGIS the exact
   false green this program exists to remove: a green cron job protecting nothing. It now exits
   non-zero on any `FAILED`/`UNAVAILABLE` source, a secondary-copy mismatch, or a crown-jewel set
   hash mismatch.

## Scheduling

`scheduler: OFF` in its own newest receipt, with **no crontab for `bs`**, no `cron.d` entry and no
systemd timer, was why it ran five times on 2026-08-10 and never again. Installed:

```
30 4 * * * /usr/bin/flock -n /tmp/aegis-backup.lock /bin/bash /home/bs/backup-v1.sh >> /home/bs/backup-v1.out 2>&1
```

`flock -n` so a long run cannot stack on the next night's trigger. It runs at 04:30 UTC, after the
ATLAS nightly (03:00) and the HERMES cross-node sync (04:00), so it captures the day's verified set.

## Source of truth

`backup-v1.sh` lived only on AEGIS with no copy in git — the same drift class that made a hand-copied
fabric runner report `3/4` and left three machines pointing at a dead subnet. It is now tracked at
`scripts/lab-control/aegis/backup-v1.sh` and deployed from there (verified by md5 across the hop).

Transfer note: OMEN has no key to AEGIS, and the cmd.exe wrapper in the exec path caps a command at
8191 characters. Deployment routes OMEN → ATLAS → AEGIS, which both ends can already reach, with an
md5 comparison on both sides rather than trusting the copy.

## Status

See the run evidence appended below. AEGIS classification is upgraded from the `NOT_PROVEN` recorded
in #862 only on the strength of a fresh scheduled run whose receipt covers the `williamos` brain with
restore proof.

## Out of scope, untouched

No PACS migration, movement, deletion, or exposure to OMEN. No second backup framework — the existing
orchestrator was repaired and extended. No new scheduler or executor. No AEGIS authoritative data
deleted.
