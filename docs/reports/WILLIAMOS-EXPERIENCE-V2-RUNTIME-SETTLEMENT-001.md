# WilliamOS Experience V2 — First-Action Runtime Settlement 001

Status: `SETTLEMENT_BLOCKED_AT_AUTHORITY` — the reservation released, and a different condition took
its place.

Continuation settled: `CONT-EXPV2-FIRST-ACTION-RUNTIME-SETTLEMENT`, retyped in
`docs/governance/williamos-experience-v2-first-action-pickup-search-record.md` §7 from
`WAITING_RESERVATION / 997-migration-complete` to
`BLOCKED_DEPENDENCY / AUTHORITY_UNREADABLE / ATLAS_REACHABLE`.

Program: `WILLIAMOS_EXPERIENCE_V2`, Gate 2 · Parent `#987` · Action contract `#995` / PR `#1002`

Settled from merged `main` `1a352a3f61286e757fb09a51eaf30092a39abe38`, executed on HERMES.

`OWNER_COURIER_ACTIONS = 0`. The owner was not asked to power on a machine, record a grant, run a
command, relay output, or confirm anything.

## Result in one paragraph

`node.stamp-identity` did not run, and the reason it did not run is the correct one. The `#997`
reservation released exactly as the continuation predicted — HERMES is up, freshly commissioned, and
answered every read this lane made. What stopped the action is one step earlier than the node: the
route checks authority first, the authority grant registry is a table in the WilliamOS Postgres, and
that Postgres lives on ATLAS. **ATLAS answers nothing.** Measured against a live-host control, every
port on `192.168.88.5` behaves exactly as an unassigned address does. So `grantCovers` was never
reached, the route's own catch applies — *"an unreadable grant registry is not permission"* — and the
verdict is `AUTHORITY_UNREADABLE`. No grant was minted, no session was fabricated, no substitute
registry was stood up, and **the node was never contacted**: the stamp file does not exist on HERMES
and the fabric ledger did not gain a line. What *was* settled is everything the route reaches before
authority plus everything provable without touching the node — including the thing this lane was
specifically told to verify, which is **which ledger guard actually holds**. Both of them do.

## The two verdicts this settlement was offered, and why it returned neither

The continuation named `SETTLED_PASS` and `SETTLED_FAIL`, and said `POST_STATE_UNVERIFIED` would be
an honest settling verdict. All three of those describe a run that reached the node. This one did not
get that far, and reporting any of them would be a claim about a machine that was never contacted.
The honest verdict is a third thing, and it is recorded as a third thing.

## Per-leg results

The driver (`RS-00-settle-stamp-identity.mjs`) walks the legs of
`app/api/system/node/stamp-identity/route.ts` **in the route's own order**, importing the route's real
modules rather than restating them, and stops exactly where the route stops.

| # | Leg | Result | Evidence |
| --- | --- | --- | --- |
| 0 | Canonical bytes | **PASS** | 12 files digest-pinned at `1a352a3f`, including `route.ts` `e49f5aa9…` and `broker.mjs` `bc00e4cc…`. `RS-01` `legs.0_canonical_digests`. |
| 1 | HTTP/session shell | **NOT EXECUTED** | Stated, not assumed — see below. `RS-01` `legs.1_session`. |
| 2 | Authority (`grantCovers`) | **REFUSED — `AUTHORITY_UNREADABLE`** | `connect ECONNREFUSED 192.168.88.5:15432`. `RS-01` `legs.2_authority`, `RS-02`. |
| 3 | Canonical object graph | **PASS** | 5 nodes projected from the reviewed seed + HERMES's own transport registry; `hermes-node` binds to endpoint `hermes`. `RS-01` `legs.3_object_graph`. |
| 4 | Registry selection | **PASS** | `"stamp identity on hermes"` → `system.node.stamp-identity` on `node:hermes-node`, one candidate, no ambiguity. `RS-01` `legs.4_selection`. |
| 5 | Plan + commands | **PASS** | 158 bytes, digest `6dce72d5…`, dialect `windows`, path fixed; the generated observe/stamp/verify strings contain no deletion verb. `RS-01` `legs.5_plan`. |
| 6 | **Ledger guards** | **BOTH HOLD** | Four refusals and two controls, on real filesystem state. `RS-01` `legs.6_ledger_guards`. |
| 7 | The mutation | **NOT EXECUTED** | Gated on leg 2 and on nothing else. Node not observed, not written, not read back. `RS-01` `legs.7_mutation`, `RS-05`, `RS-06`. |

