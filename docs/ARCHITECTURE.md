# WilliamOS — Architecture

This document describes how WilliamOS is built: its layers, its data model, the
central control flow (goal → classification → loop → work order → evidence →
closure), and the invariants that the whole system depends on.

It is written to match the code as it actually exists. File paths are concrete and
should stay accurate; if you change behavior, update this document in the same slice.

---

## 1. Layers

WilliamOS is a single Next.js 15 App Router application. There is no separate
backend service — server logic runs as React Server Components and Server Actions.

```
┌─────────────────────────────────────────────────────────────┐
│  Client (React 19, SWR)                                       │
│  components/* — console surfaces, forms, panels               │
└───────────────▲─────────────────────────────────────────────┘
                │  Server Actions ("use server")
┌───────────────┴─────────────────────────────────────────────┐
│  Server Actions          app/actions/*.ts                    │
│  - auth-gated (getSession), per-user scoped                  │
│  - the ONLY place the DB is mutated                          │
└───────────────▲─────────────────────────────────────────────┘
                │  imports
┌───────────────┴─────────────────────────────────────────────┐
│  Pure domain logic       lib/goal/*, lib/governance/*,       │
│                          lib/work-orders/*                    │
│  - deterministic, no I/O, fully unit-testable                │
└───────────────▲─────────────────────────────────────────────┘
                │
┌───────────────┴─────────────────────────────────────────────┐
│  Persistence             lib/db/schema.ts (Drizzle) → Neon   │
│  Auth                    lib/auth.ts (Better Auth)           │
└──────────────────────────────────────────────────────────────┘
```

The key architectural rule: **all governance decisions are pure functions in
`lib/`**. Server actions are thin — they authenticate, read inputs, call the pure
core, persist the result, and append an audit event. This is what makes the
behavior testable and deterministic.

---

## 2. Directory map

| Path | Responsibility |
| ---- | -------------- |
| `app/(shell)/` | Authenticated routes. The `layout.tsx` calls `getSession()` and redirects to `/sign-in` if absent. |
| `app/actions/` | Server actions — one file per register (goals, work-orders, authority, doctrine, decisions, memory, evidence, loops, truth, conflicts, locks, vault, agent-claims, documents, dashboard). |
| `lib/goal/` | The Goal Console core: `taxonomy.ts`, `classifier.ts`, `mistake-patterns.ts`, `loop-engine.ts`, `loop.ts`, `current-truth.ts`, `agent-matrix.ts`. |
| `lib/governance/` | Hardening primitives: `authority.ts`, `truth.ts`, `conflicts.ts`, `locks.ts`, `agent-claims.ts`, `doctrine-rules.ts`, `execute-guard.ts`, `events.ts`, `artifacts.ts`, `hash.ts`, `refs.ts`. |
| `lib/work-orders/` | `lifecycle.ts` — the 8-status state machine, approval-readiness gate, closure report. |
| `lib/db/` | `schema.ts` (Drizzle tables + types) and `index.ts` (the `pg` client). |
| `lib/auth.ts`, `lib/session.ts` | Better Auth config and the `getSession()` helper. |
| `components/` | UI. `components/shell/` is the app frame + nav; `components/goal-console/` is the core surface. |
| `tests/` | Vitest suites covering the pure core and the invariants. |
| `docs/` | This documentation set, plus runtime-generated artifacts under `docs/devkit/`. |

---

## 3. The control flow

This is the heart of the system. A raw operator command becomes governed work
through a fixed pipeline.

