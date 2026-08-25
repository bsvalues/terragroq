# First governed action — FRESH bounded search at the pickup base

**Status:** COMPLETE. Outcome **(b)**: no existing canonical action qualifies at `2d72d3c4`.
**Consequence:** charter `AMENDMENT-001` authorizes building the smallest new canonical action. This
record is the predecessor that authorization is conditioned on; it is not the authorization.

This is the **second** bounded search for this subject, not a restatement of the first. The first ran
at `053a33bd` and is recorded in
[`williamos-experience-v2-gate2-first-action-search-record.md`](williamos-experience-v2-gate2-first-action-search-record.md).
Both remain true of their own base. Neither supersedes the other.

Controlling requirement, quoted in full because truncating it is how this went wrong four times —
`williamos-experience-v2-implementation-charter.md:273-278`, as amended:

> The first implementation journey needs only **one** safe governed mutation. Choose the safest
> existing canonical action that satisfies the acceptance contract. If a bounded, recorded search
> proves none qualifies, implement the smallest new canonical action by extending the existing
> Object+Action Registry and routing it through the existing authority, execution/fencing, evidence,
> and verified post-state paths. Do not generalize an unsuitable legacy action merely to preserve its
> ID, and do not create a parallel action, authority, or execution mechanism. Do not invent an unsafe
> action to satisfy the demo.

Binding packet: issue **#995** §criteria. Binding authority: charter `AMENDMENT-001` and the
owner-stated semantics recorded beside it — **reuse remains mandatory-first**. Typed continuation
this document discharges the predecessor of: `CONT-EXPV2-FIRST-ACTION-IMPLEMENTATION`
(`williamos-experience-v2-phase0-collision-map.md` §9, the controlling copy).

---

## 1. Why a second search was required, and what it was required to look for

The map's §9 packet states the predecessor exactly, and it names its own reasoning:

> a FRESH bounded canonical-action search against the ACTUAL pickup base, recorded, before BUILD may
> be selected. #996's search establishes that the branch was legitimately open at `053a33bd`; it does
> NOT pre-authorize BUILD at any later base. **The pickup base is expected to contain #996's own
> Object+Action Registry work, which is precisely the seam most likely to introduce a newly
> qualifying canonical action.**

So the first question this search had to answer is not "did anything change" but "did the registry
convergence itself put a qualifying action on `main`". §5.1 answers it directly, and the answer is a
finding rather than a formality: the merged registry contains a **typed refusal** where a mutation
would be, and it says why in code.

| Fact | Value |
| --- | --- |
| Pickup base | `2d72d3c4` (`main`, equal to `origin/main` at measurement) |
| Predecessor base | `053a33bd` — the first search's base |
| Measured | 2026-08-24, by the first-action builder lane |
| Denominators | **re-measured on the pickup base**, not inherited from #995 or from #996's record |
| Reproducibility | every count is a command over the tree at `2d72d3c4`, given in §3 |

---

## 2. The interpretive boundary, restated because it still decides the outcome

#996's record split #995's eleven criteria into **intrinsic** (properties of what the action *is*;
cannot be supplied without building a different action) and **additive** (the governance envelope
Gate 2 wraps around a chosen action). It did so because reading all eleven as qualifying criteria
makes outcome (b) true by construction, which is not a search.

**This record applies the same split, and it now matters more, not less.** Four of the five additive
criteria have since been *delivered on `main`* by #996: brokered dialect-aware execution reaches
every node command (7), durable evidence is enforced by preflight rather than best-effort (9), and
the registry that would carry a `SystemObject` subject exists (2). A candidate can therefore no
longer fail on those grounds even accidentally. What remains is exactly the intrinsic set:

| Class | Criteria |
| --- | --- |
| **Intrinsic** | 1 mutation · 3 selected, not fleet-wide · 4 chosen from a fixed catalogue by name · 5 target derived from the record · 6 unsafe input refused, nothing deletes · 11 safest — reversible, small |
| **Additive** | 2 `SystemObject` subject · 7 dialect-aware brokered execution · 8 session-user scoping · 9 durable evidence · 10 verified post-state |

Where a candidate fails below, the class of the failing criterion is named, so the judgement can be
re-run under either reading.

---

## 3. Denominators, re-measured at `2d72d3c4`

Every command was run against the tracked tree (`git ls-files` / `git grep`), which is why the counts
below do not move when a sibling worktree is present under `.claude/worktrees/`. A `find`-based sweep
of the same directories reports 52 `"use server"` files rather than 26 for exactly that reason; the
tracked count is the real one and the discrepancy is recorded so the next lane does not "correct" it.

