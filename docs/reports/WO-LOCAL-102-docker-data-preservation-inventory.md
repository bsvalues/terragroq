# WO-LOCAL-102 — Docker Data Preservation Inventory

## Result

PASS / DATA PRESERVATION INVENTORY COMPLETE.

This work order inventories Docker resources that must be preserved before
resuming the WilliamOS app proof image refresh. No image rebuild, app wrapper
run, container start/stop/delete, image deletion, volume deletion, Docker reset,
Docker prune, cache mutation, database/schema change, backup restore, or
TerraFusion mutation was performed.

## Base

```text
origin/main = c7458141485bf9397efd0eb2d05a63beb00d0324
```

## Worktree

```text
BRANCH_AT_START: main
WORKTREE_STATE: clean except pre-existing untracked .obsidian/
```

## Docker Runtime

```text
DOCKER_CONTEXT: desktop-linux
DOCKER_VERSION: Client=29.5.3, Server=29.5.3
DOCKER_PS: returned container list
UNKNOWN_DUE_TO_DOCKER_TIMEOUT: none
```

## WilliamOS Resources

### Containers

```text
williamos-postgres-proof: running, healthy, postgres:16-bookworm, 127.0.0.1:15432 -> 5432
williamos-omen-app-proof: absent
```

`williamos-postgres-proof` mounts:

```text
C:\Users\bsval\williamos-local-runtime\backups -> /backup
williamos-local-runtime_williamos_pgdata -> /var/lib/postgresql/data
```

### Images

```text
williamos-app-proof:omen: present but stale, sha256:175d167f81ac2947a8de56bfa368918337cd55cb8495a5598bcd02280163377c, created 2026-07-03T17:32:17.52372634Z
williamos-app-proof:local: present, sha256:e244fdf6071ebdf9c1c0d12e6f11a05d7841dc4d604dbd72186eda8dd518537b, created 2026-07-03T04:14:34.657585326Z
postgres:16-bookworm: present, backing the WilliamOS Postgres proof container
```

### Volumes / Data

```text
williamos-local-runtime_williamos_pgdata: preserve
C:\Users\bsval\williamos-local-runtime\backups: preserve, bind-mounted into Postgres proof
```

## TerraFusion / PACS Resources

These resources are visible and must not be touched by the WilliamOS image
refresh.

### Containers

```text
terra-fusion-nginx: created, nginx:alpine
terra-fusion-main: exited, terraagent-terra-fusion-app
terra-fusion-db: exited, postgres:15
terrafusion-postgres-dev: exited, pgvector/pgvector:pg16
tf-pacs-bak-restore: exited, mcr.microsoft.com/mssql/server:2022-latest
tf-pacs-current-verify: exited, mcr.microsoft.com/mssql/server:2022-latest
tf-benton-wo004-sql: exited, mcr.microsoft.com/mssql/server:2019-latest
pacs-mdf-copy: exited, alpine
```

### Images

```text
terrafusion/local-node-toolbox:dev
terrafusion/local-dotnet-toolbox:dev
terraagent-terra-fusion-app:latest
postgres:15
pgvector/pgvector:pg16
mcr.microsoft.com/mssql/server:2022-latest
mcr.microsoft.com/mssql/server:2019-latest
nginx:alpine
```

### Volumes

```text
terraagent_postgres_data
terrafusion-dev_frontend-node-modules
terrafusion-dev_nuget-packages
terrafusion-dev_pnpm-store
terrafusion-dev_root-node-modules
tf_mssql_data
tf_mssql_data_pacs
pacs_baks
55112e2070bf5454e620eb24e76b4427ea4b681d78a186cec201c6a0543d7949
```

Additional local volumes visible but not classified as WilliamOS app-proof
refresh targets:

```text
backend_postgres-data
bsvalues-ubiquitous-invention_terragroq_db_data
2ca830581558132458aab9f34ea9b5728eabe9d3761b8a7bc95eb79f12413613
4d1f83ab480a980eeda33d03e7dce6d92feaebdf474547d654ea2078fe2edf1f
691ce00f754f33515094d10a6836c88c840c1a4b7d8930178fb00b479098b451
1759ce2234820de0dd13cc9d51bca91081f405fb12c3449c760085f60f400de1
3145a07a0e89f41aa22c485219b6fba1967219b1e208c4eee445ffb4089c6103
```

## Unrelated Running Docker MCP Containers

The following random-name containers are running from image
`sha256:bc972fc22f00` and were identified by labels as Docker MCP Heroku
containers:

```text
happy_rubin
practical_wu
mystifying_lichterman
unruffled_archimedes
```

They are unrelated to WilliamOS proof and were not touched.

## Data Loss Risks

- Deleting or recreating `williamos-postgres-proof` or
  `williamos-local-runtime_williamos_pgdata` can lose WilliamOS local Postgres
  state.
- Deleting or changing `C:\Users\bsval\williamos-local-runtime\backups` can
  remove local backup evidence.
- Docker prune/reset/cache cleanup may remove images, stopped containers,
  anonymous volumes, or build state needed by TerraFusion/PACS/WilliamOS lanes.
- TerraFusion and PACS containers/volumes are present and must remain outside
  the WilliamOS app proof image refresh.
- The WilliamOS app image refresh should target only `williamos-app-proof:omen`
  and should not delete unrelated images or volumes.

## Classification

```text
DATA_PRESERVATION_INVENTORY_COMPLETE: true
WILLIAMOS_POSTGRES_PROOF_STATE: healthy
WILLIAMOS_APP_PROOF_IMAGE_STATE: present but stale
PARTIAL_APP_CONTAINER_PRESENT: false
TERRAFUSION_RESOURCES_IDENTIFIED: true
UNKNOWN_DUE_TO_DOCKER_TIMEOUT: none
IMAGE_REFRESH_SAFE_TO_RESUME: true, if limited to the existing WilliamOS app proof image workflow
```

## Safety

```text
MUTATION_PERFORMED: false
IMAGE_REBUILD_ATTEMPTED: false
APP_WRAPPER_RUN: false
CONTAINERS_DELETED: false
IMAGES_DELETED: false
VOLUMES_MUTATED: false
TERRAFUSION_POSTGRES_TOUCHED: false
SECRETS_DISCLOSED: false
APP_CODE_CHANGED: false
PACKAGE_CHANGED: false
COMMAND_RUNNER_ADDED: false
DOCKER_INTEGRATION_ADDED_TO_APP: false
SERVICE_REGISTERED: false
SCHEDULE_CREATED: false
LAN_EXPOSURE_ENABLED: false
```

## Validation

```text
git status --short --branch: clean except .obsidian/
docker context ls: pass
docker version: pass
docker ps -a: pass
docker image ls: pass
docker volume ls: pass
docker inspect williamos-postgres-proof: pass
docker image inspect williamos-app-proof:omen/local: pass
docker inspect TerraFusion/PACS container metadata: pass
```

## Next Recommended WO

```text
WO-LOCAL-107 — Resume WilliamOS Proof Image Refresh
```

The next work order should rebuild only `williamos-app-proof:omen`, start only
`williamos-omen-app-proof` through the existing manual wrapper, and prove
`/api/local/runtime/status` returns `200` from the refreshed image.

