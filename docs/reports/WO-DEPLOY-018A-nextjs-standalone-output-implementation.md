# WO-DEPLOY-018A Next.js Standalone Output Implementation

## Result

PARTIAL / STOPPED AT ENV STARTUP GATE.

Next.js standalone output is enabled and a sanitized standalone Azure artifact
can be built. Local packaging validation proved the artifact contains the server
entry point, static assets, materialized pnpm runtime dependencies, and no
`.env*` files.

A true no-env/no-secret local startup fails because Better Auth refuses to start
without `BETTER_AUTH_SECRET`. A diagnostic run with a disposable local
placeholder secret proves the standalone artifact can serve UI routes, while
health/readiness remain unavailable without full runtime configuration.

No Azure repair deployment was attempted because the approved condition was
local validation first, and a no-secret Azure artifact would still fail at
startup.

## Approved Boundary

Approved:

- implement the minimal Next.js standalone output packaging required for the
  Azure App Service proof path
- validate locally before Azure repair deployment
- deploy a repaired no-env/no-secret artifact to the existing Azure proof App
  Service only if local validation passes
- record deployed commit, artifact provenance, route results, and health/readiness
  limitations

Blocked and preserved:

- no app settings
- no secrets
- no connection strings
- no DNS change
- no Vercel change
- no production cutover
- no GitHub settings/rules changes
- no package dependency changes
- no DB/schema changes
- no auth/access behavior changes
- no Hermes/MCP/autonomy
- no release/tag
- no production-write behavior outside the approved Azure proof repair deployment

## Implementation

The Next.js configuration now enables `output: "standalone"` so `next build`
emits a portable server bundle at `.next/standalone`.

Focused config coverage asserts that standalone output remains enabled for the
Azure App Service proof packaging path.

Added `scripts/build_azure_standalone_artifact.ps1` to produce a sanitized ZIP
from `.next/standalone`. The helper:

- copies `.next/standalone`
- copies `.next/static`
- copies `public` when present
- removes `.env*` files from the artifact
- materializes pnpm virtual-store packages into `node_modules` for Azure runtime
  compatibility
- emits artifact size, SHA-256, and package completeness metadata

## Validation

| Check | Result |
| --- | --- |
| Focused config test | 3 passed |
| Full suite | 437 passed |
| `npm run build` | passed |
| Standalone artifact generated | passed |
| Artifact `.env*` files | 0 |
| Artifact `server.js` | present |
| Artifact `.next/static` | present |
| Artifact `node_modules/styled-jsx` | present |
| Artifact `node_modules/@swc/helpers` | present |

Artifact metadata:

| Field | Value |
| --- | --- |
| ZIP path | `%TEMP%\williamos-azure-standalone.zip` |
| Final ZIP path | `%TEMP%\williamos-azure-standalone-wo-deploy-018a-final3.zip` |
| Size | 32,741,446 bytes |
| SHA-256 | `92FCF94D3F8ACF051FDE5E6510C423949DFF9318CEDDAEEA79A3DCA0E382C0A0` |

Local no-env/no-secret startup:

| Check | Result |
| --- | --- |
| Process startup | starts, then emits Better Auth unhandled rejections |
| Failure | Better Auth requires `BETTER_AUTH_SECRET` |
| Azure deploy eligibility | blocked |

Local diagnostic startup with a disposable placeholder secret:

| Route | Result |
| --- | --- |
| `/` | 200 |
| `/api/health` | 503 |
| `/api/auth/readiness` | 503 |
| `/goal-console` | 200 |

The placeholder secret was local-only and was not written to the artifact,
repository, Azure, Vercel, or any environment configuration.

## Production Verification

Canonical production remained unchanged and healthy.

| Check | Result |
| --- | --- |
| `https://terragroq.vercel.app/api/health` | 200 |
| `https://terragroq.vercel.app/api/auth/readiness` | 200 |
| `https://terragroq.vercel.app/goal-console` | 200 |
| Security headers | present |
| `x-powered-by` | absent |

## Azure Proof Verification

The Azure proof app remains on the previous failing artifact because this WO did
not attempt a new Azure deployment.

| Check | Result |
| --- | --- |
| Azure root | timeout |
| Azure `/api/health` | 503 |
| Azure `/api/auth/readiness` | 503 |
| App settings | 0 |
| Connection strings | 0 |
| `linuxFxVersion` | `NODE|22-lts` |
| Startup command | empty |

## Azure Repair Deployment

Not attempted.

Reason:

The approved Azure repair deployment required local validation first. True
no-env/no-secret startup failed before route probing because
`BETTER_AUTH_SECRET` is required at server startup. Deploying the artifact to
Azure without app settings would reproduce a known startup failure rather than
prove the repair.

## Safety Rollup

| Gate | Result |
| --- | --- |
| Standalone output enabled | yes |
| Azure repair deploy attempted | no |
| Package dependency changes | no |
| App settings added | no |
| Secrets configured | no |
| Connection strings configured | no |
| DNS changed | no |
| Vercel changed | no |
| Production cutover | no |
| DB/schema changes | no |
| Auth/access changes | no |
| Hermes/MCP/autonomy | no |

## Next Recommended Work Order

`WO-DEPLOY-018B - Azure Minimal Runtime Env Gate`

Purpose:

Decide whether to allow minimal non-production App Service settings for the
Azure proof app before another repair deployment. At minimum, the proof needs a
non-production `BETTER_AUTH_SECRET` posture to start the server. Health/readiness
will also require an explicit decision about database/readiness configuration if
those routes must pass on Azure.

Do not redeploy Azure or add App Service settings until that gate is approved.
