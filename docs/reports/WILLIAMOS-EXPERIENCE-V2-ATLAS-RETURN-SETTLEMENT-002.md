# WilliamOS Experience V2 — ATLAS Return Settlement 002

Status: `SETTLEMENT_BLOCKED_AT_AUTHORITY` — ATLAS came back, and the settlement still does not pass.
The reason it does not pass has changed from an environmental one to a substantive one, and that
change is the whole content of this record.

Continuations settled by this lane:

- `CONT-EXPV2-FIRST-ACTION-RUNTIME-SETTLEMENT` — `BLOCKED_DEPENDENCY / AUTHORITY_UNREADABLE /
  ATLAS_REACHABLE` → **`BLOCKED_AT_AUTHORITY / AUTHORITY_ABSENT_FOR_SCOPE_995`**. The waiting
  condition fired and was discharged: ATLAS is reachable. It is no longer the blocker.
- `CONT-EXPV2-ARCHIVE-RUN-UNVERIFIED` — `WAITING_EXTERNAL_ENVIRONMENT / ATLAS_REACHABLE` →
  **`DISCHARGED`**. The run happened, against a real ATLAS, and was verified by blob name from both
  sides independently.

Program: `WILLIAMOS_EXPERIENCE_V2`, Gate 2 · Parent `#987` · Action contract `#995` / PR `#1002`
Predecessor record: `WILLIAMOS-EXPERIENCE-V2-RUNTIME-SETTLEMENT-001.md` (PRs `#1004`, `#1005`)

Branched from merged `main` `1d012785` (post-`#1005`), executed on HERMES and ATLAS.

`OWNER_COURIER_ACTIONS = 0`. The owner was not asked to check a cable, confirm an address, restart a
container, record a grant, run a command, or relay output.

## Result in one paragraph

ATLAS is up, and it is not where anything said it was. Its DHCP lease moved from `192.168.88.5` to
`192.168.88.8` across the power cycle, and `192.168.88.5` is now held by a different device that
answers ARP and answered one ping — which is why polling that address returned "still down" for
forty-one minutes about a machine that had been running for the last thirty of them. The
rediscovery is canonical rather than inferred: the host at `.8` reports `hostname atlas`, its
`/etc/machine-id` digest is an exact match for the `atlas` identity pinned in
`config/execution-fabric/registry.seed.json`, and its ed25519 host key is byte-identical to the key
the fabric already trusted for `.5`. With ATLAS found, the governed action was run again through the
fixed driver — and stopped at authority again, for a new reason. The WilliamOS Postgres container
came back up bound to the literal string `192.168.88.5:15432`, an address that no longer exists on
that host, so Docker could not create the publish and left the container running, healthy, attached
to no network and reachable over TCP from nowhere — including from ATLAS itself. Behind that wall
there is a second one that the first was hiding: the authority registry contains twenty-eight
grants and not one of them is scoped to `#995`. The mutation did not happen, the node was never
contacted, no grant was minted, and no substitute registry was stood up. What did complete is the
other half of the packet: the first real archive of the live model store ran against a real ATLAS
and was independently verified by blob name.

## The verdict, in the fixed lattice

```
verdict   BLOCKED_AT_AUTHORITY:AUTHORITY_UNREADABLE      (the driver's own run, AT-07)
settled   false
executed  false          nodeContacted false          postState null
```

`AT-07-settlement-run.json` is the run, unedited. Two walls stand in front of this mutation and the
driver reports the nearer one, because that is the one its own governed path reached:

| | Wall | Proven by | Would repairing the other one change the verdict? |
| --- | --- | --- | --- |
| 1 | **Transport** — the grant registry is unreachable by any governed transport | `AT-02`, measured on ATLAS itself | No. See wall 2. |
| 2 | **Substance** — no grant scoped `#995` exists, for any actor | `AT-03`, read-only observation | No. The route would refuse `AUTHORITY_NOT_GRANTED_NO_ROWS`. |

This distinction matters for what the next lane does. Wall 1 looks like an outage and invites
someone to "just fix the container". Wall 2 says that fixing it changes nothing about this
settlement, and that the missing thing is a recorded authority decision, which is not a settlement
lane's to make and was not made here.

### The actor was wrong yesterday, and is right today

