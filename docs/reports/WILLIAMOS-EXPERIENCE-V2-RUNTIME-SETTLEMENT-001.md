# WilliamOS Experience V2 — First-Action Runtime Settlement 001

Status: `SETTLEMENT_BLOCKED_AT_AUTHORITY` — the reservation released, and a different condition took
its place.

Continuation settled: `CONT-EXPV2-FIRST-ACTION-RUNTIME-SETTLEMENT`, retyped in
`docs/governance/williamos-experience-v2-first-action-pickup-search-record.md` §7 from
`WAITING_RESERVATION / 997-migration-complete` to
`BLOCKED_DEPENDENCY / AUTHORITY_UNREADABLE / ATLAS_REACHABLE`.

> **SUPERSEDED 2026-08-25 by `WILLIAMOS-EXPERIENCE-V2-ATLAS-RETURN-SETTLEMENT-002.md`.** The
> `ATLAS_REACHABLE` condition fired and is discharged: ATLAS returned at a **different address**
> (`192.168.88.5` → `192.168.88.8`, canonically rediscovered). Reachability is no longer the
> blocker. The settlement still does not pass, and the reason is now substantive rather than
> environmental — the authority registry holds 28 grants and **none scoped `#995`**. Read 002
> before acting on anything below that names an address or an availability condition.

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

That third thing is now one state in a named lattice rather than a string chosen per run. Review
found the driver capable of emitting a SUCCESS verdict on a path that executed nothing; the lattice
that replaced it, and the reason it exists, are under *Review remediation* below.

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

### `CONT-EXPV2-AUTHORITY-REGISTRY-SINGLE-POINT` — TYPED FINDING (AMENDED 2026-08-25)

> **Amended by `WILLIAMOS-EXPERIENCE-V2-ATLAS-RETURN-SETTLEMENT-002.md`.** ATLAS's return did not
> close this and made it sharper: the oracle is now **up and still unreachable**. Its
> `williamos-postgres` container came back bound to the literal `192.168.88.5:15432`, an address the
> host no longer holds, so the publish never materialised — the container reports `Up`, serves
> fine on its own socket, and is reachable over TCP from nowhere, including ATLAS itself. The
> sentence below about "with ATLAS down" no longer describes the condition; the finding survives it.

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
  As written here it verified **blobs only**, which review showed was enough to let a manifest tree be
  deleted or nested under a green log line — it covers manifests too now; see *Review remediation*.

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

**These are the 2026-08-24 digests and `sync-models-to-forge.ps1` has since been superseded.** Review
found the manifest step of this very file deleting the archive's manifest tree; the repaired script
and its installer are deployed under *Review remediation → Deployed on HERMES, digest-verified*, and
the copy in the row above is preserved on HERMES as `.bak-20260824_2312-preremediation`. One current
disposition per artifact: the current one is the later table.

No scheduled task was created, modified, started, or stopped. No service, compose file, container or
GPU setting was touched on HERMES. `HermesModelForgeSync` and `HermesVolumeBackup` will next run on
their own existing schedules against the repaired scripts.

### `CONT-EXPV2-ARCHIVE-RUN-UNVERIFIED` — **DISCHARGED 2026-08-25**

```
type:      DISCHARGED
by:        WILLIAMOS-EXPERIENCE-V2-ATLAS-RETURN-SETTLEMENT-002.md
run:       2026-08-25T01:59:38-07:00 via the HermesModelForgeSync scheduled task
result:    OK  local=21 remote=26 manifests=5 archived-manifests=5 superseded=1 verified=by-name
verified:  independently, from both sides — 21/21 blobs and 5/5 manifests present by name
```

The paragraph below predicted the first run would move "roughly 9.65 GB, because it will be
archiving the live store for the first time." **It moved zero bytes of blob data**: all 21 live
blobs were already archived, because Ollama blobs are content-addressed and `#997` moved the same
content the old store had already sent. What was actually missing was metadata — 3 manifests
archived against 5 live — and a blob no manifest names is not restorable. See 002 §*Step 2*.
The original text is kept below rather than rewritten, because the prediction being wrong is the
finding.

