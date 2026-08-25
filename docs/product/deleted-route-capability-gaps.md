# What the deleted routes could do that the environment cannot do yet

Status: **OPEN, TYPED, ENFORCED.** Sections 1–6 were found by the independent codex assurance review
of PR #1011 and confirmed by execution by the cutover-finish lane. Section 7 was found afterwards, by
the finisher-resume lane re-auditing every deleted page against what it actually mounted, because the
merge boundary refused to treat "all ten review threads resolved" as proof that the capability audit
was complete. It was right to: the review did not raise section 7, and section 6 had already caught
the same class of miss once. Enforced by `tests/deleted-route-capability-gaps.test.ts`.

This is the companion to `docs/product/decision-register-write-gap.md`. That ledger names governed
WRITES that lost their surface. This one names READS and behaviours that lost theirs, so that the
same question — *what could the deleted page DO?* — has one answer per capability instead of a commit
message somebody has to remember.

Most entries follow the same rule: **the capability is alive in code and has no door in the
product.** Section 6 records mixed survival: both decision-queue models and all three panels were
deleted, while the correction taxonomy/model survives as a read-only, doorless description. Section 7
is the same shape: the projections were deleted outright, and what survives is the governed records
they read plus the arithmetic over them. In every case, what is gone is a product door; the ledger
does not claim the deleted models still exist.

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

The page's other mount, `components/chat/operator-chat-native-area.ts` + its panel, went too. It is
named here to close the audit rather than as a claimed loss: it was a static description of the
retired page's own posture, command sections, authority boundaries and suggested phrasings. It
described `/chat`; deleting the page is what made it moot. With it, every file this landing deleted is
accounted for in this ledger — as a gap, as a deliberate retirement, or as page-scaffolding that had
nothing to migrate.

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

## 4. The world is restored on reload — closed by #1015

| what | where |
| --- | --- |
| capability | come back to the conversation and surfaces you had |
| alive at | `workingWorld` rows — every world is validated, snapshotted and persisted |
| door now | `/api/environment/space` — owner-bound latest/exact TerraFusion world |

`components/workspace-shell/workspace-shell.tsx` now opens the owner-bound Space through
`/api/environment/space`, restores its server-persisted world id, windows, files, panes, selection,
focus and canonical spine, and only then handles an addressed summon. The server selects only an
owned TerraFusion world; it never falls back to another working world, and creates a dedicated world
when none exists. Reconstructable summoned Inspectors persist identity and reacquire governed payload
on restoration. Payload-only browser/trace/diff surfaces remain explicitly transient.

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

## 6. `/decisions`'s pending queues and correction inspection

| what | where |
| --- | --- |
| capability | review pending owner decisions, inspect blocked-decision evidence needs, and inspect the correction-candidate taxonomy |
| deleted | owner-decision queue model + `OwnerDecisionQueuePanel`; blocked-decision queue projection + `BlockedDecisionQueuePanel`; `DecisionCorrectionCapturePanel` |
| survives | only `components/dogfood/decision-correction-capture.ts`, a read-only model (`readOnlySurface: true`, `writesMemory: false`, `backgroundExtraction: false`) with no product caller |
| door now | **none** |
| continuation | **Continuation: #1012** — bounded Environment surfaces, after #1011; not W1 #1015 and not smuggled into stacked PR #1018 |

The earlier decision audit counted the six writes wired by `DecisionsView`; it did not count the
three sibling surfaces mounted above that view. As a result, `docs/product/decision-register-write-gap.md`
correctly typed accept/reject, authority and evidence writes, but did not name the lost
owner-decision queue, blocked-decision queue, or decision-correction inspection capability.

This is a real capability loss, not a reason to resurrect `/decisions` as a page. The replacement
belongs inside the Environment as summoned/contextual surfaces. The two deleted queue projections
must be rebuilt from the governed records that remain; the correction model is only an inspection
taxonomy and must not be represented as an input or write path. #1015 is narrowly the editable
workspace and #1016 is the agent workspace; the
umbrella acceptance issue #1012 is therefore the named successor until it dispatches a bounded child.
Closing this row requires that child and an operable Environment door, not merely restoring the old
panels or deleting this paragraph.

