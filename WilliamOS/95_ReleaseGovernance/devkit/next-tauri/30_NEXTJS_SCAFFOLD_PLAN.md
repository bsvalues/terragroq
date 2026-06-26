# 30 — Next.js Scaffold Plan

**Work Order:** WO-WILLIAMOS-NEXT-TAURI-ARCH-001
**Lane:** C — Next.js scaffold (plan only)
**Status:** DRAFT — documentation only
**Phase 6:** BLOCKED

---

## 0. Position

This task is **documentation only**. No scaffold is created in this pass.

Crucially, the WO's "create `control-center/operator-next/` without removing
`control-center/frontend/`" instruction assumes the Vite monorepo. **In this
repository the Next.js operator shell already exists at the repo root** and is
the running app. So the scaffold question here is not "create a new shell" but
"how does this existing Next.js shell relate to the WilliamOS Vite Control
Center that still holds authority-adjacent surfaces."

---

## 1. Canonical-frontend rule

- The **current Vite Control Center remains canonical** `[REFERENCED]` for any
  surface that is authority-adjacent (command, review, workers, runtime) until
  the Next.js shell reaches parity **and the operator approves switchover**.
- The **Next.js shell (this repo) is canonical** for the governance registers it
  already owns (memory, decisions, doctrine, work-orders, corpus, audit).
- Two shells may coexist. Neither may become a second command authority.

---

## 2. If/when scaffold creation is authorized (future)

Only on explicit operator authorization (`feat(ui): scaffold Next.js operator
shell`), and only for the monorepo context:

```
control-center/
  frontend/          # Vite — REMAINS, canonical until parity
  operator-next/     # Next.js shell — additive, never replaces frontend
```

In this repo no new scaffold dir is needed — the shell is the repo root.

### 2.1 Stack (already in place here)
- Next.js App Router, TypeScript, Tailwind v4, shadcn/ui
- Neon + Drizzle, Better Auth, AI Gateway
- `app/(shell)/*` route group with shared `layout.tsx`

### 2.2 Folder conventions (already followed)
```
app/(shell)/<route>/page.tsx     # RSC entry, fetches via actions
app/actions/<domain>.ts          # "use server" governed operations
components/<domain>/*.tsx         # view + interactive pieces
lib/db, lib/ai, lib/registers     # data, runtime, audit
```

---

## 3. Parity checklist before any Vite retirement

Vite retirement is **out of scope** for this WO and gated on:

- [ ] All authority-adjacent surfaces (`/command`, `/review`, `/workers`,
      `/runtime`) exist as governed thin clients in Next.js.
- [ ] `POST /api/chat/approve` review gate live and tested.
- [ ] Runtime provenance exposed over HTTP and rendered.
- [ ] Research intake parity (drop zone + provenance).
- [ ] Evidence browser parity.
- [ ] Operator sign-off recorded as a Decision (ADR).

Until every box is checked, **do not remove the Vite frontend.**

---

## 4. Non-goals

- No scaffold creation in this pass.
- No Vite removal. No Python rewrite.
- No broad UI redesign beyond what exists.
- No Phase 6.

---

## 5. Result

- **RESULT:** PASS
- **LANE:** C (plan only)
- **FILES_CHANGED:** this document only
- **PHASE_STATUS:** Phase 6 BLOCKED
- **NEXT:** `40_PWA_PLAN.md`