| Surface | #996 measured at `053a33bd` | Measured at `2d72d3c4` | Delta |
| --- | --- | --- | --- |
| HTTP route files | 47 | **47** | none |
| …exporting a mutating verb | 31 (30 mutating *handlers*) | **31** | none |
| Server actions (`"use server"`) | 26 | **26** | none |
| Executable action/operation vocabularies | 9 | **10** | **+1 — `MUTATING_BASELINE_STEPS`** |
| Brokered action vocabulary | 5 action names | **5 names + 6 `baseline.<step>` labels** | **+6 labels, 0 new actions** |
| control-center catalogue | 92 commands | **92** | none |
| `scripts/execution-fabric/` | 84 files | **84** | none |
| `scripts/lab-control/` | 26 files | **26** | none |
| `scripts/fabric/` | 2 files | **2** | none |
| **Exported mutating functions under `lib/` whose subject can be a node** | **not stated** | **1 — `updateNodeFields`** | **surface class the first search's boundary did not name** |
| `projectSystemObjects` production consumers | 1 (its own test) | **0 production, 2 tests** | still decisive; see §5.2 |

Reproduction:

```
git rev-parse HEAD
git ls-files 'app/api/**/route.ts' | wc -l
git grep -lE "export (async )?(function|const) (POST|PATCH|PUT|DELETE)" -- 'app/api/**/route.ts' | wc -l
git grep -l '"use server"' -- '*.ts' '*.tsx' | wc -l
git grep -nE "^export const [A-Z][A-Z0-9]*(_[A-Z0-9]+)+[^=]*= *(\[|\{|new Set|new Map|Object\.freeze)" -- 'lib/**' 'app/**'
git grep -nE "^export (async )?function [a-zA-Z]" -- 'lib/fabric/**' 'lib/system/**' 'lib/resource/**' 'lib/loom/**'
git ls-files 'scripts/execution-fabric/**' 'scripts/lab-control/**' 'scripts/fabric/**' | wc -l
git grep -ln "projectSystemObjects"
```

### 3.1 A defect in this record's own denominator method, found by its own adversarial review

The catalogue query above matches `SCREAMING_CASE` exports, because that is the convention every
catalogue named by #995 and by #996's record happens to use. **It cannot see a camelCase catalogue**,
and the registry this gate just merged is one. A denominator that silently excludes the seam the
predecessor told this search to examine first would be a boundary defect of exactly the kind §5.5
catches in the previous record, so it is recorded here rather than repaired quietly.

Re-measured with a query that does see them:

```
git grep -nE "^export const [a-z][A-Za-z0-9]*(Registry|Catalogue|Catalog|Actions|Operations|Commands|Descriptors|Kinds|Steps)\b" -- 'lib/**' 'app/**'
```

| Catalogue | At `2d72d3c4` | Examined |
| --- | --- | --- |
| `objectActionRegistry` | `lib/intent/object-action-registry.ts:289` | §5.1 — every descriptor, individually |
| `navigationDescriptors` | `lib/intent/object-action-registry.ts:297` | §5.1 — a subset of the above, navigation only |
| `workbenchActionRegistry` | `lib/intent/workbench-action-registry.ts:48` | §5.1 — a facade over the registry since #996, not a fourth catalogue |

Three, all in `lib/intent/`, all already the subject of §5.1. **The outcome does not move**, and that
is a fact about what those three contain rather than a reason the query's blind spot was harmless.

### 3.2 The one fact that shortens this search honestly, stated as evidence rather than as a shortcut

```
git diff --name-only 053a33bd..HEAD | grep -vE "^(docs/|tests/|\.phase0|lib/fabric/|lib/intent/)"
   -> (empty)
```

**Every candidate surface the first search examined is byte-identical at the pickup base**, with the
single exception of `lib/fabric/`. `app/api/`, `scripts/`, `control-center/`, `lib/resource/`,
`lib/loom/`, `lib/governance/` and `lib/system/` did not change. So the per-candidate disqualifying
evidence recorded at `053a33bd` — file and line — still resolves to the same bytes, and this search
does not re-derive it by retyping it. What it does re-derive from scratch is:

1. everything in `lib/fabric/` (changed: `audit.mjs`, `broker.mjs`, `run-baseline.mjs`, new
   `transport.mjs`) — §5.3, §5.4;
2. everything in `lib/intent/` (the new registry) — §5.1;
3. the surface class the first search's boundary never named — §5.5.

A shortened search is only legitimate if it says which part was shortened and on what evidence. That
is what §3.2 is.

---

## 4. Complete candidate ledger at `2d72d3c4`

Every action on `main` whose subject **can** be a `NODE` or `ACCELERATOR`. Rows 1–9 are the first
search's ledger, re-confirmed against unchanged bytes except where marked; rows 10–12 are this
search's own.

