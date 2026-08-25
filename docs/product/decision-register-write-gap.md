# The decision register's three unreplaced writes

Status: **OPEN, TYPED, ENFORCED.** Found by the frontend takeover lane while auditing what the six
deleted pages could DO, rather than what they showed. Enforced by
`tests/decision-register-write-gap.test.ts`.

## What happened

Deleting `/decisions` was right, and the commit that did it was careful: it built the replacement
capability first, and it stated what survived — *"Both writes survive: `createDecision` (also used by
`vault.ts` on the governed path) and `supersedeDecision`, which had no caller left until the Line
became one."*

Both of those claims are true. They are also incomplete. `components/decisions/decisions-view.tsx`
wired **six** governed writes, not two, and only two were migrated to the Line:

| write | had UI at `/decisions` | replaced by |
| --- | --- | --- |
| `createDecision` | yes | **the Line** — `record a decision: <what> because <why>` |
| `supersedeDecision` | yes | **the Line** — `record a decision superseding DECISION-0007: …` |
| `updateDecisionStatus` | yes — accept / reject a proposal | **nothing** |
| `setDecisionAuthority` | yes — binding / advisory / info | **nothing** |
| `linkEvidence` | yes — attach evidence to a decision | **nothing** |
| `deleteDecision` | yes | **nothing, deliberately** — a governed register does not offer a delete button |

## What is and is not lost

Nothing is broken and nothing is unsafe. The three actions are intact in `app/actions/decisions.ts`,
and their protection guards are intact and still tested — `tests/runtime-finding-decision-action-guard.test.ts`
and `tests/v1-2-campaign-authority-actions.test.ts` both still assert that a protected runtime finding
cannot be rejected and that a protected v1.2 authority scope refuses.

What is lost is the SURFACE. Since `/decisions` was deleted there is no way, anywhere in the product,
for the owner to accept or reject a proposed decision, set a decision's authority, or attach evidence
to one. The register can be read, recorded to, and superseded; it cannot be adjudicated.

`setDecisionAuthority` is the least of the three, and arguably should not come back as a dropdown at
all: the Line deliberately records decisions as PROPOSED and ADVISORY because *"binding authority is
minted by the governed authorization path with evidence behind it, and a typed sentence is not that."*
A menu that flips a decision to binding was the same shortcut wearing a different control. Whatever
replaces it belongs on the authorization path, not on a surface.

`updateDecisionStatus` is the one that matters. Accepting or rejecting a proposal is the act that
makes a register a register rather than a pile of notes, and it currently has no door.

## Why it was typed here rather than closed here

Closing it means a third Line classifier beside `classifyDecisionRecord` and
`classifySupersedingDecision` — `accept DECISION-0007`, `reject DECISION-0007: <reason>` — and an
accept is a governed write with authority consequences. The record path earned its safety with an
explicit leading trigger, a hard refusal on anything interrogative, negated or hypothetical, and 26
test cases covering every "wondering aloud" form. *"Should we accept DECISION-0007?"* must never
accept DECISION-0007.

Building that at the end of a single-attempt landing, without the same care, is how a shortcut ships.
The gap is smaller than the risk of closing it badly, so it is named, enforced, and handed to the
successor as its first item rather than rushed.

## The rule this places on the next lane

`tests/decision-register-write-gap.test.ts` fails if this ledger drifts from the code: if one of the
three named actions disappears from `app/actions/decisions.ts` (removed rather than replaced), or if
one of them gains a caller in the environment without its row here being updated. Update the ledger
by building the door, not by editing the row.