## 7. `/work-orders`'s triage, search and closure projections

| what | where |
| --- | --- |
| capability | see what is MOVING, what explicitly FAILED, and what Hermes should do NEXT; find one work order among many by query or facet; read closure reports with their owner-operation evidence |
| deleted | `active-work-queue.ts` + `ActiveWorkQueuePanel`; `work-order-search-filter.ts` (`filterWorkOrders`, `getWorkOrderFilterOptions`, `getDistinctWorkOrderFilterValues`); `completion-report-surface.ts` + `CompletionReportPanel`; `woe-detail-surface.ts` + `WoeDetailSurfacePanel`; `work-orders-command-surface.ts` + `WorkOrdersCommandPanel` |
| survives | the governed records and the arithmetic over them — `getWorkOrders`, `WO_STATUSES`, `buildClosureReport`, `evaluateOwnerOperationEvidence` |
| door now | **none** — `/work-orders` reaches a flat list |
| continuation | **Continuation: #1012** |

Section 5 audited `app/actions/work-orders.ts` and found the deleted WRITES. It did not count the
four sibling surfaces mounted *above* `WorkOrdersView` on the same deleted page — which is precisely
the error section 6 records for `/decisions`, committed a second time in the register next door. The
deleted page mounted six things; section 5 accounts for the writes inside one of them.

What the environment offers at that address is `getWorkOrders()` projected to five fields — `ref`,
`title`, `status`, `agent`, `phase`. That is a faithful register and it is not the triage surface.
Three questions the deleted page answered cannot be asked of it:

- **"what failed?"** — `result` is not in the projection at all, so the one field that distinguishes
  an explicit `FAIL` from an ordinary status never reaches the surface. `getActiveWorkQueueSurface`
  computed a failure lane from `result`, the recorded stop condition, and evidence presence.
- **"what is next?"** — the `hermesNext` lane ordered `approved`/`active`/`blocked`/`review` by
  recency with the next governed action named per row. The flat list has no order beyond newest-first
  and no action.
- **"where is the one I mean?"** — `filterWorkOrders` matched a query across ref, title, goal, scope,
  lane, phase, priority, authority, result, evidence, validators and stop conditions, with nine
  additional facets. There is no search on the register at all.

**Not part of this gap, checked by execution rather than assumed:** the deleted page also mounted
`OperatorOutcomeQueuePanel` over `getOutcomeQueueSurface()`. Both survive with real doors —
`/goal-console`, `/runtime`, and the environment's own `queue` summon — so "what is next" in the
*outcome* sense did migrate. Recorded here so the next lane does not re-audit it.

Two of the five deleted modules are named above for honesty about what was removed, not as claimed
losses: `getWoeDetailSurface` and `getWorkOrdersCommandSurface` were largely static descriptions of
the retired page's own posture, safety badges and phase rollup. They described `/work-orders`;
deleting the page is what made them moot. `work-order-draft-guidance`, `work-order-draft-packet` and
`work-order-empty-state` went with the work-order **write UI**, which this landing retired
deliberately — that is a decision, not a gap.

**Why it is typed and not closed here:** the triage lanes and the search are a surface that does not
exist, exactly as in sections 2, 3 and 6 — the environment summons *a register*, and a register with
lanes, ordering and a query is a different surface with its own product decisions (which lane leads,
what "next" means when Hermes disagrees with the queue). Bolting a filter onto the flat list at the
end of a landing produces a search box over five fields, which answers none of the three questions
above while looking as though it did. The records are all intact, so the successor rebuilds from
governed state and not from the deleted panels.

---

## The rule this places on the next lane

`tests/deleted-route-capability-gaps.test.ts` fails if this ledger drifts from the code:

- if a capability listed as alive is **deleted** rather than replaced — the row claims it is
  recoverable, and it would no longer be;
- if a capability listed as doorless **gains a door** without its row moving out of this ledger — the
  quieter and more likely rot, because that is how the first gap survived a green suite.

Update the ledger by building the door, not by editing the row.
