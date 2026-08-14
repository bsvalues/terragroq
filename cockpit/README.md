# WilliamOS Cockpit

This package is a thin Windows Tauri shell for the authenticated WilliamOS UI at the exact HERMES origin in `cockpit.config.json`. The remote UI owns sign-in, device enrollment, device-session establishment, and every governed operation.

The native surface is intentionally limited to four commands:

- `device_generate_key` generates one Ed25519 key, stores private PKCS8 bytes in Windows Credential Manager, and returns `{ publicKeySpki }`.
- `device_bind_credential` stores the server-issued opaque credential identifier after enrollment.
- `device_credential` returns `{ credentialId }` or `null`.
- `device_sign` signs the server-returned canonical proof and returns `{ signature }`.

Private key bytes and web session tokens never cross the native invoke boundary. The window denies navigation outside the local recovery page and the configured HERMES origin, denies all new windows, disables production devtools, and exposes no filesystem, shell, HTTP, database, or Git capability.

## Validation and build

The proven local build uses the pinned Windows GNU Rust toolchain. The bundle explicitly includes `WebView2Loader.dll`, which the GNU executable requires before application entry:

```powershell
pnpm install --frozen-lockfile
cargo test --manifest-path src-tauri/Cargo.toml --locked
pnpm tauri:build -- --bundles msi,nsis
```

Installers are emitted below `src-tauri/target/release/bundle/msi` and `src-tauri/target/release/bundle/nsis`. Before accepting an installed build, verify that the install contains both `williamos-cockpit.exe` and `WebView2Loader.dll`, launch twice, and confirm one process owns the loopback single-instance guard. Record the source commit, lockfiles, artifact size, and SHA-256. An unsigned local build is not a trusted distribution artifact.
