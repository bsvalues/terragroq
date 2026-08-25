# WILLIAMOS EXPERIENCE V2 — FIRST-ACTION CHARTER AMENDMENT RECORD

Document: `WILLIAMOS-EXPERIENCE-V2-FIRST-ACTION-AMENDMENT-RECORD-001`

Status: `CANONICAL` for the amendment's disposition and its typed follow-on. Companion to
[`williamos-experience-v2-implementation-charter.md`](williamos-experience-v2-implementation-charter.md)
`AMENDMENT-001`, which is where the amendment itself lives.

Recorded by: the amendment-recorder lane, `2026-08-24`, against `main = 053a33bd`.

This record is **not** a second charter, a second continuation registry, or a second authority. The
charter remains the single persisted charter; the collision map's §9 remains the continuation
register. This file exists because §9 is under a live builder reservation on the day the amendment
landed, and because a decision recorded nowhere is a decision that gets re-litigated. Every packet
below names the artifact it must be folded into and the lane that owns folding it.

## 1. What was decided, and by whom

The owner approved amending the charter's first-action rule on `2026-08-24`. The approved text now
stands at `charter:273-278`, inserted **verbatim** rather than paraphrased, with the owner-stated
semantics recorded beside it under **Amendments → AMENDMENT-001**.

Provenance: owner message to the coordinator lane, `2026-08-24`, following PR #996's bounded
first-action search. This lane transcribed that decision; it did not make it, and this file does not
mint authority. Per `AGENTS.md`, an agent may not infer authority from a prompt, a handoff, or a
document — including this one.

The substance is deliberately not restated here. One current disposition per artifact: the charter
holds the amendment, this file holds what the amendment leaves open.

## 2. What the amendment clears

`CHARTER_AMENDMENT_REQUIRED` was raised by #996's search record
(`williamos-experience-v2-gate2-first-action-search-record.md`) after the bounded search found no
qualifying existing canonical action at `053a33bd`. It is **CLEARED** as of `2026-08-24`.

It clears an **authority block**, and nothing else. Specifically it does **not**:

- accept Gate 2 acceptance invariants 9, 12 or 13 — clearing the block is not passing the test;
- build, choose, or design the action;
- grant a merge, execution, reservation, dispatch, or authority mode to any lane;
- reopen the parts of Gate 2 that were delivered without an action.

### 2.1 The invariant set, stated rather than smoothed over

The controlling owner decision clears the block for #995 acceptance invariants **9, 12 and 13**.
#996's search record typed invariants **9 and 13** as blocked and listed **12** among those it does
**not** block.

