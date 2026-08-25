# Experience V2 — the deployed cockpit reaches ATLAS, the grant clock tells the truth, and `#995` waits on one thing

**Lane:** JOURNEY COMPLETION · **Date:** 2026-08-25 · `OWNER_COURIER_ACTIONS = 0`
**Branched from merged `main` `10aa6738`** (post-`#1008`).
**Evidence:** `docs/reports/experience-v2-journey-completion/`

Report 003 disposed of `#995` invariant 13 as NOT ACCEPTED with two named gaps: the deployed HERMES
bundle predated the route, so the `returnTo` seam was never exercised, and the actor was
`ASSERTED_BY_OPERATOR_NOT_AUTHENTICATED`. This lane was sent to close both.

One is closed. The other is not, and the reason it is not turned out to be a fact about the product
rather than a shortfall of effort — so this report ends with a typed `WAITING_OWNER_SESSION` rather
than with a green journey.

Three things were wrong on the way, and the second of them was wrong in the merged record.

---

## 1 · A two-hour grant was honoured for nine, and the second route had it worse

`authority_grant.expiresAt` is a UTC wall clock in a `timestamp without time zone` column. node-pg
parses that by building a `Date` from its components in the **reading process's** local zone, so the
instant it returns is wrong by exactly the local offset. `lib/db/schema.ts` has always undone this —
inside a `customType` closure, which is why every read through drizzle was correct and why no raw
reader could share it.

`OR-09` measured the consequence on HERMES at UTC-7: the route read `19:05:06Z` where the schema read
`12:05:06Z`, and honoured a two-hour grant for nine. West of UTC a grant outlives its bound; east of
UTC it dies early. Either way the number in the authority record is not the number being enforced,
which makes "bounded" decoration.

The conversion now lives in `lib/db/utc-wall-timestamp.ts` and `schema.ts` calls it. **Extraction,
not restatement** — a second copy of the arithmetic beside each raw reader is the same defect one
amendment later.

**The work-context route had it worse, and this was not previously recorded.**
`app/api/governance/work-context/route.ts:56` selects the same column and passed the raw rows to
`grantCovers` with no conversion at all *and* no array defaulting, so a `null` `blockedActions` threw
inside the checker. `authorityGrantFactsFromRow` is now the single door for a raw row, and it
**throws** on a timestamp it cannot read rather than degrading to `null`: a dropped bound is not a
missing bound, it is an unbounded grant.

`grantCovers` and `isGrantActive` now take a named `AuthorityGrantFacts` rather than the full row
type. The `as never` casts at both call sites are what let two partial rows through unchecked in the
first place; a cast is not a check.

The regression test runs under a forced UTC-7 zone and **asserts the offset before anything else**,
because this suite passing on a UTC machine would prove nothing at all. It pins the old behaviour
explicitly: the same grant at the same instant is accepted by the pre-fix shape and refused by the
fixed one.

`CONT-EXPV2-GRANT-EXPIRY-TZ-SKEW` — **closed**, and deployed to the node where the journey's
authority check runs, before any grant was considered.

---

## 2 · The credential was never the problem

`CONT-EXPV2-RUNTIME-CREDENTIAL-STALE` says the deployed runtime cannot read the authority registry
because the role's password is absent from its environment. **It is not true of the runtime that is
actually deployed**, and the arithmetic in `OR-13` is not what was wrong — the identification of the
live runtime was.

The scheduled task `WilliamOS Live` serves `C:\HermesLab\williamos-runtime-64034e93-flat\server.js`.
`OR-13` measured `C:\HermesLab\williamos-runtime\.env.local`, a different directory among about forty
`williamos-runtime-*` left on the node, which serves nothing. The live file's credential digests to
`780bae1cfb8dc1c3` — the one `OR-13` itself proved `matchesRoleVerifier: true`.

Proved by connecting rather than by arithmetic, twice, with the live runtime's own `.env.local`:

| attempt | host | result |
| --- | --- | --- |
| as written in the env file | `192.168.88.5` | **`ECONNREFUSED`** in 2198 ms |
| host resolved through the fabric registry | `192.168.88.8` | **`ok`**, role `williamos`, 29 grants, 21 ms |

`ECONNREFUSED`, not `28P01`. *A connection refused at the transport and a connection rejected at
authentication look identical from a distance and are not.* `OR-13` saw `28P01` because the driver it
was debugging sourced its credential from a different file than the deployed service does.

So the wall in front of the deployed cockpit is `CONT-EXPV2-RESOLVER-NOT-WIRED`. The register said
the two findings had to be closed together, and that closing the resolver alone "would replace a
VISIBLE wrong address with an INVISIBLE wrong credential". Measured, the credential underneath was
never wrong for this process — so closing the resolver closes the whole thing.

