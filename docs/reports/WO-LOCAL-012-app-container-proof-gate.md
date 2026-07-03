# WO-LOCAL-012 — App Container Proof Gate

## Result

PASS / OWNER IMPLEMENTATION GATE.

This work order defines the exact proof plan for running WilliamOS as a single app container before building an image, creating a Dockerfile, starting a container, or introducing a Docker Compose app service.

No Dockerfile was created. No image was built. No container was started. No stack was started. No secrets were disclosed.

## Base

```text
origin/main = bcc0bb9742558073a4ffad0bd9defae7211ac9cc
```

## Current Local Runtime State

Existing approved proof dependency:

```text
williamos-postgres-proof: healthy
PostgreSQL binding: 127.0.0.1:15432 -> container 5432
```

Existing isolation boundaries:

```text
TerraFusion PostgreSQL: untouched on 5432
Existing local postgres PID 10200: untouched on 5433
WilliamOS PostgreSQL: isolated on 15432
WilliamOS app manual proof: 127.0.0.1:3100
```

## App Container Plan

### Proof Objective

The next implementation work order should answer one question:

```text
Can WilliamOS execute correctly inside one local app container while using the existing isolated WilliamOS Postgres proof database?
```

It should not attempt to prove the full platform, durable service behavior, LAN access, public exposure, or Kubernetes readiness.

### Proposed Image Strategy

Recommended first proof:

```text
Use a local Dockerfile that builds and runs the existing Next.js standalone output.
```

Rationale:

- The repo already has `next.config.ts` configured for standalone output.
- Azure proof work already validated standalone packaging as the right direction.
- The manual production proof already validated `npm run build && npm run start`.
- A single app container should be the smallest next infrastructure step.

### Base Image

Recommended base image:

```text
node:22-bookworm-slim
```

Reasoning:

- Matches the approved Node.js 22 LTS runtime direction.
- Debian slim base is less surprising than Alpine for native Node dependencies.
- Better first proof path than distroless because debugging is still useful.

Future hardening options:

```text
node:22-alpine       later if dependency compatibility is proven
distroless/nodejs22  later after container proof and observability are stable
```

### Build Command

Recommended build command inside the image build:

```text
npm ci
npm run build
```

Build artifact expectation:

```text
.next/standalone
.next/static
public
```

The implementation work order should confirm whether static assets must be copied into the standalone directory for the container runtime.

### Runtime Command

Recommended runtime command:

```text
node server.js
```

Expected working directory:

```text
/app
```

Expected runtime artifact:

```text
/app/server.js
/app/.next/static
/app/public
```

### Container Name

Recommended proof container name:

```text
williamos-app-proof
```

### Image Name

Recommended local image name:

```text
williamos-app-proof:local
```

## Env Handling

### Required Runtime Env Names

The app container proof requires these names:

```text
DATABASE_URL
BETTER_AUTH_SECRET
BETTER_AUTH_URL
BETTER_AUTH_TRUSTED_ORIGINS
```

### Secret Supply Model

Secrets must be supplied from operator-local files outside the repo:

```text
C:\Users\bsval\williamos-local-runtime\app.env
```

Rules:

- Do not commit env files.
- Do not print env values.
- Do not bake secrets into the image.
- Do not pass secrets as Dockerfile `ARG`.
- Do not copy `.env.local` into the image.
- Use `--env-file` or an owner-approved compose env reference at runtime.

### Container `DATABASE_URL`

If the app container runs with host networking unavailable on Docker Desktop, it cannot use `127.0.0.1:15432` to reach the host from inside the container.

Recommended first proof database address:

```text
host.docker.internal:15432
```

Recommended container runtime value shape:

```text
postgres://<redacted>@host.docker.internal:15432/williamos_local
```

The implementation work order must create a container-specific operator-local env file or command override without exposing the secret value.

Recommended file:

```text
C:\Users\bsval\williamos-local-runtime\app-container.env
```

This file remains outside the repo and must not be printed.

## Port Binding

Recommended app container binding:

```text
127.0.0.1:3100 -> container 3000
```

Reasoning:

- Reuses the proven local app proof port.
- Restricts access to localhost.
- Avoids LAN/public exposure.

Container internal port:

```text
3000
```

Required runtime env:

```text
PORT=3000
HOSTNAME=0.0.0.0
```

Host exposure:

```text
127.0.0.1 only
```

## Health Checks

Required route checks:

```text
GET http://127.0.0.1:3100/
GET http://127.0.0.1:3100/goal-console
GET http://127.0.0.1:3100/operator
GET http://127.0.0.1:3100/runtime
GET http://127.0.0.1:3100/work-orders
GET http://127.0.0.1:3100/api/health
GET http://127.0.0.1:3100/api/auth/readiness
```

Expected:

```text
shell routes: 200
/api/health: 200 ok
/api/auth/readiness: 200 ready true
```

Container health command candidate:

```text
node -e "fetch('http://127.0.0.1:3000/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
```

If `fetch` is unavailable for any reason, use a Node HTTP request script rather than adding packages.

## DB Untouched Proof

The app container proof must verify:

```text
williamos-postgres-proof remains healthy
127.0.0.1:15432 remains bound
TerraFusion PostgreSQL remains unchanged on 5432
existing local postgres PID 10200 remains unchanged on 5433
no DB migration was run
no schema mutation was performed
```

Verification commands:

```text
docker compose ps
docker compose exec -T postgres pg_isready -U williamos -d williamos_local
Get-NetTCPConnection -LocalPort 5432,5433,15432,3100
```

## Proposed Future Build / Run / Stop Commands

These commands are design targets only. They are not executed in this work order.

### Build Image

```powershell
cd C:\Users\bsval\william-os-devops
docker build -f Dockerfile.local-app-proof -t williamos-app-proof:local .
```

### Create Container Env File

Recommended owner-local file:

```text
C:\Users\bsval\williamos-local-runtime\app-container.env
```

It should contain the same required env names as `app.env`, adjusted so `DATABASE_URL` reaches Postgres from inside the container through `host.docker.internal:15432`.

### Run Container

```powershell
docker run --rm --name williamos-app-proof `
  --env-file C:\Users\bsval\williamos-local-runtime\app-container.env `
  -e PORT=3000 `
  -e HOSTNAME=0.0.0.0 `
  -p 127.0.0.1:3100:3000 `
  williamos-app-proof:local
```

### Stop Container

```powershell
docker stop williamos-app-proof
```

### Remove Image

```powershell
docker rmi williamos-app-proof:local
```

Image removal should be optional. Keeping the proof image locally is acceptable if the implementation report records it.

## Stop Conditions

Stop immediately if any of these occur:

- Dockerfile requires committed secrets.
- Build requires package changes not explicitly approved.
- Build requires runtime code changes not explicitly approved.
- App container requires public/LAN binding.
- App container cannot reach Postgres without changing the Postgres container.
- Any step would modify TerraFusion PostgreSQL.
- Any step would modify PID `10200` on port `5433`.
- Any step requires DB migration or schema mutation.
- Any health endpoint fails in a way that suggests code/runtime behavior change is required.
- Any secret appears in stdout, logs, report text, PR text, or screenshots.
- Any Azure/Vercel/DNS/firewall/router/prod deploy action becomes necessary.

## Rollback / Cleanup

Expected cleanup commands:

```powershell
docker stop williamos-app-proof
docker rm williamos-app-proof
docker rmi williamos-app-proof:local
```

If using `--rm`, explicit container removal may be unnecessary after stop.

Confirm cleanup:

```powershell
docker ps -a --filter "name=williamos-app-proof"
Get-NetTCPConnection -LocalPort 3100 -ErrorAction SilentlyContinue
```

Expected post-cleanup:

```text
no williamos-app-proof container running
no listener on 3100
williamos-postgres-proof still healthy
```

## Safety Posture

```text
CONTAINERS_CREATED: false
IMAGES_BUILT: false
STACK_STARTED: false
DOCKERFILE_CREATED: false
SECRETS_DISCLOSED: false
DB_MIGRATION_PERFORMED: false
PUBLIC_EXPOSURE: false
AZURE_CHANGED: false
VERCEL_CHANGED: false
DNS_CHANGED: false
PRODUCTION_DEPLOYED: false
HERMES_MCP_AUTONOMY_CHANGED: false
```

## Owner Decision Required

To proceed, approve:

```text
WO-LOCAL-013 — Single App Image / Container Proof
```

Allowed scope should be limited to:

- create a local proof Dockerfile
- create/update no-secret Docker ignore if required
- build one local WilliamOS app image
- create a container-specific operator-local env file outside the repo if needed
- run one app container bound to `127.0.0.1:3100`
- verify routes and DB readiness
- stop the container after proof unless explicitly approved to keep it running
- document evidence

Still blocked:

- no Docker Compose app stack
- no durable service/startup item
- no public exposure
- no DB migration/schema mutation
- no production deploy
- no Azure/Vercel/DNS/firewall/router changes
- no Hermes/MCP/autonomy

## Validation

```text
git diff --check: pass
npm test -- --run: pass, 106 files / 437 tests
npm run build: pass
```

Note: the first build attempt hit the known stale generated `.next/standalone` Windows `EPERM` scan error. The generated `.next` directory was removed from inside the repository and the build was rerun successfully.

## Next Recommended WO

WO-LOCAL-013 — Single App Image / Container Proof.

Purpose: implement the smallest app-container proof defined here and stop before Docker Compose stack rollout or durable service behavior.