```
type:      BLOCKED_DEPENDENCY          (as written 2026-08-24, now discharged)
reason:    WAITING_EXTERNAL_ENVIRONMENT
condition: ATLAS_REACHABLE
```

The continuation asked for a real bounded archive run if ATLAS is canonically reachable. It is not.
What is proven is the resolution, the cross-check, and both refusals; what is **not** proven is the
transfer itself, the far-side `sudo` layout under `/forge/models/ollama`, or the name-based
completion check against a real listing. The first run after ATLAS returns will move roughly 9.65 GB,
because it will be archiving the live store for the first time. It is expected to be slow and it is
expected to be loud if it fails.

**What that first run will no longer do is destroy the archive's manifest tree on its way through.**
When this was written, the run that would have discharged this continuation was the same run that
would have orphaned twelve container-era blobs — so discharging it would have cost more than leaving
it open. The manifest step is now an overlay that removes nothing, with the install path executed by
a test rather than only described; see *Review remediation*. The transfer is still unverified against
a real ATLAS, and that is what this continuation still holds open.

`backup-volumes.ps1`'s transfer leg is separately unverified for a different reason: it drives
`docker run`, and container interaction on HERMES is outside this lane's envelope.

### `CONT-EXPV2-CROSSNODE-SYNC-STILL-ON-F` — **DISCHARGED 2026-08-25**

```
type:      DISCHARGED               [retyped 2026-08-25 from PICKUP_ELIGIBLE, which #1007 had
                                     itself retyped from DISCHARGED when it withdrew on review]
repaired:  WILLIAMOS-EXPERIENCE-V2-CROSSNODE-SYNC-REPAIR-003.md, PR #1007
re-proved: 003 section "Independent re-proof", transcript XN-06-independent-reproof.txt, by a
           SEPARATE envelope that authored none of the repair and changed none of the four files
files:     scripts/lab-control/hermes/crossnode-sync.ps1, crossnode-sync-lib.ps1, lab-health.ps1,
           test-crossnode-sync-receipt.ps1
measured:  HermesCrossNodeBackupSync lastResult 1 -> 0 (28 s, 2026-08-25T03:42:42-07:00, re-run
                                     against the deployed branch head)
           HermesLabHealth           lastResult 2 -> 1 (warn, and the warn is honest)
           replication verified from both sides -- 5/5 ATLAS nightly files byte-identical on G:,
           hashed separately on each machine, and the receipt on ATLAS hashes to the value the
           HERMES-side evidence records
           LC-A + LC-01..LC-10 all pass; branch head and HERMES now digest-identical
standing:  the §10 FAILED_TERMINAL against #1007's ORIGINAL envelope is NOT withdrawn by this
           discharge and stays in the record
```

**Why this could be closed when the repairing envelope could not close it.** A §10 Immediate
Terminal Stop condition fired inside #1007's first run — clearing a hung process it owned, that lane
killed every `ssh.exe` on HERMES rather than only its own, and two of the eight belonged to other
lanes. The envelope was required to self-disable at that moment and did not; it deployed and ran its
last four controls afterwards. An envelope that has acted outside its scope may not then certify its
own outcome, so #1007 withdrew its discharge rather than defend it and handed over typed.

A later, separate envelope did the re-derivation that handoff asked for: it deployed the branch head
(digest-verified, originals preserved), re-ran every control against the newly deployed code, and
added the two controls the first envelope never got to — `IdentitiesOnly=yes` against a real ATLAS,
and the lab-health probe-skip guard. Both pass. It changed none of the repaired code, and when
clearing its own hung probe it listed every process first and left three other lanes' stalled
`ssh.exe` running.