**No password was read, printed, copied, changed, or moved between files by this lane.** The live
`.env.local` was never written: `AD51C4BE…` before the deploy and the same after it. The repair was
to resolve the *address* at boot, which needs no access to the credential at all.

---

## 3 · The cockpit's start script now exists in the repository

It previously existed only as a hand-typed file at
`C:\ProgramData\WilliamOS\start-williamos-live.ps1`. Nothing in the repository described how the one
supervised service on that node starts — the same ownership gap `#997` closed for Ollama and `#1008`
for the authority container.

`deploy/hermes/williamos-live/start-williamos-live.ps1` is that declaration, and it is the production
caller `lib/fabric/authority-registry-url.mjs` never had. The address stops being configuration and
becomes a lookup, resolved once per start.

**Writing `192.168.88.8` into `.env.local` was the alternative and it is the defect, not the repair**
— correct on the day it is typed, silently wrong the next time the lease moves. It would have been
the fifth occurrence of `CONT-EXPV2-HARDCODED-ADDRESS-CLASS`.

Only the host moves: the resolver carries role, password, port, database and query through
byte-for-byte, `.env.local` stays the one place the credential lives, and the script never reads,
prints or writes it. **Resolution failure refuses the boot**, because the cockpit answers 200 on
`/sign-in` while unable to reach its database — which is how this went unnoticed for two days.

### The mechanism was measured, not cited

The whole design rests on `process.env` beating `.env.local`. That is Next's documented behaviour and
citing it would have been enough to be wrong quietly, so it was measured on the built artifact with
two bogus loopback URLs differing only by port, and a listener on each:

```
verdict                 PROCESS_ENV_WINS
dotenvPort5551Hits      0
processEnvPort5552Hits  2
```

The first run of that probe said `INCONCLUSIVE_NO_CONNECTION_OBSERVED` while the app plainly reported
`ECONNRESET` at 7 ms — it had connected. The listener totalled its counts and wrote them at exit, and
`Stop-Process` on Windows terminates rather than delivering `SIGTERM`, so the writer never ran.
*Evidence that only exists if a process is shut down politely is evidence that goes missing exactly
when something has gone wrong.* It appends per connection now. The first number is recorded because a
reader would otherwise find it.

---

## 4 · PowerShell 5.1 refused the boot on the resolver's success message

The first deploy stopped the task, captured the rollback, replaced the bundle, placed the boot
tooling — and then threw on its own resolution check, leaving the service down. The check had
**succeeded**; its output was the resolver's diagnostic naming `192.168.88.8`.

Windows PowerShell 5.1 wraps anything a native command writes to stderr in a `NativeCommandError`
regardless of exit code, and `$ErrorActionPreference = "Stop"` makes that terminating. The resolver
writes its evidence line to stderr *by design*. So success is what killed it. `2>$file` does not
avoid it; only lowering the preference around the call does. The same defect then refused the boot
itself — `LastTaskResult 1`, an empty boot log, and a diagnostic naming `.8`.

Both call sites now drop to `Continue` for the invocation, restore the previous preference in a
`finally`, and take the verdict from `$LASTEXITCODE`, which is the only thing that was ever a
verdict. Guarded by tests at both sites so it cannot come back quietly.

This is the repository's own operating note about PS 5.1 native stderr, met in a new place. It cost
one aborted deploy and about seven minutes of downtime on a service nothing else was using at the
time.

---

## 5 · The deploy, with a rollback that exists

The canonical owner is `scripts/deploy-hermes-runtime.ps1`, and its `#762` provenance gates were left
in force: the artifact must carry a real SHA, that SHA must equal `git HEAD` in the source tree, and
the **running** instance must report the same SHA at `/api/health`.

Three additions, all in service of this lane's own requirements rather than general improvement:

- **The outgoing build is captured before `robocopy /MIR` destroys it.** The script previously said,
  accurately, that the previous build was not automatically restored — which left recovery as
  "rebuild the previous commit", requiring that commit to still be known and buildable. The restore
  command is printed by the deploy itself, because a rollback directory nobody can name is not a
  rollback.
- **The boot-time tooling is copied.** Measured on this build, Next **bundles** `lib/fabric/*.mjs`
  into the route chunks rather than tracing them as files, so `.next/standalone/lib` holds only
  `generated/build-provenance.json`. The runtime's existing `lib\fabric\*.mjs` are leftovers from an
  older hand-placement. The whole directory is copied rather than the two files named today, because
  hand-listing the closure is a trap that fails at *boot*, not at deploy.
- **The deploy proves the boot path resolves** before restarting the service, while the outgoing
  build is still restorable.

