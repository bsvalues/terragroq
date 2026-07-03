# WO-LOCAL-014 — Single App Container Reproducibility Proof

## Result

PASS.

The WilliamOS single app image/container proof is repeatable from clean local commands. The same image build command, same container run command, same localhost port binding, and same route checks passed again after the WO-LOCAL-013 proof container had been removed.

## Base

```text
origin/main = 643d2357cbba6ecf967b318aa3877f73298240ad
```

## Commands Documented

### Build

```text
docker build -f Dockerfile.local-app-proof -t williamos-app-proof:local .
```

### Run

```text
docker run -d --name williamos-app-proof --env-file C:\Users\bsval\williamos-local-runtime\app-container.env -p 127.0.0.1:3100:3000 williamos-app-proof:local
```

### Verify

```text
GET http://127.0.0.1:3100/
GET http://127.0.0.1:3100/goal-console
GET http://127.0.0.1:3100/operator
GET http://127.0.0.1:3100/runtime
GET http://127.0.0.1:3100/work-orders
GET http://127.0.0.1:3100/api/health
GET http://127.0.0.1:3100/api/auth/readiness
```

### Cleanup

```text
docker rm -f williamos-app-proof
```

## Reproducibility Proof

First run:

```text
WO-LOCAL-013: pass
```

Cleanup before second run:

```text
williamos-app-proof container removed
127.0.0.1:3100 free
```

Second build:

```text
pass
```

Second run:

```text
williamos-app-proof started
127.0.0.1:3100 -> container 3000
```

Second route proof:

```text
/                    200
/goal-console        200
/operator            200
/runtime             200
/work-orders         200
/api/health          200
/api/auth/readiness  200
```

Second cleanup:

```text
williamos-app-proof container removed
127.0.0.1:3100 no listener
```

## Database Proof

The existing WilliamOS PostgreSQL proof stayed healthy:

```text
williamos-postgres-proof: healthy
127.0.0.1:15432 -> container 5432
pg_isready: accepting connections
```

No DB migration was run.

No schema mutation was performed.

TerraFusion was not touched.

## Findings

The proof is repeatable with the same documented commands.

No hidden manual step was required after the operator-local `app-container.env` was corrected in WO-LOCAL-013.

The build continues to emit Better Auth warnings during static generation because build-time auth secrets are intentionally not baked into the image. Runtime readiness is green once the container receives operator-local env at run time.

## Validation

```text
git diff --check: pass
npm test -- --run: pass, 106 files / 437 tests
npm run build: pass
```

Note: the first build attempt hit the known stale generated `.next/standalone` Windows `EPERM` scan error. The generated `.next` directory was removed from inside the repository and the build was rerun successfully.

## Safety Posture

```text
REPRODUCIBLE: true
SAME_COMMANDS_USED: true
HEALTHCHECKS_PASS: true
CONTAINER_LEFT_RUNNING: false
SECRETS_DISCLOSED: false
DB_SCHEMA_CHANGED: false
DB_MIGRATION_PERFORMED: false
PACKAGE_CHANGED: false
AZURE_CHANGED: false
VERCEL_CHANGED: false
DNS_CHANGED: false
PUBLIC_EXPOSURE: false
AUTONOMY_CHANGED: false
```

## Next Recommended WO

WO-LOCAL-015 — Compose Stack Dry Gate.

Purpose: define the local Compose stack topology, service names, network, volume, env, healthcheck, start/stop, and cleanup model before starting app and database services together.