**Two bounds a reader should carry forward.** `IdentitiesOnly=yes` is proven to authenticate and
proven not to break `scp`, but no ssh-agent is running on that account, so the `MaxAuthTries`
exhaustion it defends against is not reproduced — it is defence against a state HERMES is not in.
And the merge decision belongs to a coordinator; the re-proving lane stopped at the merge boundary
and asserted no head state.

Both halves of the diagnosis above were right, and one thing it did not name would have kept the
task red anyway.

The five `F:\` literals in `crossnode-sync.ps1` and the `F:` check in `lab-health.ps1` are gone; the
archive resolves by the label `HERMES_NVME` to `G:`, exactly as this packet predicted, and every backup
the sync has ever written was already sitting there. What the packet did not name is that ATLAS had
moved too: `bs@192.168.88.5` was hard-coded in both files, `192.168.88.5` no longer answers ping from
HERMES, and ATLAS is at `192.168.88.8`. That address now resolves from `nodes.json`, the way `#1006`
taught `sync-models-to-forge.ps1` to.

**And the address alone would not have been enough.** Both scripts used the calling account's
`~/.ssh`, whose `known_hosts` pins `.5` and has never seen `.8` — measured on HERMES, repairing only the
address trades `Connection timed out` for `Host key verification failed`, both exit 255, both a red
task. The transport is resolved with the address now, against the fabric `known_hosts` that carries
the host key proven byte-identical across ATLAS's move.

The consequence this packet flagged is measured as repaired, though not discharged:
`crossnode-sync.ps1` is the **off-box** replication, and from 2026-08-23T11:00Z until
2026-08-25T09:48Z nothing left HERMES. It does now, in both directions, verified from both ends.

Two findings came out of the repair and are typed in 003 rather than fixed there, both
`PICKUP_ELIGIBLE` and neither the owner's: `CONT-ATLAS-HEALTH-WATCHES-ABANDONED-PATH` (ATLAS's own
health script measures a backup directory ATLAS stopped writing to — the same fault as this one,
one node over, and reserving an ATLAS-side file rather than a repository one) and
`CONT-FABRIC-RESOLUTION-DUPLICATED` (the registry read now exists in two places on HERMES).

## Review remediation — five confirmed defects, and what each one is now

Five review threads were filed against this PR after the record above was written, and an
independent merge sweep adjudicated all five **ACCEPTED / CONFIRMED** by execution against the
committed evidence, leaving every one of them open. Two of them were one failure path and named a
`SECURITY_OR_AUTHORITY_THREAD_OPEN` stop. This section is the remediating lane's answer, following
the adopt-and-fix precedent of `#994` and `#1001`: the branch was adopted, the defects were fixed,
and the PR is handed back to a coordinator that authored none of it.

Nothing false was reported by the run that produced this record. Every one of these defects is in
what the retained artifacts would do the **next** time — and `RUNTIME-SETTLEMENT-001` routes
`CONT-EXPV2-FIRST-ACTION-RUNTIME-SETTLEMENT` straight back through them on `ATLAS_REACHABLE`, so
the next time is the one that matters.

| # | Defect | Now |
| --- | --- | --- |
| P1 | `RS-00:115` — the grant lookup filtered `"scope"` alone, so any operator's `#995` grant satisfied it | the route's `AND "userId" = $2` restored; an unnamed actor refuses `AUTHORITY_UNVERIFIABLE_NO_ACTOR` |
| P1 | `RS-00:305` — the authority-PASS branch recorded `executed: false` and the verdict was `PROCEEDED` | the route's mutation and second-observation sequence actually runs; `PROCEEDED` is gone and the verdict is derived from what executed |
| P1 | `sync-models-to-forge.ps1:125` — `sudo rm -rf` over the archive-wide manifest tree, under a header promising no deletions | overlay install through a tested script; nothing in the archive is removed; superseded manifests are copied aside |
| P2 | same line — a fixed `/tmp/manifests-sync` staging path that nests on retry | unique per-run staging path, layout asserted before install, manifests verified by name afterwards |
| P2 | `RS-00:21` — the retained driver could not start from its retained location (`ERR_MODULE_NOT_FOUND`) | the repository root is discovered by walking up to `scripts/repo-alias-loader.mjs`; proven by running it from that location |

