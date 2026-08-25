# Gate 2 — bounded search record for the first governed action

**Status:** COMPLETE. Outcome **(b)**: no existing canonical action qualifies.
**Consequence:** a **charter amendment under explicit recorded authority** is required before the
first governed mutation is built. This record does not grant it, assume it, or default to it.

Controlling requirement: `williamos-experience-v2-implementation-charter.md:273-274`, quoted in full
because truncating it is how this went wrong three times:

> The first implementation journey needs only **one** safe governed mutation. **Choose the safest
> existing canonical action** that proves the architecture. Do not invent an unsafe action to satisfy
> the demo.

Binding packet: issue **#995**. Binding owner direction: `2026-08-24 — GATE 2 FIRST-ACTION SEARCH
RECORD`. Typed continuation resolved by this document: `CONT-EXPV2-FIRST-ACTION`
(`williamos-experience-v2-phase0-collision-map.md` §9), previously `OPEN` /
`CANONICAL_ACTION_SEARCH_NOT_PERFORMED`.

This requirement has been got wrong **four consecutive times**, each by a different mechanism
(map §5.6, §15 row 54). The fifth available mechanism is *running a search whose criteria are set so
tightly that outcome (b) is guaranteed before the first file is opened* — reaching revision 3's
overturned answer through a rigged search rather than through a misreading. §2 exists to stop that,
and §6 is the deliberate attempt to defeat this record's own conclusion.

---

## 1. Method and base

| Fact | Value |
| --- | --- |
| Base SHA | `053a33bd` (`main`, equal to `origin/main` at measurement) |
| Measured | 2026-08-24, by the Gate 2 builder lane |
| Denominators | **re-measured on this SHA**, not inherited from #995 |
| Reproducibility | every count below is a command over the tree at `053a33bd` |

Re-measurement was not ceremony. It moved **four** of the six denominators #995 states, and one of
those moves added a candidate the packet had never considered (§6). A lane that had inherited the
counts would have searched a smaller space and still called it a search.

---

## 2. The interpretive boundary this record had to draw

This is stated first, before any evidence, because it decides the outcome — and a boundary that
decides an outcome must be visible enough to attack.

#995 lists **eleven** qualifying criteria and then says, of `lib/resource/mutation.ts`:

> That file is the **model**, and criteria 2, 7, 8, 9 and 10 are what Gate 2 must add on top of it.

So the packet says in one place that eleven criteria qualify a candidate, and in another that five of
them are Gate 2's own work. Read the first way, **nothing on `main` can ever qualify** — criterion 2
requires a `SystemObject` subject, and the projection that mints `SystemObject`s landed one commit
before this gate (§4.7). Outcome (b) would then be true by construction, decided by the packet's
sentence order rather than by the repository.

That is not a search. So this record splits the eleven:

| Class | Criteria | Test applied |
| --- | --- | --- |
| **Intrinsic** — properties of what the action *is*. Cannot be added without building a different action. | 1 mutation · 3 selected, not fleet-wide · 4 chosen from a fixed catalogue by name · 5 target derived from the record · 6 unsafe input refused, nothing deletes · 11 safest — reversible, small | The candidate must **already** satisfy these. |
| **Additive** — the governance envelope Gate 2 wraps around a chosen action. | 2 `SystemObject` subject · 7 dialect-aware brokered execution · 8 session-user scoping · 9 durable evidence · 10 verified post-state | A candidate is **not** disqualified for lacking these. Gate 2 supplies them. |

The additive class is exactly the list #995 hands Gate 2, and criteria 9 and 10 are literally the
prerequisites `CONT-EXPV2-AUDIT-FAIL-LOUD` and the post-state rule this gate resolves for *every*
action. Disqualifying a candidate for failing a defect this gate is chartered to fix would be
circular.

**The outcome is the same under both readings.** Under the strict reading nothing qualifies
trivially. Under the charitable reading above — the one this record actually applies, and the one
that gives existing actions their best case — nothing qualifies either, and §5 and §6 show why with
named evidence. Where a candidate fails, this record states **which class** the failing criterion
belongs to, so a reviewer can re-run the judgement under either reading.

---

## 3. Denominators, re-measured — and where #995 was wrong

| Surface | #995 states | Measured at `053a33bd` | Delta |
| --- | --- | --- | --- |
| HTTP routes | 47 files, 30 mutating | **47** files, **31** export a mutating verb, **30** mutating *handlers* | reconciled — see below |
| **Server actions** | **not named** | **26** files containing `"use server"` | **omitted surface** |
| Fixed action/operation catalogues | 6 exported consts | **41** exported const catalogues repo-wide, of which **9** are executable action/operation vocabularies | **undercount of 3** |
| Brokered action vocabulary | 4 action names | **5** action names | **omission of 1** |
| control-center catalogue | 92 commands | **92** commands (54 `writes`, 2 `safe: False`) | confirmed |
| Fabric / lab operations | directories named, no count | **84** files `scripts/execution-fabric/` + **26** `scripts/lab-control/` + **2** `scripts/fabric/` = **112** | quantified, and one directory added — see below |
| **`SystemObject` consumers** | not stated | **1** — its own test | decisive; see §4.7 |

### 3.1 Routes: 47 / 31 / 30 reconciled

47 `app/api/**/route.ts` files. 31 export at least one of `POST`/`PATCH`/`PUT`/`DELETE`. The 31st is
`app/api/local/runtime/status/route.ts:40-43`, which exports all four bound to a local
`methodNotAllowed` helper returning HTTP 405 with `Allow: GET`. It is an explicit *refusal* of
mutation, not a mutating handler. #995's 30 is correct on the "mutating method" reading; both numbers
are recorded so the next lane does not rediscover the gap and assume one of us miscounted.

The same file's `ACTION_QUERY_PARAMS` (`lib/local-runtime-status.ts:157`) — `action`, `target`,
`command`, `refresh`, `start`, `stop`, `restart` — reads like an action catalogue and is the
opposite: a denylist that rejects the request (`:158-162`). Examined and excluded, recorded so the
exclusion is not silent.

### 3.2 Server actions: a mutating surface the packet's denominators omitted

26 files carry `"use server"`. On a Next.js application these are a first-class mutation surface,
equal in reach to a route handler, and #995's denominator table does not mention them. Accounted for
in §4.2.

### 3.3 Catalogues: 6 named, 9 exist

41 exported `SCREAMING_CASE` const catalogues across `lib/`, `scripts/` and `app/`. Nine are
*executable action/operation vocabularies*; the other 32 enumerate statuses, scopes, types, lanes,
authority levels and event names, and execute nothing.

| # | Catalogue | Named by #995 |
| --- | --- | --- |
| 1 | `MUTATING_OPERATIONS` (`lib/resource/mutation.ts:21`) | yes |
| 2 | `PROBE_KINDS` (`lib/resource/probe.ts:23`) | yes |
| 3 | `READ_ONLY_OPERATIONS` (`lib/resource/completion.ts:23`) | yes |
| 4 | `REPRODUCING_OPERATIONS` (`lib/resource/completion.ts:26`) | yes |
| 5 | `LOCK_KINDS` (`lib/governance/locks.ts:7`) | yes |
| 6 | `CONSEQUENTIAL_COMMANDS` (`scripts/governance/work-context-hook.mjs:47`) | yes |
| 7 | **`LOOM_OPERATIONS`** (`lib/loom/operations.ts:41`) | **no** |
| 8 | **`BASELINE_STEPS`** (`lib/fabric/baseline.ts:28`) | **no** |
| 9 | **`BASELINE_STEP_IDS`** (`lib/fabric/run-baseline.mjs:209`) | **no** |

Catalogue 7 is the consequential omission and is the subject of §6.

Two borderline members were examined rather than dropped: `MUTATION_GATES`
(`lib/governance/truth.ts:32`) names the gates that force a volatile-truth recheck and executes
nothing; `V1_2_ACCEPTANCE_BLOCKED_ACTIONS` / `V1_2_CAMPAIGN_BLOCKED_ACTIONS`
(`lib/outcome-queue/v1-2-acceptance-authority.ts:8`, `…campaign-authority.ts:8`) are denylist
phrases, not invokable actions.

### 3.4 A directory this record's first version did not name

`scripts/fabric/` (2 files at `053a33bd`) was absent from the boundary above. It was surfaced by this
gate's own adversarial review lane, sweeping for `Restart-Service`, and it is recorded here as a
defect in this record rather than quietly folded in: "every negative claim states its search
boundary" is the rule this document binds itself to, and a directory that is never named has not been
searched, whatever it happens to contain.

It contains no qualifying candidate, and both files are disposed of in §4.6. Stating the fix does not
retire the finding — the boundary was incomplete when the outcome was first written, and a reader
checking this record has to be able to see that.

### 3.5 Brokered vocabulary: 5 action names, not 4

Every `action:` string reaching `brokeredExec`, measured across the tree:

| Action | Call site | Kind |
| --- | --- | --- |
| `probe` | `app/api/fabric/nodes/route.ts:97` | read |
| `resource-verify` | `app/api/resource/verify/route.ts:83` | read |
| `resource-relocate` | `app/api/resource/relocate/route.ts:109` | mutation |
| `resource-restore` | `app/api/resource/restore/route.ts:100` | mutation |
| **`resident-gh`** | `scripts/runtime-operator/williamos-adapters.mjs:36` and `:45` | **mutation** |

`resident-gh` is a fifth brokered *mutating* action that #995's denominator does not list. It is
examined in §4.5. This is the clearest single justification for the re-measurement rule: a lane that
inherited "four" would have examined four.

---

## 4. The search, surface by surface

### 4.1 The 30 mutating route handlers

Classified by whether the handler can reach a node at all:

| Class | Count | Routes | Disposition |
| --- | --- | --- | --- |
| Reaches a node through `brokeredExec` | 3 | `resource/relocate`, `resource/restore`, `resource/verify` | examined individually — §4.3, §4.4 |
| Reaches a node through **raw** transport | 1 | `fabric/baseline` | §4.4 |
| Executes on the **local host** only | 4 | `loom/run`, `loom/agent`, `loom/edit`, `environment/line` | §6 (`loom/run` is the live candidate) |
| Mutates database records only — no node dimension | 22 | access-grants ×2, auth, chat, device-link ×2, device ×5, env/line, governance ×2, intent, loom/files, objective, resource/operation, resource/reconcile, setup ×2, thread-chat | **out of object class** — below |

**The out-of-object-class ruling, stated rather than assumed.** The Gate 1a graph is
`export type SystemObject = NodeObject | AcceleratorObject` (`lib/system/system-object.ts:147`), with
`SystemObjectKind = "NODE" | "ACCELERATOR"` (`:32`). An action whose subject is a device credential,
an access grant, a chat thread or an objective row has no node or accelerator it could be resolved
*from*. This is not criterion 2 in disguise: criterion 2 asks whether the action's existing subject is
a `SystemObject`, and Gate 2 may supply that. This asks whether a `SystemObject` subject is
*conceivable* for the action, and for these 22 it is not. Revoking a device credential does not become
an action on HERMES because HERMES is where the row is stored.

### 4.2 The 26 server actions

Zero reach a node. Measured directly: no file containing `"use server"` references `brokeredExec`,
`lib/fabric`, `node:child_process`, `spawn(` or `ssh`. Every one mutates database records through
Drizzle. Same out-of-object-class ruling as the 22 routes above, on the same stated basis.

### 4.3 `relocate-source` and `restore-database` — `MUTATING_OPERATIONS`

The **model** #995 holds up, and correctly shaped: chosen by name and never from caller text, source
and destination from the resource record, unsafe paths refused rather than escaped, nothing deletes
(`lib/resource/mutation.ts:21`, `:26-29`).

| Criterion | Class | Verdict |
| --- | --- | --- |
| 1 mutation | intrinsic | PASS |
| 3 selected | intrinsic | PASS — one resource |
| 4 fixed catalogue by name | intrinsic | PASS — `MUTATING_OPERATIONS[number]` |
| 5 target from record | intrinsic | PASS |
| 6 unsafe refused, nothing deletes | intrinsic | PASS |
| **11 safest — reversible, small** | **intrinsic** | **FAIL** |

`relocate-source` moves a multi-hundred-gigabyte PACS source between nodes; `restore-database`
restores a database. The charter's word is *safest*, and it is the operative word in the sentence
this gate is executing. This is the map's round-2 ruling (§5.6), reaffirmed at rounds 3 and 4 and
never overturned. **Failure is on an intrinsic criterion**: making them small and reversible means
they are no longer these operations.

### 4.4 `POST /api/fabric/baseline`

| Criterion | Class | Verdict |
| --- | --- | --- |
| 1 mutation | intrinsic | PASS — starts a process/container, writes and hashes a file, force-stops and deletes |
| **3 selected** | **intrinsic** | **FAIL** — the route takes no body and calls `runAllBaselines` (`app/api/fabric/baseline/route.ts:23`), which loops every node in the registry (`lib/fabric/run-baseline.mjs:382`) |
| 5 target from record | intrinsic | n/a — there is no per-call target to derive |
| **11 safest** | **intrinsic** | **FAIL** — a fleet-wide start / transfer / force-stop / delete cycle |
| 7 brokered | additive | fails, but Gate 2 fixes this for everything — `sh()` calls `exec("powershell", …)` at `run-baseline.mjs:311` and `exec("ssh", …)` at `:317`, never `brokeredExec` |
| 9 durable evidence | additive | fails — audit swallowed on the **success** path (`:298`) and the failure path (`:304`) |

Fails **two intrinsic criteria**. Its additive failures are the prerequisites this gate resolves and
are not the reason it is disqualified. Its six steps (`BASELINE_STEPS`, `lib/fabric/baseline.ts:28`)
are internal to the fleet-wide gate and not independently invokable, so catalogues 8 and 9 add no
separable candidate.

### 4.5 `resident-gh` — the fifth brokered action

```
williamos-adapters.mjs:36   brokeredExec("aegis", ["gh", ...args.map(shellQuote)].join(" "), { action: "resident-gh", timeout })
williamos-adapters.mjs:45   brokeredExec("aegis", "echo " + encoded + " | base64 -d > " + shellQuote(remotePath), { action: "resident-gh" })
```

| Criterion | Class | Verdict |
| --- | --- | --- |
| 1 mutation | intrinsic | PASS — `:45` writes an arbitrary file on AEGIS; `:36` can create pull requests and comments |
| **3 selected** | **intrinsic** | **FAIL** — the node is the string literal `"aegis"`, hardcoded at both sites |
| **4 fixed catalogue by name** | **intrinsic** | **FAIL** — the command is assembled by string concatenation from caller-supplied `args` and `remotePath`. There is no catalogue; `resident-gh` is an audit *label* on an open-ended command, not an action name |
| **5 target from record** | **intrinsic** | **FAIL** — `remotePath` comes from the caller |
| **6 unsafe input refused** | **intrinsic** | **FAIL** — `shellQuote` (`:30-32`) **escapes** rather than refuses. `mutation.ts` is held up as the model precisely because it refuses; this is the inverse |

Fails **four intrinsic criteria**, three of them the exact properties that make `mutation.ts` the
model. It is brokered and audited, which is why the vocabulary sweep surfaced it, and being brokered
is not the same as being governed.

### 4.6 The three non-candidate surfaces, with their boundaries stated

**`POST /api/resource/verify`** — fails criterion **1** (intrinsic): it is a read.
`PROBE_KINDS = ["exists-size"]` with the comment "adding one that writes would defeat the point of
the seam" (`lib/resource/probe.ts:22-24`). Not remediable — a writing probe is a different seam. Its
POSIX-only command (`probe.ts:149`) and identity-only scoping (`verify/route.ts:34`) are additive
failures and are *not* the reason. Its good properties survive as a read-only predecessor and Gate 2
keeps them.

**The 92 control-center commands.** Measured: 92 registered, 54 with `writes: True`, 2 with
`safe: False` (`semantic-clear`, `accept-draft`). Their subject is an **Obsidian vault** —
`VAULT = Path(os.environ.get("WILLIAMOS_VAULT", "WilliamOS"))`
(`scripts/williamos_commands.py:14`), thirteen groups spanning note creation, promotion, synthesis,
backup, release and workspace hygiene (`:21`). Exactly one names a restart —
`control-center-restart` (`:173`), which restarts the Control Center on the local host. **Not one of
the 92 takes a node or accelerator as its subject.** The whole catalogue is out of object class, on
the same stated basis as §4.1 — which is a structural ruling over all 92, not a sample. That this
catalogue nonetheless gates execution (`allowed`, `runnable`, `confirmation_required`, `safety_tier`,
`execution_path: "safety.py -> command_runner.py"` at
`control-center/backend/command_center.py:136`) is why its disposition is a Gate 2 decision — but it
supplies no candidate.

**`scripts/lab-control/` — 26 files.** All six exported entry points
(`LabControl.psm1:714`) are **read-only probes**: `Invoke-LabContainers` runs `docker ps` on hermes
and atlas (`:659-680`); `Invoke-LabBackups` runs `find` over backup directories on atlas
(`:682-712`); the rest render snapshots. Fails criterion **1** across the entire surface.

**`scripts/fabric/` — 2 files.** `run-baseline.mjs` is a headless CLI wrapper that imports and calls
the baseline gate already examined as candidate 6 (`scripts/fabric/run-baseline.mjs:16`); it is a
second entry point, not a second action. `enroll-omen.ps1` is a one-time enrolment applied **on OMEN
by OMEN's own agent** (`:1-20`); its `Restart-Service sshd -Force` (`:47`) fails criteria **3** and
**5** — the machine is not selected, it is the one running the script, and no record supplies the
target — and it is not reachable from `app/` or `lib/` (measured: no import, no path reference).

**`scripts/execution-fabric/` — 84 files.** 29 mutate a remote node through raw `ssh`/`scp`/
`systemctl`-class calls. All fail criteria **3** and **5** (intrinsic): the node and the target come
from argv. Independently, the surface is unreachable from the application — measured directly,
**nothing under `app/` or `lib/` imports or invokes any file** in `scripts/execution-fabric/` or
`scripts/lab-control/`; the only references are prose comments and one config path
(`lib/system/node-identity-contract.ts:7-17`, `lib/system/system-object.ts:16`).

### 4.7 The charter's own named actions do not exist

`charter:264-266` names the actions a real object should expose: *inspect, benchmark, reserve,
release, drain, evict inactive model, restart service, open terminal, view evidence, view topology*.
Swept across `app/` and `lib/` for each verb as an exported symbol or an action string:

| Verb | Hits | What they are |
| --- | --- | --- |
| `drain`, `evict`, `benchmark`, `unload` | **0** | absent |
| `reserve` | 1 | `dependencyClosure` over reserved **paths** (`lib/governance/receipt-anchor.ts:25`) — unrelated |
| `restart` | 1 | the query-param **denylist** at `lib/local-runtime-status.ts:157` |
| `inspect` | 13 | device-link inspection, the workbench **inspector panel**, the `inspect` goal *mode*, and `READ_ONLY_OPERATIONS` — no node action |

No Ollama or model-residency mutation surface exists at all.

**And the decisive structural fact.** `projectSystemObjects` (`lib/system/system-object.ts:378`) has
exactly **one** consumer on `main`: `tests/system-object-projection.test.ts`. Zero production
consumers. Gate 1a merged one commit before this gate (`8452b780`), so no action on `main` has ever
seen a `SystemObject`. Under the strict reading this alone settles the search; under this record's
charitable reading it settles nothing on its own, which is why §4.1–§4.6 and §6 do the work.

---

## 5. Complete candidate ledger

Every action on `main` whose subject **can** be a `NODE` or `ACCELERATOR` — the full candidate set,
not a sample:

| # | Candidate | Mutation? | Fails intrinsic criteria | Remediable by Gate 2? |
| --- | --- | --- | --- | --- |
| 1 | `probe` (`fabric/nodes`) | no | 1 | no — a writing probe is a different action |
| 2 | `resource-verify` | no | 1 | no — same |
| 3 | `resource-relocate` | yes | **11** | no — smallness is not addable |
| 4 | `resource-restore` | yes | **11** | no — same |
| 5 | `resident-gh` | yes | **3, 4, 5, 6** | no — it has no catalogue to be chosen from |
| 6 | `fabric/baseline` (+ its 6 steps) | yes | **3, 11** | no — selection means rewriting the gate |
| 7 | `service.restart` (`LOOM_OPERATIONS`) | yes | **3, 5** | see §6 |
| 8 | `lab-control` ×6 | no | 1 | no |
| 9 | `execution-fabric` ×29 | yes | **3, 5** | no — and not application-reachable |

Nothing in the ledger passes the intrinsic set.

---

## 6. The strongest candidate — the one #995 never considered

Recorded at length because it is the only candidate that could have changed the outcome, and because
a search record whose new finding conveniently confirms the packet's expectation deserves suspicion.

`LOOM_OPERATIONS` (`lib/loom/operations.ts:41`) is catalogue 7 from §3.3 — absent from #995's
denominator and from all four previous rounds' three-candidate list. It contains eight operations, of
which exactly one is `mutating: true`:

```
lib/loom/operations.ts:123   id: "service.restart"
                             intent: "Stop and restart the app and HTTPS listener.
                                      Sessions survive; in-flight requests do not."
                             command: "powershell", args: [ …fixed argv… ], mutating: true
```

**Why it is a serious candidate.** `charter:264-266` names *restart service* as an example canonical
action. It is chosen from a fixed catalogue by id (`findLoomOperation`, `:138`); mutating operations
additionally require explicit confirmation, enforced server-side rather than in the UI so it "cannot
be skipped by calling the endpoint directly" (`resolveLoomOperation`, `:157-162`); the argv is a
constant with `shell: false`, so there is no interpolation point to escape from
(`app/api/loom/run/route.ts:54-59`); mutating operations pass a work-context gate (`:48-51`); and it
is reversible and small. On criteria **1, 4, 6 and 11** it is the best candidate in the repository —
better than `relocate`/`restore`, which fail 11.

**Why it nonetheless fails.**

| Criterion | Class | Verdict |
| --- | --- | --- |
| **3 selected — one object, not fleet-wide** | **intrinsic** | **FAIL.** Nothing is selected. The request body is `{ operation, confirmed }` and nothing else (`run/route.ts:32`). The operation always executes on the machine serving the request, via `spawn` from `node:child_process` (`:1`, `:54`). Its subject is not "a node" — it is "this process's host", which is a different thing that happens to be a node. |
| **5 target derived from the record** | **intrinsic** | **FAIL.** There is no record. The target is `process.cwd()` and two scheduled-task names embedded in the argv string (`operations.ts:126-131`). |
| 7 dialect-aware brokered execution | additive | fails — hardcoded `powershell` argv, so it is Windows-only in the same structural way `resource/verify` is POSIX-only. Gate 2 could supply this. |
| 9 durable evidence | additive | fails — `recordLoomStart`/`recordLoomEnd` (`lib/loom/receipts.ts:26,39`) call `appendGovernanceEvent`, which swallows write failures by explicit design (`lib/governance/events.ts:69`), and both call sites are `void`ed (`run/route.ts:81,92`) so even a rejection is unobserved. Gate 2 fixes this. |
| **10 verified post-state** | **intrinsic here** | **FAIL, and not remediable.** The command's final statement emits the literal string `'restart requested'` (`operations.ts:130`); the route reports the child's exit code. Nothing observes whether the tasks came back. Post-state verification is normally additive — but this action restarts **the process that would do the observing**. An action cannot witness its own termination. |

**The move this record refuses to make.** One could "adopt" `service.restart` by giving it a node
parameter, a dialect strategy and a record-derived target. That is not adopting an existing action —
it is writing a new command, a new target derivation and a new transport while keeping an old id.
`service.restart` has no node dimension to generalize: its argv is a fixed string naming two local
scheduled tasks. Calling that adoption would be the fifth failure of this requirement, by a fresh
mechanism — **adopt in name, build in fact** — and it would be harder to see than the previous four,
because every word of the claim "we chose an existing catalogued action" would be true.

---

## 7. Outcome

**(b) — nothing qualifies.** The search space was enumerated with stated denominators; every surface
was accounted for; every candidate whose subject can be a `NODE` or `ACCELERATOR` was examined
individually with exact disqualifying evidence; and each failure is on an **intrinsic** criterion
that Gate 2 cannot supply without building a different action.

Per `charter:273-274`, owner direction of 2026-08-24, and #995: **this is a charter amendment, not a
Gate 2 finding.** This record does not make it, does not assume it, and does not treat "nothing
qualified" as permission to build.

### What is therefore NOT built by this gate

- the first governed mutation;
- #995 acceptance invariant **9** (the chosen action satisfying all eleven criteria, each with a
  test) — there is no chosen action to test;
- #995 acceptance invariant **13** (the first bounded journey end to end through governed execution)
  — its `governed execution` leg has no action, and its terminal leg additionally waits on Gate 1b.

Everything else in #995 is buildable without a chosen action and is delivered: the registry
convergence, the ambiguity-refusal invariant under generalization, context-ranks-never-retargets, the
no-authority guarantee, the `control-center` disposition, and both mutating-path prerequisites
(`CONT-EXPV2-AUDIT-FAIL-LOUD`, `CONT-EXPV2-BASELINE-RAW-TRANSPORT`). A single blocked item must not
park the rest — that is the queue-blocking bug class already fixed.

### The typed continuation this record leaves

```
CONT-EXPV2-FIRST-ACTION
  type:                   BLOCKED_AUTHORITY
  reason:                 CHARTER_AMENDMENT_REQUIRED
  previous:               BLOCKED_DEPENDENCY / CANONICAL_ACTION_SEARCH_NOT_PERFORMED  (RESOLVED)
  search:                 PERFORMED. This document. Denominators re-measured at 053a33bd; four of
                          six moved; complete candidate ledger in S5; strongest candidate in S6.
  finding:                no existing canonical action satisfies the intrinsic criteria. Each
                          failure is named, evidenced by file and line, and classified intrinsic
                          vs additive so the judgement can be re-run.
  requires:               an explicit charter amendment, under recorded authority, permitting the
                          first journey's safe governed mutation to be BUILT rather than chosen --
                          shaped on lib/resource/mutation.ts, with the five additive criteria
                          (SystemObject subject, dialect-aware brokered execution, session-user
                          scoping, durable evidence, verified post-state) supplied by Gate 2.
  ownerDecisionRequired:  true -- and ONLY for the amendment itself.
  routing:                the canonical channel. Recorded on #995 and surfaced to the coordinator
                          lane that owns charter amendments. NOT an owner courier task: no owner is
                          asked to run a command, relay output, or operate a tool.
  continuation:           on amendment, Gate 2 re-enters at the action half alone. The registry,
                          both prerequisites and the control-center disposition do not re-open.
  blocks:                 #995 acceptance invariants 9 and 13 only.
  does NOT block:         #995 acceptance invariants 1-8 and 10-12, all delivered by this gate.
```

---

## 8. What this record does not claim

- It does not claim the repository is incapable of a safe governed mutation. It claims no **existing
  catalogued action** is one, on the stated criteria, at `053a33bd`.
- Its own boundary was incomplete when first written: `scripts/fabric/` was unnamed until the review
  lane found it (§3.4). The outcome did not move, and that is a fact about those two files rather
  than a reason the omission was harmless.
- It does not claim #995's denominators were carelessly derived. Four moved because the tree is
  measured differently by different queries; the packet's own rule is that a lane re-measures, and
  this is what that rule is for.
- It does not claim `control-center`'s 92 commands are unsafe or unwanted. It claims none takes a
  node or accelerator as its subject, which is a statement about object class and nothing else.
- It does not settle the `control-center` disposition. That is recorded separately, as #995 requires.
- Its negatives state their boundary. Where this record says "none", the surface, the query and the
  denominator that produced the "none" are given, and every count is reproducible at `053a33bd`.
