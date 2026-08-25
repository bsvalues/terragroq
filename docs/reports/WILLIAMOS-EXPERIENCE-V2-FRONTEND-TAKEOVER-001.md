# WilliamOS Experience V2 — Frontend Takeover 001

Lane: `LANE-EXPV2-FRONTEND-TAKEOVER`. Work order `WO-EXPV2-FRONTEND-TAKEOVER-001`.
`OWNER_COURIER_ACTIONS = 0`. No owner decision was required and no authority gap was reached.

Base at start: `main` = `2ddb22d4`. Adopted branch: `origin/wb/primary-experience-replacement`
(13 commits, +3660/−10660, last commit `8c0c9bfe` dated 2026-08-22 — the lane that authored it has
been dead since).

## Why this lane exists

Owner ruling, 2026-08-25, recorded verbatim in `.phase0-evidence/CONTINUATION-30-FRONTEND-TAKEOVER.md`:
the owner has been looking at the same product for a month while the program merged substrate behind
it. The dead #927 frontend lane is REASSIGNED, the #921 freeze on this path is LIFTED for the
takeover, and the visible experience is the program's priority axis.

The owner looks at `https://192.168.88.9:3443`. Merged-but-not-deployed is failure.

## 1. The rebase, and the conflict that was not there

Sweep 12 measured the conflict surface as one file, `app/api/environment/line/route.ts`. That was
stale: `main` has not touched that file since the merge base `a7efbe59`, and the rebase never
conflicted on it. The real overlap was two files, both of which Gate 2 had already collapsed into one
registry.

| file | resolution |
| --- | --- |
| `lib/intent/router.ts` | main's side taken whole — Gate 2 moved `SIGNALS`/`DESTINATIONS` out of it |
| `lib/intent/workbench-action-registry.ts` | main's side taken whole — it is a facade over the registry now |
| `lib/intent/object-action-registry.ts` | **the branch's semantics ported here**, into the one catalogue |

Main's side wins the FILE; the branch's side wins the SEMANTICS. Reinstating the branch's copies
would have re-created the two-catalogues-one-concept defect that §5.3 exists to name.

Four tests failed after the rebase — all of them the branch's own, all correct to fail — because the
catalogue edits went with the files: `mode.projects` and `mode.activity` still offered navigation to
deleted pages, and `DESTINATIONS.answer` still pointed at `/chat`. Fixed in the registry. Gate 2's own
count test moved from 16 descriptors / 4 modes to 14 / 2, with the reason written into it.

## 2. Three holes the branch was carrying

### 2.1 It built the third shell it existed to prevent

The collision map §5.2 counted three compositions and recorded: *"PR #927 touches both
`app/env/page.tsx` and `app/environment/page.tsx`, so the takeover lane is already collapsing the
pair; the resolution is its to make."*

It did not make it. The branch added `/` as a THIRD greenfield root and left both predecessors
mounted. Collapsed here: `/env`'s composition (#919 — its page, its `Environment` component, its own
`/api/env/line`; nothing imported it) is deleted, and `/env` and `/environment` redirect to `/`. One
root, one Desk, one Line endpoint.

### 2.2 Ninety-three links across thirty-five files pointed at deleted pages

The branch **named this itself**, in the commit that deleted `/work-orders`: *"Known and deliberately
NOT fixed here: legacy shell components still cross-link `/work-orders`. I rewrote those links, saw it
break 30 unrelated test files, and reverted."* The judgment was right; what was missing was a
resolution that does not touch the links at all.

Every superseded address now redirects into the environment **carrying the surface it used to be** —
`/work-orders` → `/?summon=work-orders`, `/trace` → `/?summon=runtime-trace`, and so on. All
ninety-three links keep working, none of them edited, and none of the thirty unrelated test files
disturbed. `/chat` carries no surface: the Line replaced it.

