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
another's. Measured against the ten PRs open on `2026-08-24`. The Holder column records the
reservation as it stood at that measurement, with what has become of it since:

| Artifact | Holder | This lane's action |
| --- | --- | --- |
| `williamos-experience-v2-implementation-charter.md` | **unreserved** — no open PR touches it | amended (`AMENDMENT-001`) |
| `williamos-experience-v2-phase0-collision-map.md` | **PR #994** — the map was that PR's *entire* content; #994 has since merged to `main` as `184aaa2b` | **not touched by this lane**; retype typed as `CONT-EXPV2-FIRST-ACTION-MAP-RETYPE` below, now `RESOLVED` — #994 performed it on itself |
| `williamos-experience-v2-gate2-first-action-search-record.md` | **PR #996** — the Gate 2 builder lane; merged to `main` as `2630ee5a` | **not touched**; clearance carried by comment |
| `lib/intent/object-action-registry.ts`, `tests/intent-object-action-registry.test.ts` | **PR #996**, merged `2630ee5a` | **not touched**; the `CHARTER_AMENDMENT_REQUIRED` literal in the registry and its tests is the builder lane's to retire |

#994's hunk and the block that needed the retype did not overlap — `map:1607-1681` against
`map:1454-1485` as the file stood on `2026-08-24`; the retype has since landed and the block now
sits at `map:1495-1514`. That made this a **reservation boundary rather than a merge conflict** —
precisely the case where honouring the reservation is a choice rather than a constraint, and
precisely the choice the Gate 1b lane already made against this same file and this same §9 block
(`292bb67a`). Making the opposite choice one commit later would say the rule holds only when it
costs nothing.

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
  type:                   RESOLVED
  was:                    PICKUP_ELIGIBLE, set on this branch by 4dda3e97
                          (WO-EXPV2-MERGE-SWEEP-003) and never landed on main -- the merge gate that
                          read it found the state already consumed. Recorded so that no reader hunts
                          main for a disposition it never held.
  before that:            BLOCKED_DEPENDENCY / PREDECESSOR_LIFECYCLE_INCOMPLETE
  consumed:               2026-08-24. The first-action builder lane picked the packet up, ran the
                          MANDATORY fresh bounded canonical-action search against the ACTUAL pickup
                          base 2d72d3c4, and recorded it in
                          williamos-experience-v2-first-action-pickup-search-record.md. Outcome (b)
                          again -- nothing qualified there either -- so the charter's mandatory-first
                          reuse rule selected BUILD after REUSE was run in full, and this packet is
                          discharged BUILT rather than UNBUILT.
  pickup:                 DONE. The condition this field used to name -- "AFTER the #996 lifecycle
                          completes: review, CI, threads, merge; not before" -- was met when #996
                          merged to main as 2630ee5a, and the pickup followed at 2d72d3c4.
  delivered as:           node.stamp-identity, the one governed NODE mutation
                          (lib/system/node-identity-stamp.ts), in PR #1002 -> main 1a352a3f.
  controlling copy:       collision map S9, which carries the same retype. That copy, not this one,
                          held the MANDATORY fresh-search predecessor; the predecessor is DISCHARGED
                          by the search record named above, not by either retype.
  subject was:            the smallest new canonical action permitted by charter AMENDMENT-001 --
                          the first journey's one safe governed mutation, BUILT because a second
                          bounded search proved again that none could be chosen.
  constraints it set:     charter:273-278 as amended, read under the owner-stated semantics recorded
                          at AMENDMENT-001 -- smallest new canonical action; extend the EXISTING
                          Object+Action Registry; route through the EXISTING authority,
                          execution/fencing, evidence and verified-post-state paths; do not
                          generalize an unsuitable legacy action merely to preserve its ID; do not
                          create a parallel action, authority or execution mechanism; the shape of
                          lib/resource/mutation.ts plus the five ADDITIVE Gate 2 criteria. Whether
                          the delivered action meets them is #1002's review and merge record. This
                          file set the constraints; it does not certify compliance with them.
  satisfies:              per the delivering lane's own packet
                          (williamos-experience-v2-first-action-pickup-search-record.md:383-385),
                          #995 acceptance invariants 9 and 12 and the governed-execution leg of 13
                          are delivered and tested. 13's TERMINAL acceptance is NOT satisfied and
                          still needs a live HERMES settlement.
  continues as:           CONT-EXPV2-FIRST-ACTION-RUNTIME-SETTLEMENT -- WAITING_RESERVATION,
                          condition 997-migration-complete, continuation automatic -- recorded on
                          main at line 369 of
                          williamos-experience-v2-first-action-pickup-search-record.md. That packet,
                          not this one, now carries Gate 2's terminal leg.
  authority:              NONE NEW. AMENDMENT-001 granted no authority category by itself, and
                          resolving this packet grants none either.
  owner:                  closed. The successor names its own.
  not:                    an owner task. It was not one while it was blocked and it is not one now.

