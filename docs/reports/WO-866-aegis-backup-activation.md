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

## The Hermes step could not have been scheduled as written

`scp -r "$HH:C:/HermesLab"` was pulling **27.32 GB across 1,078,891 files** — eight-plus
`williamos-runtime-<sha>` deployment copies, each ~1.1 GB with its own `node_modules` and `.next`.
That is commit-pinned build output, reproducible from git, and already named in this script's own
`excluded` list. The repository the step exists to preserve — `C:\HermesLab\.git` — is **113 files**.
At the observed rate the nightly job would have run about three hours, mostly copying `node_modules`.

Replaced with a tar built on the Hermes side with exclusions, transferred as one file:
**27.32 GB → 1.3 GB, a 20x reduction**, and one transfer instead of a million round trips.

The exclusion behaviour was verified rather than assumed: on `bsdtar 3.5.2 / libarchive 3.5.2`,
`--exclude=node_modules` **does** match nested path components (a probe tree kept only
`./src/keep/b.txt`, dropping both a nested and a top-level `node_modules`). An earlier suspicion that
it matched whole pathnames only was wrong.

Remaining inefficiency, deliberately not addressed here: the `williamos-runtime-<sha>` copies still
contribute their source trees. They are commit-pinned and arguably belong in the existing
`git-pushed-repos` exclusion, which would take this step from minutes to seconds.

## Evidence

**Scheduled acceptance run** — fired by cron, not by hand:

```
==== AEGIS BACKUP v1 start 20260818T201901Z ====
   forge files=38976 bytes=3151652846 bundles_ok=9/9
   williamos dump bytes=129389 sha=d568f3a766c52a2d86ce84dec247565d34c149df7e5c7b9c300fa49d2503eecb
   williamos restore: RESTORE_VERIFIED  tables=40 goals=17 vector_ext=1
   secondary pg copy sha match: yes
==== BACKUP v1 VERIFIED (all sources protected) ====
```

`tables=40 goals=17` match the ATLAS source exactly, and `vector_ext=1` confirms the extension
survived — the thing stock postgres would have silently dropped.

**Health state after the run** (`/backup-primary/backup-state.json`):

- `scheduler` — was hardcoded `OFF`, now `CRON`
- `primary_result` — `RESTORE_VERIFIED/RESTORE_VERIFIED/RESTORE_VERIFIED/RESTORE_VERIFIED` (was three)
- `atlas:williamos-postgres` — `RESTORE_VERIFIED`, present in `protected_sources` for the first time
- crown-jewel manifest sha matches across primary and secondary: `8b05ff40b0bb96d8…`
- `last_restore_verify` — `20260818T201901Z`, replacing 2026-08-10

**Fail-closed negative test**, run against a variant with both pre-move addresses restored and its
backup roots redirected into `/tmp` so it could not overwrite real receipts or health state:

```
==== BACKUP v1 FAILED: atlas:tf-postgres=FAILED atlas:williamos-postgres=FAILED
     forge=FAILED hermes=UNAVAILABLE ====
exit 1
```

| Case | Exit | Verdict |
|---|---|---|
| both nodes at dead pre-move addresses | 1 | fails closed |
| **unmodified scheduled run (positive control)** | **0** | **passes** |

Verified afterwards that `/backup-primary/backup-state.json` still held generation
`20260818T201901Z` — the negative test did not damage the thing it was testing.

## Sovereign review (Tier 1) and what it caught

The supersession's Tier 1 is a reviewer role in a context separate from the builder. Tier 3 external
advisers were all unavailable — Codex and Sourcery quota-exhausted, CodeRabbit did not auto-review —
which per doctrine is `EXTERNAL_REVIEW_UNAVAILABLE`, not `REVIEW_NOT_DONE`, and never a reason to
stall or to lower the sovereign tiers.