The 2026-08-24 runs passed `--actor=william`. There is no user with that id. The registry's users
are `YCAbP6TPTU1sxkpf4gVl5FcX9Nf4lrwZ` (`bsvalues@gmail.com`) and a synthetic operator. The route
scopes every grant lookup by `"userId"`, so `--actor=william` would have returned zero rows for the
wrong reason — an actor that does not exist rather than a grant that does not. Today's run used the
real id and is recorded with it, marked `ASSERTED_BY_OPERATOR_NOT_AUTHENTICATED` as the driver
requires. Naming is still not authenticating.

## Step 0 — the rediscovery, and why the poll alone would have lied

Full evidence: `AT-01-atlas-reachability-and-rediscovery.txt`.

The declared endpoint was polled every ~2 minutes for 41 minutes and never answered. Held on its
own, that measurement supports the conclusion the packet warned against: it looks exactly like
`ATLAS_ABSENT`. Three things separated the two readings.

1. **Layer 2 answers what IP will not.** `192.168.88.5` resolved to a real MAC in `Reachable` state
   from *both* HERMES and OMEN, while the unassigned controls `.200`/`.250` and the genuinely-absent
   AEGIS `.6` all read `Unreachable / 00-00-00-00-00-00`. Something was there. That alone did not
   say *what*.
2. **The sweep found exactly one Postgres**, on `192.168.88.8`, behind an Ubuntu OpenSSH banner
   matching ATLAS's OS family. A candidate, not an answer.
3. **Identity settled it, twice.** `machine_id_sha256` at `.8` equals the `atlas` pin in
   `registry.seed.json` exactly; and the ed25519 host key at `.8` is byte-identical to the key
   already pinned for `.5` in the fabric `known_hosts`. A port that looks right is a guess. A
   machine-id that matches the registry's own pin is a rediscovery.

Old → new: **`192.168.88.5` → `192.168.88.8`**, ATLAS booted `2026-08-25 08:20:33Z`.

The polls that kept saying "no" are printed in the artifact rather than dropped, because a lane that
only records the measurement that turned out to matter is teaching the next one to trust a poll.

## Step 1 — the settlement legs

Driver: `RS-00-settle-stamp-identity.mjs`, the fixed one from `#1004`. **Digest-verified before use,
and not only the driver.** All thirteen files the run depends on were compared as git blobs between
the HERMES checkout and merged `main`:

```
618c64e5…  RS-00-settle-stamp-identity.mjs        e86ed1de…  app/api/system/node/stamp-identity/route.ts
73cbcf73…  lib/system/node-identity-stamp.ts      be1a3372…  lib/system/system-object-source.ts
ffdf937c…  lib/system/system-object.ts            0b23c6ab…  lib/system/node-identity-contract.ts
d058e8df…  lib/intent/object-action-registry.ts   3b905a28…  lib/governance/authority.ts
709be139…  lib/fabric/broker.mjs                  df8abab2…  lib/fabric/audit.mjs
10c8ec3d…  lib/fabric/transport.mjs               cbe3044b…  config/execution-fabric/registry.seed.json
edd71ce9…  config/execution-fabric/node-identity-contract.json
```

Every one matched `main`, so **no redeploy was needed**. The checkout's `HEAD` is `6155b04f`, an
intermediate commit of the `#1004` branch, which is why this was checked file-by-file rather than by
comparing commits: the later commits on that branch touched tests, docs and the archive scripts, not
the settlement's module graph. Comparing on-disk SHA-256 would have been the wrong test — that
checkout has `core.autocrlf=true`, so its bytes differ from `main` by line ending alone; the git
blob is the comparison that means something.

| Leg | Result | Evidence |
| --- | --- | --- |
| 0 · canonical digests | recorded, 12 modules | `AT-07` `legs.0` |
| 1 · HTTP/session shell | `SESSION_SHELL_NOT_EXECUTABLE` — deployed bundle `fe6ef4e7` still does not contain the route | `AT-07` `legs.1` |
| 2 · **authority** | **`AUTHORITY_UNREADABLE`** — `connect ETIMEDOUT 192.168.88.5:15432` | `AT-07` `legs.2`, `AT-02` |
| 3 · object graph | 5 nodes resolved from the canonical graph | `AT-07` `legs.3` |
| 4 · selection | `system.node.stamp-identity` → `node:hermes-node`, state `authority_required` | `AT-07` `legs.4` |
| 5 · plan | plan built, 158 bytes, `deletesNothing: true` | `AT-07` `legs.5` |
| 6 · ledger guards | preflight `LEDGER_WRITABLE`, wrote nothing; broker `requireAudit` refused at **0** exec calls; inverse control proceeded at 1 | `AT-07` `legs.6` |
| 7 · **mutation** | **not executed**, `refusedAt: authority`, `nodeContacted: false` | `AT-07` `legs.7` |