### The driver could not be run from where it is retained

`const root = path.resolve(import.meta.dirname, "..")` was correct exactly once: the settlement ran
from `.settlement/`, one level below a checkout root. Retained at
`docs/reports/experience-v2-runtime-settlement/` it resolved `root` to `docs/reports`, and the
alias-loader import failed before argv was even read. `root` was wrong twice over — the second use,
`process.env.WILLIAMOS_PROJECT_ROOT = root`, would have resolved system objects against a
documentation directory silently, and `WILLIAMOS_PROJECT_ROOT` is the variable `#1002` introduced so
that root is not guessed.

`findRepoRoot()` now walks up to the directory that actually contains
`scripts/repo-alias-loader.mjs`, which is correct from both locations and refuses
`REPO_ROOT_NOT_FOUND` from neither. The reviewer's own reproduction is the acceptance check and it
is now a test (`tests/experience-v2-runtime-settlement-driver.test.ts`): a clean tree holding only
the loader and the driver at its retained depth, invoked from there.

```
before  Error [ERR_MODULE_NOT_FOUND]: Cannot find module '...\docs\reports\scripts\repo-alias-loader.mjs'
after   Error: usage: RS-00-settle-stamp-identity.mjs <path to .env.local> [--actor=<userId>]
```

The second test proves which directory `root` actually became, rather than only that the import
stopped failing: LEG 0 digests canonical files relative to `root`, and in a bare tree the path it
reports is the root it resolved — the repository root, not `docs/reports`.

### Authority: the route's predicate, restored — and what "no session" now means

The canonical route filters `WHERE "scope" = $1 AND "userId" = $2` and documents that second clause
as `criterion 8`, in a comment written to stop this exact drift. The driver dropped it. It was right
that it cannot build a session — `getSession` needs a Next request context, and LEG 1 says so — but
**unable to scope is not scoped to everyone**: any active grant scoped to `#995`, belonging to any
operator, satisfied `grantCovers` here.

The predicate is back, verbatim, and the actor is now named rather than absent:
`--actor=<userId>` (or `WILLIAMOS_SETTLEMENT_ACTOR_USER_ID`). Naming is not authenticating, and the
report says so: `actorIdentification: ASSERTED_BY_OPERATOR_NOT_AUTHENTICATED`. Three registry states
are kept apart, because collapsing them is how "we could not check" becomes "there is nothing to
find":

| State | Means |
| --- | --- |
| `AUTHORITY_UNREADABLE` | the registry did not answer. Not permission, and not absence. **This run.** |
| `AUTHORITY_UNVERIFIABLE_NO_ACTOR` | the registry answered and there is no actor to scope to. No grant is consulted. |
| `AUTHORITY_NOT_GRANTED_NO_ROWS` / `_NO_COVERAGE` | the registry answered *for this actor*, and nothing covers |

Reachability is now established with a `SELECT 1` before scoping, deliberately: without it, a missing
actor would mask an unreadable registry and this run's verdict would no longer reproduce. It does.
A returned row whose `userId` is not the named actor is itself refused as `AUTHORITY_SCOPE_VIOLATION`
rather than reasoned about.

### The verdict lattice: `PROCEEDED` is gone and does not come back

The `else` branch at `:305` was reached exactly when authority **passed**; it recorded
`executed: false` with `detail: "unreachable in this run"`, and the driver then stamped
`PROCEEDED`. So the one path meaning "the settlement succeeded" was also the only path that
performed no mutation. `detail` was true of one run and was never a guard.

LEG 7 now executes the route's own sequence when authority passes — observe, assert the observed
identity, stamp under `requireAudit`, observe a **second** time, and record that observation with
`required: true` — and the verdict is derived from LEG 7, never from LEG 2:

