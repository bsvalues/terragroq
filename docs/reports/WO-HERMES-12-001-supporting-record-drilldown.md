# WO-HERMES-12-001 — Supporting-record drill-down

`RESULT: READY_FOR_VALIDATION`

## Owner outcome

Goal Console outcome rows show linked Goal, Work Order, Evidence, Trace, and Audit records only when
their durable references exist. The links remain read-only and lead to the corresponding persisted
record surfaces.

## Bounded remediation

- `components/outcome-queue/supporting-record-links.ts` projects the five record categories from an
  exact Goal timeline and the outcome row's durable bindings.
- Goal identity matching rejects a conflicting display reference and duplicate timeline projections.
- A conflicting Work Order binding prevents timeline Evidence, Trace, and Audit records from being
  borrowed while preserving the row's own durable Work Order reference.
- A valid Goal database ID remains linkable when its optional display reference is absent.
- A terminal Evidence database ID remains visible alongside other Evidence references unless the
  exact timeline record already represents it with a non-empty display reference.
- Evidence references are trimmed before empty filtering and deduplication, so padded duplicates
  collapse to one durable reference and whitespace-only values do not create a record category.
- Evidence, Trace, and Audit references now carry individual record-specific links. Their target
  pages perform one bounded, current-user lookup and render the canonical durable ID; ambiguous or
  unavailable records fail closed without substituting a nearby record.
- Trace links are limited to persisted runtime checkpoints and failure evaluations, the two event
  types rendered by the Trace ledger. Lease, terminal, and recovery references are not advertised
  as Trace destinations the ledger cannot resolve.
- Goal Console consumes `?goal=` only when the requested ID changes. A server refresh updates the
  selected Goal object without replacing a later user selection with the original deep link. The
  guard is cleared when the requested Goal is unavailable, so `A -> B -> unavailable -> A`
  correctly reapplies A instead of leaving the guard stuck, and a still-requested Goal can apply if
  it later becomes available.
- Missing queue Goal timelines are capped at 50 per request and loaded sequentially in batches of
  25, bounding both total enrichment work and concurrent database fan-out. Active and next-eligible
  Goals are selected first, followed by other nonterminal Goals and then terminal history, with
  queue order preserved within each group. A failed batch contributes no projections, does not stop
  later batches, and marks every Goal in that batch unavailable. Rows beyond the selected window
  visibly report deferred supporting-record coverage and state that missing links are not evidence
  of no records; attempted Goal reads that return no exact projection report unavailable coverage.
- Evidence deduplication uses the record-specific href as canonical identity. When one display ref
  maps to multiple canonical Evidence records, that ambiguous display ref is omitted rather than
  silently collapsing to whichever record appeared first. A separately recorded canonical terminal
  Evidence ID remains linkable even when its display alias is ambiguous.
- Repeated or conflicting Evidence, Trace, and Audit query parameters fail closed. Only an absent,
  scalar, or single-element parameter can resolve an exact record read.
- Outcome-row projection indexes timelines once by Goal ID, retaining duplicate candidates for the
  existing fail-closed identity check while avoiding a full timeline scan for every rendered row.
- Supporting-record tooltips use human-readable category names, including `work order`, rather than
  exposing enum spellings such as `work_order`.
- Goal deep-link parsing is a directly tested pure helper. It accepts one canonical positive safe
  integer (including a single-element query array) and rejects empty, fractional, non-canonical,
  unsafe, repeated, or conflicting values.
- `tests/outcome-queue-supporting-record-links.test.ts` covers exact projection, omission, identity and
  Work Order conflicts, duplicate projections, Goal-ID fallback, terminal Evidence retention, and
  Evidence normalization, canonical-ID/display-alias collisions, multi-valued parser rejection,
  Goal-index duplicate retention, exact destinations, and unsupported Trace-event omission.
- `tests/goal-console-outcome-record-drilldown.test.ts` exercises the timeline cap and sequential
  loader with more than 25 and more than 50 Goal IDs, proves a live Goal following 51 terminal rows
  is still selected, and proves one failed batch does not discard a later successful batch while all
  failed-batch IDs become unavailable. It also renders the row-51 coverage boundary, exercises the
  deep-link request sequence and query parser, and records the exact-read and indexed-render
  contracts.

## Independent file review

The post-review remediation received a direct file-only consistency and safety review. No remaining
file-level defect was found in the reserved-path changes:

- `app/(shell)/goal-console/page.tsx` fills at most 50 missing queue timelines in sequential batches
  of at most 25, prioritizes operationally live/nonterminal rows over retained terminal history,
  isolates individual batch failures, and passes the requested Goal ID into the Goal Console view.
- `components/outcome-queue/operator-outcome-queue-panel.tsx` renders the labelled record navigation
  only when at least one projected record exists, links each resolvable durable reference, and shows
  explicit deferred/unavailable coverage without implying that uncovered records do not exist.
- Goal and Work Order destinations expose stable anchors; every named Evidence, Trace, and Audit
  record has its own encoded query and anchor backed by an exact current-user read.
- The projector preserves record order, removes duplicate references, and omits empty categories.
- The supporting-record drill-down adds no command execution, mutation control, credential handling,
  production action, or blocked product/data integration; existing governed controls in surrounding
  views are unchanged.

## Native-host validation state

Hermes subsequently completed native validation, commit, push, PR creation, and review monitoring.
The review identified four valid product findings: refreshes could restore the original deep-linked
Goal, aggregate Evidence and Trace links could miss named records, unsupported Trace event types were
advertised, and timeline batches were launched without a total-work or concurrency bound. This
bounded remediation addresses each finding and adds the behavioral/static contracts described above.

A later assurance pass rejected four edge cases in that remediation: silent row coverage after the
50-Goal cap, display-ref Evidence deduplication, an unavailable deep-link request sequence, and
multi-valued exact-record query parameters. The current handoff explicitly covers and tests all four.

The expanded review also raised page-prop typing, per-row timeline scan cost, enum-shaped tooltip
copy, and untested Goal query parsing. Timeline indexing, tooltip copy, and parser coverage were
valid and are remediated above. The page-prop change was not applied: this repository's Next 15 app
router pages use the asynchronous `searchParams: Promise<...>` contract, so replacing it with the
legacy object shape or a union would create rather than remove generated Page-prop type risk.

No validator, interpreter, package manager, Git command, or runtime-operator path was invoked in this
review-remediation lane. Focused tests, lint, the full test suite, and build remain Hermes native-host
gates for the resulting file handoff.

The first focused native-host rerun passed all 17 supporting-record link tests but could not import
the rendered coverage fixture because Vite import analysis received preserved JSX from the directly
imported TSX module. The coverage component now emits the same markup through `createElement`, keeping
the behavioral rendered-boundary proof while removing preserved JSX from that focused import path.

The latest exact-head review found that terminal history could consume all 50 enrichment slots and
that one rejected timeline batch could fail the entire Goal Console request. The current handoff
prioritizes active, next-eligible, and other nonterminal rows before terminal history; isolates each
batch failure; preserves successful batches; and explicitly classifies every failed-batch Goal as
unavailable. Behavioral coverage includes a live Goal after 51 terminal rows and a failed first batch
followed by a successful second batch. These changes received direct file review; native validation
was intentionally not run in this bounded lane.

## Safety and handoff

- Reserved paths only.
- Read-only product projection and navigation only.
- No blocked scope crossed.
- No owner operation or contact.
- No review threads remain.
- Commit, pull request, and merge metadata remain unset for Hermes continuation.