### Leg 1 — why the HTTP shell was not called, stated rather than skipped

`getSession()` reads `next/headers`, which needs a Next request context. The only WilliamOS instance
running on HERMES serves a standalone bundle whose release SHA is
`fe6ef4e7de70c1e455cf1f2aa02fa904aae01681`, and
`.next/server/app/api/system/node/stamp-identity` **is not in it** — checked, recorded as
`routePresentInDeployedBundle: false`. There is no deployed surface that could have been called, and
redeploying the HERMES runtime belongs to the `#762` deploy doctrine and to another lane, not to a
settlement.

No session was minted to work around this. Fabricating an authentication artifact to satisfy an
authentication check is the same class of failure as minting a grant to satisfy an authority check,
and this lane was told not to do the second one.

### Leg 2 — the authority refusal, in full

```
requiredAuthority : A3_WRITE_SHARED
operation         : node.stamp-identity
scope             : #995
checker           : lib/governance/authority.ts grantCovers -- not a SQL predicate
result            : AUTHORITY_UNREADABLE
error             : connect ECONNREFUSED 192.168.88.5:15432  (code ECONNREFUSED)
selfMinted        : false
```

`grantsFound` is `null` rather than `0`, and the distinction is the whole point: this lane does not
know whether a qualifying grant exists. It knows it could not ask. Reporting "no grant exists" would
be an assertion about a table nobody read.

### Leg 6 — which ledger guard actually holds

This is the question the continuation raised, because `#1003` found a `--require-audit` flag **inert**
against `lib/fabric/broker.mjs` at `b9f5138b`. At this base the broker is `bc00e4cc…` and the answer
is different. Both guards on this path were exercised against real filesystem state, and the broker
guard was exercised with an **injected `exec` spy**, so proving it could never itself touch the node.

| Guard | Where | Probe | Result |
| --- | --- | --- | --- |
| `requireLedger(fabricRoot)` | `route.ts`, before any node contact | real fabric root | `LEDGER_WRITABLE` |
| — same, negative | | root that does not exist | refused: `AUDIT_UNAVAILABLE: no ledger at …` |
| — same, negative | | `audit.log` that is a **directory** | refused: `AUDIT_UNAVAILABLE: … is not a file` |
| `requireAudit: true` | `broker.mjs:95`, before `exec` | unwritable root + exec spy | refused, **`execCallsBeforeRefusal: 0`** |
| — control | | same root, `requireAudit: false` | proceeded, `execCalls: 1` |
| `auditFabricAction(… required: true)` | `route.ts`, post-state record | unwritable root | refused: `AUDIT_UNAVAILABLE` |

The control matters as much as the refusal: without it, "the broker refused" could have meant the
unwritable root broke something else along the way. It does not — the same call with the guard off
runs. **The refusal is the guard.**

And the preflight costs the ledger nothing: `1241147` bytes before, `1241147` after the preflight,
`1241147` at the end of the run. A check that proves the ledger works does not itself pollute it.

### Leg 7 — the negative evidence, checkable rather than asserted

```
stamp path    : C:\Users\bs\.williamos\node-identity.json
exists        : False
dir exists    : True
checked at    : 2026-08-24T22:23:07.4401883-07:00
```

```
ledger        : C:\Users\bs\.williamos\fabric\audit.log
bytes         : 1241147
lines         : 19691
lastWriteTime : 2026-08-24T21:26:41.1153492-07:00
```

The driver ran at `21:59:35` local. The ledger's last write is `21:26:41`, thirty-three minutes
earlier, and its last twelve lines are all `#997` migration lines. Nothing this lane did reached the
ledger, because nothing this lane did reached the node.

## ATLAS: measured, not assumed

`RS-02`, from HERMES, with two controls:

```
atlas 192.168.88.5      :22 TIMEOUT  :15432 TIMEOUT  :5432 TIMEOUT  :80 TIMEOUT  :9999 TIMEOUT
aegis 192.168.88.6      :22 TIMEOUT  :5432 TIMEOUT
live host, closed port  127.0.0.1:9999   -> ConnectionRefused in 2036ms
live host, open port    127.0.0.1:11434  -> OPEN in 0ms
unassigned address      192.168.88.200:22 -> TIMEOUT
```

A host that is up and has nothing listening says `ConnectionRefused`. ATLAS says nothing at all, on
every port, exactly like the unassigned address. A bounded sweep of every LAN neighbour that answers
ARP found Postgres on none of them, and ports `22` open on four other machines — so this is ATLAS
being absent, not the lab having moved.