```
BLOCKED_AT_AUTHORITY:<result>      authority did not pass
AUTHORISED_NOT_EXECUTED:<refusal>  authority passed and the mutation did not run
EXECUTED_POST_STATE_UNVERIFIED     it ran and the second observation did not verify it
EXECUTED_POST_STATE_UNRECORDED     it ran, verified, and the observation could not be recorded
SETTLED_MUTATION_EXECUTED          all three: executed, separately observed, durably recorded
```

Only the last sets `settled: true`, and the report carries that contract in
`verdictContract` so a later reader does not have to infer it. Passing an authority check is a fact
about a grant registry; settling a governed mutation is a fact about a node.

This is the failure shape this repository has already paid for once. `project-lab-backup-truth`
records every backup mechanism reporting success while protecting nothing; a settlement driver that
can emit a success verdict without executing is the same thing one subsystem over — and the sync
script's own header says it in the same words.

### The archive's manifest tree is no longer deleted

The header at `:13` said *"Nothing is ever deleted on either side by this script."* The manifest step
said:

```powershell
Invoke-Atlas "sudo rm -rf $remote/models/manifests && sudo mv /tmp/manifests-sync $remote/models/manifests"
```

Not a hypothetical first run: this file's own header records ATLAS archived green through
`2026-08-23` with `local=12` — twelve container-era blobs and their three manifests — while blob sync
is additive and never removes anything. The first repaired run would have copied `D:`'s blobs in,
deleted all three archived manifests, installed five, and left twelve immutable blobs on the far
side that nothing names. The comment above the delete was right — *"a blob without its manifest is
unusable for restore"* — and the line beneath it manufactured that condition for every model this
script has ever archived from a store it no longer points at. The by-name completion check added by
this PR verifies **blobs only**, so it would have logged `OK` on exactly that run.

The install is now `scripts/lab-control/hermes/install-forge-manifests.sh`, sent to ATLAS by content
so nothing depends on remote quoting, and it is a real file precisely so it can be **executed** in a
test rather than only reasoned about inside a quoted one-liner. Its contract:

- nothing under the archive's manifest tree is ever removed; the current store's manifests are
  overlaid with `cp -a src/. dest/`, which adds and replaces and does not delete;
- a manifest the current store would overwrite **with different bytes** is copied aside to
  `models/manifests-superseded/<run>/` first, so re-pointing a tag does not lose the metadata naming
  the older blobs. An unchanged tag is not history and is not copied;
- the only thing it deletes is its own staging tree under `/tmp`.

The header now states exactly what is deleted on each side instead of a promise the code broke.

`tests/lab-control-forge-manifest-install.test.ts` runs the real script against a real filesystem,
starting from the concrete case: three container-era manifests in the archive that the live store
knows nothing about. They are still there afterwards, byte-identical.

### The staging path is unique per run, and manifests are verified by name

`/tmp/manifests-sync` was a fixed literal that nothing cleaned. If the `scp` succeeded and the
following `Invoke-Atlas` failed — a dropped session, a sudo refusal, ATLAS going down between the two
calls, which `RS-02` shows is not academic — the staged tree survived; and `scp -r src dest` copies
*into* `dest` when `dest` exists, so the next run produced
`.../manifests/manifests/<registry>/...`, one level too deep, at a path no restore would look at.
It nested again on every run after that, and every one of them logged `OK`.

Now: a per-run staging path (`/tmp/williamos-manifest-sync/<timestamp>-<pid>`) removed before use,
the staged layout **asserted** before anything is installed (`STAGING_LAYOUT_UNEXPECTED`, with the
archive left untouched), and the completion check extended to manifests in both directions:

- every manifest of the live store must be present at its expected archive path after the run —
  a nested layout fails this;
- every manifest the archive held **before** the run must still be present after it —
  `ARCHIVE_REGRESSION`, the tripwire the blob-only check could never have.

