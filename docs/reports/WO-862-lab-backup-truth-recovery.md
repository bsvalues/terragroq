# WO-862 — LAB_BACKUP_TRUTH_RECOVERY

**Work order:** https://github.com/bsvalues/terragroq/issues/862

**Work context receipt:** `b8a99c492013fc9969c9dace8eed929cf9b06cac2e0fdbe13c2519f920ab3d71`
against `origin/main = 4efd858f4897ad3fd7cfd1838c2317c9b29a35ea`, provenance **local** — no device
credential is enrolled (`device-credential.json` absent; the `device_credential` table has 0 rows),
so authority was NOT checked and the claim was NOT ledger-recorded. Recorded here, not presented
as proof.

## The finding, stated once

Every backup mechanism in this lab reported success while protecting nothing, each in its own way:

| Mechanism | Reported | Actually |
|---|---|---|
| ATLAS `backup-volumes.sh` | `OK` per volume, nightly | tarred **live** PGDATA to the **same block device**; blind to bind mounts |
| HERMES `HermesVolumeBackup` | scheduled result **0 = success** | wrote to a **`D:` drive that does not exist**; last real output 2026-08-07 |
| HERMES `HermesCrossNodeBackupSync` | result **1**, nightly | pointed at ATLAS `192.168.1.156` (wrong subnet) and `D:` paths |
| HERMES `lab-health` | `FAIL` hourly | right that something was wrong, but pinging `192.168.1.156`/`.157`; nobody read the log |
| AEGIS backup suite | `RESTORE_VERIFIED` x3 | `scheduler: OFF` in its own receipt; last run 2026-08-10; the verified restore was 901 bytes of a database with `user_tables=0 approx_rows=0` |

The common shape is not laziness. Each layer verified the step it controlled; none verified that the
result could be restored. `tar` exiting 0, a hash matching, a scheduled task returning 0, and a
receipt saying `RESTORE_VERIFIED` are all true statements that do not add up to a recoverable backup.

## What changed

**Repaired the existing canonical system. No parallel stack.** The receipt/manifest machinery in
`crossnode-sync-lib.ps1` was already better than anything written to replace it:
`Invoke-CheckedNative` correctly contains the PowerShell 5.1 native-stderr trap,
`ConvertTo-ShellSafePosixCommand` base64s remote commands, and `Assert-ArchiveManifestMatch` already
threw on an empty source. Preserved and adapted, not rewritten.

1. **Topology corrected** in `crossnode-sync.ps1`, `backup-volumes.ps1`, `lab-health.ps1`: ATLAS
   `192.168.1.156` to `192.168.88.5`; AEGIS `192.168.1.157` to `192.168.88.6`; every `D:` path to
   `F:\lab-backups`; `Get-Volume D` to `Get-Volume F`. Addresses taken from the canonical fabric
   registry and live probes, not from prose.
2. **Retargeted ATLAS-to-HERMES replication** from the obsolete flat `/home/bs/backups/*.tar.gz` set
   (torn live-volume tars that nothing writes any more) to the verified logical set at
   `/forge/backups/nightly/<stamp>/`. `Get-LocalArchiveManifest` gained a `-Filter` so the manifest
   covers `.dump`, `.archive.gz` and `.rdb`, defaulted to `*.tar.gz` so the reverse direction is
   unchanged.
3. **Staleness and future-stamp guards added.** ATLAS names run directories in UTC; the first version
   parsed them as local time, putting every stamp hours into the future and making the guard
   unfireable. A negative test caught it returning success with the window set to zero hours. Now
   parsed as UTC against `UtcNow`, and a stamp more than 10 minutes ahead of now is refused as a
   clock fault.
4. **Ad-hoc duplicate removed.** `pull-atlas-nightly.ps1` — written earlier the same session, before
   the existing suite was discovered; never successfully run, never scheduled — deleted with its
   logs. Exactly one scheduled ATLAS-to-HERMES replication path remains.
5. **Source of truth established.** These scripts lived only on HERMES with no git copy: the same
   drift class that made a hand-copied fabric runner report `3/4` earlier the same day. They now live
   in `scripts/lab-control/hermes` and `scripts/lab-control/atlas`, and deploy from there.

## Evidence

