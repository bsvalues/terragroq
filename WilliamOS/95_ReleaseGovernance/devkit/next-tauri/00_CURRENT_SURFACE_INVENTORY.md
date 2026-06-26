# 00 — Current Surface Inventory

**Work Order:** WO-WILLIAMOS-NEXT-TAURI-ARCH-001
**Lane:** A — Architecture docs only
**Status:** DRAFT
**Baseline:** WilliamOS v1.3.1 local hardening baseline
**Phase 6:** BLOCKED (unchanged)

---

## 0. Reality Check (read this first)

This work order was written against the **full WilliamOS monorepo** layout
(`control-center/backend` FastAPI + `control-center/frontend` Vite + Python
control plane). **That layout is not present in this repository.**

This repository (`bsvalues/terragroq`) **is the realized Next.js operator
shell** — i.e. the "future state" that Tasks 3–4 of this WO describe. It already
contains the operator routes, server actions, governance registers, auth, and
the AI Gateway runtime adapter.

Therefore this inventory is split into two honest sections:

- **§1 — This repo (authoritative, verified by file read).** The Next.js shell
  that exists today, file-by-file.
- **§2 — Broader WilliamOS baseline (referenced, not in this tree).** The Python
  control plane and Vite Control Center described by the WO, documented as the
  migration *source* for completeness. Nothing here was read from disk; it is
  carried forward from the WO and prior baselines and is marked `[REFERENCED]`.

No code was changed to produce this document.

---

## 1. This Repo — Next.js Operator Shell (verified)

### 1.1 Framework / runtime posture

| Concern | Current state |
| --- | --- |
| Framework | Next.js (App Router) |
| Language | TypeScript / React |
| Styling | Tailwind v4, shadcn/ui |
| Database | Neon Postgres (`@/lib/db`, Drizzle ORM) |
| Vector recall | pgvector, 1536-dim embeddings |
| Auth | Better Auth (email + password), `app/api/auth/[...all]` |
| AI runtime | Vercel AI Gateway (explicit model strings, no fallback) |
| Chat model | `openai/gpt-5-mini` |
| Embedding model | `openai/text-embedding-3-small` (1536d) |

### 1.2 Operator routes (`app/`)

| Route | File | Purpose |
| --- | --- | --- |
| `/` | `app/(shell)/page.tsx` | Overview / command dashboard |
| `/chat` | `app/(shell)/chat/page.tsx` | Operator Chat (governed RAG) |
| `/memory` | `app/(shell)/memory/page.tsx` | Memory governance (authority lifecycle) |
| `/decisions` | `app/(shell)/decisions/page.tsx` | Decision Register (ADR-style) |
| `/doctrine` | `app/(shell)/doctrine/page.tsx` | Doctrine Registry (machine-readable rules) |
| `/work-orders` | `app/(shell)/work-orders/page.tsx` | Work Orders |
| `/corpus` | `app/(shell)/corpus/page.tsx` | Document corpus / ingestion |
| `/audit` | `app/(shell)/audit/page.tsx` | Audit log / event history |
| `/sign-in` | `app/sign-in/page.tsx` | Auth |
| `/sign-up` | `app/sign-up/page.tsx` | Auth |

Shell chrome: `components/shell/` — `app-shell.tsx`, `sidebar-nav.tsx`,
`mobile-nav.tsx`, `nav-items.ts`, `page-header.tsx`, `user-menu.tsx`.

### 1.3 Navigation groups (`components/shell/nav-items.ts`)

- **Command:** Overview (`/`), Operator Chat (`/chat`)
- **Registers:** Memory, Decisions, Doctrine, Work Orders
- **Knowledge:** Corpus, Audit Log

### 1.4 Server actions (`app/actions/`)

| File | Exposed operations |
| --- | --- |
| `dashboard.ts` | `getDashboardData` |
| `memory.ts` | `getMemoryFacts`, `createMemoryFact`, `updateMemoryFact`, `reviewMemoryFact`, `promoteToCanon`, `demoteFromCanon`, `setMemoryStale`, `archiveMemoryFact`, `togglePinMemory`, `deleteMemoryFact`, `exportMemory`, `searchMemory` |
| `decisions.ts` | `getDecisions`, `searchDecisions`, `getActiveDecisions`, `createDecision`, `updateDecisionStatus`, `setDecisionAuthority`, `linkEvidence`, `supersedeDecision`, `deleteDecision`, `seedGovernanceDecisions` |
| `doctrine.ts` | `getDoctrine`, `getActiveDoctrine`, `searchDoctrine`, `createDoctrine`, `toggleDoctrine`, `linkDoctrineEvidence`, `supersedeDoctrine`, `deleteDoctrine`, `validateAction`, `seedGovernanceDoctrine` |
| `documents.ts` | `getDocuments`, `ingestDocument`, `deleteDocument`, `searchCorpus` |
| `work-orders.ts` | `getWorkOrders`, `createWorkOrder`, `updateWorkOrderStatus`, `deleteWorkOrder` |

