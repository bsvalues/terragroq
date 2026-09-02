# Third-party components in the generated County Development bundle

The build workflow records exact versions and SHA-256 values in `manifest.json`.

- **Node.js** — Node.js license. Runtime executable is taken from the pinned GitHub Actions Node toolchain.
- **PostgreSQL** — PostgreSQL License. The package carries portable Windows binaries only; it does not install a machine-wide service.
- **pgvector** — PostgreSQL License. Built from the pinned `pgvector/pgvector` release against the packaged PostgreSQL version.
- **Ollama** — MIT License. The Windows runtime is downloaded from the pinned official `ollama/ollama` GitHub release.
- **Qwen2.5-Coder 1.5B** — model files are emitted separately by the build workflow. Review the official model card and license before County distribution.
- **Snowflake Arctic Embed 2** — embedding model files are emitted separately by the build workflow. Review the official model card and license before County distribution.
- **Microsoft WebView2 Loader** — staged from the exact lockfile-pinned `webview2-com-sys` crate already used by the WilliamOS Cockpit. The installed Windows WebView2 Runtime remains a workstation prerequisite.

The generated bundle is unsigned unless an approved code-signing identity is supplied. SHA-256, source revision, package manifest, and protected GitHub provenance are evidence; they are not a substitute for County application-control approval.