| | before | after |
| --- | --- | --- |
| `routePresentInDeployedBundle` | `false` | **`true`** |
| `/api/health` | no response, timed out at 15 s | `200`, `database.ok true`, 11 ms |
| running SHA | marker `fe6ef4e7…` | `42836911…`, matching the built artifact |
| `.env.local` sha256 | `AD51C4BE…` | `AD51C4BE…` — byte-unchanged |

`BOOT_RESOLVED` is in the boot log with the registry fingerprint the answer came from, so a later
boot is auditable rather than merely successful.

**`READ_OK`.** The deployed runtime reads the authority registry through its *own* configuration
path — not through a driver, not through a re-derivation. That is the proof
`CONT-EXPV2-RUNTIME-CREDENTIAL-STALE` asked for, obtained without touching a credential.

The one Ollama owner was not touched and is still answering (`runtime.ok`, provider
`127.0.0.1:11434`, `fallback false`). This lane deployed the WilliamOS app bundle only.

And the route answers:

```
POST /api/system/node/stamp-identity  {"objectId":"node:hermes-node"}
401 {"error":"UNAUTHENTICATED"}
```

Live, reachable, and refusing for the one remaining reason. Before this deploy the same request
reached no such route at all.

---

## 6 · `WAITING_OWNER_SESSION`

The journey needs a real authenticated session. Every path the product offers was enumerated and
measured against the deployed runtime:

| path | state |
| --- | --- |
| email + password | enabled, and the identity has a credential account — needs the owner's password |
| email OTP | **disabled and unconfigured** (`AUTH_EMAIL_OTP_ENABLED` unset, no provider) |
| passkey | **0 registered** for this identity |
| device link | requires an already-authenticated session to mint a code; 0 pending, 0 live device sessions |
| sign-up / bootstrap | `signup.open false` |

Every one either requires a credential only the owner can enter, or cannot mint a session for anyone
at present. That is precisely the condition the continuation packet defines, and it is the only owner
interaction this lane has raised.

### The path deliberately not taken

96 live browser sessions exist for this identity, and Better Auth stores `session.token` in
**plaintext**. A token could have been read out of the registry this lane already has authenticated
access to, set as a cookie, and used to drive the journey to a green result.

It must not be. It is not the canonical sign-in path and it is not minting — it is replaying the
owner's live authentication artifact, which is the same class of act as fabricating a session row,
which is the same class of act as minting a grant to satisfy an authority check. `#1008` drew exactly
this line. *A journey whose actor is a token lifted from a database proves nothing about
authentication; it proves that whoever ran it had database access, which was never in question.*

---

## 7 · No grant was minted

The packet authorises one re-mint to finish the acceptance test. The acceptance test cannot be
finished, so minting would produce standing `A3_WRITE_SHARED` permission under `#995` with nothing to
spend it on — the state `GRANT-0019`'s own revocation reason says must not outlive the proof. With the
timezone defect fixed the window would also be real: two hours means two hours now.

**And the canonical recorder refuses it, by design.** `#1008`'s review found that
`OR-01-record-grant.mjs`'s replay guard was written on `grantCovers`, and coverage is exactly what
revocation removes — so after `GRANT-0019` was revoked a re-run would have minted a fresh *active*
grant with no owner decision behind it. `#1008` called that the worst defect in the lane and rewrote
the guard to test for the issuance's existence **in any status**, before `--record` is consulted, with
no override flag.

Minting here would mean weakening that guard. Removing a safety rail a previous lane installed, in
order to tick a step in my own packet, would be the worst thing this lane could do. So this is a
report rather than an attempt.

Authority state at the end: **29 grants, `GRANT-0019` revoked, no standing `#995` permission.** The
lane began with none and ends with none.

---

## `#995` invariant 13 — disposition

**NOT ACCEPTED**, and the gap is now exactly one thing rather than two.

| Seam | Settled | By |
| --- | --- | --- |
| stable object | yes | `OR-10` leg 3, unchanged |
| current world | yes | `OR-10` leg 3, unchanged |
| contextual action | yes | `OR-10` leg 4, unchanged |
| governed execution | yes | `OR-10` legs 2/5/6/7, unchanged |
| verified post-state | yes | `OR-10` leg 7, unchanged |
| **preserved return location** | **no** | built at `route.ts:344`; now *deployed and reachable*, but only emitted on a successful stamp |

Report 003's first gap — `routePresentInDeployedBundle: false` — **is closed**. The route is deployed
and answering. The sixth seam is no longer blocked by the deploy; it is blocked only by the second
gap.

Report 003's second gap — the actor — **stands**, and now stands alone. Both remaining items collapse
into one: an authenticated session. With it, the remaining work is a grant re-mint under the
`CONTINUATION-27` constraints and one journey run.

**No lane may read this record as invariant 13 accepted.**

---

## What this may NOT be read as

**`CONT-EXPV2-RUNTIME-CREDENTIAL-STALE` is not "fixed" — it is corrected.** The defect as written did
not exist on the deployed runtime. Something real was found in its place and repaired. A lane that
reads "closed" here and assumes a credential was rotated will be wrong.

