# 70 — Data / Storage Boundary

**Work Order:** WO-WILLIAMOS-NEXT-TAURI-ARCH-001
**Lane:** A — Architecture docs
**Status:** DRAFT
**Phase 6:** BLOCKED

---

## 0. Rule

> **One owner per data type.** UI layers (Next.js client, PWA cache, Tauri
> config) may **cache**, but may **not own** source of truth.

Reality note: this repo stores governed registers in **Neon Postgres** (Drizzle).
The WO references `copilot.db` (SQLite) in the Python plane `[REFERENCED]`. Both
are recorded; the reconciliation rule is in §3.

---

## 1. Ownership table

| Data type | Owner (authoritative) | Store | Cacheable by | Never owns |
| --- | --- | --- | --- | --- |
| Memory facts | Next.js memory actions (this repo) | Neon `memory_fact` (+pgvector) | client view, Tauri display | PWA/Tauri/Rust |
| Decision records | Next.js decision actions | Neon `decision` | client view | PWA/Tauri/Rust |
| Doctrine records | Next.js doctrine actions | Neon `doctrine` | client view | PWA/Tauri/Rust |
| Work Order records | Next.js work-order actions | Neon `work_order` | client view | PWA/Tauri/Rust |
| Corpus docs + chunks | Next.js document actions | Neon `document` (+pgvector) | client view | PWA/Tauri/Rust |
| Evidence / history | Next.js events | Neon `event` | client view | PWA/Tauri/Rust |
| Auth sessions/users | Better Auth | Neon (Better Auth tables) | — | everyone else |
| Runtime registry | `lib/ai/config.ts` (`RUNTIME`) | code constant (+`[FUTURE]` endpoint) | tray/UI | Tauri/Rust |
| `copilot.db` | Python control plane `[REFERENCED]` | SQLite | — | this repo |
| Research originals | Python research intake `[REFERENCED]` | local FS (governed) | — | Tauri/Rust own copy |
| Research metadata | Python intake `[REFERENCED]` | `copilot.db` / store | client view | Tauri/Rust |
| Worker registry | Python workers `[REFERENCED]` | control-plane store | client view | Tauri/Rust |
| Frontend local storage | UI only | browser localStorage | n/a | any governed truth |
| Tauri app config | Tauri | OS app-config dir | n/a | any governed truth |
| Logs | producer process | log files | viewers | governed truth |

---

## 2. Caching rules

- **Allowed caches:** static shell assets (SW), in-memory client query state
  (SWR), Tauri window/UI prefs, last-known status for offline display.
- **Forbidden caches:** governed mutations, canon state, approvals, secrets,
  per-user register data persisted outside the owner store.
- Caches must be **invalidatable** and must never be treated as truth on write.

---

## 3. Postgres vs `copilot.db` reconciliation `[FUTURE]`

This repo (Neon) and the Python plane (`copilot.db`) currently describe
overlapping concepts (memory, evidence). To avoid dual ownership:

1. Pick **one authoritative store per data type** (table above is the proposal:
   registers → Neon; research originals/worker registry → Python plane).
2. Where both exist, define a **one-way sync or a single canonical API** so the
   non-owner becomes a read-through client.
3. No write goes to two owners. Reconciliation is a **separately authorized WO**.

---

## 4. Non-goals

- No migration of data in this pass.
- No new store introduced. No schema change.
- No Phase 6.

---

## 5. Result

- **RESULT:** PASS
- **LANE:** A
- **FILES_CHANGED:** this document only
- **PHASE_STATUS:** Phase 6 BLOCKED
- **NEXT:** `80_SECURITY_SECRETS_BOUNDARY.md`
