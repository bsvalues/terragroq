# 20 — Next.js Migration Map

**Work Order:** WO-WILLIAMOS-NEXT-TAURI-ARCH-001
**Lane:** G — Migration map
**Status:** DRAFT
**Phase 6:** BLOCKED

---

## 0. Orientation

The WO maps a **Vite Control Center** to a **future Next.js shell**. In this
repository the Next.js shell **already exists**, so this map serves two roles:

1. **Parity ledger** — confirm each Vite Control Center surface `[REFERENCED]`
   has a Next.js counterpart here, and flag gaps.
2. **Forward map** — record the client/server split and API dependencies for
   each route so reconciliation with the Python control plane is unambiguous.

Legend: `[LIVE]` exists here · `[GAP]` referenced surface with no counterpart yet
· `[REFERENCED]` Vite source only.

---

## 1. Route map (recommended WO routes vs. this repo)

| WO target route | This repo | Status | Future component | API dependencies | RSC vs Client | Risk | Parity req |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `/app/page.tsx` | `app/(shell)/page.tsx` | `[LIVE]` | `DashboardView` | `getDashboardData` | RSC + client widgets | low | counts, recent events |
| `/app/command/page.tsx` | — | `[GAP]` | `CommandPanel` | Python `command_runner` `[REFERENCED]` | client | **high** (authority) | must call governed CLI/API only |
| `/app/review/page.tsx` | — | `[GAP]` | `ReviewQueue` | `POST /api/chat/approve` `[FUTURE]` | client | high | approval gate parity |
| `/app/research/page.tsx` | partial via `/corpus` | `[PARTIAL]` | `ResearchDropZone` | `ingestDocument`, research intake `[REFERENCED]` | client (upload) | med | drop-zone + provenance |
| `/app/memory/page.tsx` | `app/(shell)/memory/page.tsx` | `[LIVE]` | `MemoryView` | memory actions | RSC fetch + client | low | authority lifecycle |
| `/app/decisions/page.tsx` | `app/(shell)/decisions/page.tsx` | `[LIVE]` | `DecisionsView` | decision actions | RSC + client | low | ADR + supersession |
| `/app/doctrine/page.tsx` | `app/(shell)/doctrine/page.tsx` | `[LIVE]` | `DoctrineView` | doctrine actions | RSC + client | low | machine-readable clauses |
| `/app/workorders/page.tsx` | `app/(shell)/work-orders/page.tsx` | `[LIVE]` | `WorkOrdersView` | work-order actions | RSC + client | low | status lifecycle |
| `/app/evidence/page.tsx` | partial via `/audit` | `[PARTIAL]` | `EvidenceView` | `event` table, evidence `[REFERENCED]` | RSC | med | evidence linkage |
| `/app/workers/page.tsx` | — | `[GAP]` | `WorkerDock` | worker status/delegation `[REFERENCED]` | client | high | proposal-only authority |
| `/app/runtime/page.tsx` | — (data in `lib/ai/config.ts`) | `[GAP]` | `RuntimeStatus` | `GET /api/copilot/runtime` `[FUTURE]` | RSC | low | provenance, no fallback |
| `/app/history/page.tsx` | `app/(shell)/audit/page.tsx` | `[LIVE]` (named Audit) | `AuditView` | `event` table | RSC | low | append-only history |

---

## 2. Naming reconciliation

This repo groups routes as **Command / Registers / Knowledge**. The WO uses a
flat list. No rename is required for this docs pass. If alignment is later
authorized:

| WO name | This repo name | Action |
| --- | --- | --- |
| History | Audit Log | keep "Audit Log" (superset) |
| Research | Corpus | Corpus covers ingestion; add Research intake later |
| Evidence | (folded into Audit) | split out when evidence endpoints land |
| Command / Review / Workers / Runtime | — | new routes, gated by API contracts |

No route renames are performed in this WO.

---

## 3. Gaps to close (future, separately authorized)

| Gap | Why it matters | Blocking dependency |
| --- | --- | --- |
| `/command` | operator command surface | Python `command_runner` + safety tiers `[REFERENCED]` |
| `/review` | write/promote/commit approval | `POST /api/chat/approve` `[FUTURE]` |
| `/workers` | worker dock (proposal-only) | worker status/delegation `[REFERENCED]` |
| `/runtime` | runtime provenance page | `GET /api/copilot/runtime` `[FUTURE]` |
| `/research` | dedicated intake + provenance | research intake `[REFERENCED]` |
| `/evidence` | first-class evidence browser | evidence/history endpoints `[REFERENCED]` |

**Authority note:** `/command`, `/review`, and `/workers` carry authority risk.
They must remain **thin clients** over governed Python/CLI endpoints. None may
embed command, safety, or approval logic in the Next.js layer.

---

## 4. Client/server defaults

- **Default to RSC** for register reads (`getX` actions run server-side).
- **Client components** only for interactivity (forms, dialogs, drag/drop,
  streaming chat).
- **No data fetching in `useEffect`** — server actions or SWR only.
- **Mutations** via server actions that log to `event` and `revalidatePath`.

---

## 5. Result

- **RESULT:** PASS
- **LANE:** G
- **FILES_CHANGED:** this document only
- **PHASE_STATUS:** Phase 6 BLOCKED
- **NEXT:** `30_NEXTJS_SCAFFOLD_PLAN.md`
