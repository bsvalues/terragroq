# 10 — API Contract Freeze

**Work Order:** WO-WILLIAMOS-NEXT-TAURI-ARCH-001
**Lane:** B — API contract inventory
**Status:** DRAFT
**Phase 6:** BLOCKED

---

## 0. Purpose & the authority rule

Next.js and Tauri/Rust must remain **clients**, never authorities. This document
freezes the contract surface so any shell (web, PWA, desktop) talks to the same
governed endpoints and cannot invent its own command path.

**Authority rule:**
- `WilliamOS Core (Python control plane)` is the authority for safety,
  commands, release gates, and worker approval `[REFERENCED]`.
- In *this repo*, governed state (memory/decision/doctrine/work-order/corpus)
  is served by **Next.js server actions + route handlers**, each scoped by
  `getUserId()` and writing to the `event` audit trail.
- Tauri/Rust **must call these APIs / governed CLI** — never DB, git, or
  filesystem authority directly.

Legend: `[LIVE]` = exists in this repo (verified). `[REFERENCED]` = WilliamOS
Python contract, not in this tree. `[FUTURE]` = planned, not yet built.

---

## 1. Transport conventions

- **Server Actions** (`"use server"`): primary RPC for the Next.js shell. Not
  directly callable by Tauri/Rust — see §6 for the desktop bridge requirement.
- **Route Handlers** (`app/api/*`): HTTP, callable by any client incl. Tauri.
- **Auth:** Better Auth session cookie. Every action calls `getUserId()` and
  scopes queries by user. Unauthenticated calls must fail closed.
- **Side-effect logging:** mutations call `logEvent()` → `event` table.

---

## 2. System / health

### `GET /api/status` `[FUTURE]`
- **Purpose:** liveness of the Next.js shell.
- **Authority:** none (read-only).
- **Response:** `{ ok: boolean, ts: string }`
- **Approval required:** no. **Runtime dependency:** none.
- **Consumers:** PWA offline screen, Tauri tray health.

### `GET /api/copilot/health` `[REFERENCED]`
- **Purpose:** WilliamOS Python control-plane liveness.
- **Authority:** Python. **Runtime dependency:** FastAPI backend.
- **Consumers (future):** Tauri backend supervisor, Runtime page.

### `GET /api/copilot/runtime` `[PARTIAL]`
- **Purpose:** model/runtime provenance.
- **Today:** surfaced in-process via `lib/ai/config.ts` → `RUNTIME`
  (`{ chatModel, embeddingModel, gateway }`). No HTTP endpoint yet.
- **Authority:** read-only. **Approval:** no.
- **Response (proposed):** `{ chatModel, embeddingModel, gateway, fallback: false }`
- **Consumers:** Runtime status UI, Tauri tray.

---

## 3. Chat / reasoning

### `POST /api/chat` `[LIVE]`
- **File:** `app/api/chat/route.ts` (`maxDuration = 30`).
- **Purpose:** governed chat. Injects **active doctrine** (allowed/forbidden/
  requires-approval), **active binding decisions**, and **RAG context** (corpus
  + memory) before answering; enforces refuse-and-cite on forbidden actions.
- **Authority:** read + reasoning only. Does **not** write memory/decisions.
- **Request:** `{ messages: UIMessage[] }` (AI SDK format).
- **Response:** streamed assistant message + `sources` metadata
  (kind, ref, snippet, similarity, authority, stale).
- **Side effects:** none persisted (chat is ephemeral unless separately saved).
- **Approval required:** no (read-only reasoning). **Runtime dependency:**
  AI Gateway.
- **Consumers:** `/chat` (web), future PWA, future Tauri.

### `POST /api/chat/approve` `[FUTURE]`
- **Purpose:** operator approval of a proposed write/promotion/commit surfaced
  by chat ("Review Required" flow).
- **Authority:** **gated** — performs the approved governed action only.
- **Request:** `{ proposalId, decision: "approve" | "reject", note? }`
- **Side effects:** executes the underlying governed action; writes `event`.
- **Approval required:** **yes (this IS the approval).**
- **Consumers:** Review Required UI, Tauri pending-review badge.

---

## 4. Governance registers (server actions, `[LIVE]`)

All scoped by `getUserId()`; all mutations write `event`.

### Memory — `app/actions/memory.ts`
| Operation | Authority | Approval | Side effects |
| --- | --- | --- | --- |
| `getMemoryFacts` | read | no | — |
| `searchMemory(userId, query, limit)` | read | no | stamps `lastUsedAt` on recall |
| `createMemoryFact` | write (intake) | no | insert + embed + event |
| `updateMemoryFact` | write | no | update + re-embed + event |
| `reviewMemoryFact` | promote | no | unreviewed→reviewed/working + event |
| `promoteToCanon` | promote | **yes (operator)** | →canon + event |
| `demoteFromCanon` | demote | yes | canon→working + event |
| `setMemoryStale` | flag | no | stale toggle + event |
| `archiveMemoryFact` | retire | no | →archived + event |
| `togglePinMemory` | flag | no | pin + event |
| `deleteMemoryFact` | destroy | yes | delete + event |
| `exportMemory` | read | no | serialize all facts |

