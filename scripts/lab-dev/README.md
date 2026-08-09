# Stage 5 development preflight

`lab-dev-preflight.ps1` is a read-only, fail-closed topology check for the disposable Stage 5 configuration proof. It accepts only these overrides: `LAB_DEV_GIT_EXECUTABLE`, `LAB_DEV_SSH_EXECUTABLE`, `LAB_DEV_NOW_UTC`, `TERRAFUSION_REPO_PATH`, and `WILLIAMOS_REPO_PATH`.

Run it from the WilliamOS repository with `pwsh -NoProfile -File scripts/lab-dev/lab-dev-preflight.ps1`. It emits stable `KEY=VALUE` evidence and exits `0` only when both source contracts, both bounded node metadata probes, and WilliamOS database isolation are proven. Any missing or malformed evidence exits `2` with a sanitized `BLOCKER`.

The remote commands use noninteractive SSH with a five-second connection timeout and collect only Docker/Compose metadata: container name, image, running state, health state, published ports, and Atlas Compose service names. They do not query databases, inspect Forge, inspect container environment variables, execute inside containers, write remote state, or make changes to either node.

Set `TERRAFUSION_REPO_PATH` to the local TerraFusion checkout before running the preflight; a missing or blank value fails during precheck. `WILLIAMOS_REPO_PATH` remains optional and defaults to this repository. Local checkout paths and raw remote URLs are never printed.
