# 50 — Tauri Architecture

**Work Order:** WO-WILLIAMOS-NEXT-TAURI-ARCH-001
**Lane:** E — Tauri architecture (plan only)
**Status:** DRAFT
**Phase 6:** BLOCKED

---

## 0. Role

Tauri is the **native desktop wrapper** for the Next.js operator shell. It
improves the desktop experience (window, tray, native file drop, notifications)
but holds **no authority**.

> **Hard rule:** Tauri must not call git / file-write / canon / commit / release
> actions directly. Tauri calls **WilliamOS APIs** or **governed CLI commands**.

---

## 1. Window model

- **Single main window** hosting the Next.js shell.
  - Dev: load `http://localhost:3000` (Next dev server).
  - Prod: load the built Next.js app (served locally or via static export +
    local server, depending on RSC needs — see §7).
- **Single-instance lock** (via Rust, see 60): second launch focuses the
  existing window.
- Optional small **status window** for backend lifecycle; no governed inputs.

---

## 2. System tray

- Tray icon reflects control-plane state: `online` / `offline` / `degraded`.
- Menu:
  - Show / Hide operator window
  - **Pending review count** (read from `GET /api/events` / review endpoint)
  - Start / Stop / Restart backend (delegates to Rust supervisor → governed
    launcher; never bypasses safety)
  - Open logs folder (OS open; read-only)
  - Quit
- Pending-review badge is **display only**; approval happens in the shell's
  Review Required UI via `POST /api/chat/approve`.

---

## 3. Start / stop / restart actions

- Tauri exposes controls that call the **Rust supervisor**, which in turn calls
  the **governed backend launcher** `[REFERENCED]`.
- Tauri itself runs **no** safety logic; it requests, the control plane decides.
- Restart must be idempotent and reuse the single-instance / port checks.

---

## 4. Native file drop

- OS-level drag/drop captured by Tauri → handed to Rust for **path
  normalization** → surfaced to the shell as a research-intake candidate.
- The actual ingest still goes through the governed `ingestDocument` / research
  intake path. Tauri/Rust only deliver the file reference safely.

---

## 5. Deep links

- Register a `williamos://` scheme.
- Deep links may **navigate** the shell (e.g. `williamos://review`,
  `williamos://decisions/ADR-0008`) but may **not** trigger writes/approvals
  without the operator acting in the UI.

---

## 6. Local notifications

- Allowed triggers: new pending review, backend offline, worker proposal ready.
- Notifications are **informational**; clicking navigates the shell. No
  notification action performs a governed write directly.

---

## 7. Backend lifecycle & runtime checks

- Tauri asks Rust to: check ports, verify Ollama/runtime availability, launch/
  supervise the WilliamOS backend `[REFERENCED]`.
- **Ollama / runtime checks:** report status only; **no silent model fallback**,
  **no cloud fallback**. If the required runtime is down, surface offline state.
- RSC consideration: a Next.js app using server actions/RSC needs a running Node
  server, not just static files. Plan: Tauri supervises (a) the WilliamOS Python
  backend and (b) the Next.js server process, both via Rust. Static export is
  insufficient for the governed server actions.

---

## 8. Security boundary

- Tauri `allowlist`/capabilities restricted to: window, tray, notifications,
  dialog (file pick), and the specific Rust commands in 60.
- **No** broad `fs`, `shell`, or `http` allowlist to arbitrary targets.
- Webview may only load the WilliamOS shell origin(s).
- Secrets are never embedded in the Tauri binary (see 80).

---

## 9. What Tauri must NOT do

- No direct DB / git / filesystem-write authority.
- No command execution outside the governed launcher/CLI.
- No canon promotion, decision/doctrine writes, commits, tags, releases.
- No cloud calls, no model fallback, no Phase 6 behaviors.

---

## 10. Result

- **RESULT:** PASS
- **LANE:** E (plan only)
- **FILES_CHANGED:** this document only
- **PHASE_STATUS:** Phase 6 BLOCKED
- **NEXT:** `60_RUST_BRIDGE_BOUNDARY.md`