**Canonical sync, real Task Scheduler path** (not nested SSH): `HermesCrossNodeBackupSync` exit **0**,
replicating run `20260818_131907` with 8 artifacts, `SHA256_PASS`, atlas receipt sha256
`911bb99813a2ab8c`.

**Fail-closed, with a positive control so the suite discriminates:**

| Case | Exit | Verdict |
|---|---|---|
| stale source (window forced to 0h) | 1 | fails closed |
| missing source (nightly root absent) | 1 | fails closed |
| unreachable ATLAS (stale IP restored) | 1 | fails closed |
| **unmodified real task** | **0** | **passes** |

**Restore/readback drill from the HERMES-held replica.** `williamos-postgres--williamos.dump`, sha256
`c3d2d3ada9a31b96` matching the source manifest, restored into a disposable container: `pg_restore
rc=0`, **40** public tables, `vector` extension present, and row counts matching the ATLAS source —
`session` 51, `goal` 17, `device_link` 7, `workbench_thread` 3, `document_chunk` 0, `truth_claim` 0.

**A restore prerequisite the drill exposed.** The first attempt used HERMES `postgres:16`, which has
no pgvector: `CREATE EXTENSION vector` failed, `document_chunk` (`embedding vector(1024)`) was never
created, its data was dropped, and `pg_restore` exited 1 — while the backup file itself was
byte-perfect and hash-verified. **A DR copy that cannot be restored at the DR site is not a DR copy.**
`pgvector/pgvector:pg16` is now present on HERMES and the drill passes against it. Any future restore
host for the `williamos` database must provide pgvector.

**Health surface.** `HermesLabHealth` went from exit **2** with four problems, all artifacts of stale
config (`Hermes D: 0 GB`, `X-sync task`, `Atlas unreachable`, `Aegis unreachable`), to exit **1** with
one real one: `Aegis spare disk sdd SMART UNKNOWN`. It now reaches AEGIS successfully.

## HERMES-local backup is local redundancy, NOT disaster recovery

`HermesVolumeBackup` writes HERMES's own docker volumes to HERMES `F:`. That is **same-machine**
redundancy: it survives a volume or container loss, and does not survive losing HERMES. Labelled as
such deliberately, because it previously returned success while writing nothing, and its result must
not now be mistaken for off-machine protection.

Genuinely off-machine as of this work: the ATLAS nightly set replicated to HERMES `F:` — different
machine, verified, restore-drilled.

## AEGIS backup status: `NOT_PROVEN`

Read through the fabric key with a bounded per-probe helper, one command per connection, because the
broker answers some verbs and silently swallows others: a compound command cannot distinguish "no
data" from "not permitted". The management path was **not** blocked, so this is `NOT_PROVEN` rather
than `BLOCKED_MANAGEMENT_PATH`.

AEGIS is genuinely provisioned for the role — two dedicated 916 GB volumes, `/backup-primary` holding
`atlas`, `forge`, `hermes`, `manifests` and `receipts`, plus `/backup-secondary` holding
`crown-jewel`, with matching primary and secondary crown-jewel manifest hashes. The design is sound.
What is missing:

- `scheduler: OFF` in its own newest receipt; **no crontab for bs**, no `cron.d` entry, no systemd
  timer. Five receipts exist, all dated **2026-08-10**, then nothing. It ran by hand once.
- last backup, hash-verify and restore-verify all `20260810T061501Z` — **8 days stale**.
- protected sources are `atlas:tf-postgres`, `atlas:/forge/terrafusion` and
  `hermes:HermesLab+ollama-meta`, with `tf-mongo` and `tf-redis` `SKIPPED`. The **`williamos` brain
  database is not among them**, nor is any heavy data.
- its `RESTORE_VERIFIED` for `atlas:tf-postgres` covers 901 bytes with `dbs=[icondo]
  app_db=icondo user_tables=0 approx_rows=0` — a truthfully verified restore of an empty database.

**Agent-owned recovery condition, not an owner task:** schedule the existing AEGIS backup
orchestrator, and extend its protected-source list to include the `williamos` database on ATLAS. No
PACS was moved, read, or exposed to OMEN in producing this classification.

## Out of scope, untouched

No PACS migration or disposition. No AEGIS authoritative data deleted. No new scheduler or executor.
No AEH or #750 revival. No new auth system. No public network exposure.