`?summon=` is not a second navigation model. It reaches the same summon the Line performs, through the
same endpoint, as an explicit `summon` field rather than a sentence synthesized on the owner's behalf
— putting words into their side of the transcript to simplify plumbing would be a lie in the one place
that has to stay honest.

Measured against the real standalone artifact, not read out of the config:

| route | observed |
| --- | --- |
| `/work-orders` | `308 → /?summon=work-orders` |
| `/decisions` | `308 → /?summon=decisions` |
| `/trace` | `308 → /?summon=runtime-trace` |
| `/activity` | `308 → /?summon=activity` |
| `/projects` | `308 → /?summon=project` |
| `/chat`, `/env`, `/environment` | `308 → /` |
| `/?summon=bogus` | `200` — an unknown surface opens the ordinary environment, never an error page |
| `/runtime`, `/system` | `200` — not deleted |

### 2.3 A summon did not work as the first thing said

`classifySummon` was consulted only inside `if (requestedWorldId)` — the existing-world path. So a cold
load answered *"show me the work orders"* with model prose instead of the work orders.

This is worse than the dead links. The entire warrant for deleting those five pages is that the
environment summons them on request, and the first request after opening WilliamOS was the one request
that did not work. Now handled on the new-world path too, placed after the sign-in-repair branch so no
sentence that used to reach that path changes meaning.

## 3. The gap the branch named itself

`8c0c9bfe`'s title is *"and a gap I created"*. Its first half — a correct fix left the outcome queue
with nowhere to appear, and nothing failed because nothing asserted the queue was reachable — is
genuinely closed: the queue is wired from `getOutcomeQueueSurface()` through the Line route to a
rendered view.

What is not closed is why `/runtime` survived the deletion sweep: it is a composite of about ten reads
and only two have moved. The commit message says so, and a commit message is not what the next lane
reads before deciding a page looks safe to delete.

**Disposition: OPEN, TYPED, ENFORCED.** `docs/product/runtime-migration-gap.md` carries the ledger;
`tests/runtime-migration-gap.test.ts` fails the build if `/runtime` is deleted while a read exists
nowhere else, fails if the ledger drifts from what the page imports, and checks the two MIGRATED claims
against the environment's own route rather than taking them on trust.

Migrating the remaining nine reads is Gates 3/5/7 work and is not smuggled into this landing.

## 4. Capability audit of the six deleted pages

Each migration was checked against what the page could DO, not against what it showed.

| page | reads | writes |
| --- | --- | --- |
| `/work-orders` | `getWorkOrders()` — the same reader — as the `work-orders` surface | the creation form was **retired, not migrated** (owner decision: work is created by naming an outcome to the Line and authorizing it through the governed path). `deleteWorkOrder` and `recordWorkOrderResult` retired with it — the deleted view was their only caller. `createWorkOrder` **kept**: `goals.ts`, `vault.ts`, the workroom-authority route and the objective API all call it |
| `/decisions` | `getDecisions()` — same reader, carrying status, authority and supersession lineage | `createDecision` and `supersedeDecision` survive and gained a caller in the Line, recorded as PROPOSED/ADVISORY and stated as such. The three deleted queue components are pure projections (`readOnly: true, approvesDecision: false, grantsAuthority: false`). **But the deleted view wired SIX writes, not two — see §4.1** |
| `/trace` | `getRuntimeExecutions()` — same reader, lease state and current checkpoint carried across | none existed; the page said so itself. Its SAFETY INVARIANT (no eval runner, no mutation path) was moved onto the surface rather than deleted with the page |
| `/activity` | `getActivity()` — corrected to its real reader during the migration | none |
| `/projects` | the project registry, with lifecycle preserved | none on the route |
| `/chat` | — | replaced by the Line |

`components/trace/trace-ledger-registry.ts` (985 lines of typed static governance material) survives as
DATA. It is material, not capability, and line count is not an argument either way.

### 4.1 A second gap the audit found: the decision register's three unreplaced writes