The same verification gap was behind both findings, and closing it closes both.

### Deployed on HERMES, digest-verified

The repaired script and its installer replace the deployed copies; the pre-remediation file is
preserved rather than overwritten. The repository and the deployed bytes match exactly.

| File | repo & deployed sha256 | bytes | preserved as |
| --- | --- | --- | --- |
| `sync-models-to-forge.ps1` | `fd9e8779b5af4ebed7b078187bddcc3c4bfd03760a9a06530a33d7ad367526e4` | 14410 | `.bak-20260824_2312-preremediation` (`0b92037d…`) |
| `install-forge-manifests.sh` | `f7deb8e7f7672d6192d43caac443998c0af95ce67eebf7d3e93517f0c35af7fa` | 2951 | new file |
| `backup-volumes.ps1` | `54bf3b05df73bf4fa505ac809f20a9da63771692cd4378c8809efec5378e9866` | 4769 | unchanged by this remediation |

Controls re-run against the **live** files the scheduled tasks invoke, after deploy:

| Probe | Result | exit |
| --- | --- | --- |
| `sync-models-to-forge -ResolveOnly` | `{"store":"D:\HermesData\ollama","storeAgrees":true,"blobCount":21,"manifestCount":5,"manifestInstallerPresent":true}` | 0 |
| `sync-models-to-forge -ManifestInstaller <absent>` | `MANIFEST_INSTALLER_MISSING: … Refusing rather than falling back to deleting the archive's manifest tree.` | 1 |
| `sync-models-to-forge -ServiceScript <absent>` | `SERVICE_CONFIG_UNREADABLE: …` | 1 |
| `backup-volumes -ResolveOnly` | `{"archiveVolumeLabel":"HERMES_NVME","backupDirExists":true}` | 0 |
| `backup-volumes -ArchiveVolumeLabel NO_SUCH_LABEL_XYZ` | `ARCHIVE_VOLUME_ABSENT: …` | 1 |

**One real defect was found by running the controls rather than by reading the diff.** Windows
PowerShell 5.1 binds parameter defaults before `$PSScriptRoot` exists, so
`[string]$ManifestInstaller = (Join-Path $PSScriptRoot ...)` threw on an empty path under `-File` —
the form the scheduled task uses. The default is resolved in the body instead. The guard is also a
**preflight**, before any ssh: a refusal reachable only after the network is up is a refusal nobody
can exercise while the far side is down, which is the state this lab is in.

**A second one was found by re-reading the fix rather than the original.** The manifest listing used
a bare `sudo find` under a checked ssh wrapper. On an archive that does not yet hold a manifest tree
`find` exits non-zero — so the repaired run would have died on the **first repair of exactly the
condition the repair exists for**, which is the failure shape this whole thread is about, reproduced
inside its own fix. Now `|| true`: an empty before-state is legitimate, and an unreadable one is
still caught by the install step, which fails loudly. Redeployed and the controls re-run:
`RS-10-sync-redeploy-after-fix.txt`, which supersedes `RS-09`'s sync digest.

`MODEL_STORE_DISAGREEMENT` is unchanged by this remediation and its refusal is recorded above under
*Verification, on HERMES, with negative controls*.

### The stale copy on HERMES: there was none, and the one that exists now is stated

