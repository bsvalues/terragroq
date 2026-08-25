# WilliamOS Experience V2 — cross-node sync repair

Continuation discharged: `CONT-EXPV2-CROSSNODE-SYNC-STILL-ON-F`, typed `PICKUP_ELIGIBLE` at
`WILLIAMOS-EXPERIENCE-V2-RUNTIME-SETTLEMENT-001.md:354` by PR `#1005`.

Program: `WILLIAMOS_EXPERIENCE_V2` · Parent `#987` · Picked up from merged `main` `c3d822fa`.
Executed on HERMES. `OWNER_COURIER_ACTIONS = 0`. No owner decision was required and no authority
gap was reached.

## What was wrong, in one sentence

Two scheduled tasks had been failing since 2026-08-24 because two scripts wrote down where things
were instead of resolving where things are, and by 2026-08-25 neither of the things they named
existed: `F:` had become `G:`, and ATLAS had moved from `192.168.88.5` to `192.168.88.8`.

## What is true now

| | before | after |
| --- | --- | --- |
| `HermesCrossNodeBackupSync` | `lastResult=1` since 2026-08-24 | **`lastResult=0`**, 25 s |
| `HermesLabHealth` | `lastResult=2`, five problems, four of them false | `lastResult=1`, two problems, both real |
| off-box replication | dead since 2026-08-23T11:00Z | **both directions, verified from both sides** |
| `F:\` literals in `crossnode-sync.ps1` | 5 | 0 |
| `192.168.88.5` literals across the two files | 3 | 0 |

`lab-health` is **warn, not green**, and that is the correct answer — see *What the repair
uncovered*.

## The fault, measured rather than recited

Everything in this section was checked on HERMES before anything was changed
(`XN-01-preconditions-measured.txt`).

`Get-Volume -DriveLetter F` returns nothing. The 931 GB NVMe that carried `F:` is lettered `G:`,
and it still holds the entire archive: five ATLAS nightly stamp directories under
`G:\lab-backups\crossnode\atlas`, 35 volume tarballs totalling 214 MB under
`G:\lab-backups\hermes-volumes`, and the last successful sync's evidence file, dated
2026-08-23T11:00Z. **The archive never moved. Only its letter did.**

`192.168.88.5` does not answer ping from HERMES. `nodes.json` — the canonical fabric registry —
records `atlas` at `192.168.88.8`, with the note that the lease moved on the 2026-08-25 power cycle
and that `.5` is now held by another device.

Failing loudly was the mercy here. The dangerous shape is the other one: `New-Item -Force` would
have built a fresh, empty archive tree on whatever `F:` had become — a USB stick, say — and every
run after that would have reported success while protecting nothing. That is precisely the failure
the 2026-08-18 backup recovery existed to end, and it is why every resolution below refuses rather
than falls back.

### The half that is easy to miss

Repairing only the address would have changed nothing an operator sees. Both scripts ran bare
`ssh -o BatchMode=yes`, leaning on the calling account's `~/.ssh`, whose `known_hosts` pins
`192.168.88.5` and has never seen `192.168.88.8`. Measured on HERMES the same day:

```
[default-88-5] EXIT=255  ssh: connect to host 192.168.88.5 port 22: Connection timed out
[default-88-8] EXIT=255  Host key verification failed.
[fabric-88-8]  EXIT=0    atlas / bs
```

So the transport is resolved with the address. The fabric `known_hosts` carries the ed25519 key
proven byte-identical across ATLAS's move, and `StrictHostKeyChecking=yes` stays on deliberately:
if the registry is ever wrong, a refused connection is the right outcome, not a backup handed to a
stranger.

## The repair

Nothing is written down any more. Three resolutions, each of which refuses:

| resolves | from | refuses with |
| --- | --- | --- |
| the archive root | the volume label `HERMES_NVME` | `ARCHIVE_VOLUME_ABSENT` / `ARCHIVE_VOLUME_AMBIGUOUS` |
| ATLAS's address | `nodes.json`, the fabric registry | `FABRIC_REGISTRY_UNREADABLE` / `FABRIC_REGISTRY_INCOMPLETE` |
| the ssh identity | the fabric key and `known_hosts` | `FABRIC_IDENTITY_UNREADABLE` |

They live in `crossnode-sync-lib.ps1`, so `crossnode-sync.ps1` and `lab-health.ps1` share one owner
and their refusals can be exercised against temporary directories on any machine. Resolution runs
as a preflight, before anything is created or contacted, and deliberately does **not** route
through `Format-CrossNodeSyncFailure` — that formatter sanitizes native stderr down to a code,
which is right mid-transfer and wrong here, where an operator needs to be told that a disk is
simply not plugged in rather than handed `code=NATIVE_COMMAND_FAILED`.

`crossnode-sync.ps1` also gains `-ResolveOnly`, which prints what was resolved and stops — no ssh,
no scp, nothing created. That is what lets the resolution be proven separately from a transfer.

`lab-health.ps1` carried the same fault three times: `F:` free space, ATLAS at `.5`, and AEGIS at a
literal `192.168.88.6` under a comment claiming it came from the canonical registry — it did, once,
in August. A copy of a registry is not a registry. All three resolve now, and an unresolvable
location reports FAIL rather than being defaulted. Its `F:` branch had substituted `0` for an
absent volume, so it printed `F: free : 0.0 GB [WARN]` — an absent disk reported as a full one.

**What did not change:** the direction of travel, the freshness guard, the manifest cross-check,
the 14-day retention, and the receipt/evidence publication sequence. This is a repair to where the
scripts point, not to what they do.

## Proof

**No `.ps1` in this repository runs in CI.** `.github/workflows/ci.yml` runs vitest over
`tests/**/*.test.{ts,tsx}` and a Next production build; `work-context.yml` runs the work-context
receipt. Nothing invokes PowerShell. These scripts cannot be proven by opening a pull request, so
they are proven by running them on the machine they run on, and **the live controls are the test
suite**. Full transcripts in `docs/reports/experience-v2-crossnode-sync-repair/`.

Deployed to `C:\HermesLab\hermes\` with originals preserved as `*.bak-20260825_0245-pre-f-repair`,
each backup digest-matching the pre-change file. The deployed files match the repository copies
byte for byte:

| file | repo and deployed sha256 | preserved original sha256 |
| --- | --- | --- |
| `crossnode-sync.ps1` | `590b3989a6d6bddcb9259be71f065542768c345f7e8684558475eb68e05b48ce` | `1557d9700b274af26fd380fa8a855f6197eaf20a0c09058280c2e6dd8c8f1c79` |
| `crossnode-sync-lib.ps1` | `cae108b3a3e23a102f5dc8bad1a0a527b586a4bde2e481f48df2bc255b0f9a56` | `a5a49754a41b7bd3e02483f82a60aba6e8ceffb4a2456390c26cad46dc296978` |
| `lab-health.ps1` | `2a001349da738bf32cfb5929fc07602f1655d255646a21785dc338e016b1f38f` | `c4f1a146db5144d877beccc1b13eb5cd722d669ff86291e6f6dbf8e50001d3aa` |
| `test-crossnode-sync-receipt.ps1` | `317a0fe004d75f9490c7579baec68e0c79bc9a16df54c65326b5d1e451262867` | `20583d9cd1350fa0060435c3f61528df123e8920f001ccc4a9d4432d0715c813` |

| control | result |
| --- | --- |
| LC-01 unit tests on HERMES against the deployed library | `PRODUCER_TESTS_PASS`, exit 0 |
| LC-02 `-ResolveOnly` on real hardware | `G:` and `bs@192.168.88.8`, 35 archives, exit 0 |
| LC-03 `-ArchiveVolumeLabel NO_SUCH_LABEL_XYZ` | `ARCHIVE_VOLUME_ABSENT`, exit 1 |
| LC-04 `-FabricRoot` at an empty directory | `FABRIC_REGISTRY_UNREADABLE`, exit 1 |
| LC-05 `-FabricRoot` at a registry with no key | `FABRIC_IDENTITY_UNREADABLE`, exit 1 |
| LC-06/07 real run via `HermesCrossNodeBackupSync` | `lastResult=0`, 25 s, evidence rewritten |
| LC-08 replication verified from both sides | 5/5 files identical by hash; receipt hash matches |
| LC-09 `HermesLabHealth` | `lastResult` 2 to 1, four false problems gone |

LC-03/04/05 are the point of the repair rather than decoration around it. The failure this system
keeps producing is not a crash; it is a green run that protected nothing. Each of those is the
moment where the old code would have carried on regardless.

LC-08 is verified from both sides because the script reporting `SHA256_PASS` about itself is the
claim, not the evidence. Hashed separately on each machine, all five files of ATLAS's
`20260825_030001` nightly run are byte-identical on `G:`, and the receipt on ATLAS hashes to
`98b377c0…910b6b` — the same value the HERMES-side evidence file records, which is what makes the
two files one record rather than two claims.

`ATLAS_REACHABLE` was verified at the **resolved** address before any write: ssh and scp both exit
0 to `192.168.88.8` under the fabric identity, `/forge` is mounted, `/forge/backups/nightly` is
readable. No `WAITING` state is typed. ATLAS's broken Postgres publish
(`ATLAS-RETURN-SETTLEMENT-002`) is real and unrelated — this sync touches no database — and this
lane went nowhere near ATLAS-side topology.

## A wrong turn, kept in the record

The first real run hung for 232 seconds on a directory listing and was killed having done nothing.
The hypothesis was that `ssh` was blocking on inherited stdin; `ssh -n` was implemented, with the
option list split so that `scp` could never receive `-n` (in OpenSSH 9.x `scp -n` is dry run — it
would copy nothing, exit 0, and let this script log success over an empty transfer), tested, and
deployed.

**The hypothesis was wrong.** The same call hung identically with `-n` present, while the same
script under the scheduled task completed in 25 seconds. The hang is a property of running these
scripts from inside a nested ssh session, not a defect in them.

So `-n` and the two-list split were **reverted**. A flag that fixes nothing measurable does not get
shipped on a hunch, and keeping a second option list purely to hold it would have been carrying
scaffolding for a repair that was not one. What is kept is a comment at the resolver recording that
it was tried, that it did not help, and that `scp` must never be given `-n`. Full account in
`XN-03-the-hang-that-was-not-a-defect.txt`, including collateral: clearing that first hung run,
this lane killed every `ssh.exe` on HERMES rather than only its own — eight stalled processes, two
of which were not this lane's to kill. No scheduled work was interrupted, and every kill after that
was filtered by command line.

## What the repair uncovered

Before the repair, `HermesLabHealth` reported five problems and four of them were false. A monitor
with four false alarms in it is a monitor nobody reads, which is how the two real ones below sat
unattended.

### CONT-ATLAS-HEALTH-WATCHES-ABANDONED-PATH — TYPED FINDING, not repaired here

```
type:      TYPED_FINDING
file:      /home/bs/health-atlas.sh:67   (on ATLAS, not in this repository)
symptom:   reports "no backup in 174h" while ATLAS's actual nightly ran today
```

`health-atlas.sh` measures `ls -t /home/bs/backups/*.tar.gz`, whose newest file is from
2026-08-18. ATLAS stopped writing there: it writes verified logical dumps to
`/forge/backups/nightly/<stamp>/`, and `20260825_030001` was written today — this lane replicated
it and verified all five files by hash. `crossnode-sync.ps1` already carries a comment from the
2026-08-18 recovery saying exactly this about that flat directory.

**This is the same class of fault this lane just repaired, one node over.** It is not repaired here
because it is an ATLAS-side change, this lane's envelope is HERMES-side scripts, and ATLAS-side
topology is with the owner.

### CONT-FABRIC-RESOLUTION-DUPLICATED — TYPED FINDING, not repaired here

`sync-models-to-forge.ps1` grew its own `Resolve-AtlasEndpoint` in `#1006`; this lane put
`Resolve-FabricNode` in `crossnode-sync-lib.ps1`. Two copies of the same registry read on the same
machine. Not unified here: that file is `#1006`'s artifact, merged hours ago, does not dot-source
this library, and taking it would put a freshly-proven archive path back into play to save fifteen
lines. A lane holding both files can dot-source the library and delete the private copy.

### Pre-existing, and not this lane's

`AEGIS spare disk sdd SMART UNKNOWN` and `Backup FAIL_CLOSED / RESTORE_PROOF_MISSING` were present
before any change here and belong to `wo/866-aegis-backup-activation`.

## Envelope

No scheduled task was created, deleted, enabled, disabled, or rescheduled. Two existing tasks were
**started**, on their own unmodified definitions, both of which were going to run on their own
schedules within the hour anyway. No service, container, compose file, GPU setting, firewall rule
or registry entry was touched on HERMES. Nothing was written on ATLAS except what
`crossnode-sync.ps1` writes by design. Nothing on AEGIS.

This repairs two scripts and discharges one continuation. It is not acceptance of `#995`, and it
makes no claim about Gate 2.
