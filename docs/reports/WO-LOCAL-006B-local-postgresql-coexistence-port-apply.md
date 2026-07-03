# WO-LOCAL-006B Local PostgreSQL Coexistence Port Apply

## Result

PARTIAL / STOPPED AT SECOND PORT-CONFLICT OWNER GATE.

The owner decision was to preserve TerraFusion PostgreSQL on port 5432 and run
WilliamOS PostgreSQL separately on `127.0.0.1:5433`. The operator-local
WilliamOS runtime config was updated to port 5433, but the container could not
start because port 5433 is already occupied by a local `postgres` process.

No secret values are recorded in this report.

## Base

`origin/main = 6dd2a92d495670634972b5f79891b6029038a1ec`

## Owner Decision Applied

Decision:

- do not reuse TerraFusion PostgreSQL
- do not stop or move TerraFusion PostgreSQL
- keep TerraFusion and WilliamOS isolated
- run WilliamOS PostgreSQL separately on `127.0.0.1:5433`

Architecture intent:

| System | Host Port | Purpose | Action |
| --- | --- | --- | --- |
| TerraFusion | 5432 | TerraFusion development database | Leave alone |
| WilliamOS | 5433 | WilliamOS local proof database | Attempt isolated proof |

## Local Runtime Changes Outside Repo

Operator-local folder:

`C:\Users\bsval\williamos-local-runtime`

Updated outside-repo files:

| File | Change |
| --- | --- |
| `compose.yaml` | changed PostgreSQL binding to `127.0.0.1:5433:5432` |
| `app.env` | changed local-only `DATABASE_URL` to use port 5433 |

Secret-bearing files remain outside the repository. Secret values were not
printed or committed.

## Docker Attempt Result

Command attempted from the operator-local runtime folder:

`docker compose up -d postgres`

Result:

- image `postgres:16-bookworm` was pulled
- Docker network `williamos-local-runtime_default` was created
- Docker volume `williamos-local-runtime_williamos_pgdata` was created
- container `williamos-postgres-proof` was created
- container failed to start because port 5433 is unavailable

Docker error summary:

`ports are not available: exposing port TCP 127.0.0.1:5433`

## Current Local Port State

Observed:

| Port | Owner | Posture |
| --- | --- | --- |
| 5432 | `terrafusion-postgres-dev` Docker container | Running, left untouched |
| 5433 | local `postgres` process | Listening, left untouched |

`williamos-postgres-proof` state:

| Field | Value |
| --- | --- |
| Image | `postgres:16-bookworm` |
| Status | Created |
| Running | no |
| Published port | none active |

## What Was Not Done

| Action | Result |
| --- | --- |
| TerraFusion container stopped or changed | no |
| Local `postgres` process on 5433 stopped or changed | no |
| Alternate port guessed | no |
| WilliamOS container running | no |
| WilliamOS database created | no running DB proof |
| Schema migration run | no |
| Secrets committed | no |
| Firewall/router/DNS changed | no |
| Public exposure enabled | no |
| WilliamOS app connected to local DB | no |
| Auth/access changed | no |
| Hermes/MCP/autonomy changed | no |

## Owner Decision Required

Choose one:

1. Authorize a new isolated WilliamOS port, recommended `127.0.0.1:15432:5432`.
2. Authorize stopping or moving the local `postgres` process currently listening
   on 5433.
3. Authorize inspection of the local 5433 PostgreSQL process to determine what
   owns it and whether it should remain.
4. Authorize cleanup of the created but non-running `williamos-postgres-proof`
   container/network/volume.
5. Defer the local PostgreSQL proof.

Recommended path:

Use `127.0.0.1:15432:5432` for WilliamOS. This preserves both TerraFusion on
5432 and the existing local PostgreSQL process on 5433 while keeping WilliamOS
isolated.

## Safety Rollup

| Gate | Result |
| --- | --- |
| Container image pulled | yes |
| Docker network created | yes |
| Docker volume created | yes |
| Container created | yes, not running |
| Existing containers/processes changed | no |
| Secret values disclosed | no |
| Database migration run | no |
| Public exposure | no |
| DNS/firewall/router changed | no |

## Next Recommended Work Order

`WO-LOCAL-006C - Local PostgreSQL Alternate Port Apply`

Proposed approval:

- use `127.0.0.1:15432:5432`
- update operator-local `compose.yaml` and `app.env`
- start the existing created container after recreating it if required
- verify `pg_isready`
- verify `select 1`
- do not touch TerraFusion, the 5433 listener, firewall/router/DNS, or public
  exposure