Both ledger guards held, again, and the broker's `requireAudit` refusal was proven with an injected
exec spy that recorded zero calls — so the guard, not the network, is what stopped it. The inverse
control (same unwritable root, `requireAudit: false`) proceeded to one call, which is what makes the
refusal meaningful rather than incidental.

**Negative evidence, before and after the run:** the fabric ledger was `1241147` bytes last written
`2026-08-24 21:26:41` before, and `1241147` bytes last written `2026-08-24 21:26:41` after.
`C:\ProgramData\WilliamOS\node-identity.json` did not exist before and does not exist now. The run
left no trace on the node because it never reached it.

## Step 2 — the first real archive run, and the thing it actually found

Full evidence: `AT-08-archive-run-and-verification.txt`.

The packet expected roughly 9.65 GB to move. **`copied=0`.** Every one of the live store's 21 blobs
was already in the archive, and that is not the sync having quietly worked all along. Ollama blobs
are content-addressed; the `#997` migration moved the same content onto `D:`, and those blobs had
been archived back when the script still pointed at the store that held them. The models were
covered by an accident of history.

What was genuinely missing was the metadata. The archive held **3** manifests; the live store has
**5**. A blob no manifest names is not restorable — precisely the unusable-restore condition the
script's own guard is written against. This run installed the two absent manifests
(`llama3.2/3b`, `snowflake-arctic-embed2/latest`) and refreshed a third whose bytes had changed,
copying the superseded version aside instead of overwriting it.

So the product of the first real archive run is not bytes moved. It is that the model store is
restorable, which it was not yesterday, and which no green log line in this script's history would
ever have told anyone.

**Verified independently, not taken from the script's own `verified=by-name`:** both sides were
listed separately and diffed here — 21 of 21 live blobs present on ATLAS by name, 5 of 5 live
manifests at their expected archive paths, 5 archive-only blobs retained, 1 manifest superseded
aside, nothing removed from the archive in either direction.

`backup-volumes.ps1` ran through `HermesVolumeBackup`, `lastResult=0`, five volumes written at
`02:01:08` with sizes matching the last good run. Its label resolution returned `G:` — the letter
whose change broke the old `F:` path — which is the earlier repair demonstrably working.

Both were invoked through their **scheduled tasks**, not by hand, so what ran is the production
path. A hand invocation over ssh was tried first and hung: an ssh child launched from inside an ssh
session inherits that session's stdio and neither side tears down. The task has no such parent.

## Repairs this lane made

Each one is the same defect the program has now paid for four times — a written-down address or
letter outliving the thing it named.

**1 · `scripts/lab-control/hermes/sync-models-to-forge.ps1` — the endpoint is resolved, not written
down.** The script hard-coded `$atlas = "bs@192.168.88.5"`. Left alone it would have offered the
lab's entire model store to whatever now holds that address. It now resolves ATLAS from
`nodes.json`, the registry that already exists to answer this, and **refuses** if that registry is
absent or carries no `atlas` entry — `FABRIC_REGISTRY_UNREADABLE` / `FABRIC_REGISTRY_INCOMPLETE`.
Falling back to a literal is how the stale value survives, so there is no fallback. This is the same
discipline `Assert-LiveStore` already applies to the model store: one owner, read rather than
restated.

**2 · The fabric registry — ATLAS's address, through the registry's own merge-write.**
`updateNodeFields` sets the fields named and carries every other field through untouched, and
refuses if the file changed since it was read. `atlas.host` `192.168.88.5` → `192.168.88.8`, plus a
`note` recording the move and both identity proofs, so the next lane does not have to re-derive
them. Every other node is byte-unchanged. No hand-edit, no `registry.seed.json` edit.