CONT-EXPV2-FIRST-ACTION-MAP-RETYPE
  type:                   RESOLVED
  was:                    BLOCKED_RESERVATION / TARGET_FILE_IS_ANOTHER_LANE_S_ENTIRE_PR
  subject:                collision map S9's CONT-EXPV2-FIRST-ACTION packet, which carried type
                          BLOCKED_DEPENDENCY, reason CANONICAL_ACTION_SEARCH_NOT_PERFORMED and
                          "round 4: STILL OPEN" after all three had gone stale, and whose "next:"
                          pair still presented branch (b) as a hypothetical.
  resolved:               2026-08-24. That packet now reads type CLEARED at map:1495-1514, with the
                          search recorded, the amendment named, and branch (b) recorded as taken.
  performed by:           #994 itself, on its own branch. `git log origin/main --
                          docs/governance/williamos-experience-v2-phase0-collision-map.md` puts the
                          retype in 184aaa2b, the #994 merge commit. NOT by this record's lane, and
                          NOT by PR #1001, which edits a different S9 packet
                          (CONT-EXPV2-FIRST-ACTION-IMPLEMENTATION at map:1516+). The pickup line
                          below named "the #994 holder, in #994 or immediately after it merges"
                          first; that is the option that was taken.
  why it was blocked:     the map was the entire content of open PR #994, and a reservation that is
                          blocked is still a reservation (AGENTS.md; precedent 292bb67a, on this
                          same S9 block). The block ended when #994 merged, not when the edit became
                          textually safe -- the two edits never collided, which is why honouring the
                          reservation was a choice and was recorded as one.
  owner:                  none. Closed, and no longer any lane's pickup.
  not:                    an owner decision.
```

## 5. What this record does not claim

- It does not claim the collision map is wrong. It claimed §9's `CONT-EXPV2-FIRST-ACTION` packet
  was **stale** on a point the charter settles, and it named who may fix it. That retype is done:
  #994 performed it on itself in `184aaa2b`, and the packet reads `CLEARED` at `map:1495-1514`.
- It does not claim Gate 2 is unblocked as a whole. #996's lifecycle is **complete** — merged to
  `main` as `2630ee5a` — and the first action is built and merged (#1002 → `1a352a3f`). What
  invariant 13's TERMINAL acceptance still waits on is a live HERMES settlement, tracked as
  `CONT-EXPV2-FIRST-ACTION-RUNTIME-SETTLEMENT`, `WAITING_RESERVATION / 997-migration-complete /
  automatic`.
- It does not claim the action is designed. `CONT-EXPV2-FIRST-ACTION-IMPLEMENTATION` stated the
  constraints the amendment imposes on a build and deliberately chose no verb, because choosing
  one was not this lane's work. The lane that picked the packet up chose it —
  `node.stamp-identity`, in #1002 — after proving absence a second time.
- It does not claim the amendment was inevitable. The search could have found a qualifying action.
  The charter's mandatory-first reuse rule survives the amendment intact, and a later lane that wants
  to build an action must prove absence again, by bounded recorded search, for its own subject.