The commit that deleted `/decisions` said *"Both writes survive: `createDecision` and
`supersedeDecision`."* True, and incomplete. `components/decisions/decisions-view.tsx` wired **six**
governed writes. Two were migrated to the Line. Four were not:

- `updateDecisionStatus` — accept or reject a proposal. **No door anywhere in the product now.**
- `setDecisionAuthority` — binding / advisory / info. No door.
- `linkEvidence` — attach evidence to a decision. No door.
- `deleteDecision` — no door, and deliberately so: a governed register does not offer a delete button.

Nothing is broken and nothing is unsafe. All three actions are intact in `app/actions/decisions.ts`
and their protection guards are still asserted by `runtime-finding-decision-action-guard` and
`v1-2-campaign-authority-actions`. What is gone is the SURFACE: the register can be read, recorded to
and superseded, but it cannot be adjudicated.

`updateDecisionStatus` is the one that matters — accepting or rejecting a proposal is what makes a
register a register rather than a pile of notes. `setDecisionAuthority` arguably should not return as
a dropdown at all: the Line records PROPOSED/ADVISORY precisely because binding authority is minted by
the governed authorization path with evidence behind it, and a menu that flips a decision to binding is
that same shortcut wearing a different control.

**Disposition: OPEN, TYPED, ENFORCED**, and typed rather than closed on purpose. Closing it means a
third Line classifier, and an accept is a governed write with authority consequences — the record path
earned its safety with an explicit leading trigger, a hard refusal on every interrogative, negated and
hypothetical form, and 26 test cases. *"Should we accept DECISION-0007?"* must never accept
DECISION-0007. Building that at the end of a single-attempt landing is how a shortcut ships. The gap is
smaller than the risk of closing it badly. Record: `docs/product/decision-register-write-gap.md`;
enforcement: `tests/decision-register-write-gap.test.ts`, which fails if one of the three is deleted
rather than replaced, or if one gains a caller in the environment without its row being updated.

It is the successor's **first** item.

### 4.2 Documentation that the deletion made false

`docs/reference/work-orders.md` still listed `recordWorkOrderResult`, `setWorkOrderGate` and
`deleteWorkOrder` as available actions. It now records that they were retired with the write UI, and
why each one was a second way to do something the governed path already does — in particular that the
release gates (`commitAllowed` / `tagAllowed` / `pushAllowed`) are **not orphaned**: they are still
written by the work contract's `delivery` block through `scripts/hermes-bridge/outcome-source.mjs` and
still read by `outcome-queue-runtime.mjs` and `lib/workbench/outcome-execution-authorization.ts`. What
went away is the manual override that sat beside the contract.

Shipping a change that makes the reference documentation lie is the same defect class as shipping a
link that 404s.

## 5. Validation

| check | result |
| --- | --- |
| `next build` (production) | compiles; `/` is `ƒ`; `/env` and `/environment` no longer appear in the route table |
| deterministic suite, CI profile, local | **421 files passed, 5871 tests passed, 0 failed, 46 skipped** |
| `vitest (deterministic suite)` on GitHub | pass |
| `production build (next build)` on GitHub | pass |
| `work context receipt (#831)` | pass |
| redirect behavior | measured against the built standalone server — table in §2.2 |

An earlier local run showed `execution-fabric-remote-dev-offload-worker` timing out at 30s. It passed in
the runs before and after, and on both GitHub runs; it was resource contention from a concurrent suite
and a concurrent review on the same host, not a change in this branch. Recorded because a reader would
otherwise find it in the logs and wonder.

## 6. Successor — Gates 3 / 5 / 7

The owner's axis does not stop here. The full packet is
`.phase0-evidence/CONTINUATION-31-GATES-357.md`; what the next lane inherits, in short:

- **Gate 3 — WorkingWorld adapter completion.** The spine exists and the environment renders execution
  from it. What is not complete is the adapter: `app/api/environment/line/route.ts` is now 780 lines
  and singly owns request validation, world lifecycle, seven surface readers, decision writes, sign-in
  repair, ambiguity, grounding and conversation. It works, and it is the next thing that will resist
  change. Extract what has a second caller; do not rewrite it into a framework.