**3 · The fabric `known_hosts` — a stale pin that would have refused ATLAS.** `192.168.88.8` was
already pinned, to **OMEN's** key, left from when OMEN held that lease. ATLAS now presents its own
key there, so every `StrictHostKeyChecking=yes` connection to ATLAS — which is exactly what the sync
script uses — would have failed on a key mismatch. The `.8` pin now carries ATLAS's key, and the
`.5` pin, which asserted a machine that is no longer there, is gone. The edit asserts both pins are
exactly what it expects before changing anything and refuses otherwise; a backup is preserved. OMEN
keeps its `omen` / `omen.local` pins, which is how OMEN is actually addressed — and OMEN's own
registry note (`the DHCP lease moved .8 -> .7 -> .8 in a day`) is why it is addressed that way.

### Controls, run against the live deployed file

Not against the repository copy — that distinction is not pedantry; `#1004`'s `$PSScriptRoot` defect
was found this way and could not have been found by reading a diff.

| Control | Result |
| --- | --- |
| `-ResolveOnly` | `exit 0`, `atlas: bs@192.168.88.8` resolved from the registry, store agrees, 21 blobs / 10,360,071,891 bytes / 5 manifests |
| `-FabricRoot <absent>` | `exit 1` `FABRIC_REGISTRY_UNREADABLE` |
| `-FabricRoot <registry with no atlas>` | `exit 1` `FABRIC_REGISTRY_INCOMPLETE` |
| `-ManifestInstaller <absent>` | `exit 1` `MANIFEST_INSTALLER_MISSING` (pre-existing, still holds) |
| `-ServiceScript <absent>` | `exit 1` `SERVICE_CONFIG_UNREADABLE` (pre-existing, still holds) |
| `backup-volumes.ps1 -ArchiveVolumeLabel NO_SUCH_LABEL_XYZ` | `exit 1` `ARCHIVE_VOLUME_ABSENT` |

The deployed file was byte-identical to `main` (`40de3800…`) before the deploy, so there was no
drift to reconcile, and it is byte-identical to this branch (`0b67f758…`) after it. A pre-deploy
backup is preserved on HERMES.

**Stated rather than glossed: these controls are the only tests this change has.** No test in the
suite executes a `.ps1` file — `tests/lab-control-forge-manifest-install.test.ts` runs the *bash*
installer, and CI has no PowerShell. So the guards are exercised on real hardware against the live
file, and that is written down here instead of a test file being added that could not run.

## What this lane did NOT do, and why

**It did not repair the `williamos-postgres` container.** It could have: the data is on a named
volume, so a recreate would not risk it. It did not, because the binding cannot be *restored* — the
address it names is gone and belongs to another device, so any new binding (`0.0.0.0:15432`, or the
new address) is a **new decision about how this lab's single authority oracle is exposed on the
network**. No repository file declares that container; it has no compose labels, and the only
repo-side record of the endpoint (`docs/reports/WO-LOCAL-006C`) specifies a *loopback* proof binding
on a different host. There is no canonical definition to re-apply, only one to invent. That is a
gate's decision.

It is also worth being plain that repairing it would not have moved this verdict: there is no `#995`
grant in that database to find.

**It did not point `DATABASE_URL` at `192.168.88.8:5432`.** That port is `tf-postgres` —
TerraFusion, a different product. Aiming the authority lookup at the wrong database to get an answer
is the same move as minting a grant, wearing different clothes.

**It did not mint, cache, widen, or fail open on authority.** The `"userId"` predicate was applied
verbatim, with a real actor id.

## What may NOT be claimed from this record

- That `node.stamp-identity` has been settled. It has not run. `nodeContacted: false`.
- That Gate 2 is `ACCEPTED`. `#995`'s invariant 13 requires the governed mutation to have executed
  and been verified by separate observation. It has not executed.
- That ATLAS being back unblocks the program. It unblocked the archive. It did not unblock
  authority, and it revealed that authority was never only an availability problem.
- That the archive run proves the sync had been protecting the models. It proves the opposite:
  the blobs were covered by coincidence and the manifests were not covered at all.
- That the `williamos-postgres` container is healthy because it says `Up`. It is `Up`, serving, and
  unreachable from every host in the lab including its own.

## Typed findings

### `CONT-EXPV2-AUTHORITY-REGISTRY-SINGLE-POINT` — AMENDED, and sharper than when it was filed