### 1.5 HTTP route handlers (`app/api/`)

| Endpoint | File | Purpose |
| --- | --- | --- |
| `POST /api/chat` | `app/api/chat/route.ts` | Governed chat: injects doctrine + active decisions + RAG context; `maxDuration = 30` |
| `ALL /api/auth/[...all]` | `app/api/auth/[...all]/route.ts` | Better Auth handler |

### 1.6 Libraries (`lib/`)

| File | Responsibility |
| --- | --- |
| `db/index.ts`, `db/schema.ts` | Neon pool + Drizzle schema (memory_fact, decision, doctrine, work_order, document, event, auth tables) |
| `ai/config.ts` | Model registry + runtime provenance (`RUNTIME`) |
| `ai/embeddings.ts` | Embedding generation |
| `auth.ts`, `auth-client.ts`, `session.ts` | Auth + `getUserId()` scoping |
| `registers/events.ts` | `logEvent()` audit trail helper |
| `hooks/use-scroll-to-bottom.tsx`, `utils.ts` | UI utilities |

### 1.7 Governance surfaces present today

- **Memory governance:** authority lifecycle (intake → unreviewed → working →
  reviewed → canon → deprecated/superseded/archived), stale flag, evidence of
  recall (`lastUsedAt`), approval-gated canon promotion, supersession.
- **Decision register:** ADR refs, authority (binding/advisory/informational),
  evidence, supersession lineage, 8 seeded governance decisions.
- **Doctrine registry:** machine-readable allowed/forbidden/requires-approval
  clauses, RULE refs, evidence, supersession, 7 seeded rules, `validateAction`.
- **Runtime provenance:** explicit gateway model strings surfaced via `RUNTIME`.
- **Audit:** `event` table via `logEvent()`, surfaced at `/audit`.
- **Per-user scoping:** every query filters by `getUserId()` (no RLS; Better
  Auth session-scoped).

---

## 2. Broader WilliamOS Baseline `[REFERENCED]` — not in this tree

The following are carried from the WO and prior WilliamOS baselines. They live
in the broader WilliamOS project, **not** in this repository, and were **not**
read from disk. Listed so the migration source is documented.

### 2.1 Python control plane `[REFERENCED]`

- `safety.check_command` — safety tiers
- `command_runner` — governed command execution
- `william.py` — control CLI (`production-readiness`, `runtime-smoke`)
- FastAPI backend (`control-center/backend/app.py`)
- memory governance, RAG/retrieval, runtime adapter
- research intake (`research_intake.py`), worker dock (`workers.py`)
- evidence/history, release/gate logic

### 2.2 Vite Control Center frontend `[REFERENCED]`

- `control-center/frontend/src/App.tsx` + `src/components/*`
- Phase 5A Operator Shell, 5B Launcher Runtime, 5C Research Drop Zone,
  5D Agent Dock, 5E Runtime Adapter, 5F Memory Governance

### 2.3 Launcher / runtime `[REFERENCED]`

- `scripts/williamos_control_center.py`, `scripts/william.py`
- Ollama 14B default, explicit-runtime-only policy

---

## 3. Migration-target classification

| Surface | Source | Target | Notes |
| --- | --- | --- | --- |
| Operator UI / routing | Vite `[REFERENCED]` | Next.js (this repo) | **Largely already done here** |
| Governance registers | mixed | Next.js (this repo) | Memory/Decision/Doctrine live here |
| Command authority | Python `[REFERENCED]` | **stays Python** | No authority moves to Next.js |
| Safety tiers / runner | Python `[REFERENCED]` | **stays Python** | Never reimplemented in JS/Rust |
| RAG / retrieval | mixed | Python authority `[REFERENCED]`; this repo has its own pgvector recall | Reconcile in §10 sequence |
| Native desktop shell | none | Tauri | Future, planned only |
| Local process bridge | none | Rust sidecar | Future, planned only |

---

## 4. Non-goals (this task)

- No code changes. No scaffolding. No migration execution.
- No claim that `[REFERENCED]` Python/Vite files were inspected.
- No Phase 6. No authority drift.

---

## 5. Result

- **RESULT:** PASS
- **LANE:** A (architecture docs)
- **FILES_CHANGED:** this document only
- **CURRENT_CONTROL_CENTER_STATUS:** untouched (not in this tree)
- **PHASE_STATUS:** Phase 6 BLOCKED
- **NEXT:** `10_API_CONTRACTS.md`