One honest inconsistency, recorded rather than tidied: the `pg` pool reported `ECONNREFUSED` while
the socket probe minutes later reported `TIMEOUT`. Both are consistent with "no Postgres is reachable
at the canonical address" — an intermediate ICMP unreachable produces the first, silence produces the
second — and the conclusion does not turn on which one it was. The probe with controls is the
stronger evidence and is the one this report reasons from.

## What this settlement may and may not be read as

**May be read as:**

- `997-migration-complete` is satisfied. The reservation is no longer what blocks invariant 13's
  terminal leg, and the continuation no longer says it is.
- The governed path's ledger guarantee is real at this base, in both places, with negative controls
  and a positive control. `#1003`'s inert-flag finding does not transfer to this path.
- The action's non-contact legs work against real canonical data on real hardware: the graph, the
  registry selection, the broker record, and the exact bytes with their digest.
- The route refuses correctly when its authority oracle is unreachable, and refusing cost nothing —
  no node contact, no ledger line, no partial state.

**May NOT be read as:**

- That `node.stamp-identity` has executed. It has not. Invariant 13's terminal leg is still open.
- That no qualifying grant exists. Unknown — the registry was unreadable, which is a different fact.
- That the stamp's bytes are correct *on a node*. They are correct *in a plan*; the read-back that
  would make that a fact about HERMES never happened.
- That Gate 2 is `ACCEPTED`. `#995` forbids that on the implementation alone, and this settlement
  does not supply the missing leg.

## Typed findings

### `CONT-EXPV2-AUTHORITY-REGISTRY-SINGLE-POINT` — TYPED FINDING

Every governed mutation in this program checks authority against one Postgres on one node — and that
node is neither the node being governed nor the node the control plane runs on. With ATLAS down,
nothing in WilliamOS can be authorised: not on HERMES, which is up and healthy, and not on OMEN.

This is **not** a proposal to cache, degrade, or fail open. It must not. The finding is that the lab
has one authority oracle with no availability story, and the first lane to hit it from the authority
side should say so rather than let the next one rediscover it. Recorded in the search record §7;
where it gets answered is a gate's question, not a settlement's.

### `CONT-EXPV2-RUNTIME-DEPLOY-LAG` — TYPED OBSERVATION

The governed action merged to `main` at `1a352a3f` and the HERMES runtime serves
`fe6ef4e7`. A route can therefore be merged, tested, and correct while no running surface exposes it,
which is exactly the state Gate 2's terminal leg found itself in. Not a defect of this action;
recorded because "the action is shipped" and "the action is reachable" are two claims and only one of
them was true today.

## Task 2 — the dead archive scripts, repaired

`#1003` disclosed that `sync-models-to-forge.ps1` and `backup-volumes.ps1` still point at `F:`. Both
are repaired, both are now in git, and both are deployed. The disclosure was right about the fault and
understated it in one direction and overstated it in another; both corrections are below, because the
second one is the more dangerous of the two.

### What was actually true

**`F:` does not exist on HERMES.** The volumes are `C:` (464.7 GB), `D:` (111.7 GB, unlabelled),
`E:` (System Reserved, exFAT) and `G:` (`HERMES_NVME`, 931.5 GB, 922.4 free). `G:` holds
`lab-backups` and a `HermesData\ollama`; it *is* the disk that was lettered `F:`.

**The archive was not "already down before the migration" — it was green, and that was worse.**
`model-forge-sync.log` records `OK` runs through `2026-08-23T04:30:01` with `local=12`. Twelve is the
blob count of `G:\HermesData\ollama` — the container-era store. The live store since the `#997`
migration is `D:\HermesData\ollama`, which holds **21 blobs (9.65 GB) and 5 manifests**. So for as
long as it ran green, the sync was faithfully archiving a stale copy while the models actually being
served went unprotected. It only started failing loudly on `2026-08-24`, when the letter moved.

`backup-volumes.ps1` has the same shape: `G:\lab-backups\hermes-volumes` holds 30 archives through
`2026-08-23T03:00`, and `D:\HermesBackups` holds 55 through `2026-08-17` — the destination before the
`2026-08-18` repair. Both stopped on `2026-08-24`.

### The repairs

**`sync-models-to-forge.ps1`** — new to git; it had lived only on HERMES, which is the same drift
class `#865` moved the other five HermesLab scripts into the repository to end.

