# HERMES operating record

Reconciled September 9, 2026. Canonical appliance source is `scripts/lab-control/hermes` in TerraGroq/WilliamOS. The deployed `C:\HermesLab` tree is a runtime, not an independent source repository. This record supersedes the August hardware/storage and legacy watchdog instructions.

- Inference: Tesla P40 UUID `GPU-4f7d4396-9304-d12f-7e9b-7f04d1236fc2`, TCC, 150 W. RTX 3050 is the display/chassis thermal proxy, not the inference owner.
- One owner: SYSTEM scheduled task `WilliamOS-HERMES-Ollama`, script `hermes/ollama-service/hermes-ollama-service.ps1`, executable `D:\HermesServices\ollama\v0.9.2\ollama.exe`, listener `127.0.0.1:11434`.
- Active models: `G:\HermesData\ollama\models`. D: model copies are historical rollback material, not serving configuration.
- Protected live ownership receipt: `C:\ProgramData\Hermes\inference\current-owner.json`. A responding endpoint alone does not establish ownership.
- Docker Desktop WSL data: `G:\DockerDesktopWSL\disk\docker_data.vhdx`. Preserve the configured named volumes and secrets during deployment.
- Appliance surface: standalone read-only HERMES Console at `127.0.0.1:3210`. HERMES appliance work is distinct from WilliamOS application development and deployment, as clarified by the owner on September 9. The existing inference task name is retained; no WilliamOS application files or services are part of this rollout.

`hermes-ai.config.json`, `start-ollama.ps1`, `HermesOllamaServe`, `HermesOllamaWatchdog` and watchdog heartbeat authority are retired. Do not reinstall them. `hermes-acceptance.ps1` is the current read-only acceptance suite; `verify-durability-after-reboot.ps1` invokes that same suite with the post-deployment reboot gate rather than maintaining a second acceptance implementation.

## Recovery and deployment

Deploy the approved source under `scripts/lab-control/hermes` to `C:\HermesLab\hermes`; the companion README and SERVICE-MAP under `scripts/lab-control` map to `C:\HermesLab`. Do not mirror/delete the runtime tree. Do not replace `.env`, ProgramData receipts, logs, frozen doctrine or backup generations with repository files. Preserve exact current Docker images; `start-hermes.ps1` pulls only with explicit `-PullImages`.

The existing daily producer and cross-node transport remain the recovery chain. `p40-guard.json` and `hermes-placement.json` are generated observations, not configuration: they remain captured in recovery where present but are not committed as fresh source truth. The backup inventory hash proves archived bytes; its file count may grow as source assets are installed and is not a hard-coded acceptance threshold.

Recovery additionally needs the pinned Ollama binary, model weights, Docker images/volumes, protected secrets, task definitions, firewall rules, and the protected frozen doctrine under ProgramData. Source alone cannot recreate secrets or historical receipt bytes. Provision owner-state ACLs with the Ollama installer before starting a restored owner. Use the latest successful off-host hash/readback/canary/config-inventory receipt; daily backup success does not establish current restore proof.

After rollout verify native health, exact owner/listener/model/GPU state, Docker G: location, doctrine, current backup and off-host readback, retained native alerts, and the standalone HERMES Console. Reboot durability requires an actual subsequent reboot and fresh evidence; an old commissioning receipt does not prove the current deployment survived reboot.
