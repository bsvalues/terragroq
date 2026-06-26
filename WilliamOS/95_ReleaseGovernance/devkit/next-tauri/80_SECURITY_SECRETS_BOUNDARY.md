# 80 — Security / Secrets Boundary

**Work Order:** WO-WILLIAMOS-NEXT-TAURI-ARCH-001
**Lane:** A — Architecture docs
**Status:** DRAFT
**Phase 6:** BLOCKED

---

## 0. Goal

Prevent credential and local-context leakage across Python, Next.js, PWA, Tauri,
and Rust. Secrets live **server-side / OS-keychain only**; shells never embed or
cache them.

---

## 1. Secret ownership

| Secret / sensitive item | Owner | Storage | Never exposed to |
| --- | --- | --- | --- |
| Neon connection string | Next.js server | env (`.env.*.local`, project env) | client, PWA, Tauri webview, Rust |
| `BETTER_AUTH_SECRET` | Next.js server | env | client/PWA/Tauri |
| AI Gateway key (`AI_GATEWAY_API_KEY`) | server / platform | env / gateway | client/PWA/Tauri/Rust |
| Worker configs | Python plane `[REFERENCED]` | control-plane config | shells |
| MCP configs | Python plane `[REFERENCED]` | control-plane config | shells |
| Cloud runtime creds | **not used** (no cloud fallback) | n/a | everyone |
| Session cookie | Better Auth | httpOnly cookie | JS where possible |

---

## 2. Sensitive local context

| Item | Rule |
| --- | --- |
| Research originals | Stay in governed FS; never bundled, never sent to cloud |
| Local paths | Normalized + root-checked (60); not leaked into logs/telemetry |
| Daily notes | **Never committed** (WO stop condition); local only |
| App logs | No secrets; redact tokens; not committed |
| Clipboard | Not read unless operator-initiated paste |
| Drag/drop files | Treated as untrusted input; validated before intake |
| External worker prompts | Proposal-only; no embedded secrets; reviewed before use |

---

## 3. Shell-specific rules

### Next.js / PWA
- Secrets only in **server** code (actions, route handlers). Never in client
  components or `NEXT_PUBLIC_*`.
- Service worker **must not** cache authenticated responses or secrets.
- CSP: restrict to shell origin + AI Gateway; no arbitrary remote scripts.

### Tauri
- Capabilities/allowlist minimal (window, tray, notifications, dialog, the
  explicit Rust commands). No broad `fs`/`shell`/`http`.
- Webview loads only WilliamOS shell origin(s).
- No secret baked into the binary; if the desktop app needs a token, fetch it at
  runtime via authenticated session, hold in memory only, or use OS keychain.

### Rust
- No cloud calls. No secret persistence. Reads only what a mechanical task needs.
- Logs are redacted; stdout/stderr capture must not echo secrets.

---

## 4. Authentication posture

- Better Auth: email + password, httpOnly session cookie, 7-day expiry.
- Every server action calls `getUserId()`; **no RLS** → per-query user scoping is
  mandatory (already enforced in this repo's actions).
- Tauri rides the same session via the embedded webview; no separate credential
  store.

---

## 5. Explicit prohibitions (WO stop conditions)

- No committing secrets. No committing local/daily notes.
- No cloud fallback. No silent model fallback.
- No broad worker permissions. No Tauri/Rust path bypassing safety tiers.

---

## 6. Result

- **RESULT:** PASS
- **LANE:** A
- **FILES_CHANGED:** this document only
- **PHASE_STATUS:** Phase 6 BLOCKED
- **NEXT:** `90_MIGRATION_SEQUENCE.md`
