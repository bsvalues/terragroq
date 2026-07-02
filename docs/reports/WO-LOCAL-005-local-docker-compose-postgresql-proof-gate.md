# WO-LOCAL-005 Local Docker Compose PostgreSQL Proof Gate

## Result

PASS / OWNER DECISION GATE.

This packet prepares the first local Docker Compose PostgreSQL proof. It does
not create compose files, start containers, create databases, generate secrets,
run migrations, change networking, or deploy WilliamOS.

## Base

`origin/main = 7570389b558f4a376a88e39c82b2d7bc81c16c86`

## Context

WO-LOCAL-004 established:

- Docker Compose first for Phase 1
- Kubernetes deferred
- `postgres:16-bookworm` recommended
- database volume and backups outside the repo
- `DATABASE_URL` remains secret and uncommitted
- PostgreSQL binds localhost-only first

Current host:

- HP OMEN Gaming Laptop 16-ap0xxx
- Windows 11 Home
- Docker available
- local proof should be localhost/LAN-first

## 1. Exact Docker Compose Approach

Recommended first proof:

- one PostgreSQL service
- official `postgres:16-bookworm` image
- localhost-only port binding
- persistent named volume or external bind mount
- optional backup mount outside the repo
- no app service in the first DB-only proof
- no Kubernetes
- no public exposure

Future compose shape, not authorized for creation in this work order:

```yaml
services:
  postgres:
    image: postgres:16-bookworm
    restart: unless-stopped
    ports:
      - "127.0.0.1:5432:5432"
    environment:
      POSTGRES_DB: williamos_local
      POSTGRES_USER: williamos
      POSTGRES_PASSWORD: ${POSTGRES_PASSWORD}
    volumes:
      - williamos_pgdata:/var/lib/postgresql/data
      - <owner-approved-backup-path>:/backup
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U williamos -d williamos_local"]
      interval: 10s
      timeout: 5s
      retries: 5

volumes:
  williamos_pgdata:
```

This snippet is a design reference only. Do not create or run it without owner
approval.

## 2. Compose Config Location

Recommendation: operator-local folder first, not repo.

Reason:

- avoids committing local secrets or host-specific paths
- supports OMEN-specific proof without hardcoding local paths into repo
- keeps the repo clean until the deployment model stabilizes

Recommended future local folder:

`C:\Users\bsval\williamos-local-runtime`

Possible contents after explicit approval:

- `compose.yaml`
- `.env` or `.env.local` containing local-only secrets
- `backups\`
- `README.local.md`

Repo-owned compose files can be considered later after the local runtime shape is
proven and secrets/path handling is clean.

## 3. Persistent Data Outside Repo

Two acceptable persistence options:

| Option | Description | Recommendation |
| --- | --- | --- |
| Docker named volume | Docker manages data path. | Best first proof. |
| Explicit bind mount | Owner chooses exact path outside repo. | Better visibility, more path risk. |

Recommended first proof:

Use Docker named volume `williamos_pgdata`.

Rules:

- do not store database data in `C:\Users\bsval\william-os-devops`
- do not commit database files
- do not commit backups
- keep backups under an owner-approved path outside the repo

Recommended backup path:

`C:\Users\bsval\williamos-local-runtime\backups`

This path is not created by this work order.

## 4. Local `DATABASE_URL` Handling

`DATABASE_URL` is a secret.

Recommended future local connection shape:

`postgres://williamos:<redacted-password>@127.0.0.1:5432/williamos_local`

Rules:

- store the actual value only in an operator-local env file or approved secret
  store
- never commit the value
- never print the value in reports, PRs, logs, or screenshots
- report only `DATABASE_URL` presence/absence
- rotate the password if accidentally exposed

Recommended future locations:

| Secret | Location |
| --- | --- |
| `POSTGRES_PASSWORD` | operator-local compose `.env` file |
| `DATABASE_URL` | app `.env.local` or operator-local runtime env file, after approval |
| `BETTER_AUTH_SECRET` | existing local dev env or approved operator-local secret file |

No secret is created or changed by this work order.

## 5. Proving PostgreSQL Is Running

Future validation commands after owner approval:

```powershell
docker compose ps
docker compose logs postgres --tail 100
docker compose exec postgres pg_isready -U williamos -d williamos_local
docker compose exec postgres psql -U williamos -d williamos_local -c "select 1;"
```

Expected proof:

- container is running
- healthcheck is healthy
- `pg_isready` succeeds
- `select 1` succeeds
- no secret value appears in output

## 6. Connecting WilliamOS Locally

Future app connection flow after owner approval:

1. Start PostgreSQL container.
2. Store `DATABASE_URL` locally without committing it.
3. Run WilliamOS locally.
4. Verify:
   - `/`
   - `/goal-console`
   - `/api/health`
   - `/api/auth/readiness`

Expected after database and auth env are configured:

- `/api/health` returns 200
- `/api/auth/readiness` returns 200

If schema is missing, readiness may fail with a database/schema-specific error.
Schema migration is not included in this gate and must be separately approved.

## 7. Backup and Restore

Future backup command shape, not authorized for execution now:

```powershell
docker compose exec postgres pg_dump `
  --username williamos `
  --dbname williamos_local `
  --format custom `
  --file /backup/williamos_local.dump
```

Future restore command shape, not authorized for execution now:

```powershell
docker compose exec postgres pg_restore `
  --username williamos `
  --dbname williamos_local `
  --clean `
  --if-exists `
  /backup/williamos_local.dump
```

Backup rules:

- backup path outside repo
- test restore before trusting durable data
- copy backup off-host before any production-grade use
- do not include secrets in backup filenames, reports, or PRs

## 8. Owner Approval Required Before Container Start

Owner must explicitly approve:

1. Compose config location.
2. Data persistence model.
3. Backup path.
4. Local database name.
5. Local database user name.
6. Password creation method.
7. Local port binding.
8. Whether to create a repo-owned compose file or operator-local compose file.
9. Whether to connect WilliamOS immediately or only prove PostgreSQL first.
10. Whether schema migration is included or deferred.

Default recommendation:

- operator-local compose folder
- Docker named volume
- backup path outside repo
- localhost-only binding `127.0.0.1:5432:5432`
- prove PostgreSQL first
- defer WilliamOS connection and schema migration to the next gate

## 9. What Remains Blocked

Blocked until owner approval:

- creating compose files
- starting containers
- creating database users
- creating passwords
- creating databases
- configuring `DATABASE_URL`
- running migrations
- exposing ports beyond localhost
- changing firewall/router/DNS
- connecting WilliamOS to the database
- creating backup files
- deploying WilliamOS locally
- changing auth/access behavior
- activating Hermes/MCP/autonomy

## Next Recommended Work Order

`WO-LOCAL-006 - Local Docker Compose PostgreSQL Proof Implementation`

This should be the first implementation WO only if the owner approves the exact
local compose location, volume model, backup path, local-only secret handling,
and localhost binding.

Alternative:

`WO-LOCAL-005R - Local PostgreSQL Proof Deferral Packet` if the owner wants to
defer local database mutation and continue runbook/design work.

## Explicit Non-Mutation Statement

This work order does not start containers, create Docker Compose files, create
databases, create users, generate passwords, run migrations, configure secrets,
change firewall/router/DNS settings, expose public access, deploy WilliamOS, or
alter auth/access/Hermes/MCP/autonomy behavior.
