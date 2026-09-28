# HERMES service map

Current configuration, September 9, 2026. Health must be read from current receipts.

| Service | Intended endpoint | Role |
|---|---|---|
| WilliamOS-HERMES-Ollama | 127.0.0.1:11434 | Native SYSTEM owner; P40 TCC 150 W; G: models |
| Open WebUI | 3000 | Existing chat client of native Ollama |
| PostgreSQL | 127.0.0.1:5433 | Existing local named volume; no new authority implied |
| Redis | 127.0.0.1:6379 | Existing local named volume |
| Portainer | 127.0.0.1:9000 | Existing container administration |
| HERMES Console | 127.0.0.1:3210 | Standalone read-only appliance status surface |

The HERMES appliance is distinct from WilliamOS. WilliamOS development, deployment and its owner-facing application are outside this appliance release. The existing task name `WilliamOS-HERMES-Ollama` is retained as the established inference owner identity; it does not transfer appliance product ownership.

Docker data resides at G:\DockerDesktopWSL. Nous port 9119, preview containers/tasks and frozen inventory must conform to their approved doctrine; this map does not authorize wildcard ingress or turn temporary residents into permanent services. Other-node addresses and placement must come from current fabric configuration, not the obsolete August static topology.

See [operating and recovery record](hermes/HERMES-COMMISSIONED.md).