| # | Candidate | Mutation? | Fails intrinsic | Changed since `053a33bd`? |
| --- | --- | --- | --- | --- |
| 1 | `probe` (`fabric/nodes`) | no | **1** | no |
| 2 | `resource-verify` | no | **1** | no |
| 3 | `resource-relocate` | yes | **11** | no |
| 4 | `resource-restore` | yes | **11** | no |
| 5 | `resident-gh` | yes | **3, 4, 5, 6** | no |
| 6 | `fabric/baseline` (+ its steps) | yes | **3, 11** | **YES — re-examined in full, §5.3** |
| 7 | `service.restart` (`LOOM_OPERATIONS`) | yes | **3, 5, 10** | no |
| 8 | `lab-control` ×6 | no | **1** | no |
| 9 | `execution-fabric` ×29 | yes | **3, 5** | no |
| 10 | **`system.node.inspect` / `system.accelerator.inspect`** (the merged registry) | no | **1** | new at this base — §5.1 |
| 11 | **`updateNodeFields`** (`lib/fabric/registry.mjs:62`) | yes | **4, 5** | new to the boundary — §5.5 |
| 12 | **`runNodeBaseline`** as a directly-called per-node entry point | yes | **11** | re-examined — §5.4 |

Nothing in the ledger passes the intrinsic set.

---

## 5. The five things this search had to establish for itself

### 5.1 The merged Object+Action Registry — the seam the predecessor named