The sovereign lane itself turned out to be **broken by the same defect as everything else today**:
HERMES's `ollama` container bound `D:/HermesData/ollama`, and there is no `D:` on HERMES. The model
store was a throwaway directory inside the VM — `ollama list` was empty and a pull died with "no
space left on device". The 34 GB of models are safe on ATLAS at `/forge/models/ollama`. The container
was recreated with identical image, ports, GPU, env and restart policy, changing only the mount to
`F:/HermesData/ollama`, and `qwen2.5-coder:7b` pulled onto the RTX 3050.

Review was run against the exact diff. Its first pass degenerated into a repeated, self-contradictory
finding and was discarded rather than dressed up; a second pass with a repetition penalty produced
three findings. Two were style or non-issues. The third was real:

> exit codes lost through pipes or subshells — the readiness loop could fail silently

Traced to a genuine **false green in the fail-closed gate itself**: if the pgvector verify container
never became ready, or the image pull failed, or the restore errored, `WM_RESTORE` stayed `SKIPPED`,
so `WM_STATUS` remained `HASH_VERIFIED` — and `HASH_VERIFIED` was not in the gate's failure set. The
run would have exited **0 with the brain's restore never proven**. Precisely the class of defect this
whole program exists to remove, reproduced in the code written to remove it.

**Remediated:** for the two database sources, anything short of `RESTORE_VERIFIED` now fails the run.
Bytes are not protection for a database. Non-database sources may still report `COPIED`, so the gate
discriminates instead of failing everything.

**Gate truth table** (`scripts/lab-control/aegis/gate-truth-table.sh`, extracts the gate's own logic
from the deployed script so it cannot drift into testing a restatement):

| Case | Expect | Got |
|---|---|---|
| all sources restore-verified | PASS | PASS |
| williamos dump failed | FAIL | FAIL |
| hermes unreachable | FAIL | FAIL |
| secondary copy mismatch | FAIL | FAIL |
| crown-jewel set hash mismatch | FAIL | FAIL |
| **williamos hash-only, restore not proven** | **FAIL** | **FAIL** |
| **tf-postgres hash-only, restore skipped** | **FAIL** | **FAIL** |
| **williamos restore only partial** | **FAIL** | **FAIL** |
| forge copied but not restore-verified | PASS | PASS |

`GATE_TRUTH_TABLE: ALL PASS`

## The #831 gate rejected this twice, and was right both times

Recorded because the failures are more useful than the pass, and because both were mine.

**1. `FAILED_STALE_MAIN` + no declared receipt.** The first receipt was anchored to `d9b92c1` while
main had moved three commits, one of which was #868 — the very check that would judge it. The pull
request also carried no `WORK_CONTEXT_RECEIPT` block at all. Fixed by rebasing onto `1f9161b`,
re-issuing, and declaring the block in the body.

**2. `FAILED_SCOPE_ESCAPE`.** The reservation matcher is:

```js
return normalized.endsWith("/") ? path.startsWith(normalized) : path === normalized
```

A reservation is a **prefix only when it ends in `/`**. `scripts/lab-control` without the slash must
match a file path exactly, so it matched nothing and every changed file counted as an escape. The
declaration was malformed, not the gate. Re-issued as `scripts/lab-control/` and `docs/reports/`.

**Operational note for the next lane:** `gh run rerun --failed` replays the *original event payload*,
which carries the pull request body as it was when the event fired. Editing the body and re-running
therefore re-checks the old body and fails identically. CI here triggers on
`[opened, synchronize, reopened]` — not `edited` — so a corrected receipt needs a push to be seen.

Throughout all of this the vitest suite was green. That is the point of criterion 8: a green suite is
not a proven premise.

## Status: AEGIS backup `PROVEN`

Upgraded from the `NOT_PROVEN` recorded in #862, on current evidence: a cron-fired run whose receipt
covers the `williamos` brain with restore proof, a health surface that reports the real schedule and
the real protected set, and a fail-closed failure path demonstrated with a passing positive control.

## Out of scope, untouched

No PACS migration, movement, deletion, or exposure to OMEN. No second backup framework — the existing
orchestrator was repaired and extended. No new scheduler or executor. No AEGIS authoritative data
deleted.