Filed on `#1004` as "the lab has one authority oracle with no availability story." ATLAS's return
did not close it; it made it worse and more precise. The oracle is now **up and still unreachable**,
because its transport was pinned to an address that a DHCP lease took away. So the finding is not
only "one oracle, no availability story" — it is that the oracle's reachability depends on a
hand-made `docker run` from 2026-08-13 that no repository file describes and no health check tests.
Nothing in WilliamOS noticed. The container reported `Up` throughout.

Still not an argument for caching or failing open. It must not.

### `CONT-EXPV2-AUTHORITY-ABSENT-FOR-SCOPE-995` — NEW, and it is the real terminal blocker

```
type:      BLOCKED_AUTHORITY
reason:    NO_GRANT_RECORDED_FOR_SCOPE
scope:     #995
required:  A3_WRITE_SHARED for node.stamp-identity
observed:  28 grants in the registry, 0 scoped #995 (AT-03)
notClosedBy: repairing the registry's transport
```

The authority registry has grants for `#887`, `#890`, `#891`, `#905`, `WO-0027`, `WO-0028`, nine
goals, four Hermes outcomes and two campaigns. It has none for `#995`. Four `A3_WRITE_SHARED` grants
exist and every one is scoped elsewhere. Gate 2's terminal leg is waiting on a recorded authority
decision that has never been made, and the ATLAS outage has been standing in front of that fact
since 2026-08-24. **No grant was minted to get past it, and none may be.**

### `CONT-EXPV2-HARDCODED-ADDRESS-CLASS` — NEW, typed observation

Four instances now, all the same shape, all silent: `F:` outliving its NVMe; the 2026-08-18 LAN
move; `sync-models-to-forge.ps1`'s `bs@192.168.88.5`; and `williamos-postgres`'s
`HostIp: 192.168.88.5`. Three are repaired. The fourth is wall 1 above. The lab already knows the
answer — OMEN's registry entry uses an mDNS name *because* its lease moved twice in a day — and it
has not been applied consistently. Recorded so the next occurrence is recognised rather than
re-diagnosed.

### `CONT-EXPV2-RUNTIME-DEPLOY-LAG` — unchanged

The deployed bundle is still `fe6ef4e7` and still does not contain the route. `AT-07` `legs.1`.

## `#995` invariant 13 — disposition

**NOT ACCEPTED.** Not for want of an environment this time. The governed mutation did not execute,
and the reason is now specific and recorded: no authority grant scoped `#995` exists, so the route's
own check refuses on substance and not merely on reachability. That is a decision to be recorded by
whoever holds it, and neither this lane nor any builder lane may record it for them.

## Retained artifacts

All under `docs/reports/experience-v2-atlas-return-settlement/`.

| File | What it holds |
| --- | --- |
| `AT-01-atlas-reachability-and-rediscovery.txt` | the 41-minute poll, layer-2 discrimination with controls, the port sweep, and both identity proofs |
| `AT-02-authority-registry-transport-broken.txt` | the container's pinned `HostIp`, the missing docker-proxy, and TCP unreachability proven from ATLAS itself |
| `AT-03-grant-observation.txt` | read-only registry observation: 28 grants, no `#995`, and the corrected actor id |
| `AT-04-registry-merge-write.txt` | the canonical `updateNodeFields` merge-write, before/after, module blobs verified against `main` |
| `AT-05-known-hosts-repair.txt` | the stale `.8`→OMEN pin, the guarded replacement, backup path |
| `AT-06-sync-deploy-and-controls.txt` | deploy digests and the six controls run against the live file |
| `AT-07-settlement-run.json` | the settlement run, unedited: every leg, every digest, every refusal |
| `AT-08-archive-run-and-verification.txt` | the real archive run and the independent two-sided by-name diff |

## Envelope

HERMES and ATLAS were this lane's nodes. On HERMES: one script redeployed with its backup preserved,
`nodes.json` merge-written with a backup preserved, `known_hosts` corrected with a backup preserved,
two existing scheduled tasks started on their normal definitions, one worktree used. No service,
container, compose file, GPU setting or model was changed; the `#1003` Ollama service and the P40's
150 W cap were not touched. On ATLAS: read-only inspection, plus the archive writes the sync script
itself performs under its additive contract — 2 manifests installed, 1 superseded copied aside, no
blob and no manifest removed. `williamos-postgres` was not started, stopped, recreated, or
re-plumbed, and no row in the authority registry was written.

`OWNER_COURIER_ACTIONS = 0`.