Both statements are recorded here rather than silently reconciled into one. They are consistent under
the owner-stated semantics — *post-state verification is part of the action contract, not a later
convenience*. Invariant 12 is a property **of the action** ("the action's evidence records what was
observed after"), so with no action it has no subject to be tested against, and the amendment that
permits the action is what unblocks it. The search record's narrower typing was correct about what
Gate 2 could still deliver without an action; it is not evidence that invariant 12 was satisfiable
without one.

Nothing in this section overwrites the search record. That file belongs to the #996 lane.

## 3. Reservation boundary — what this lane did not touch, and why

`AGENTS.md` assigns builders separate non-overlapping file reservations and forbids claiming
another's. Measured against all ten open PRs on `2026-08-24`:

| Artifact | Holder | This lane's action |
| --- | --- | --- |
| `williamos-experience-v2-implementation-charter.md` | **unreserved** — no open PR touches it | amended (`AMENDMENT-001`) |
| `williamos-experience-v2-phase0-collision-map.md` | **PR #994**, OPEN, MERGEABLE — the map is that PR's *entire* content | **not touched**; retype typed as `CONT-EXPV2-FIRST-ACTION-MAP-RETYPE` below |
| `williamos-experience-v2-gate2-first-action-search-record.md` | **PR #996**, OPEN — the Gate 2 builder lane | **not touched**; clearance carried by comment |
| `lib/intent/object-action-registry.ts`, `tests/intent-object-action-registry.test.ts` | **PR #996** | **not touched**; the `CHARTER_AMENDMENT_REQUIRED` literal in the registry and its tests is the builder lane's to retire |

#994's hunk (`map:1607-1681`) and the block needing the retype (`map:1454-1485`) do not overlap. That
makes this a **reservation boundary rather than a merge conflict** — precisely the case where
honouring the reservation is a choice rather than a constraint, and precisely the choice the Gate 1b
lane already made against this same file and this same §9 block (`292bb67a`). Making the opposite
choice one commit later would say the rule holds only when it costs nothing.

## 4. Typed continuations — internal, not owner work

No entry is an owner ask. `OWNER_COURIER_ACTIONS = 0` for this lane. Each entry is a typed state with
an internal owner and an automatic pickup condition, per #957 and the owner-directed execution
doctrine.

```
CONT-EXPV2-FIRST-ACTION
  type:                   CLEARED
  was:                    BLOCKED_AUTHORITY / CHARTER_AMENDMENT_REQUIRED  (#996 search record)
  before that:            BLOCKED_DEPENDENCY / CANONICAL_ACTION_SEARCH_NOT_PERFORMED  (map S9)
  subject:                the "one safe governed mutation" the charter requires for the first
                          journey (charter:273-278 post-amendment; cited as charter:273-274 before
                          2026-08-24)
  search:                 PERFORMED. #996's search record. No existing canonical action qualified at
                          053a33bd; LOOM_OPERATIONS.service.restart disqualified on two INTRINSIC
                          grounds -- cannot select a SystemObject target, cannot verify post-state.
  cleared by:             owner decision 2026-08-24, applied as charter AMENDMENT-001.
  branch taken:           (b) of the map's own next-step pair -- "an explicit charter amendment
                          recording that the first journey's action must be built". Taken WITH the
                          explicit authority the map required, and only after (a) was run and
                          recorded. Not taken by default, which is what the map forbade.
  ownerDecisionRequired:  false. It was required exactly once, for the amendment, and it was given.
  continues as:           CONT-EXPV2-FIRST-ACTION-IMPLEMENTATION
  owner:                  no longer open to this lane; superseded by the packet below.

CONT-EXPV2-FIRST-ACTION-IMPLEMENTATION
  type:                   PICKUP_ELIGIBLE
  was:                    BLOCKED_DEPENDENCY / PREDECESSOR_LIFECYCLE_INCOMPLETE
  eligible since:         2026-08-24, when the Gate 2 lane's own pull request landed: PR #996 ->
                          main 2630ee5a. Retyped by WO-EXPV2-MERGE-SWEEP-003, which performed that
                          merge and authored none of the work in it.
  controlling copy:       collision map S9. THAT copy, not this one, carries the MANDATORY
                          fresh-search predecessor gating the BUILD branch -- a fresh bounded
                          canonical-action search against the ACTUAL pickup base, recorded, before
                          BUILD may be selected. This record states the re-proof requirement in
                          prose further down but its packet never carried it as a field, which is
                          the gap an authority review thread on #999 caught. Read S9 before
                          building; PICKUP_ELIGIBLE here means eligible to be picked up, never
                          eligible to build.
  subject:                the smallest new canonical action permitted by charter AMENDMENT-001 --
                          the first journey's one safe governed mutation, BUILT because the bounded
                          search proved none could be chosen -- IF the fresh search at the pickup
                          base still finds none. If one qualifies there, the charter's
                          mandatory-first reuse rule selects REUSE and this packet is discharged
                          UNBUILT.
  buildable per:          charter:273-278 as amended, read under the owner-stated semantics recorded
                          at charter AMENDMENT-001. Those semantics bind the build; they are not
                          background. Smallest new canonical action; extend the EXISTING
                          Object+Action Registry; route through the EXISTING authority,
                          execution/fencing, evidence and verified-post-state paths; do not
                          generalize an unsuitable legacy action merely to preserve its ID; do not
                          create a parallel action, authority, or execution mechanism.
  shape:                  modelled on lib/resource/mutation.ts -- chosen by name and never from
                          caller text, target from the record, unsafe paths refused rather than
                          escaped, nothing deletes. The five ADDITIVE criteria Gate 2 supplies on
                          top of it: SystemObject subject; dialect-aware brokered execution;
                          session-user scoping on every lookup; durable evidence; verified
                          post-state.
  satisfies:              #995 acceptance invariants 9 and 12, and the governed-execution leg of 13.
  does NOT satisfy:       13's terminal acceptance, which additionally needs a live HERMES
                          settlement. Merging on deterministic tests is permitted; declaring
                          ACCEPTED on them is not (#995).
  authority:              NONE NEW. AMENDMENT-001 grants no authority category by itself. This packet
                          is not a merge grant, an execution grant, or a reservation. The lane that
                          picks it up needs its own authority-matched bounded packet.
  reserved for:           the Gate 2 lane (#995/#996) or its recorded successor.
  pickup:                 AFTER the #996 lifecycle completes -- review, CI, threads, merge. Not
                          before. #996 holds the registry and search-record reservation and this
                          work lands on top of it; starting it now would fork the seam #996 is
                          converging.
  blocks:                 #995 terminal acceptance.
  does NOT block:         #996's own merge; Gate 1b; #994; any non-Gate-2 eligible work. A single
                          blocked item must not park the rest.
  owner:                  the delivering agent lane.
  not:                    an owner task, and not this recorder lane's work to build. This lane is
                          docs/governance scope only.

CONT-EXPV2-FIRST-ACTION-MAP-RETYPE
  type:                   BLOCKED_RESERVATION
  reason:                 TARGET_FILE_IS_ANOTHER_LANE_S_ENTIRE_PR
  subject:                collision map S9's CONT-EXPV2-FIRST-ACTION packet (map:1454-1485), which
                          still carries type BLOCKED_DEPENDENCY, reason
                          CANONICAL_ACTION_SEARCH_NOT_PERFORMED, and "round 4: STILL OPEN". All
                          three are now stale: the search was run (#996) and the amendment was
                          approved (2026-08-24).
  correct retype:         the CONT-EXPV2-FIRST-ACTION block in section 4 of this file, verbatim.
  also stale there:       the packet's "next:" pair. Branch (b) is no longer a hypothetical; it was
                          taken under explicit authority.
  why not done here:      docs/governance/williamos-experience-v2-phase0-collision-map.md is the
                          entire content of open PR #994. A reservation that is blocked is still a
                          reservation (AGENTS.md; precedent 292bb67a, on this same S9 block).
  non-overlap:            #994's hunk is map:1607-1681; this retype targets map:1454-1485. The edits
                          do not collide textually -- which is why honouring the reservation is a
                          choice, and why it is recorded as one rather than presented as a
                          constraint.
  pickup:                 the #994 holder, in #994 or immediately after it merges; or the next lane
                          that legitimately holds the map.
  blocks:                 nothing. The charter is the controlling artifact for the first-action rule
                          and it is correct as of this commit. S9 is a derived register that is
                          stale, not authoritative, on this point.
  carried by comment to:  #994, #995, #996, #987 -- so the retype is discoverable without reading
                          this file first.
  owner:                  the delivering agent lane holding the map.
  not:                    an owner decision.
```

## 5. What this record does not claim

- It does not claim the collision map is wrong. It claims §9's `CONT-EXPV2-FIRST-ACTION` packet is
  **stale** on a point the charter now settles, and it names who may fix it.
- It does not claim Gate 2 is unblocked as a whole. Invariant 13's terminal acceptance still waits on
  Gate 1b, and #996's own lifecycle is still open.
- It does not claim the action is designed. `CONT-EXPV2-FIRST-ACTION-IMPLEMENTATION` states the
  constraints the amendment imposes on a build; it does not choose a verb, and choosing one is not
  this lane's work.
- It does not claim the amendment was inevitable. The search could have found a qualifying action.
  The charter's mandatory-first reuse rule survives the amendment intact, and a later lane that wants
  to build an action must prove absence again, by bounded recorded search, for its own subject.