The continuation this remediation answers requires that the `ATLAS_REACHABLE` run can only ever
execute fixed bytes. The retained driver's own working copy —
`C:\HermesLab\expv2-runtime-settlement`, the worktree `RS-01` records this settlement running from —
**no longer existed on HERMES**. Checked rather than assumed: a recursive search of `C:\HermesLab`,
`D:\` and `G:\` for `*settle-stamp-identity.mjs` returned nothing. So there was no unfixed copy for a
successor to pick up, and no old bytes to overwrite.

**One copy exists there now, and it is this remediation's own.** The section below re-created that
path as a git worktree at `6155b04f` — the commit that carries every code fix — in order to run the
driver where it is retained. `RS-09` records that HEAD, and the two commits after it are
documentation only, so the driver blob `618c64e5…` is unchanged by them.

It is a **reproduction checkout, not a deployment**: it holds this branch, not `main`, and after this
PR merges it is one squash behind by construction. The next lane on `ATLAS_REACHABLE` should refresh
or recreate it from merged `main` before running — the blob is recorded precisely so that "is this
the merged driver?" is a check rather than an assumption, and
`git -C C:\HermesLab\terragroq-s2 worktree remove C:\HermesLab\expv2-runtime-settlement` removes it.

### The fixed driver, run on HERMES from its retained location

Not asserted from a diff. The branch was delivered to HERMES as a bundle, checked out as a worktree
at `C:\HermesLab\expv2-runtime-settlement` — the same path `RS-01` records the settlement running
from — and the driver was invoked **from
`docs/reports/experience-v2-runtime-settlement/`**, the location that could not start at all before
this fix.

Digest-verified both ends by the only comparison that means anything for a git-delivered artifact:
the blob is `618c64e5ba3d1cd3e1c6867c8df9f7d07e20b288` on OMEN and on HERMES, and the HERMES
worktree is clean. The on-disk sha256 differs (26558 bytes here, 27111 there) for one uninteresting
reason: HERMES checks out with `core.autocrlf=true`. Byte-comparing two checkouts of the same commit
across that setting would report a difference that is not one, so the blob is what is compared.

```
verdict           BLOCKED_AT_AUTHORITY:AUTHORITY_UNREADABLE
settled           false
2_authority       registryReadable false, userScoped null, result AUTHORITY_UNREADABLE
7_mutation        executed false, refusedAt "authority", nodeContacted false
6_ledger_guards   routePreflight LEDGER_WRITABLE; brokerRequireAudit refused, execCallsBeforeRefusal 0
```

Retained as `RS-08-fixed-driver-rerun.json`. The verdict is byte-identical to the one this record was
written on, which is the point: the repairs did not move the answer, they moved what the driver would
do if the answer were different. Run again with `--actor=william`
(`RS-08b-fixed-driver-named-actor.json`) the report carries
`actorIdentification: ASSERTED_BY_OPERATOR_NOT_AUTHENTICATED` and the same verdict — ATLAS is still
down, so the actor changes nothing today and is recorded rather than acted on.

Negative evidence after both runs, unchanged: `C:\ProgramData\WilliamOS\node-identity.json` does not
exist, and the fabric ledger is still `1241147` bytes last written `21:26:41` — before either run.
The driver contacted no node, and neither run left a trace.

Full capture: `RS-09-remediation-hermes-controls.txt`.
## Reproduction

```powershell
# on HERMES, from a checkout of this branch with node_modules available. The driver runs from where
# it is RETAINED -- that is the fix, and running it from anywhere else no longer proves anything.
cd <checkout>\docs\reports\experience-v2-runtime-settlement
node --experimental-transform-types .\RS-00-settle-stamp-identity.mjs `
  C:\HermesLab\williamos-runtime-64034e93-flat\.env.local [--actor=<userId>]

# the archive repairs, without side effects, from anywhere on HERMES
powershell -File C:\HermesLab\hermes\backup-volumes.ps1        -ResolveOnly
powershell -File C:\HermesLab\hermes\sync-models-to-forge.ps1  -ResolveOnly

# and their refusals, which is the half a green run never shows you
powershell -File C:\HermesLab\hermes\sync-models-to-forge.ps1  -ResolveOnly -ManifestInstaller <absent>
powershell -File C:\HermesLab\hermes\sync-models-to-forge.ps1  -ResolveOnly -ServiceScript <absent>
powershell -File C:\HermesLab\hermes\backup-volumes.ps1        -ArchiveVolumeLabel NO_SUCH_LABEL_XYZ
```

