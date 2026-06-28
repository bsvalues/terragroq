---
type: plan
feature: pwa-tauri-packaging
status: planned
generated: 2026-06-24
tags:
  - devkit
  - pwa
  - tauri
  - packaging
---

# PWA / Tauri Packaging Plan

## Recommended Architecture

```
WilliamOS launcher (python scripts/william.py)
  └── Runtime and process owner
        ├── FastAPI backend (port 8420)
        │     ├── /api/* endpoints
        │     └── Serves React frontend from dist/
        └── Browser shell (PWA or Tauri)
              └── UI layer only — no command authority
```

WilliamOS core is and remains the authority. PWA and Tauri are shells, not new
command systems. They provide a better desktop/mobile experience around the
existing backend — they do not replace it.

---

## Hard Rule

> Tauri must not become a second command system. Core command execution remains
> inside WilliamOS safety gates (`safety.check_command → command_runner`).
> Tauri's native capabilities (file access, notifications, IPC) must not be
> used to bypass the governed command runner.

---

## PWA Scope

A Progressive Web App makes the Control Center installable from the browser.

### What the PWA Provides

| Feature | Description |
|---------|-------------|
| `manifest.json` | App name, icons, theme color, start URL |
| Icons | Multiple sizes (192px, 512px minimum; maskable variants recommended) |
| Installable shell | "Install" prompt in compatible browsers (Chrome, Edge, Safari) |
| Backend-offline screen | Static fallback page when backend is unreachable |
| Basic offline caching | Service worker caches static assets; API calls fail gracefully offline |

### What the PWA Does NOT Provide

| Non-Goal | Reason |
|----------|--------|
| Background sync | WilliamOS does not sync; no background workers needed |
| Push notifications | Watchdog alerts come from the running backend, not push |
| Offline command execution | Commands require the backend; no offline execution |
| Data caching | Vault data is local; no client-side cache of vault content |

### PWA Implementation Steps

1. **Add `manifest.json`** to `control-center/frontend/public/`:
   ```json
   {
     "name": "WilliamOS Control Center",
     "short_name": "WilliamOS",
     "start_url": "/",
     "display": "standalone",
     "theme_color": "#1a1a2e",
     "background_color": "#0f0f1a",
     "icons": [
       { "src": "/icons/icon-192.png", "sizes": "192x192", "type": "image/png" },
       { "src": "/icons/icon-512.png", "sizes": "512x512", "type": "image/png" }
     ]
   }
   ```

2. **Add icons** to `control-center/frontend/public/icons/`.

3. **Add a service worker** for asset caching and offline fallback.
   Use Vite PWA plugin (`vite-plugin-pwa`) to generate the service worker automatically.

4. **Add offline fallback page** that displays "WilliamOS is offline — backend
   not reachable at localhost:8420." with a Retry button.

5. **Link manifest** in the React app's `index.html`:
   ```html
   <link rel="manifest" href="/manifest.json" />
   ```

6. **Test installation** in Chrome: navigate to `http://localhost:8420`, verify
   the install prompt appears, install, confirm the installed app opens correctly.

---

## Tauri Scope

Tauri is a Rust-based framework for building native desktop apps from web frontends.
It wraps the React frontend in a native window, adds tray icon support, and provides
access to native OS features.

### What Tauri Provides

| Feature | Description |
|---------|-------------|
| Native desktop app shell | Wraps the existing React frontend in a native window |
| System tray icon | Shows WilliamOS status in the OS tray |
| Tray actions | Open, Restart, Stop the Control Center from the tray |
| Local notifications | Native OS notifications for watchdog alerts |
| Native file drop | Receive dropped files via OS file drop API (for Research Drop Zone) |
| Deep links (future) | Handle `williamos://` scheme links |
| Pending review count | Show badge count on tray icon for pending Review Required items |

### What Tauri Does NOT Provide

| Non-Goal | Reason |
|----------|--------|
| Second command system | Commands still go through `safety.check_command` in the backend |
| Auto-launch on startup | Optional OS-level setting, not managed by Tauri itself |
| New command endpoints | No new Tauri IPC commands that bypass the backend |
| Background autonomy | No background Tauri processes that act without operator input |
| Phase 6 behavior | Tauri packaging does not unlock Phase 6 |

### Tauri Architecture

```
Tauri app (native window)
  └── WebView: loads http://localhost:8420 (existing React app)
        ├── All API calls: /api/* on the FastAPI backend
        └── All commands: through safety.check_command

  Tauri main process (Rust)
  └── Manages tray icon, notifications, window lifecycle
  └── NO direct command execution
  └── NO vault file access
  └── NO bypassing of WilliamOS backend
```

### Tray Menu

```
WilliamOS Control Center
─────────────────────────
○ Open
○ Restart Backend
○ Stop Backend
─────────────────────────
○ Quit
```

Open and Restart invoke the existing `william.py control-center` and
`control-center-restart` commands through the backend API — they do not
directly shell out from Tauri.

### Tauri Implementation Steps

1. **Initialize Tauri** in the frontend directory:
   ```bash
   cd control-center/frontend
   npx create-tauri-app --template react-ts
   ```

2. **Configure `tauri.conf.json`**:
   - App name: `WilliamOS Control Center`
   - Window title: `WilliamOS`
   - Default URL: `http://localhost:8420`
   - System tray: enabled

3. **Add tray icon** to `src-tauri/icons/`.

4. **Implement tray menu** in Rust (`src-tauri/src/main.rs`):
   - Open: `tauri::api::shell::open` → `http://localhost:8420`
   - Restart/Stop: HTTP calls to the backend's management endpoints

5. **Add notification support** for watchdog alerts via Tauri's notification API.

6. **Build and test**:
   ```bash
   cd control-center/frontend
   npm run tauri build
   ```

7. **Verify:** Tray icon appears, Open opens the existing Control Center correctly,
   commands route through the backend without modification.

---

## Implementation Order

1. **PWA first** — lower risk, browser-native, no Rust toolchain needed.
   - Add manifest + icons
   - Add Vite PWA plugin
   - Add offline fallback page
   - Test PWA install in Chrome

2. **Tauri second** — after PWA is stable.
   - Set up Tauri project structure
   - Implement tray + notifications
   - Verify no command system bypass

3. **Not before v1.3.0 tag** — packaging is post-release hardening.

---

## Release Relationship

Neither PWA nor Tauri implementation is required for the v1.3.0 release. The
existing browser-served React app is the production Control Center. PWA and Tauri
are quality-of-life improvements for post-release packaging.

Tag v1.3.0 first. Begin PWA/Tauri work after the tag, as the first post-release
hardening sprint.