**`CONT-EXPV2-AUTHORITY-REGISTRY-SINGLE-POINT` stays typed open.** Nothing here touches it. The
cockpit reaching ATLAS makes the single point *reachable*, not *redundant*.

**The deployed SHA is `42836911`, a branch commit**, not merged `main`. The packet required the
timezone fix deployed before any grant was considered, and that fix is not in `main` yet. Commits
after `42836911` on this branch are documentation only.

**Reboot behaviour is claimed from configuration, not from a reboot.** The task and its start script
are in place and were proven by a stop/start cycle; HERMES was not rebooted.

---

## Coordination

`lib/db/schema.ts` is also touched by open PR **#927** (`codex/environment-frontend-takeover-921`).
No other path this lane touched appears in any open PR.

This was checked rather than waved at, because the work-context gate treats a declared collision as
"the lane must not proceed" and that is too strong a verdict to reach on a guess:

| | region |
| --- | --- |
| this lane | lines 19–48, the `utcWallTimestamp` definition |
| **#927** | `@@ -381,6 +381,30 @@` (adds `environmentWorld`) and `@@ -961/-976 @@` (adds a `kind` column to `deviceCredential`) |

The two are **line-disjoint**, so this is file-level adjacency rather than an overlapping reservation,
and it was not declared as a collision on the receipt for that reason. #927 has been open since
2026-08-20, was last updated 2026-08-21, and already reports `mergeable: CONFLICTING` against `main`
independently of anything here. The merge coordinator should still sequence the two deliberately
rather than race them.

## Tests

`tests/authority-grant-expiry-utc.test.ts` and `tests/hermes-live-start-definition.test.ts` are new.

The full deterministic suite was run twice on this branch, and the difference between the two runs is
worth recording rather than picking the flattering one:

| run | files | tests |
| --- | --- | --- |
| before the records were written | 2 failed, 429 passed, 4 skipped | 22 failed, 5846 passed |
| final tree | 3 failed, 429 passed, 4 skipped | 23 failed, 5858 passed |

`execution-fabric-hermes-embedding-bakeoff` (16) and `lab-dev-preflight` (6) fail in both, and fail on
unmodified `main` — they are report 003's documented baseline. The third slot is occupied by a
different file each time: `execution-fabric-pinned-placement` in report 003's run, nothing in the
first run here, `multi-agent-evidence-ledger` in the second. That is exactly the concurrency-sensitive
subprocess-spawning class this repository's operating notes already describe.

`multi-agent-evidence-ledger` was re-run **alone** and passes 19/19. It imports
`scripts/multi-agent-operator/authority-events.mjs`, not `lib/governance/authority.ts`, so it shares
no module with anything this lane changed.

`tsc --noEmit` reports **1645 errors on this branch and 1645 on the unmodified baseline**, verified by
stashing this lane's changes and re-running. None is in `app/` or `lib/`.

### The new test failed on CI first, for its own version of the defect it tests

`authority-grant-expiry-utc` passed locally and failed on the runner: two assertions, `expected false
to be true`. The zone was being set in `beforeAll`, but a `describe` callback body runs during
**collection**, before any `beforeAll` — so the driver `Date`s were built in the runner's zone and read
back in the configured one. On a UTC-7 laptop that is a no-op and everything passes; on a UTC runner
the fixture carries a skew nobody asked for.

The arrangement was environment-order-dependent in exactly the way the code under test is, which is a
poor thing for this particular file to have been. The zone is now set at module scope and every driver
value is constructed inside its test rather than beside it, so moving that line cannot reintroduce it.
Verified under **both** `TZ=UTC` (the condition that failed) and the native zone: 13/13 each.

## Retained artifacts

| File | What it holds |
| --- | --- |
| `JC-01-credential-finding-corrected.txt` | which runtime actually serves, the three env files compared by digest, and the two-attempt connection proof |
| `JC-02-deploy-and-boot.txt` | env-precedence measurement, pre/post state, rollback receipts, the aborted deploy and what it cost |
| `JC-03-session-paths.txt` | every session-mint path enumerated and measured; the path deliberately not taken |
| `JC-04-grant-state.txt` | 29 grants, `GRANT-0019` revoked, and the three reasons no grant was minted |
| `JC-measure-env.mjs` | reports a `DATABASE_URL`'s shape without emitting the credential |
| `JC-probe-authority.mjs` | the two-attempt connection probe, redacted through the canonical `redactUrl` |
| `JC-precedence-live.ps1`, `JC-precedence-listener.mjs` | the socket-level `process.env` vs `.env.local` measurement |
| `JC-session-and-grants.mjs` | read-only session and authority counts; selects no token column |
