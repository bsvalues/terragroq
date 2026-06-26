# 40 — PWA Plan

**Work Order:** WO-WILLIAMOS-NEXT-TAURI-ARCH-001
**Lane:** D — PWA scaffold (plan only)
**Status:** DRAFT — documentation only
**Phase 6:** BLOCKED

---

## 0. Goal

Define an **installable browser/operator layer** over the Next.js shell. The PWA
is a *shell convenience*, not a new authority and not an offline write system.

---

## 1. Hard constraints (from WO)

- **No offline mutation queue.** Writes require the backend online. Offline =
  read-only / informative.
- **No hidden background sync.** No service-worker code that mutates governed
  state opportunistically.
- **No silent fallback.** If the backend is unreachable, show the
  backend-offline screen — never a degraded "fake" mode.

---

## 2. Components

### 2.1 App manifest (`app/manifest.ts` or `public/manifest.webmanifest`)
```jsonc
{
  "name": "WilliamOS Operator",
  "short_name": "WilliamOS",
  "start_url": "/",
  "display": "standalone",
  "background_color": "<theme bg token>",
  "theme_color": "<theme primary token>",
  "icons": [
    { "src": "/icons/icon-192.png", "sizes": "192x192", "type": "image/png" },
    { "src": "/icons/icon-512.png", "sizes": "512x512", "type": "image/png" },
    { "src": "/icons/maskable-512.png", "sizes": "512x512", "purpose": "maskable" }
  ]
}
```
Next.js note: prefer `app/manifest.ts` (typed Metadata Route).

### 2.2 Icons
- 192, 512, and maskable-512 PNGs under `public/icons/`.
- Generated assets — **not committed under this WO** unless the asset task is
  explicitly owned. Plan references them; creation is a separate authorized step.

### 2.3 Service worker scope
- Scope: `/` (whole shell).
- Strategy: **app-shell + static caching only.**
  - Cache: HTML shell, CSS, JS, fonts, icons (stale-while-revalidate for static).
  - **Never cache** authenticated API responses or governed mutations.
  - **Network-only** for `POST /api/chat`, all server actions, auth, register
    reads that must reflect live authority state.
- Recommended: a minimal hand-written SW, or `next-pwa`/Serwist if a dependency
  is later authorized. No SW is added in this pass.

### 2.4 Backend-offline screen
- Dedicated route/component shown when health check fails.
- States: "WilliamOS control plane unreachable." + retry + last-known status.
- Read-only; no inputs that imply a write will be queued.

### 2.5 Static fallback
- `app/offline/page.tsx` `[FUTURE]` cached by the SW as the offline document.
- Explains offline = read-only, links to retry.

---

## 3. Install UX

- Standard `beforeinstallprompt` capture → "Install WilliamOS" affordance in the
  shell header/user menu.
- Installed PWA and Tauri desktop shell are distinct delivery channels over the
  same Next.js app; both are clients of the same governed APIs.

---

## 4. Security notes (see 80)

- SW must not cache secrets or per-user governed data.
- Auth session cookie rules unchanged; SW is bypassed for auth + mutations.

---

## 5. Non-goals

- No SW or manifest created in this pass.
- No offline writes, no background sync, no push (Phase-6-adjacent → blocked).

---

## 6. Result

- **RESULT:** PASS
- **LANE:** D (plan only)
- **FILES_CHANGED:** this document only
- **PHASE_STATUS:** Phase 6 BLOCKED
- **NEXT:** `50_TAURI_ARCHITECTURE.md`