- `$store` is `D:\HermesData\ollama`, the store the runtime serves.
- The store is **cross-checked against the Ollama service's own definition on every run**. The script
  reads `$ModelsDir` out of `hermes-ollama-service.ps1` and refuses on `MODEL_STORE_DISAGREEMENT` if
  the two disagree, or `SERVICE_CONFIG_UNREADABLE` if it cannot read it. Fixing the letter alone would
  have left the deeper fault — archiving a store nothing serves — able to recur silently.
- The completion check was **count-based** and is now **name-based**. It compared ATLAS's total blob
  count against ours and passed if it was not smaller; ATLAS holds 26 blobs accumulated from every
  store this script ever pointed at, so after the store correction that check would have reported
  success with none of `D:`'s 21 blobs present. A count is not a fact about our blobs; their names are.

**`backup-volumes.ps1`** — the destination is resolved by **volume label** (`HERMES_NVME`), not by
drive letter, and refuses on `ARCHIVE_VOLUME_ABSENT` or `ARCHIVE_VOLUME_AMBIGUOUS`. A letter is an
assignment; a label travels with the disk. This also closes a worse door than the one that broke: had
`F:` been reassigned to a USB stick, `New-Item -Force` would have created a fresh archive tree on it
and every run would have reported success while protecting nothing.

It also **exits non-zero when a volume fails**. It previously printed `FAILED` per volume and exited 0
regardless, so `HermesVolumeBackup` could record success having archived nothing — the documented
shape of the 2026-08-18 failure, still present in the script that was supposed to be the safety net.

Both scripts gained a `-ResolveOnly` switch. That is what let the repair be proven on real hardware
with ATLAS down and without running a container.

### Verification, on HERMES, with negative controls

Positive controls, run against the **live** files the scheduled tasks invoke, after deploy:

```
backup-volumes.ps1 -ResolveOnly
  {"archiveVolumeLabel":"HERMES_NVME","archiveRoot":"G:",
   "backupDir":"G:\\lab-backups\\hermes-volumes","backupDirExists":true}          exit=0

sync-models-to-forge.ps1 -ResolveOnly
  {"store":"D:\\HermesData\\ollama","serviceModelsDir":"D:\\HermesData\\ollama\\models",
   "storeAgrees":true,"blobCount":21,"blobBytes":10360071891,"manifestCount":5}   exit=0
```

Negative controls, each run before deploy against the staged copies:

| Probe | Refusal | exit |
| --- | --- | --- |
| `backup-volumes -ArchiveVolumeLabel NO_SUCH_LABEL_XYZ` | `ARCHIVE_VOLUME_ABSENT: no mounted volume is labelled …` | 1 |
| `sync-models -ServiceScript <absent>` | `SERVICE_CONFIG_UNREADABLE: … do not archive an unverified store.` | ≠0 |
| `sync-models -ServiceScript <declares G:>` | `MODEL_STORE_DISAGREEMENT: this script would archive 'D:\…' but the Ollama service serves 'G:\…'` | ≠0 |

A guard with no negative test is a guard nobody has seen refuse, which is most of what the
2026-08-18 recovery found. The label parameter exists only so its refusal can be exercised.

### Deployed

Originals preserved on HERMES as `*.bak-20260824_222200-preexpv2`; the deployed files digest-match
the repository copies byte for byte.

| File | repo & deployed sha256 | preserved original sha256 |
| --- | --- | --- |
| `backup-volumes.ps1` | `54bf3b05df73bf4fa505ac809f20a9da63771692cd4378c8809efec5378e9866` | `d1759a3490726a10c886951b51c65ab5194c95bdadf56e55cfa873f8a1094eae` |
| `sync-models-to-forge.ps1` | `0b92037dc5b512684f1efc09b9284a2e2ebfef0b5da599da3b97385b78a529d9` | `2de0a8419f886bc9c9ed4dbb1e32879ad36aa290b6ad6517073e869249147aba` |

No scheduled task was created, modified, started, or stopped. No service, compose file, container or
GPU setting was touched on HERMES. `HermesModelForgeSync` and `HermesVolumeBackup` will next run on
their own existing schedules against the repaired scripts.

### `CONT-EXPV2-ARCHIVE-RUN-UNVERIFIED` — the part that is not finished

```
type:      BLOCKED_DEPENDENCY
reason:    WAITING_EXTERNAL_ENVIRONMENT
condition: ATLAS_REACHABLE
```

