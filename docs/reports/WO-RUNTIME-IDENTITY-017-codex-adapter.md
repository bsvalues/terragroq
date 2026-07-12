# WO-RUNTIME-IDENTITY-017 - Codex Non-Interactive Adapter

The adapter requires sanitized ChatGPT/keyring readiness, removes API and
GitHub token environment names, uses argument lists rather than shell strings,
pins no-approval workspace sandboxing and schema output, and enforces timeout
and output-size walls. It has not been invoked while activation is disabled.

Result: `PASS_ADAPTER_STATIC_AND_FIXTURE_PROOF`.