`lib/intent/object-action-registry.ts` (650 lines, merged in #996 at `2630ee5a`) is the one place a
newly qualifying action would most plausibly have appeared. It did not, and the absence is
deliberate and typed rather than accidental:

- `systemObjectActions` (`:150-186`) holds exactly **two** descriptors, `system.node.inspect` and
  `system.accelerator.inspect`. Both carry `mutating: false`. They fail criterion **1** (intrinsic),
  and a read cannot be made a mutation without becoming a different action.
- `resourceActions` (`:200-224`) catalogues `resource.relocate-source` and
  `resource.restore-database` with `subject: "project_resource"`. Catalogued is not adopted: the
  registry's own comment records that they are listed so the catalogue is not silently incomplete,
  and that their subject is a resource record while the node in a relocation is a destination field.
  Unchanged intrinsic failure on **11**.
- `MUTATION_UNAVAILABLE` (`:342-350`) is a typed refusal carrying
  `reason: "CHARTER_AMENDMENT_REQUIRED"`, returned by `resolveObjectMutation` for any object class
  with no mutating descriptor. The registry states in code that there is no governed `SystemObject`
  mutation on `main`.

**Finding.** The seam the predecessor flagged as most likely to have introduced a qualifying action
introduced a machine-readable statement that none exists. That is the strongest available evidence
for outcome (b) at this base, and it is evidence rather than assertion because
`tests/intent-object-action-registry.test.ts` asserts it.

### 5.2 `projectSystemObjects` still has zero production consumers

```
git grep -ln "projectSystemObjects"
   docs/governance/…search-record.md          (prose)
   docs/reports/experience-v2-gate1b/…mjs     (evidence script)
   lib/intent/object-action-registry.ts       (two comments; the import is `import type`)
   lib/system/system-object.ts                (the definition)
   tests/system-object-projection.test.ts
   tests/intent-object-action-registry.test.ts
```

The registry references the projection **in comments and in a type-only import**. No shipped code
path calls it. So no action on `main` has ever received a `SystemObject`, at this base as at the
last. Under the strict reading of criterion 2 this settles the search on its own; under the
charitable reading applied here it settles nothing by itself, which is why §5.1 and §5.3–§5.5 do the
work.

### 5.3 `fabric/baseline` — the one changed candidate, re-examined rather than carried

`run-baseline.mjs` was substantially rewritten by #996: raw `exec("powershell", …)` and
`exec("ssh", …)` were replaced by `brokeredExec`, transport primitives moved to the new
`transport.mjs`, `MUTATING_BASELINE_STEPS` was introduced, and mutating steps now pass
`requireAudit: true` so the ledger is proven writable *before* the node is touched. Its previous
additive failures on **7** and **9** are therefore fixed.

**It still fails the same two intrinsic criteria, and the fixes did not touch either.**

| Criterion | Class | Verdict at `2d72d3c4` |
| --- | --- | --- |
| 1 mutation | intrinsic | PASS |
| **3 selected** | **intrinsic** | **FAIL** — `app/api/fabric/baseline/route.ts:14-27` takes no body and calls `runAllBaselines`, which loops every entry in the registry (`run-baseline.mjs:226-233`). Unchanged. |
| 5 target from record | intrinsic | n/a — no per-call target to derive |
| **11 safest** | **intrinsic** | **FAIL** — six steps that start a container or process, transfer a file, force-stop and clean up, on every node. Unchanged. |
| 7 brokered, dialect-aware | additive | **now PASS** (`:154-160`) |
| 9 durable evidence | additive | **now PASS** for the mutating steps (`requireAudit`, `broker.mjs:93`) |

Its six step ids remain internal: `step()` is a closure inside `runNodeBaseline`, and
`MUTATING_BASELINE_STEPS` classifies steps for the audit preflight rather than exposing them as
independently invokable actions. Catalogue 10 adds no separable candidate.

### 5.4 `runNodeBaseline` called directly — the adoption that would have been available

The tempting reading is that a per-node entry point makes criterion 3 satisfiable without building
anything: call `runNodeBaseline(name, node)` for one selected node and the gate is no longer
fleet-wide.

Two facts refuse it.

1. **It is not new.** `runNodeBaseline` was exported and per-node at `053a33bd` too
   (`git show 053a33bd:lib/fabric/run-baseline.mjs` → `:263`). Nothing about selectability changed at
   this base, so treating it as a new opening would be re-deciding a settled judgement on no new
   evidence.
2. **It still fails criterion 11, intrinsically.** Selecting one node does not make a
   start / transfer / force-stop / clean-up cycle the *safest* mutation available; it makes it the
   same cycle on one machine. The charter's operative word is `safest`, and the gate's own step list
   names ending work it started as the failure it most has to prove it can survive.

And the deeper objection is the one #996's record already named under a different candidate: taking
an acceptance gate, calling one of its internal entry points, and presenting that as "the first
governed mutation" is **adopt in name, build in fact**. The subject would still be a registry entry
rather than a `SystemObject`, the target would still come from the caller's `node` argument rather
than from a canonical record, and the action's post-state would be a list of step results rather than
an observation of the node.

### 5.5 `updateNodeFields` — a candidate the first search's boundary never named

`lib/fabric/registry.mjs:62`. A mutating exported function whose subject is a node, in a directory
the first search examined only through its catalogues and its brokered vocabulary. It appears in no
route, no catalogue and no `"use server"` file, so **every one of the first search's six surfaces
would have missed it**. That is a defect in that boundary, recorded here as one rather than folded in
quietly: a surface class that is never named has not been searched, whatever it happens to contain.

It is a careful, well-shaped function — optimistic concurrency against a content fingerprint,
field-loss refusal, unknown fields carried through — and it still fails intrinsically:

| Criterion | Class | Verdict |
| --- | --- | --- |
| 1 mutation | intrinsic | PASS — merges fields into a node's registry entry |
| 3 selected | intrinsic | PASS — one node by name |
| **4 fixed catalogue by name** | **intrinsic** | **FAIL** — there is no catalogue. `patch` is an arbitrary caller-supplied object; any field, including fields the type has never heard of, is writable by design (`registry.mjs:62-64`, and the `[key: string]: unknown` index signature at `transport.d.mts:22`) |
| **5 target from the record** | **intrinsic** | **FAIL** — the node name and every written value come from the caller |
| 11 safest | intrinsic | PASS in isolation |

Two further facts, neither of which is the reason it fails. It has **zero call sites** outside its own
type declaration (`git grep -n "updateNodeFields" -- app lib scripts`), so it is library capability
rather than a shipped action. And its subject is the **transport record**, not the machine: it edits
`~/.williamos/fabric/nodes.json` on the controller and no command reaches a node. An action that
changes how the lab addresses HERMES has not changed HERMES.

### 5.6 The unchanged surfaces, named so the negative states its boundary

Re-confirmed byte-identical at `2d72d3c4` by §3.2, with the first search's per-candidate evidence
therefore still resolving:

- **30 mutating route handlers** — 3 brokered (`resource/{relocate,restore,verify}`), 1 raw-transport
  (`fabric/baseline`, now brokered), 4 local-host-only (`loom/{run,agent,edit}`, `environment/line`),
  22 database-record-only and out of object class.
- **26 server actions** — none reaches a node; all mutate database records through Drizzle.
- **92 control-center commands** — subject is an Obsidian vault; not one takes a node or accelerator
  as its subject. Disposition `FENCE`, recorded and enforced at
  `object-action-registry.ts:324-333`.
- **`scripts/execution-fabric/` (84)**, **`scripts/lab-control/` (26)**, **`scripts/fabric/` (2)** —
  node and target from argv, and measured unreachable from `app/` or `lib/`.
- **`LOOM_OPERATIONS.service.restart`** — the first search's strongest candidate. Fails **3** and
  **5**, and fails **10** irrecoverably: it restarts the process that would observe the post-state.
  An action cannot witness its own termination.

---

## 6. Outcome

**(b) — nothing qualifies at `2d72d3c4`.**

The search space was enumerated with re-measured denominators; the one changed candidate was
re-examined in full; the seam the predecessor named as most likely to have opened the reuse branch
was examined first and found to type its own absence; and one candidate outside the first search's
stated boundary was found, examined and disqualified on intrinsic grounds. Every failure named above
is on a criterion that cannot be supplied without building a different action.

The charter's mandatory-first reuse rule was therefore run first and returned nothing, at this base,
for this subject. `AMENDMENT-001` authorizes the build.

### 6.1 What this record does not claim

- It does not claim the first search was wrong. It re-ran it because the base moved, which is the
  rule, and it agrees with it everywhere except on a boundary the first record did not draw (§5.5).
- It does not claim `updateNodeFields` is a defect. It claims it is not a canonical action.
- It does not claim the build is authorized by this document. `AMENDMENT-001` authorizes it; this
  document discharges the predecessor that authorization is conditioned on.
- It does not claim a later lane may skip this step. The amendment's reuse-first clause is intact: a
  lane that wants to build an action for a different subject must prove absence again, by bounded
  recorded search, for that subject.
- Its negatives state their boundary. Where this record says "none", §3 gives the surface, the query
  and the denominator that produced it, and §3.2 states exactly which part of the search was
  shortened and on what evidence.

---

## 7. Typed continuations

No entry is an owner ask. `OWNER_COURIER_ACTIONS = 0` for this lane.

```
CONT-EXPV2-FIRST-ACTION-IMPLEMENTATION
  predecessor:            DISCHARGED by this document. The fresh bounded search required by the
                          collision map S9 packet was run against the ACTUAL pickup base 2d72d3c4,
                          recorded here, and returned outcome (b).
  branch selected:        BUILD. Not by default -- REUSE was run first, in full, and returned
                          nothing. Had any candidate qualified, this packet would have been
                          discharged UNBUILT, which the map requires and which was a live
                          possibility until S5.1 and S5.3 were measured.
  built as:               node.stamp-identity, the one governed NODE mutation. Catalogued in
                          lib/system/node-identity-stamp.ts, described in the merged Object+Action
                          Registry, executed through brokeredExec, evidenced through the fabric
                          ledger with requireAudit and through appendGovernanceEvent, and verified
                          by reading the written bytes back off the node.
  owner:                  this lane.
  ownerDecisionRequired:  false.

CONT-EXPV2-FIRST-ACTION-RUNTIME-SETTLEMENT
  type:                   BLOCKED_AUTHORITY   [retyped 2026-08-25 from BLOCKED_DEPENDENCY, which was
                                               itself retyped 2026-08-24 from WAITING_RESERVATION]
  reason:                 AUTHORITY_ABSENT_FOR_SCOPE_995
  condition:              A RECORDED AUTHORITY DECISION. No longer ATLAS_REACHABLE -- that condition
                          fired and is discharged.
  continuation:           blocked; not automatic. What it now waits on is not an event.
  settled by:             docs/reports/WILLIAMOS-EXPERIENCE-V2-ATLAS-RETURN-SETTLEMENT-002.md,
                          2026-08-25. Read that record before the 2026-08-24 text retained below,
                          whose prediction being wrong is itself part of the finding.
  ATLAS_REACHABLE:        DISCHARGED. ATLAS returned on the 2026-08-25 power cycle at a DIFFERENT
                          address: its DHCP lease moved 192.168.88.5 -> 192.168.88.8, and .5 is now
                          held by another device that answers ARP and answered a ping. Rediscovered
                          canonically, twice over: the /etc/machine-id sha256 at .8 equals the atlas
                          pin in config/execution-fabric/registry.seed.json, and the ed25519 host key
                          at .8 is byte-identical to the key already pinned for .5. The fabric
                          registry was merge-written through lib/fabric/registry.mjs updateNodeFields.
  what blocks it NOW:     not reachability, and not only transport. TWO walls, and the second is the
                          real one. (1) TRANSPORT: williamos-postgres came back bound to the literal
                          HostIp 192.168.88.5:15432, an address the host no longer holds, so Docker
                          never created the publish -- the container reports Up, serves on its own
                          socket, and is reachable over TCP from NOWHERE, including ATLAS itself.
                          (2) SUBSTANCE: the authority registry holds 28 grants and NOT ONE is
                          scoped #995. Four A3_WRITE_SHARED grants exist; every one is scoped
                          elsewhere. So even over a perfect connection the route refuses
                          AUTHORITY_NOT_GRANTED_NO_ROWS. Repairing (1) does not move this.
  actor corrected:        the 2026-08-24 runs passed --actor=william. No user has that id. The real
                          id is YCAbP6TPTU1sxkpf4gVl5FcX9Nf4lrwZ (bsvalues@gmail.com), and the
                          2026-08-25 run used it. --actor=william would have returned zero rows for
                          the wrong reason -- a missing actor, not a missing grant.
  what was NOT done:      no grant minted, no session fabricated, no substitute registry stood up,
                          no container recreated or re-plumbed, and DATABASE_URL was NOT repointed at
                          ATLAS's other Postgres (192.168.88.8:5432 is tf-postgres -- TerraFusion, a
                          different product). The node was never contacted; the stamp file still does
                          not exist and the ledger is unchanged at 1241147 bytes.
  owner:                  whoever records authority for #995. NOT a builder lane.
  ownerDecisionRequired:  TRUE, and this is the change. The 2026-08-24 entry said false, reasoning
                          that "whether a qualifying grant exists is a question this lane's driver
                          answers in one run." It has now been answered: none exists. Recording one
                          is a decision, and no lane may record it on the owner's behalf.

  --- the 2026-08-24 text, retained ---
  type:                   BLOCKED_DEPENDENCY          [retyped 2026-08-24 from WAITING_RESERVATION]
  reason:                 AUTHORITY_UNREADABLE
  condition:              ATLAS_REACHABLE
  continuation:           automatic
  settlement attempted:   yes, for real, against live hardware. See
                          docs/reports/WILLIAMOS-EXPERIENCE-V2-RUNTIME-SETTLEMENT-001.md.
  released condition:     997-migration-complete IS satisfied. PR #1003 landed the native Ollama
                          service and released HERMES; HERMES answered every read this lane made.
                          The reservation is no longer what blocks this.
  what blocks it now:     the authority grant registry is a table in the WilliamOS Postgres, and
                          that Postgres lives on ATLAS. ATLAS answers nothing -- every port behaves
                          exactly as an unassigned address does, measured against a live-host
                          control. So `grantCovers` was never reached: the route's own catch turns
                          an unreadable registry into AUTHORITY_UNREADABLE, and an unreadable grant
                          registry is not permission.
  what was NOT done:      no grant was self-minted, no session was fabricated, no local grant
                          registry was stood up, and the node was never contacted. The stamp file
                          does not exist on HERMES and the fabric ledger did not gain a line.
  what WAS settled:       every leg the route reaches before authority, and every leg that can be
                          proven without contacting the node: canonical object graph, registry
                          selection, broker record, the exact planned bytes and their digest, and
                          -- the thing this settlement was specifically told to verify -- WHICH
                          ledger guard actually holds. Both do, on this path, at this base:
                          `requireLedger` before contact, and the broker's `requireAudit`, which
                          refused with the injected exec spy at zero calls. #1003's finding that
                          `--require-audit` was inert applies to broker.mjs at b9f5138b, not here.
  blocks:                 #995 acceptance invariant 13's TERMINAL leg only, unchanged. Invariants 9
                          and 12 and the governed-execution leg remain delivered and tested.
  owner:                  the next lane that finds ATLAS answering.
  ownerDecisionRequired:  false. The owner is not asked to power on, report on, or declare a node,
                          and is not asked to record a grant. When ATLAS answers, whether a
                          qualifying grant exists is a question this lane's driver answers in one
                          run without an owner in the loop.

CONT-EXPV2-AUTHORITY-ABSENT-FOR-SCOPE-995
  type:                   BLOCKED_AUTHORITY
  raised by:              CONT-EXPV2-ATLAS-RETURN-SETTLEMENT, 2026-08-25
  finding:                the authority registry contains 28 grants, across scopes #887, #890, #891,
                          #905, WO-0027, WO-0028, nine goals, four Hermes outcomes and two
                          campaigns. It contains NO grant scoped #995. Gate 2's terminal leg has
                          been waiting on an authority decision that was never recorded, and the
                          ATLAS outage stood in front of that fact from 2026-08-24 until now.
  observed how:           a read-only SELECT against the registry, out of band, because the governed
                          path could not reach it. That observation did NOT authorise anything and
                          did NOT produce the verdict: the verdict comes from the driver's own run
                          through the route's real modules, recorded unedited at
                          docs/reports/experience-v2-atlas-return-settlement/AT-07-settlement-run.json.
  not claimed:            that the absence may be remedied by any lane. It may not. No grant was
                          minted and none may be.
  blocks:                 #995 acceptance invariant 13's terminal leg. This is now THE blocker.
  ownerDecisionRequired:  true.

CONT-EXPV2-HARDCODED-ADDRESS-CLASS
  type:                   TYPED_OBSERVATION
  raised by:              CONT-EXPV2-ATLAS-RETURN-SETTLEMENT, 2026-08-25
  finding:                four instances of one defect, every one silent while green: F: outliving
                          its NVMe; the 2026-08-18 LAN move; sync-models-to-forge.ps1's hard-coded
                          bs@192.168.88.5; and williamos-postgres's HostIp 192.168.88.5. Three are
                          repaired. The fourth is what makes the authority registry unreachable
                          today. The lab already knows the remedy -- OMEN's registry entry uses an
                          mDNS name BECAUSE its lease moved twice in one day -- and has not applied
                          it consistently.
  ownerDecisionRequired:  false.

CONT-EXPV2-AUTHORITY-REGISTRY-SINGLE-POINT
  type:                   TYPED_FINDING               [AMENDED 2026-08-25]
  raised by:              CONT-EXPV2-FIRST-ACTION-RUNTIME-SETTLEMENT, 2026-08-24
  amendment:              ATLAS's return did not close this; it sharpened it. The oracle is now UP
                          AND STILL UNREACHABLE, because its transport was pinned to an address a
                          DHCP lease took away. So the finding is not only "one oracle with no
                          availability story" -- it is that the oracle's reachability rests on a
                          hand-made docker run from 2026-08-13 that no repository file describes and
                          no health check tests. Nothing noticed. The container reported Up
                          throughout. The "with ATLAS down" phrasing below no longer describes the
                          condition; the finding outlives it.
  finding:                every governed mutation in this program checks authority against one
                          Postgres on one node, and that node is neither the node being governed
                          nor the node the control plane runs on. With ATLAS down, NOTHING in
                          WilliamOS can be authorised -- not on HERMES, which is up and healthy,
                          and not on OMEN. The sovereignty clause in AGENTS.md says WilliamOS must
                          stay useful when optional external providers are unavailable; ATLAS is
                          not an optional external provider, but the availability shape is the
                          same one, and this is the first lane to hit it from the authority side.
  not claimed:            this is NOT a claim that the grant check should degrade, cache, or fail
                          open. It must not. The finding is that the lab has one authority oracle
                          with no availability story, and that is a design question a gate owns.
  blocks:                 nothing today. Recorded so the next lane blocked this way finds it
                          already named.
  ownerDecisionRequired:  false.

CONT-EXPV2-ACCELERATOR-FIRST-ACTION
  type:                   BLOCKED_DEPENDENCY
  reason:                 CANONICAL_ACTION_SEARCH_NOT_PERFORMED_FOR_THIS_OBJECT_CLASS
  subject:                a governed mutation whose subject is an ACCELERATOR. resolveObjectMutation
                          ("ACCELERATOR") returns MUTATION_UNAVAILABLE at this base and will keep
                          returning it until this is discharged.
  requires:               its own bounded recorded search, for its own subject, before any build.
                          AMENDMENT-001's reuse-first clause survived the amendment intact and is
                          not spent by this lane having used it once. This entry exists so the
                          NODE build cannot be read as precedent for an ACCELERATOR one.
  blocks:                 nothing at Gate 2. The charter asks the first journey for ONE safe
                          governed mutation, and it has one.
  owner:                  the lane that first needs an accelerator mutation.
  ownerDecisionRequired:  false.
```

## 8. Dispositions at the ORACLE RESTORATION lane, 2026-08-25

Executed under an explicit owner decision of 2026-08-25. `OWNER_COURIER_ACTIONS = 0`. Full record:
`docs/reports/WILLIAMOS-EXPERIENCE-V2-ORACLE-RESTORATION-003.md`; evidence under
`docs/reports/experience-v2-oracle-restoration/`.

```
CONT-EXPV2-AUTHORITY-ABSENT-FOR-SCOPE-995
  type:                   DISCHARGED                                      [2026-08-25]
  discharged by:          an owner decision, recorded through the canonical path. GRANT-0019:
                          scope #995, A3_WRITE_SHARED, allowedActions ["node.stamp-identity"],
                          grantedTo claude, 16 blockedActions, workOrderId null, 2h expiry.
                          Created by app/actions/authority.ts createAuthorityGrantWithResult --
                          NOT by SQL -- so it carries its advisory-lock-allocated ref, contentHash
                          be172d51, governance_event 1081 AUTHORITY_GRANTED, event_log 147, and the
                          Tier-2 ledger docs/devkit/authority/GRANT-0019.{md,json}.
  exercised:              once. RS-00 returned SETTLED_MUTATION_EXECUTED.
  and then closed:        REVOKED through revokeAuthorityGrant immediately after the proof
                          (governance_event 1083, event_log 148). The same driver now returns
                          AUTHORITY_NOT_GRANTED_NO_COVERAGE. NO standing #995 permission remains.
                          Re-authorising is a NEW owner decision, not a re-run.
  ownerDecisionRequired:  false. It was made, and it is spent.

CONT-EXPV2-FIRST-ACTION-RUNTIME-SETTLEMENT
  type:                   DISCHARGED                                      [2026-08-25]
  condition:              A RECORDED AUTHORITY DECISION -- fired.
  settled:                the mutation executed, a SEPARATE post-state observation verified it
                          (ba29cf1b, 158 bytes), and that observation was recorded durably.
                          Ledger 1241147 -> 1242044. All three legs of the verdict contract, which
                          is the only way this entry could be discharged.
  ownerDecisionRequired:  false.

CONT-EXPV2-HARDCODED-ADDRESS-CLASS
  type:                   TYPED_OBSERVATION                               [AMENDED 2026-08-25]
  amendment:              the fourth instance is repaired, and it is the one that mattered.
                          williamos-postgres is declared at deploy/atlas/williamos-authority-
                          registry/compose.yaml and publishes 0.0.0.0:15432 -- no interface named.
                          HERMES resolves ATLAS through lib/fabric/authority-registry-url.mjs,
                          which refuses rather than falling back. A FIFTH instance was found while
                          doing it: OMEN's ~/.ssh/config still points `atlas` at 192.168.88.5. Not
                          repaired here (operator-workstation config, outside the repository); the
                          lane worked around it with -o HostName, and pinned .8's host key only
                          after proving it byte-identical to the key already pinned for .5.
  ownerDecisionRequired:  false.

CONT-EXPV2-AUTHORITY-REGISTRY-SINGLE-POINT
  type:                   TYPED_FINDING                    [OPEN -- NOT closed by the restoration]
  restated 2026-08-25:    the oracle is now owned, published independently of ATLAS's address, and
                          restricted at two policy layers. That makes the architecture FUNCTIONAL.
                          It does not make it RESILIENT. It is still one Postgres, on one node, on
                          one LAN, and when it is unreachable every governed mutation in WilliamOS
                          refuses -- which remains the correct behaviour and remains a single point
                          of failure. The owner's decision said explicitly to leave this typed, and
                          it is left typed. A restoration lane must not be read as an availability
                          answer.
  ownerDecisionRequired:  false.

CONT-EXPV2-GRANT-EXPIRY-TZ-SKEW
  type:                   TYPED_DEFECT
  raised by:              CONT-EXPV2-ORACLE-RESTORATION, 2026-08-25
  finding:                app/api/system/node/stamp-identity/route.ts reads "expiresAt" with the
                          raw pg client and does new Date(row.expiresAt), bypassing lib/db/
                          schema.ts's utcWallTimestamp type, whose fromDriver exists precisely to
                          undo node-pg's local-time interpretation. A stored UTC wall clock is
                          therefore read as LOCAL time. Measured against the live GRANT-0019 row on
                          HERMES (UTC-7): the route reads 19:05:06Z, the schema reads 12:05:06Z,
                          skew 7h. A grant written to live two hours is one the route accepts for
                          nine. West of UTC grants outlive their bound; east of UTC they expire
                          early. Either way the number in the record is not the number enforced.
  scope:                  wherever a governed route reads authority timestamps through raw pg
                          rather than drizzle. This lane checked one route and did not audit others.
  not repaired here:      the fix edits a module the settlement driver digest-pins, mid-proof, and
                          it is outside the owner's authorised sequence. It is also why GRANT-0019
                          was REVOKED rather than left to lapse: revocation is checked by status,
                          not by clock, and is the only bound here that behaves as written.
  ownerDecisionRequired:  false.

CONT-EXPV2-RUNTIME-CREDENTIAL-STALE
  type:                   TYPED_DEFECT
  raised by:              CONT-EXPV2-ORACLE-RESTORATION, 2026-08-25
  finding:                with transport restored and both policy layers admitting HERMES, the
                          driver still reported AUTHORITY_UNREADABLE -- 28P01, password
                          authentication failed for user "williamos". The resolver was ruled out
                          first: the 64-character password is byte-identical through URL parse and
                          host substitution, and only the host changed. Three distinct DATABASE_URL
                          passwords exist across HERMES's env files, and the LIVE runtime's
                          (C:\HermesLab\williamos-runtime\.env.local) is NOT the role's.
  established how:        arithmetically, against the role's stored SCRAM-SHA-256 verifier --
                          derive SaltedPassword, ClientKey, StoredKey, compare. NOT by trying
                          logins: a wrong guess is indistinguishable in the server log from
                          someone else's. No password was changed, printed, or copied anywhere.
  consequence:            the deployed WilliamOS runtime on HERMES cannot read the authority
                          registry even now. Every governed route it serves would refuse
                          AUTHORITY_UNREADABLE. This was invisible until the two walls in front of
                          it were removed.
  not repaired here:      editing a live service's configuration and restarting it is outside a
                          reads-and-driver-run boundary, and the crossnode-repair lane was active
                          on HERMES.
  owner:                  a lane authorised to change the runtime's configuration.
  ownerDecisionRequired:  false.

CONT-EXPV2-GRANT-HAS-NO-TARGET-PREDICATE
  type:                   TYPED_OBSERVATION
  raised by:              CONT-EXPV2-ORACLE-RESTORATION, 2026-08-25
  finding:                the owner's decision asked for a grant whose target was limited to the
                          canonical HERMES node. authority_grant has no target column, and
                          grantCovers checks only level and action, so no such limit is
                          expressible. The restriction is recorded in the grant's reason as intent
                          and is NOT claimed as enforcement. What actually confines the mutation to
                          one machine is the route: the endpoint comes from the transport registry
                          rather than from the request, and any object absent from the canonical
                          graph is refused.
  ownerDecisionRequired:  false.

CONT-EXPV2-ALLOWLIST-ADDRESS-BOUND
  type:                   TYPED_OBSERVATION
  raised by:              CONT-EXPV2-ORACLE-RESTORATION, 2026-08-25
  finding:                the authority oracle's two policy layers allowlist an L3 address
                          (192.168.88.9/32, HERMES). An address allowlist cannot be made
                          DHCP-independent the way the software was; it names addresses by nature.
                          Declared once in deploy/atlas/williamos-authority-registry/fabric-
                          callers.json and rendered into both pg_hba.conf and the DOCKER-USER
                          chain, with a test asserting the two stay in step -- so a lease change is
                          a one-file edit and a re-run, not a hunt. The owner is handling DHCP
                          reservations separately.
  ownerDecisionRequired:  false.
```