The continuation asked for a real bounded archive run if ATLAS is canonically reachable. It is not.
What is proven is the resolution, the cross-check, and both refusals; what is **not** proven is the
transfer itself, the far-side `sudo` layout under `/forge/models/ollama`, or the new name-based
completion check against a real listing. The first run after ATLAS returns will move roughly 9.65 GB,
because it will be archiving the live store for the first time. It is expected to be slow and it is
expected to be loud if it fails.

`backup-volumes.ps1`'s transfer leg is separately unverified for a different reason: it drives
`docker run`, and container interaction on HERMES is outside this lane's envelope.

### `CONT-EXPV2-CROSSNODE-SYNC-STILL-ON-F` — TYPED FINDING, NOT REPAIRED HERE

```
type:      TYPED_FINDING
file:      scripts/lab-control/hermes/crossnode-sync.ps1  (and lab-health.ps1's F: free-space check)
symptom:   HermesCrossNodeBackupSync lastResult=1, HermesLabHealth lastResult=2, both since 2026-08-24
```

`crossnode-sync.ps1` hard-codes `F:\lab-backups\crossnode`, `F:\lab-backups\hermes-volumes` and
`F:\lab-backups\crossnode\crossnode-sync-task-evidence.json`, and `lab-health.ps1` reports free space
on `F:`. The same letter, the same day, the same one-line fix — and both belong to other lanes:
`lab-health.ps1` is a reserved file of **open PR `#1003`**, and `crossnode-sync.ps1` is the `#862`
backup-recovery lane's artifact. A blocked or in-flight reservation is still a reservation. Typed here
so the next lane to open either file finds the diagnosis already done, with the destination named:
`G:`, resolved by the label `HERMES_NVME` the way `backup-volumes.ps1` now does.

Note the consequence, because it is easy to miss: `crossnode-sync.ps1` is the **off-box** replication.
While it is dead, the repaired `backup-volumes.ps1` writes local redundancy on the same machine and
nothing leaves HERMES.

## Reproduction

```powershell
# on HERMES, from a checkout of 1a352a3f with node_modules available
node --experimental-transform-types .settlement\settle-stamp-identity.mjs `
  C:\HermesLab\williamos-runtime-64034e93-flat\.env.local

# the archive repairs, without side effects, from anywhere on HERMES
powershell -File C:\HermesLab\hermes\backup-volumes.ps1        -ResolveOnly
powershell -File C:\HermesLab\hermes\sync-models-to-forge.ps1  -ResolveOnly
```

`--experimental-transform-types` is required rather than optional: Node 24's strip-only mode rejects
`system-object-source.ts`'s constructor parameter property, and the module graph will not load
without it.

No TypeScript or JavaScript file changed in this lane, so no deterministic suite is implicated; the
repository's own suites are unaffected and were not re-run. The two changed files are PowerShell, and
both were executed on real hardware with positive and negative controls, above.

## Retained artifacts

All under `docs/reports/experience-v2-runtime-settlement/`.

| File | What it holds |
| --- | --- |
| `RS-00-settle-stamp-identity.mjs` | the settlement driver, exactly as run |
| `RS-01-settlement.json` | its full output: every leg, every digest, every refusal |
| `RS-02-atlas-reachability.txt` | ATLAS/AEGIS probed with a live-host and an unassigned-address control |
| `RS-03-hermes-store-and-topology.txt` | model stores on `D:`/`G:`, the service's own `OLLAMA_MODELS`, backup destinations, sync log tail |
| `RS-03b-hermes-drives-and-tasks.txt` | volumes, `C:\HermesLab\hermes` inventory, scheduled tasks with last results |
| `RS-04-archive-repair-controls.txt` | the positive and negative control run, pre-deploy |
| `RS-05-ledger-untouched.txt` | ledger size, line count, last write and tail — the proof nothing ran |
| `RS-06-node-unstamped.txt` | the stamp path on HERMES, absent |
| `RS-07-deployed-archive-scripts.txt` | deployed and preserved digests |

## Chronology (local, HERMES/OMEN are the same timezone)

- `21:44` — worktree created on HERMES at `1a352a3f` from an incremental bundle; `node_modules` junctioned
- `21:59:35` — settlement driver runs; `AUTHORITY_UNREADABLE` at leg 2; ledger untouched
- `22:0x` — ATLAS probed with controls; bounded LAN sweep finds Postgres on no neighbour
- `22:1x` — HERMES store and destination truth measured; `F:` confirmed absent
- `22:21:17` — repaired archive scripts deployed, originals preserved, live positive controls pass
- `22:23:07` — negative evidence captured: no stamp on HERMES, ledger last written `21:26:41`
