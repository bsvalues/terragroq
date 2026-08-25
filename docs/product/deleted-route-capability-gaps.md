# What the deleted routes could do that the environment cannot do yet

Status: **OPEN, TYPED, ENFORCED.** Found by the independent codex assurance review of PR #1011 and
confirmed by execution by the cutover-finish lane. Enforced by
`tests/deleted-route-capability-gaps.test.ts`.

This is the companion to `docs/product/decision-register-write-gap.md`. That ledger names governed
WRITES that lost their surface. This one names READS and behaviours that lost theirs, so that the
same question — *what could the deleted page DO?* — has one answer per capability instead of a commit
message somebody has to remember.

Everything here follows the same rule: **the capability is alive in code and has no door in the
product.** Nothing listed is broken, unsafe, or deleted. What is gone is the way to reach it.

Four findings from the same review were *not* typed — they were fixed on this branch, with
regression tests, because they were outright broken behaviour rather than missing behaviour: the
unrendered `work-orders` surface, the supersession reference format, the supersession authority
claim, and the summon that stole the canonical current-work question.

---

## 1. `/chat`'s governed retrieval and its source citations

| what | where |
| --- | --- |
| capability | doctrine + decision + Memory + Corpus retrieval, with visible per-claim citations |
| alive at | `app/api/chat/route.ts` |
| door was | `app/(shell)/chat/page.tsx` → `components/chat/operator-chat.tsx` (both deleted) |
| door now | **none** — `/chat` redirects to `/`, and nothing in the product calls `/api/chat` |

`/chat` was replaced by the Line, and conversation genuinely survives: `/chat` reaches `/`, and the
Line answers. What did not survive is the part that made that page a *governed* chat rather than a
chat box. `app/api/chat/route.ts` retrieves active doctrine, active decisions, Memory and Corpus for
every message, instructs the model to *"Answer ONLY from retrieved context and doctrine"* and to
*"Cite every claim drawn from context"*, and returns the sources as message metadata so the operator
can see what an answer rested on.

The Line's `converse()` carries `groundingFacts()` — the real identity and the real project register —
and nothing else. That is a real second grounding layer and it is why the Line does not hallucinate
projects. It is not retrieval, and it emits no citations.

**Why it is typed and not closed here:** wiring retrieval into `converse()` is not a redirect, it is
the Line's answer model. It changes what every ordinary sentence costs, what it is allowed to say,
and what the reply must show alongside it. Grafting the four reads onto a 400-token conversational
call at the end of a landing produces a slower Line that cites nothing visible, which is worse than
the honest gap.

## 2. `/trace`'s static Trace Ledger

| what | where |
| --- | --- |
| capability | static reasoning records, failure classifications, evidence-gap classifications, confidence movement, eval candidates |
| alive at | `components/trace/trace-ledger-registry.ts` — `getTraceLedgerSurface()`, `TRACE_RECORDS` |
| door was | `components/trace/trace-ledger-panel.tsx` (deleted) |
| door now | **none** — `getTraceLedgerSurface()` has test callers only |

`/trace` was a composite page: persisted runtime execution truth **and** an explicitly historical,
static Trace Ledger. Only the runtime half became a surface. `/trace` now redirects to
`/?summon=runtime-trace`, which is the correct destination for the runtime half and the wrong one for
the other.

This is visible to the operator as a *mislabelled* door, not just a missing one. Six navigation
registries still advertise the address with the static ledger's description, and they are now wrong
about where it goes:

- `components/academy/academy-wiki-registry.ts` — *"Review reasoning records and failure-to-eval proposals."*
- `components/agent-forge/agent-forge-surface.ts` — *"Review reasoning and failure-to-eval records."*
- `components/hermes/hermes-boundary-registry.ts` — *"Review reasoning history and failure-to-eval proposals."*
- `components/brain-council/council-advisory-surface.ts` — *"Static proof history, evidence gaps, and eval candidates."*
- `components/operator/codex-operator-surface.ts` — *"Review reasoning and failure history."*
- `components/workbench/supporting-capabilities.ts` — `Trace`

## 3. `/trace`'s exact durable-record addressing

| what | where |
| --- | --- |
| capability | open ONE durable trace record by reference, scrolled to it |
| link generators alive at | `lib/workbench/execution-projection.ts`, `lib/workbench/load-threads.ts` |
| door was | `app/(shell)/trace/durable-trace-query.ts` + `components/trace/durable-trace-record-panel.tsx` (both deleted) |
| door now | **none** — the reference arrives and is discarded |

Two modules still mint `EXACT` deep links of the form
`/trace?trace=<reference>#trace-record-trace-<id>`. Probed against the standalone build of
`afbfa3dc`, the reference survives the redirect intact:

```
GET /trace?trace=TRACE-0007
308 -> /?trace=TRACE-0007&summon=runtime-trace
```

Nothing at `/` reads a `trace` parameter, and no element carries a `trace-record-…` id, so a link
that used to open one exact record now opens the whole runtime-execution list. The good news is in
that probe: because the reference still arrives, closing this gap later needs a reader at `/`, not a
change to any of the links that point at it.

`getDurableTraceRecord` was **deleted** here rather than left doorless, and unlike the release gates
in section 5 it is deliberately not restored. It was a 41-line exact-match query over `TRACE_RECORDS`
living inside the deleted route's own directory; the data it queried survives, nothing else in the
system reads a value it wrote, and so nothing froze when it went. Rebuilding it belongs with the
surface that would call it.

**Why 2 and 3 are typed and not closed here:** both need a surface that does not exist — a static
ledger surface and a single-record surface — plus a summon that carries a *reference*, which no
summon does today (`?summon=` carries a surface name and nothing else). That is the next phase of the
same migration, not a redirect fix.

## 4. The world is not restored on reload

| what | where |
| --- | --- |
| capability | come back to the conversation and surfaces you had |
| alive at | `workingWorld` rows — every world is validated, snapshotted and persisted |
| door now | **none** — the client never sends a saved `worldId` back |

`components/desk/desk.tsx` holds `worldId` in React state only. On arrival it posts
`{ worldId: null }`, which is the new-world sentinel, so:

- a **sentence**-summoned surface and the whole transcript are gone after a reload;
- an **address**-summoned surface comes back — the redirect re-summons it — but as a *new* world,
  inserting another `workingWorld` row each time rather than restoring the saved one.

Nothing is lost from the database; the worlds are all there and readable. What is missing is the way
back into one.

**Why it is typed and not closed here:** restoration is a product decision before it is code. Which
world does an operator return to — the last one on this device, the last one anywhere, or the one
they were sent a link to? A wrong answer silently resurrects stale work in front of them, which is
worse than an honest blank Line. It also needs a reply shape the route does not have: today a reply
carries the surfaces of the *current* action, not the world's accumulated turns and surfaces.

## 5. `/work-orders`'s release gates and closure result — deleted, then restored

| what | where |
| --- | --- |
| capability | open/close the commit, tag and push release gates; record a work order's PASS/FAIL/PARTIAL result |
| alive at | `app/actions/work-orders.ts` — `setWorkOrderGate`, `recordWorkOrderResult`, `deleteWorkOrder` |
| door was | `components/work-orders/work-orders-view.tsx` (deleted) |
| door now | **none** |

This one was not a missing door. Deleting `/work-orders` deleted the three actions themselves —
69 lines out of `app/actions/work-orders.ts` — which is a different and worse thing, and it is
undone. They are restored intact on this branch and left doorless.

The reason it matters more than the other four: `commitAllowed`, `tagAllowed` and `pushAllowed` are
**live governance inputs, not page state.** They are columns on `workOrder`; they travel in the
delivery authority contract that `lib/workbench/outcome-execution-authorization.ts` emits; the Hermes
bridge orchestrator and CLI consume them; `lib/work-orders/lifecycle.ts` prints whether each gate is
open. `setWorkOrderGate` was the only writer. With it gone, every gate was frozen at whatever value
its row already held — permanently, for every work order, with no error anywhere — and
`recordWorkOrderResult`, the function that enforces *"commit/tag refs may only be recorded when their
gate has been opened"*, went with it.

`revalidatePath("/work-orders")` is deliberately **not** restored on any of the three: that route no
longer exists.

This is the rule the decision register's ledger already stated, applied to the register next door:
*"Removing them would turn 'no surface reaches this' into 'this no longer exists', and the protection
guards would go with them."* A doorless capability is a gap. A deleted one is a loss.

`createWorkOrder`, `transitionWorkOrder`, `updateWorkOrderContract`, `linkWorkOrderEvidence`,
`runGovernedLoop` and `getClosureReport` were never deleted. The first two still have governed
callers (`app/actions/goals.ts`, `app/actions/vault.ts`, `app/api/objective/route.ts`,
`app/api/governance/workroom-authority/route.ts`); the rest are doorless and listed here for the same
reason.

---

## The rule this places on the next lane

`tests/deleted-route-capability-gaps.test.ts` fails if this ledger drifts from the code:

- if a capability listed as alive is **deleted** rather than replaced — the row claims it is
  recoverable, and it would no longer be;
- if a capability listed as doorless **gains a door** without its row moving out of this ledger — the
  quieter and more likely rot, because that is how the first gap survived a green suite.

Update the ledger by building the door, not by editing the row.
