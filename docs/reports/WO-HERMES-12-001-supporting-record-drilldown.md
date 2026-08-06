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
- `tests/outcome-queue-supporting-record-links.test.ts` covers exact projection, omission, identity and
  Work Order conflicts, duplicate projections, Goal-ID fallback, terminal Evidence retention, and
  Evidence normalization and deduplication.

## Independent file review

Independent assurance found one Important whitespace-normalization issue and one Minor report-wording
issue. Both were corrected, and bounded re-review returned `READY` with no remaining file-level defect:

- `app/(shell)/goal-console/page.tsx` fills missing queue timelines in batches of at most 25 and passes
  the requested Goal ID into the Goal Console view.
- `components/outcome-queue/operator-outcome-queue-panel.tsx` renders the labelled record navigation
  only when at least one projected record exists and lists each durable reference.
- Goal, Work Order, Evidence, Trace, and Audit destinations expose the anchors used by the projection.
- The projector preserves record order, removes duplicate references, and omits empty categories.
- The supporting-record drill-down adds no command execution, mutation control, credential handling,
  production action, or blocked product/data integration; existing governed controls in surrounding
  views are unchanged.

## Native-host validation state

The latest native-host retry again did not collect either test file:

```text
npx vitest run tests/goal-console-outcome-record-drilldown.test.ts tests/outcome-queue-supporting-record-links.test.ts
'vitest' is not recognized as an internal or external command,
operable program or batch file.
```

The repeated output is not assertion evidence and cannot be repaired by changing the two test files
or their reserved implementation paths.

The subsequent native-host lint attempt also stopped before evaluating repository source:

```text
npm run lint
Failed to load plugin 'react-hooks' declared in eslint-config-next/core-web-vitals:
Cannot find module 'eslint-plugin-react-hooks'
```

The supplied diagnostic resolved `eslint-config-next` from an unrelated `runtime-acceptance`
dependency tree. That host dependency-resolution failure is not a lint finding in this Work Order and
cannot be repaired inside the reserved product, test, or report paths. No validator, interpreter,
package manager, Git command, or runtime-operator path was invoked in the bounded remediation lane.
Focused tests, lint, the full test suite, and build remain native-host gates after repository-local
validation tooling is available and isolated to this worktree.

The later full-suite attempt reached repository assertions and exposed one stale static contract in
`tests/goal-console-timeline-surface.test.ts`. That test still required the original
`timelines={timelines}` prop even though the bounded queue-completeness implementation intentionally
passes `timelines={supportingTimelines}` to include queue Goals beyond the default timeline window.
The expectation now matches the implemented contract and the focused drill-down suite. A reserved-path
search found no remaining `timelines={timelines}` expectation.

## Safety and handoff

- Reserved paths only.
- Read-only product projection and navigation only.
- No blocked scope crossed.
- No owner operation or contact.
- No review threads remain.
- Commit, pull request, and merge metadata remain unset for Hermes continuation.
