# OMEN Stage 5 development flow

## Purpose

This runbook advances the current TerraFusion/WilliamOS development flow from the OMEN cockpit without changing Hermes, Atlas, Forge, or application data. It proves source identity and advertised lab capabilities before any disposable application configuration is attempted.

The successful preflight state means **ready for a disposable configuration proof**. It does not mean TerraFusion or WilliamOS is already configured to use Hermes or Atlas.

## Authority and naming

| Role | Canonical identity | Meaning |
| --- | --- | --- |
| TerraFusion source | `bsvalues/terrafusion_os_1.0` | Current TerraFusion product source. Historical Hermes clones and differently named repositories are not source authority. |
| WilliamOS source/control plane | `bsvalues/terragroq` | Current WilliamOS and OMEN control-plane source. |
| Atlas host | `atlas-node` | Physical durable-state host reached through SSH alias `atlas`. |
| Atlas product | `atlas-suite` | Product/repository name only; it must not be confused with the physical `atlas-node` host. |

Use clean linked worktrees that contain each repository's live remote `main`. Do not use a shared checkout, dirty worktree, detached historical source, or stale branch. The preflight validates these conditions and fails closed.

## Advertised capability contract

The preflight validates bounded Docker and Compose metadata only.

| Node | Advertised capability | Port | Interpretation |
| --- | --- | ---: | --- |
| Hermes | `open-webui` | 3000 | Advertised UI capability. |
| Hermes | `portainer` | 9000 | Advertised administration capability. |
| Hermes | `ollama` | 11434 | Advertised compute capability; it is not silently adopted as a WilliamOS provider. |
| Atlas | `tf-postgres` | 5432 | Advertised TerraFusion state endpoint. |
| Atlas | `tf-redis` | 6379 | Advertised TerraFusion state endpoint. |
| Atlas | `tf-mongo` | 27017 | Advertised capacity, not proof that current TerraFusion requires Mongo. |
| Atlas | `portainer_agent` | 9001 | Advertised administration metadata. |

Atlas Compose authority is `/home/bs/terrafusion/terrafusion-data.yml`, whose exact expected services are `mongo`, `postgres`, and `redis`. `portainer_agent` is independently advertised container metadata and is not a service in that Compose file.

## WilliamOS database and provider isolation

WilliamOS remains on its separate Neon Postgres contract. Never point WilliamOS `DATABASE_URL` at Atlas `tf-postgres` or any TerraFusion PostgreSQL instance. A passing preflight proves this repository still declares Neon and retains the explicit local-operator prohibition against reusing TerraFusion PostgreSQL.

Hermes Ollama remains an advertised lab capability. Selecting it as a WilliamOS AI provider would require an explicit, separately implemented product configuration; the preflight does not infer or apply that choice.

## Run the preflight

1. Prepare clean linked worktrees for both canonical repositories. Each worktree must contain its live remote `main`, and TerraFusion source must remain unmodified.
2. Select those worktrees through `TERRAFUSION_REPO_PATH` and `WILLIAMOS_REPO_PATH` in the local process.
3. From the WilliamOS worktree, run:

   ```powershell
   pwsh -NoProfile -File scripts/lab-dev/lab-dev-preflight.ps1
   ```

4. Accept success only when the process exits `0` and emits exactly these six green states:

   ```text
   TERRAFUSION_SOURCE=READY
   WILLIAMOS_SOURCE=READY
   HERMES_COMPUTE=AVAILABLE
   ATLAS_STATE_ENDPOINTS=ADVERTISED
   WILLIAMOS_DB_ISOLATION=PRESERVED
   PRODUCT_FLOW=READY_FOR_DISPOSABLE_CONFIGURATION_PROOF
   ```

Any unavailable, dirty, stale, mismatched, malformed, or incomplete evidence exits `2` with a sanitized `BLOCKER`. Correct the local source or metadata discrepancy and rerun; do not bypass a failed state.

## Evidence boundary

The preflight may read only:

- local Git remote identity, linked-worktree state, branch, cleanliness, live remote `main`, ancestry, and the TerraFusion canonical marker;
- Hermes container name, image, running state, health state, and published-port metadata;
- Atlas container name, image, running state, health state, published-port metadata, and Compose service names from the declared Compose file;
- the WilliamOS Neon declaration and local-operator database-isolation prohibition.

The preflight must not read or invoke:

- Postgres queries or readiness calls;
- Redis commands;
- Mongo queries;
- Ollama, Open WebUI, Portainer, or other service HTTP APIs;
- container environment variables, credentials, connection strings, or application payloads;
- `docker exec` or other commands inside containers;
- any Forge path, Forge verifier state, source-data contents, or storage payload;
- remote writes, service changes, database changes, firewall changes, mounts, remounts, cleanup, deletion, or bulk I/O.

Raw SSH output, absolute local worktree paths, remote URLs, environment values, and secrets are not completion evidence.

## Next product outcome

After a green preflight, the next bounded outcome is a **disposable, non-production configuration proof** using the validated current sources and the advertised lab endpoints. That proof must:

1. keep WilliamOS database isolation on Neon;
2. make any TerraFusion-to-Atlas state configuration explicit and disposable;
3. make any Hermes compute/provider integration explicit rather than inferred;
4. validate connectivity and application behavior without reading or mutating preserved Forge source data;
5. produce its own reversible configuration, tests, and evidence before any durable development topology is adopted.

The Stage 5 preflight supplies readiness evidence only. It neither wires the applications nor authorizes production, migration, destructive, or storage work.