```
operator command
      │
      ▼
classifyGoal()                         lib/goal/classifier.ts  (pure)
  detect lane  ── LANE_SIGNALS
  detect mode  ── MODE_SIGNALS
  derive authority  ── deriveAuthority(lane, mode)
  match mistake patterns  ── MP-001…MP-010
  check doctrine rules  ── checkDoctrineRules()
  compute risk + verdict
      │
      ▼
verdict ∈ { allow, requires_approval, refuse }
      │
      ├── refuse ──────────────► stop. recommendedMove explains why.
      │
      ├── allow ───────────────► runLoop() read/verify loop, report findings
      │
      └── requires_approval ───► convertGoalToWorkOrder()
                                       │
                                       ▼
                                 Work Order (draft)
                                       │  lifecycle (lib/work-orders/lifecycle.ts)
                                 draft→proposed→approved→active→review→closed
                                       │
                                       │  but approval ≠ authority …
                                       ▼
                                 createAuthorityGrant()  (explicit, durable)
                                       │
                                       ▼
                                 runGovernedLoop(execute)  evaluateLoop()
                                   - requires active grant ≥ requested authority
                                   - requires authorized WO + validators
                                   - EXECUTE_LOOP_V1: records plan, never mutates
                                       │
                                       ▼
                                 recordEvidence()  → evidence_record (+ hash, artifact)
                                       │
                                       ▼
                                 transition → closed, buildClosureReport()
```

Every box that changes state also appends to the audit trail (`event_log` and,
for governance-critical changes, the append-only `governance_event` log).

---

## 4. The taxonomy (single source of truth)

Defined once in `lib/goal/taxonomy.ts` and shared by the engine, actions, and UI.

### Lanes — *what kind* of work (8)

| Lane | Base risk | Meaning |
| ---- | --------- | ------- |
| `docs` | low | Documentation, specs, plans. No runtime behavior. |
| `ui` | low | Client components, pages, styling. No data authority. |
| `read_model` | low | Read-only queries, dashboards, verifiers. |
| `write_model` | medium | Server actions that create/update records. |
| `schema` | high | DB schema changes, migrations, indexes. |
| `auth` | high | Auth, sessions, permissions, secrets. |
| `integration` | medium | Third-party services, external APIs, webhooks. |
| `release` | critical | Commits, tags, pushes, deploys, infra. |

### Modes — *how* it proceeds (7)

`inspect` · `plan` · `draft` · `implement` · `verify` · `review` · `operate`

### Authority — *what the actor may do* (A0–A9)

| Level | Rank | Meaning |
| ----- | ---- | ------- |
| `A0_READ_ONLY` | 0 | Read and report. No writes. |
| `A1_DRAFT` | 1 | Drafts/proposals. Nothing authoritative persisted. |
| `A2_WRITE_OWN` | 2 | Write own records inside an approved WO. |
| `A3_WRITE_SHARED` | 3 | Modify shared registers. Requires approval. |
| `A4_SCHEMA` | 4 | Additive schema changes. Requires approval. |
| `A5_DESTRUCTIVE` | 5 | Deletes / non-additive migrations. Approval each time. |
| `A6_AUTH` | 6 | Auth, sessions, secrets. Approval each time. |
| `A7_COMMIT` | 7 | Local commits. Requires approval. |
| `A8_PUSH` | 8 | Push to remote, open PRs. Requires approval. |
| `A9_RELEASE` | 9 | Tag, deploy, production release. Highest. |

`LANE_MAX_AUTHORITY` caps how high each lane can ever go; `deriveAuthority()`
combines the lane ceiling with the mode (inspect/plan/verify/review never exceed
A0; draft → A1; operate → A7 or A9; implement → the lane ceiling).

---

## 5. Registers (the data model)

All tables live in `lib/db/schema.ts`. Every register carries `userId` and is
scoped per-user in queries. Human-readable refs (e.g. `GOAL-0001`) are generated
via `lib/governance/refs.ts`.

### Operating registers
- **`goal`** — every classified command (lane, mode, risk, authority, verdict, rationale, matched patterns/rules). status: `classified | converted | dismissed`.
- **`work_order`** — governed units of work. 8-status lifecycle, the full WO contract (scope, allowed/forbidden files, validators, stop conditions), authority request + grant link, release gates (`commitAllowed`/`tagAllowed`/`pushAllowed`, default closed).
- **`loop_run`** — every `/loop` iteration with the §8.5 output shape (actions, evidence, findings, blockers, stopReason, nextValidMove).
- **`evidence_record`** — operator-grade evidence per WO (result PASS/FAIL/PARTIAL, repo/branch/head, files changed, validators) plus a tamper-evidence `contentHash` and filesystem `artifactPath`.

