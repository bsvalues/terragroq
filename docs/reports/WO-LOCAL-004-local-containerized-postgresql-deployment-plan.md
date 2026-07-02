# WO-LOCAL-004 Local Containerized PostgreSQL Deployment Plan

## Result

PASS / OWNER DECISION GATE.

This packet defines a Docker-first local PostgreSQL proof plan for the HP OMEN
Phase 1 host. Kubernetes remains a later optional lane. This work order does not
start containers, install packages, create databases, run migrations, configure
secrets, change networking, or deploy WilliamOS.

## Base

`origin/main = 871eea4b2b939183c5d50c781d69cb163ca452ee`

## Context

Phase 1 host:

- HP OMEN Gaming Laptop 16-ap0xxx
- Windows 11 Home
- Docker and Kubernetes available
- localhost/LAN-first proof
- no public internet exposure

Phase 2 target:

- dedicated local always-on server
- Ubuntu Server LTS preferred
- PostgreSQL, reverse proxy, VPN/LAN access, and automated backups

## 1. Docker Compose vs Kubernetes for Phase 1

Recommended Phase 1: Docker Compose.

| Criterion | Docker Compose | Kubernetes |
| --- | --- | --- |
| Setup complexity | Low | Higher |
| Local proof speed | Strong | Slower |
| Debuggability | Simple logs, volumes, ports | More moving parts |
| PostgreSQL persistence | Named volume or bind mount | PVC/storage class required |
| Backup/restore | Straightforward `pg_dump`/volume path | Requires pod/volume operations |
| Migration to Ubuntu Server | Easy | Possible, but cluster posture needed |
| Production parity | Good enough for local proof | Better for future orchestration |
| Failure modes | Easier to reason about | More abstraction |

Decision:

Use Docker Compose for the first local PostgreSQL proof. Defer Kubernetes until
WilliamOS needs multi-service orchestration, local model services, workers, or a
cluster-style deployment.

## 2. PostgreSQL Image / Version Recommendation

Recommended image:

`postgres:16-bookworm`

Rationale:

- PostgreSQL 16 is mature and current enough for durable use.
- Debian/bookworm base is stable and familiar.
- Official image behavior is well documented.
- Works well with Docker Compose, named volumes, and standard backup tooling.

Alternative:

`postgres:17-bookworm` can be considered if the app and dependencies are
confirmed compatible, but PostgreSQL 16 is the lower-risk first proof.

Do not use `latest`.

## 3. Volume Persistence Plan

Recommended Phase 1 persistence:

- Docker named volume for PostgreSQL data
- separate host directory for backups
- no database files inside the app repo

Proposed names for a future approved implementation:

| Item | Proposed Name |
| --- | --- |
| Compose project | `williamos-local` |
| PostgreSQL service | `postgres` |
| Data volume | `williamos_pgdata` |
| Backup directory | owner-approved path outside repo |
| Database name | `williamos_local` |

Rules:

- never store database data under `C:\Users\bsval\william-os-devops`
- never commit volume contents or backup dumps
- add any future local backup directory to ignore rules if it could sit near the
  repo
- document volume name and backup path, not secret values

## 4. Backup / Restore Plan

Minimum backup plan before durable data:

1. Use `pg_dump` from the PostgreSQL container or host client.
2. Write backup files to a host directory outside the repo.
3. Copy backups to at least one off-host target.
4. Keep a restore command/runbook.
5. Test restore before treating the database as durable.

Future backup command shape, not authorized for execution in this WO:

```powershell
docker compose exec postgres pg_dump `
  --username "<db-user>" `
  --dbname "williamos_local" `
  --format custom `
  --file "/backup/williamos_local.dump"
```

Future restore command shape, not authorized for execution in this WO:

```powershell
docker compose exec postgres pg_restore `
  --username "<db-user>" `
  --dbname "williamos_local" `
  --clean `
  --if-exists `
  "/backup/williamos_local.dump"
```

Secret values must not appear in backup scripts, reports, or PRs.

## 5. Local-Only `DATABASE_URL` Handling

`DATABASE_URL` remains a secret.

Recommended future local value shape:

`postgres://<user>:<password>@127.0.0.1:<port>/williamos_local`

Rules:

- do not commit the value
- do not print the value
- do not put it in PR descriptions or reports
- store in a local env file or secret mechanism only after owner approval
- document presence by variable name only
- use localhost binding first

Recommended app posture:

- app connects to `127.0.0.1`
- PostgreSQL container port is bound to localhost only for first proof
- LAN clients access the app, not the database

## 6. LAN Access Boundaries

Default Phase 1 database exposure:

- PostgreSQL: localhost only
- WilliamOS app: localhost first, then LAN-only if separately approved
- public internet: blocked
- router port forwarding: blocked
- DNS changes: blocked

Database should not be exposed directly to LAN clients. If LAN access is needed,
only the app should be reachable; PostgreSQL should remain local to the host.

## 7. Kubernetes as Future Option

Kubernetes can be revisited later if WilliamOS needs:

- multiple coordinated services
- local AI/model services
- worker scheduling
- isolated environments
- production-like orchestration
- migration to a dedicated server or cluster

Kubernetes-specific concerns:

- persistent volume class
- secret management
- backup job design
- service exposure
- ingress/TLS
- resource limits
- operational complexity

Do not start Kubernetes for the first PostgreSQL proof.

## 8. Migration Path to Ubuntu Server

If the OMEN Docker Compose proof succeeds, migrate later by:

1. Provisioning a dedicated Ubuntu Server host.
2. Installing Docker Engine or native PostgreSQL, depending on the future target
   decision.
3. Creating a fresh PostgreSQL instance.
4. Restoring a tested dump from the OMEN proof.
5. Moving app env configuration to the server.
6. Running readiness checks.
7. Keeping the OMEN as the development workstation.

Docker Compose can be reused on Ubuntu Server for continuity, or replaced with
native PostgreSQL if the owner prefers lower container dependency.

## 9. What Remains Blocked Until Owner Approval

Blocked:

- starting a PostgreSQL container
- creating Docker Compose files
- installing Docker components
- enabling Kubernetes resources
- creating databases or users
- generating passwords
- writing `DATABASE_URL`
- running migrations
- exposing ports
- changing firewall/router/DNS
- deploying WilliamOS against the local database
- creating backup jobs
- changing auth/access behavior
- activating Hermes/MCP/autonomy

## 10. Future Implementation Gate

Next implementation gate should be:

`WO-LOCAL-005 - Local Docker Compose PostgreSQL Proof Gate`

That gate must explicitly approve:

- creating a Docker Compose file or local-only compose override
- starting the PostgreSQL container
- creating a database/user/password
- choosing a local port
- choosing a data volume
- choosing backup path
- creating local-only secret handling
- verifying PostgreSQL readiness

## Explicit Non-Mutation Statement

This work order does not start containers, install packages, create Docker
Compose files, create databases, run migrations, configure secrets, change
firewall/router/DNS, deploy WilliamOS, or alter auth/access/Hermes/MCP/autonomy
behavior.
