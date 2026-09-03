# HERMES appliance doctrine detector (#1034 / #1035)

Canonical source for the standing host-doctrine pipeline that runs on the HERMES
appliance. These files are deployed to `C:\HermesLab\hermes\doctrine\` and executed
by the `HermesDoctrineCheck` SYSTEM scheduled task via `run-hermes-doctrine.ps1`
(observe -> normalize -> evaluate -> write
`C:\ProgramData\Hermes\doctrine\current-result.json`); the HERMES console
(`hermes/console`) renders that result as the `doctrine` and `security` domains.

| File | Role |
| --- | --- |
| `collect-hermes-doctrine-observation.ps1` | Privileged read-only observer; emits one `hermes-host-raw-observation/1` envelope. Hard-requires Administrator (`OBSERVER_REQUIRES_ADMINISTRATOR`) by design — it enumerates every service, task, socket, process, and container on the host. |
| `normalize-hermes-observation.mjs` | Raw -> `hermes-host-observation/1`. Dedupes identity keys (sockets, resident process classes), unwraps PowerShell's single-array `ConvertFrom-Json` wrapper, refuses unknown process owners. |
| `evaluate-hermes-doctrine.mjs` | The comparator (pure functions). Declared-vs-observed over the six categories with **stable-vs-ephemeral semantics**: instance noise (browser/overlay/agent sockets+processes, UDP ephemeral/mDNS/DHCPv6, NetBIOS on the Docker/WSL switch re-binding each boot, vendor loopback UDP telemetry such as the NVIDIA `nvcontainer` helper, per-session service suffixes, OS-self-updating binary hashes, OS-internal task XML self-rewrites) is never identity-compared. The pinned appliance surface — inference listeners, docker residents, declared HERMES/WilliamOS tasks, `node\server`/`williamos`/`open-webui` processes — is compared exactly. |
| `mint-hermes-doctrine.mjs` | Freeze mint: observation + a `hermes-appliance-freeze-acceptance/1` record (five gates all PASS) -> `hermes-appliance-doctrine/1`. |
| `run-hermes-doctrine.ps1` | SYSTEM-task entry point. Records a truthful `DOCTRINE_NOT_DECLARED` UNKNOWN when no doctrine.json exists yet. Never mutates declared doctrine. |

Deliberately NOT in the repo: the appliance-side `mint-hermes-doctrine-run.mjs`
execution wrapper. Minting hard-codes an acceptance record whose five gates must be
*attested*, and attestation is a freeze-authority act (WO-HERMES-APPL-005), not a
routine script an agent may re-fire; the library above is where the real logic lives.

## The asymmetry rule (adversarial-review finding, 2026-09-02)

The appliance's production ingress IS node/docker-owned. Ephemeral classification must
never absorb `node`/`docker` generally, or the detector would pass silently on a missing
production listener or an unexpected wildcard ingress. An unexpected `tcp|::|<port>|...node.exe`
is drift — proven by live incident: the post-boot `tcp|::|24678|node.exe` listener belonged to
a Codex desktop lane's dev server and was correctly held as drift until the lane ended and it
self-cleared. No baseline was re-minted. Comparator fixes (e.g. the `nvcontainer` loopback UDP
exemption, 2026-09-02) land here as behavior changes with contract tests, never by editing
`doctrine.json` to match noise.

Contract tests: `tests/hermes-appliance-doctrine.test.ts`.