**Recall rule:** `searchMemory` excludes `deprecated/superseded/archived`;
surfaces `authority` + `stale` to the caller.

### Decisions — `app/actions/decisions.ts`
| Operation | Authority | Approval | Side effects |
| --- | --- | --- | --- |
| `getDecisions` / `searchDecisions` | read | no | — |
| `getActiveDecisions(userId)` | read | no | injected into chat context |
| `createDecision` | write | no | auto ADR ref + event |
| `updateDecisionStatus` | write | no | status + event |
| `setDecisionAuthority` | write | no | binding/advisory/info + event |
| `linkEvidence` | write | no | append evidence + event |
| `supersedeDecision` | supersede | yes | new row, links lineage, preserves history |
| `deleteDecision` | destroy | yes | delete (locked seeds protected) |
| `seedGovernanceDecisions` | seed | no | inserts 8 locked decisions |

### Doctrine — `app/actions/doctrine.ts`
| Operation | Authority | Approval | Side effects |
| --- | --- | --- | --- |
| `getDoctrine` / `searchDoctrine` | read | no | — |
| `getActiveDoctrine(userId)` | read | no | injected into chat context |
| `createDoctrine` | write | no | auto RULE ref + event |
| `toggleDoctrine` | write | no | active flag + event |
| `linkDoctrineEvidence` | write | no | append evidence + event |
| `supersedeDoctrine` | supersede | yes | new row, lineage, preserves history |
| `deleteDoctrine` | destroy | yes | delete (locked seeds protected) |
| `validateAction(action)` | read | no | returns allowed/forbidden/needs-approval verdict |
| `seedGovernanceDoctrine` | seed | no | inserts 7 locked rules |

### Work Orders — `app/actions/work-orders.ts`
| Operation | Authority | Approval | Side effects |
| --- | --- | --- | --- |
| `getWorkOrders` | read | no | — |
| `createWorkOrder` | write | no | insert + event |
| `updateWorkOrderStatus` | write | no | status (+completedAt) + event |
| `deleteWorkOrder` | destroy | yes | delete |

### Corpus / documents — `app/actions/documents.ts`
| Operation | Authority | Approval | Side effects |
| --- | --- | --- | --- |
| `getDocuments` | read | no | — |
| `ingestDocument` | write | no | insert + chunk/embed + event |
| `deleteDocument` | destroy | yes | delete |
| `searchCorpus(userId, query, limit)` | read | no | vector recall for chat |

### Dashboard — `app/actions/dashboard.ts`
| Operation | Authority | Approval |
| --- | --- | --- |
| `getDashboardData` | read | no |

---

## 5. Auth

### `ALL /api/auth/[...all]` `[LIVE]`
- **Purpose:** Better Auth (email + password, autoSignIn, 7-day sessions).
- **Authority:** session issuance. **Approval:** n/a.
- **Consumers:** web shell, future PWA, Tauri (via embedded webview cookie).

---

## 6. Referenced WilliamOS Python endpoints `[REFERENCED]`

Documented for the migration source; not in this tree. Contracts to be honored
when reconciling with the Python control plane.

- `GET /api/memory/facts`, memory governance endpoints
- research intake endpoints, research history endpoints
- worker status endpoints, delegation endpoints, proposal endpoints
- evidence/history endpoints
- `[FUTURE]` decision register / doctrine / work-order endpoints (if the Python
  plane needs read access to the registers this repo now owns)

---

## 7. Future endpoints to formalize `[FUTURE]`

| Endpoint | Reason |
| --- | --- |
| `GET /api/status` | PWA/Tauri health |
| `GET /api/copilot/runtime` | expose `RUNTIME` over HTTP for Tauri tray |
| `POST /api/chat/approve` | Review Required approval gate |
| `GET /api/events` | audit feed for Tauri pending-review count |
| Server-action → HTTP shims | Tauri cannot call server actions directly (§8) |

---

## 8. Hard boundary: how desktop clients call governed state

Tauri/Rust cannot invoke Next.js **server actions** directly (they are
RSC-internal). To keep one authority path:

1. Expose required governed operations as **route handlers** (`app/api/*`) that
   internally call the same action logic, **or**
2. Tauri loads the Next.js shell in a webview and rides the same session.

Tauri/Rust must **never** reach Postgres, git, or the filesystem authority
directly. See `50_TAURI_ARCHITECTURE.md` and `60_RUST_BRIDGE_BOUNDARY.md`.

---

## 9. Result

- **RESULT:** PASS
- **LANE:** B
- **FILES_CHANGED:** this document only
- **PHASE_STATUS:** Phase 6 BLOCKED
- **NEXT:** `20_NEXTJS_MIGRATION_MAP.md`
