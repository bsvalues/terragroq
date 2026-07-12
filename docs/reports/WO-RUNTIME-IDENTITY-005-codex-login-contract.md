# WO-RUNTIME-IDENTITY-005 - Codex ChatGPT Login Contract

Implementation state: `PASS_READY_CHATGPT_KEYRING`.

- Native Codex is pinned to `0.142.2`.
- Configuration requires `forced_login_method = "chatgpt"` and
  `cli_auth_credentials_store = "keyring"`.
- A nonempty `~/.codex/auth.json` produces `PLAINTEXT_FALLBACK_WALL` before
  login or runtime work.
- Status evidence is reduced to `OWNER_LOGIN_REQUIRED` or
  `READY_CHATGPT_KEYRING`; raw command output is not reported.
- The implementation never invokes `codex login`, copies an auth cache, or
  handles credential material.

Observed preflight: the native plaintext fallback path is a nonempty regular
file. Only its existence and byte length were observed; contents, hash, prefix,
and credential state were not inspected.

Owner action completed through the official Codex logout/login flow. The
sanitized adapter returned `CODEX_AUTH_STATUS=READY_CHATGPT_KEYRING` with
native Codex `0.142.2`. Runtime activation remained disabled.