- **Gate 5 — desktop composition.** Surfaces that survive a reload, a surface the owner can promote,
  and restoration of where they were — see `CONT-EXPV2-ENVIRONMENT-NO-RESTORATION` below.
- **Gate 7 — visual / material contract (#984).** Untouched here, deliberately. The Desk's styling is
  functional and unconsidered; the charter's material contract has never been applied to it.

Four rules this landing established, which the successor inherits:

1. A deleted page must not become a dead address. Delete a route, add its redirect and its row in
   `tests/summoned-route-redirects.test.ts`, or the test says so.
2. Parity by construction. A migrated surface calls the reader the page called — not a summary, not a
   re-derivation. An invariant that lived on the page moves to the surface; it does not die with the
   route.
3. A surface must be checked for what it STOPPED showing. A green suite is not evidence that nothing
   was lost; it is evidence that nothing anyone thought to assert was lost.
4. Do not build a third shell. The map warned, the branch did it anyway, and this lane collapsed it.
   There is one root.

## 7. Typed continuations

    CONT-EXPV2-RUNTIME-MIGRATION-GAP
    status                             = open, typed, ENFORCED by test
    blocks this landing                = false
    must resolve before affected phase = Gates 3/5/7 (before /runtime may be deleted)
    record                             = docs/product/runtime-migration-gap.md

    CONT-EXPV2-DECISION-REGISTER-WRITE-GAP
    status                             = open, typed, ENFORCED by test
    detail                             = updateDecisionStatus, setDecisionAuthority and linkEvidence
                                         survive in code with their guards, and have no surface in the
                                         product since /decisions was deleted. The register can be read,
                                         recorded to and superseded; it cannot be adjudicated.
    blocks this landing                = false
    must resolve before affected phase = Gate 3 — the successor's FIRST item
    record                             = docs/product/decision-register-write-gap.md

    CONT-EXPV2-ENVIRONMENT-NO-RESTORATION
    status                             = open, pre-existing, NOT introduced here
    detail                             = the Desk mounts with worldId null every time, so every visit
                                         opens a NEW world; there is no restoration of where the owner
                                         was. True before this landing. The first thing a real working
                                         day will expose.
    blocks this landing                = false
    must resolve before affected phase = Gate 5 (desktop composition)

    CONT-EXPV2-963-LINE-ROUTE-OVERLAP
    status                             = open, recorded rather than hidden
    detail                             = PR #963 (untouched since 2026-08-22) edits
                                         app/api/environment/line/route.ts against a pre-landing base.
                                         Textually disjoint from what landed; it needs a rebase.
    blocks this landing                = false

    CONT-EXPV2-TAKEOVER-MERGED-BY-BUILDER
    status                             = recorded deviation, deliberate
    detail                             = the merge-sweep norm is that the merging lane authored no
                                         commit on the branch (sweep 8's independence claim). This lane
                                         authored every commit on it. CONTINUATION-30 assigns rebase,
                                         review, merge and deploy to ONE lane in a single attempt, and
                                         the owner ruling supersedes doctrine text that would re-freeze
                                         this path. Independent assurance was supplied by a separate
                                         PROVIDER lane (codex, stdin-closed, holding no reservation)
                                         rather than by a separate merging lane. Stated, not implied.
    blocks this landing                = false

    CONT-EXPV2-CODEX-SANDBOX-UNSPAWNABLE
    status                             = environment defect, worked around
    detail                             = `codex exec --sandbox read-only` fails on this host with
                                         CreateProcessAsUserW error 5 for 74 of 91 attempted commands,
                                         so a sandboxed reviewer can read the diff but cannot run its
                                         own checks. The review was re-run unsandboxed under an explicit
                                         no-write constraint, with the worktree tree hash taken before
                                         and after to prove it wrote nothing.
    blocks this landing                = false
