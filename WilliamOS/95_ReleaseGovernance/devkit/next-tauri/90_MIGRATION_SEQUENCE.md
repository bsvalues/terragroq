# 90 — Migration Sequence

**Work Order:** WO-WILLIAMOS-NEXT-TAURI-ARCH-001
**Lane:** A — Architecture docs
**Status:** DRAFT
**Phase 6:** BLOCKED

---

## 0. Principle

> Do not rewrite the brain. Wrap, harden, and migrate surfaces gradually.

Each step is its own authorized WO. No step starts without operator approval.
Vite retirement happens **only** after parity is approved.

---

## N0 — API contract freeze
- **Goal:** stable contracts so all shells are clients, not authorities.
- **Scope:** `10_API_CONTRACTS.md`; formalize `[FUTURE]` endpoints
  (`/api/status`, `/api/copilot/runtime`, `/api/chat/approve`, `/api/events`).
- **Non-goals:** behavior changes, authority moves.
- **Validators:** contract doc review; existing build green.
- **Acceptance:** every shell-facing operation has a frozen contract entry.
- **Rollback:** docs only — revert doc.

## N1 — Next.js shell prototype
- **Goal:** confirm/extend the existing Next.js shell as the operator surface.
- **Scope:** this repo's registers (already live); add `[GAP]` routes behind
  governed APIs (`/runtime` first — lowest authority risk).
- **Non-goals:** command/review/workers authority surfaces yet.
- **Validators:** `next build`; route smoke; per-user scoping check.
- **Acceptance:** `/runtime` renders provenance from `GET /api/copilot/runtime`.
- **Rollback:** remove added route; registers untouched.

## N2 — Next.js parity
- **Goal:** reach parity with Vite Control Center for authority-adjacent
  surfaces as **thin governed clients**.
- **Scope:** `/command`, `/review`, `/workers` calling Python/CLI only.
- **Non-goals:** embedding safety/approval logic in Next.js.
- **Validators:** approval-gate test (`/api/chat/approve`); worker proposal-only
  test; safety-tier pass-through verified.
- **Acceptance:** operator can do daily ops in Next.js without the Vite shell.
- **Rollback:** Vite remains canonical; disable new routes.

## N3 — PWA install layer
- **Goal:** installable shell, read-only offline.
- **Scope:** `40_PWA_PLAN.md` — manifest, icons, app-shell SW, offline screen.
- **Non-goals:** offline mutation queue, background sync, push.
- **Validators:** Lighthouse PWA installable; offline screen shows; no cached
  mutations.
- **Acceptance:** installs; offline = read-only + retry.
- **Rollback:** unregister SW; remove manifest.

## T1 — Tauri wrapper
- **Goal:** native window + tray over the Next.js shell.
- **Scope:** `50_TAURI_ARCHITECTURE.md` — window, tray, deep links,
  notifications.
- **Non-goals:** any authority in Tauri.
- **Validators:** loads shell; tray status; single-instance; capability allowlist
  minimal.
- **Acceptance:** desktop app usable; no direct git/fs/DB access.
- **Rollback:** ship web/PWA only.

## T2 — Tauri runtime bridge
- **Goal:** backend lifecycle + runtime checks via governed launcher.
- **Scope:** start/stop/restart, Ollama/runtime status (status only).
- **Non-goals:** silent/cloud fallback.
- **Validators:** start/stop/restart idempotent; offline reported, not faked.
- **Acceptance:** operator controls backend from desktop, safety intact.
- **Rollback:** manual backend start; disable controls.

## R1 — Rust worker/process bridge
- **Goal:** process supervision, port checks, path normalization, file drop,
  worker cancel.
- **Scope:** `60_RUST_BRIDGE_BOUNDARY.md` allowed list only.
- **Non-goals:** any forbidden Rust responsibility.
- **Validators:** path traversal rejected; no orphan processes; cancel works.
- **Acceptance:** reliable local bridges, zero authority.
- **Rollback:** remove Rust commands; Tauri runs as thin wrapper.

## R2 — Optional worker sandbox `[FUTURE]`
- **Goal:** sandboxed worker execution (later).
- **Scope:** TBD, separately authorized.
- **Non-goals:** worker write authority; Phase 6.
- **Validators / Acceptance / Rollback:** defined when authorized.

## Vite retirement
- **Only after** N2 parity approved + operator sign-off recorded as a Decision
  (ADR). Until then the Vite frontend remains canonical and is not removed.

---

## 1. Dependency order

```
N0 → N1 → N2 → (N3 ∥ T1) → T2 → R1 → R2 → [parity sign-off] → Vite retirement
```

- N3 (PWA) and T1 (Tauri wrapper) can proceed in parallel after N2.
- Nothing here unblocks Phase 6.

---

## 2. Result

- **RESULT:** PASS
- **LANE:** A
- **FILES_CHANGED:** this document only
- **PHASE_STATUS:** Phase 6 BLOCKED
- **NEXT:** `next-tauri-manifest.json`
