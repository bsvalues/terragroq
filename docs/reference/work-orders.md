# Reference — Work Orders

A work order (WO) is a governed unit of work: a scoped, approvable contract that
says exactly what may change, how it will be proven, and when to stop.

- **Lifecycle:** `lib/work-orders/lifecycle.ts` (pure)
- **Actions:** `app/actions/work-orders.ts`
- **Table:** `work_order`

---

## The 8-status lifecycle

```
draft ──► proposed ──► approved ──► active ──► review ──► closed
  │           │            │          │  ▲         │
  │           │            │          ▼  │         │
  │           │            │        blocked        │
  └───────────┴────────────┴──────── aborted ◄─────┘
```

`TRANSITIONS` in `lifecycle.ts` is the allow-list. Anything not listed is rejected
by `canTransition(from, to)`:

| From | Allowed to |
| ---- | ---------- |
| `draft` | proposed, aborted |
| `proposed` | approved, draft, aborted |
| `approved` | active, aborted |
| `active` | blocked, review, aborted |
| `blocked` | active, aborted |
| `review` | closed, active, aborted |
| `closed` | — (terminal) |
| `aborted` | — (terminal) |

---

## The WO contract

A work order carries an operator-grade contract (columns on `work_order`):

- `goal`, `scope`, `nonGoals`
- `allowedFiles`, `forbiddenFiles`
- `validators`, `stopConditions`, `acceptanceCriteria`
- `lane`, `phase`, `priority`, `assignee`, `agent`
- `authorityLevel` (requested) + `authorityGrantId` (the durable grant, source of truth)
- Release gates: `commitAllowed`, `tagAllowed`, `pushAllowed` — **default closed**
- Evidence + outcome: `evidence`, `result`, `commitRef`, `tagRef`
- Lineage: `supersedesId`, `supersededById`

---

## Approval-readiness gate (§9.2)

A WO cannot move `proposed → approved` until `checkApprovalReadiness(wo)` passes.
It returns the exact list of what's missing so the UI can show the operator what to
fix. The required preconditions are:

1. Scope is defined.
2. Authority level is declared.
3. Blocked actions / forbidden files are declared.
4. Acceptance criteria exist.
5. A validation method (validators) exists.

`requiresExplicitApproval(authorityLevel)` returns true for any level above A1 —
those always require an explicit operator approval act, never an implicit one.

---

## Actions

| Action | Effect |
| ------ | ------ |
| `getWorkOrders()` | List the user's work orders. |
| `createWorkOrder(input)` | Create a draft WO. |
| `transitionWorkOrder(id, to)` | Validated lifecycle transition (rejects illegal moves and unmet approval readiness). |
| `updateWorkOrderContract(...)` | Edit scope, files, validators, etc. |
| `linkWorkOrderEvidence(id, evidence)` | Attach evidence. |
| `recordWorkOrderResult(...)` | Set PASS/FAIL/PARTIAL and refs. |
| `setWorkOrderGate(...)` | Open/close a release gate (commit/tag/push). |
| `getClosureReport(id)` | Render the operator-grade closure report (`buildClosureReport`). |
| `deleteWorkOrder(id)` | Remove a WO. |

---

## Closure report

`buildClosureReport(wo)` is a pure render of the stored WO: result, identifiers,
allowed/forbidden files, validators, stop conditions, evidence, and the state of
each release gate (gates show `[gate closed]` until explicitly opened). It is the
artifact an operator reviews before considering work done.

---

## Relationship to authority

A work order's `authorityLevel` is a **request**, not a grant. To act above A0 on a
WO, an explicit `authority_grant` must exist and be linked via `authorityGrantId`.
The loop engine checks the grant — not the WO's display field — before permitting a
mutating loop. See [`authority.md`](authority.md).
