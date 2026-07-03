# WO-LOCAL-013 — Single App Image / Container Proof

## Result

PASS.

WilliamOS was built and run once as a single local app container using the Next.js standalone output. The container reached the existing isolated WilliamOS PostgreSQL proof database and passed shell, health, and auth readiness checks.

The proof container was stopped and removed after verification.

## Base

```text
origin/main = c6fbf6e5084baf2578bff2934a4a84256e7c4dbe
```

## Files Changed

```text
.dockerignore
Dockerfile.local-app-proof
docs/reports/WO-LOCAL-013-single-app-image-container-proof.md
```

## Image Build

Image:

```text
williamos-app-proof:local
```

Image proof:

```text
IMAGE_BUILT: true
image id: 2d35586d9841
size: 404MB
```

Build notes:

- Initial Docker context load failed because a nested `control-center\backend\.pytest_cache` directory was unreadable.
- `.dockerignore` was tightened to exclude nested caches and unrelated local tooling folders.
- Initial pnpm install failed because pnpm 11 blocked dependency build scripts for `sharp` and `esbuild`.
- `Dockerfile.local-app-proof` now explicitly allows dependency build scripts inside the isolated image build with `pnpm config set dangerouslyAllowAllBuilds true`.
- No package manifest or lockfile changes were required.
- No secrets were passed at image build time.
- Better Auth emitted expected build-time warnings because secrets are intentionally not baked into the image.

## Runtime Container Proof

Container:

```text
williamos-app-proof
```

Port binding:

```text
127.0.0.1:3100 -> container 3000
```

Host port fallback:

```text
not needed
```

Env source:

```text
C:\Users\bsval\williamos-local-runtime\app-container.env
```

Secret handling:

```text
operator-local env only
no secret values printed
no secret values committed
no secrets baked into image
```

Env note:

- First container run reached shell routes and database connectivity but auth readiness returned 503 because the generated `app-container.env` had empty Better Auth values.
- The operator-local env file was regenerated from existing local env sources using strict parsing and wrapper-quote removal.
- The second run passed all checks.

## Health Checks

Final route proof:

```text
/                    200
/goal-console        200
/operator            200
/runtime             200
/work-orders         200
/api/health          200
/api/auth/readiness  200
```

Health summary:

```text
/api/health:
  status: ok
  database.ok: true
  auth.ok: true
  runtime.ok: true

/api/auth/readiness:
  ready: true
  databaseReady: true
  authReady: true
  emailOtp.enabled: false
  accessGrants.enabled: false
```

## DB Untouched Proof

WilliamOS PostgreSQL proof remained healthy:

```text
williamos-postgres-proof: healthy
127.0.0.1:15432 -> container 5432
pg_isready: accepting connections
```

No DB migration was run.

No schema mutation was performed.

TerraFusion remained isolated and untouched.

## Rollback / Cleanup

Cleanup executed:

```text
docker rm -f williamos-app-proof
```

Cleanup proof:

```text
williamos-app-proof container: removed
127.0.0.1:3100: no listener
williamos-postgres-proof: still healthy
```

The local image remains available for the next reproducibility proof:

```text
williamos-app-proof:local
```

## Validation

```text
git diff --check: pass
npm test -- --run: pass, 106 files / 437 tests
npm run build: pass
```

Note: the first build attempt hit the known stale generated `.next/standalone` Windows `EPERM` scan error. The generated `.next` directory was removed from inside the repository and the build was rerun successfully.

## Safety Posture

```text
IMAGE_BUILT: true
CONTAINER_STARTED: true
PORT_BINDING: 127.0.0.1:3100
LOCAL_PROCESS_LEFT_RUNNING: false
CONTAINER_LEFT_RUNNING: false
SECRETS_DISCLOSED: false
SECRETS_BAKED_IN_IMAGE: false
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

WO-LOCAL-014 — Single App Container Reproducibility Proof.

Purpose: prove the local app image/container proof is repeatable from clean commands by rebuilding, recreating, rerunning health checks, and cleaning up with the same documented sequence.