`--actor` is optional only in the sense that omitting it is a defined outcome: without an identified
actor the authority leg refuses `AUTHORITY_UNVERIFIABLE_NO_ACTOR` rather than consulting every
operator's grants. While ATLAS is down the registry is unreadable either way.

`--experimental-transform-types` is required rather than optional: Node 24's strip-only mode rejects
`system-object-source.ts`'s constructor parameter property, and the module graph will not load
without it.

The original settlement changed no TypeScript or JavaScript, so no deterministic suite was implicated
by it. **The remediation adds two test files** and they are part of the suite:
`tests/experience-v2-runtime-settlement-driver.test.ts` and
`tests/lab-control-forge-manifest-install.test.ts`. Full deterministic suite at the remediated tree,
via the CI config: **426 files passed / 4 skipped; 5723 tests passed / 46 skipped; 0 failed.**

## Retained artifacts

All under `docs/reports/experience-v2-runtime-settlement/`.

| File | What it holds |
| --- | --- |
| `RS-00-settle-stamp-identity.mjs` | the settlement driver. As run on 2026-08-24, then repaired under review — see *Review remediation* |
| `RS-01-settlement.json` | the 2026-08-24 run's full output: every leg, every digest, every refusal |
| `RS-02-atlas-reachability.txt` | ATLAS/AEGIS probed with a live-host and an unassigned-address control |
| `RS-03-hermes-store-and-topology.txt` | model stores on `D:`/`G:`, the service's own `OLLAMA_MODELS`, backup destinations, sync log tail |
| `RS-03b-hermes-drives-and-tasks.txt` | volumes, `C:\HermesLab\hermes` inventory, scheduled tasks with last results |
| `RS-04-archive-repair-controls.txt` | the positive and negative control run, pre-deploy |
| `RS-05-ledger-untouched.txt` | ledger size, line count, last write and tail — the proof nothing ran |
| `RS-06-node-unstamped.txt` | the stamp path on HERMES, absent |
| `RS-07-deployed-archive-scripts.txt` | deployed and preserved digests, 2026-08-24 deploy |
| `RS-08-fixed-driver-rerun.json` | the REPAIRED driver, run on HERMES from its retained location; same verdict, new lattice |
| `RS-08b-fixed-driver-named-actor.json` | the same run with `--actor` named, showing the assertion recorded rather than acted on |
| `RS-09-remediation-hermes-controls.txt` | remediation deploy digests, five controls, blob verification, negative evidence |
| `RS-10-sync-redeploy-after-fix.txt` | the sync redeploy after a latent failure mode was found in the fix itself; supersedes `RS-09`'s sync digest |

## Chronology (local, HERMES/OMEN are the same timezone)

- `21:44` — worktree created on HERMES at `1a352a3f` from an incremental bundle; `node_modules` junctioned
- `21:59:35` — settlement driver runs; `AUTHORITY_UNREADABLE` at leg 2; ledger untouched
- `22:0x` — ATLAS probed with controls; bounded LAN sweep finds Postgres on no neighbour
- `22:1x` — HERMES store and destination truth measured; `F:` confirmed absent
- `22:21:17` — repaired archive scripts deployed, originals preserved, live positive controls pass
- `22:23:07` — negative evidence captured: no stamp on HERMES, ledger last written `21:26:41`
- `22:27` — PR `#1004` opened
- `22:33` — five review threads filed; an independent sweep confirms all five and stops the merge
- `23:0x` — remediation: driver root, authority scoping, verdict lattice; manifest overlay + staging
- `23:09–23:11` — repaired sync script and its installer deployed to HERMES, pre-remediation copy preserved
- `23:12` — five controls re-run against the live files; `$PSScriptRoot` defect found by running them
- `23:15–23:16` — the fixed driver runs on HERMES from its retained location, twice; same verdict
- `23:17` — remediation evidence captured; ledger still `1241147` bytes at `21:26:41`