### Knowledge registers
- **`decision`** — ADR-style decision register (status + binding/advisory/informational authority, lineage).
- **`doctrine`** — machine-readable operating rules (allowed/forbidden/requiresApproval lists, priority, locked seeds).
- **`memory_fact`** — durable facts with an authority lifecycle and `pgvector` embeddings for recall.
- **`document` / `document_chunk`** — RAG corpus with embedded chunks.

### Governance-hardening registers (WO-011…020)
- **`authority_grant`** — durable grants. *Approval is not authority* — an active, unexpired, unrevoked grant must exist before any A2+ action.
- **`truth_claim`** — Current Truth with freshness/confidence; volatile truth must be rechecked before mutate/commit/push/tag/release.
- **`agent_claim`** — agent assertions, untrusted until evidence-backed.
- **`conflict_record`** — unresolved high-risk conflicts block loops.
- **`lock_record`** — explicit HOLD/STOP/FREEZE locks with a deliberate release protocol.
- **`parked_idea`** — the Not-Now Vault; parked ideas can't create loops without a promoting decision.

### Audit
- **`event_log`** — general activity feed (type, summary, register, refId, metadata).
- **`governance_event`** — append-only, hash-chained log of governance-critical changes (before/after hashes; never updated in place).

---

## 6. The Loop Engine

`lib/goal/loop-engine.ts` is a pure evaluator. Given a loop request and a work
order, `evaluateLoop()` returns the §8.5 outcome and a `permitted` flag.

Loop types and their gates:

| Loop | Mutating | Needs authorized WO | Min authority |
| ---- | -------- | ------------------- | ------------- |
| `read` | no | no | A0 |
| `verify` | no | no | A0 |
| `plan` | no | no | A1 |
| `evidence` | no | yes | A1 |
| `watch` | no | no | A0 |
| `execute` | yes | yes | A2 |

Stop conditions are evaluated in priority order: doctrine conflict → blocking
conflict → missing/unauthorized WO → **missing or insufficient authority grant** →
dirty repo → missing validators → max iterations. The first failure sets
`stopReason`, blocks the loop, and produces the corrective `nextValidMove`.

Critically, even a *permitted* `execute` loop does not mutate. It records a
governed execution iteration under `EXECUTE_LOOP_V1` (see `lib/governance/execute-guard.ts`).
Any action whose text matches a mutation signal returns `ESCALATION_NEEDED`. Real
mutation is performed by the operator under granted authority, then evidenced.

---

## 7. Invariants (must always hold)

1. **Approval ≠ authority.** `evaluateLoop()` blocks any mutating loop without an
   active grant ≥ the requested authority. The WO's `authorityGranted` mirror is
   not sufficient on its own — `authority_grant` is the source of truth.
2. **Execute is non-mutating in V1.** `guardExecuteAction()` returns
   `ESCALATION_NEEDED` for any mutation signal; the engine never shells out.
3. **Determinism.** `classifyGoal()` and `evaluateLoop()` are pure — same input,
   same output. No randomness, no clock-dependence in the decision.
4. **Fail-closed auth.** `app/(shell)/layout.tsx` redirects unauthenticated users.
   Release gates default to closed.
5. **Per-user scoping + audit.** Every register query filters by session user id;
   every state change appends an audit/governance event.

---

## 8. Where to start reading the code

- The product in one file: `lib/goal/classifier.ts`.
- The taxonomy it maps into: `lib/goal/taxonomy.ts`.
- The governance gates: `lib/goal/loop-engine.ts` + `lib/governance/execute-guard.ts`.
- The lifecycle: `lib/work-orders/lifecycle.ts`.
- The orchestration: `app/actions/goals.ts` and `app/actions/loops.ts`.
