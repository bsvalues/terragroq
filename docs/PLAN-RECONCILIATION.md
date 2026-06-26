# Plan Reconciliation — Goal Console (`/goal` + `/loop`)

The original build plan lives at `v0_plans/sharp-spec.md` (a system-managed plan
file). It was written forward-looking and has since diverged from what actually
shipped. This document is the authoritative reconciliation: what shipped, where it
diverged, and where the canonical docs now live. Treat `sharp-spec.md` as a
historical snapshot; treat this file as the truth.

---

## Status

**SHIPPED and hardened.** The Goal Console shipped, then grew beyond the original
5-slice envelope with the governance registers WO-011…020. All divergences below
were intentional.

---

## Divergences from the original plan

| Area | Original plan | What shipped |
| ---- | ------------- | ------------ |
| Classifier file | `lib/goal/classify.ts` | `lib/goal/classifier.ts` (function `classifyGoal`) |
| Modes vocabulary | THINK/PLAN/VERIFY/EXECUTE/RECOVER/HOLD/PUBLIC | `inspect / plan / draft / implement / verify / review / operate` |
| `goal` columns | `statement`, `riskClass`, `authorityRequested`, `crossLaneFlag`; verdict `question/wo_draft/hold/rejected/packet`; status `open/converted/held/rejected/closed` | `command`, `risk`, `authority`; verdict `allow/requires_approval/refuse`; status `classified/converted/dismissed` |
| Mistake patterns | `triggers[]` + `intervention` | `signals: RegExp[]` + `severity` + `guidance` |
| Loop scope | Read/verify only; **execute refused** | Full 6 loop types incl. **governed execute** under `EXECUTE_LOOP_V1` — permitted but **non-mutating**; real mutation returns `ESCALATION_NEEDED` |
| UI components | `components/goal/*` | `components/goal-console/*` (the `goal/*` variants were removed as duplicates) |
| Authority | a "granted" field on the goal/WO | **Durable Authority Grant Registry** (`authority_grant`, WO-011). Approval ≠ authority; the loop engine checks the grant record, not a flag |
| Release stance | "commit locally; do not push until you approve" | Superseded — governed execute loops + authority grants were built, proven by tests, and pushed |

### Shipped beyond the original plan

`truth_claim` (WO-014), `agent_claim` (WO-016), `conflict_record` (WO-018),
`parked_idea` (WO-019, Not-Now Vault), `lock_record` (WO-020), `governance_event`
(append-only, hash-chained), and `evidence_record` with tamper-evidence hashing +
filesystem artifacts (§11).

---

## Canonical documentation

| Topic | Doc |
| ----- | --- |
| System overview, layers, data flow, invariants | [`ARCHITECTURE.md`](ARCHITECTURE.md) |
| Goal Console + classifier | [`reference/goals.md`](reference/goals.md) |
| Work-order lifecycle | [`reference/work-orders.md`](reference/work-orders.md) |
| Authority model + grant registry | [`reference/authority.md`](reference/authority.md) |
| Doctrine | [`reference/doctrine.md`](reference/doctrine.md) |
| Audit, evidence, event log | [`reference/audit.md`](reference/audit.md) |
| Development workflow | [`CONTRIBUTING.md`](CONTRIBUTING.md) |

---

## As-built file map

- **Pure core (`lib/goal/`):** `taxonomy.ts`, `classifier.ts`, `mistake-patterns.ts`, `loop-engine.ts`, `loop.ts`, `current-truth.ts`, `agent-matrix.ts`
- **Governance (`lib/governance/`):** `authority.ts`, `truth.ts`, `conflicts.ts`, `locks.ts`, `agent-claims.ts`, `doctrine-rules.ts`, `execute-guard.ts`, `events.ts`, `artifacts.ts`, `hash.ts`, `refs.ts`
- **Lifecycle:** `lib/work-orders/lifecycle.ts`
- **Server actions (`app/actions/`):** `goals.ts`, `loops.ts`, `work-orders.ts`, `authority.ts`, `evidence.ts`, `truth.ts`, `conflicts.ts`, `locks.ts`, `vault.ts`, `agent-claims.ts`, `doctrine.ts`, `decisions.ts`, `memory.ts`, `documents.ts`, `dashboard.ts`
- **Routes (`app/(shell)/`):** `goal-console`, `work-orders`, `governance`, `decisions`, `doctrine`, `memory`, `corpus`, `audit`, `runtime`, `chat`, `/` (dashboard)
- **Schema:** `lib/db/schema.ts` (applied to Neon via the integration; additive)
- **Tests (`tests/`):** `goal-console.test.ts`, `work-order-lifecycle.test.ts`, `governance.test.ts`
