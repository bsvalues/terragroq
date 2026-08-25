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
  type:                   WAITING_RESERVATION
  condition:              997-migration-complete
  continuation:           automatic
  subject:                the live-hardware settlement of node.stamp-identity: one real brokered
                          write against a canonical node, with the ledger line, the read-back and
                          the post-state verdict retained as evidence.
  why not now:            HERMES is under the #997 P40 migration lane's active reservation. A lane
                          that does not hold a node does not probe it, and does not mutate it, and
                          the fact that this action is small is not a reason to make an exception
                          for it.
  deliverable now:        the implementation and its deterministic tests, which is what #995
                          permits to merge. #995 also forbids declaring Gate 2 ACCEPTED on them,
                          and this lane does not.
  blocks:                 #995 acceptance invariant 13's TERMINAL leg only. It does not block the
                          governed-execution leg, invariant 9, or invariant 12, all of which are
                          delivered and tested here.
  ownerDecisionRequired:  false. The owner is not asked to power on, release, report on, or
                          declare a node.

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
