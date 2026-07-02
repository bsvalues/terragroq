# WO-DEPLOY-017A Next.js Standalone Artifact Repair Gate

## Result

OWNER DECISION REQUIRED.

This gate defines the exact implementation authority required before WilliamOS
may change its Next.js packaging posture for Azure App Service.

It does not authorize `next.config.ts` changes, package changes, Azure config
mutation, startup command changes, app settings, secrets, connection strings,
another deployment, DNS changes, Vercel changes, production cutover, GitHub
settings changes, DB/schema changes, auth/access behavior changes,
Hermes/MCP/autonomy, release, or tag work.

## Context

WO-DEPLOY-015A proved:

- Azure OneDeploy accepts the WilliamOS no-env/no-secret artifact.
- Azure records deployment provenance.
- The current source ZIP does not start on Azure App Service Linux.
- Azure reports `ContainerTimeout`.
- Routes return timeout/503.
- Canonical Vercel production remains healthy.

WO-DEPLOY-016A classified the problem as startup/packaging and recommended a
Next.js standalone artifact repair path.

## Current Facts

| Area | Current State |
| --- | --- |
| Next.js config | no `output: "standalone"` |
| Build command | `npm run build` / `next build` |
| Start command | `npm run start` / `next start` |
| Azure runtime | `NODE|22-lts` |
| Azure app command line | empty |
| Azure app settings | none |
| Azure connection strings | none |
| Azure proof app | running but routes return timeout/503 |

## Gate Purpose

Before any repair is implemented, the owner must decide whether to approve:

1. a minimal Next.js standalone output change
2. local standalone artifact inspection
3. a future no-secret standalone deployment gate
4. any Azure startup command design
5. rollback/cleanup posture if standalone still fails

## Proposed Minimal Code Change

The likely future implementation would modify `next.config.ts` only:

```ts
const nextConfig: NextConfig = {
  output: "standalone",
  poweredByHeader: false,
  async headers() {
    // existing security headers stay unchanged
  },
};
```

This should be tested locally before another Azure deployment is attempted.

## Proposed Artifact Layout

If standalone output is approved, the expected artifact should include:

- `.next/standalone/**`
- `.next/static/**`
- `public/**`, if present
- provenance manifest

The artifact must exclude:

- `.env*`
- local logs
- node_modules outside the standalone bundle
- build caches not required by the standalone server
- database dumps
- credentials

## Startup Command Design

The expected standalone startup command is likely:

```text
node server.js
```

But this must not be configured in Azure until a later deployment gate approves
it.

Open questions for implementation:

1. Does `.next/standalone/server.js` exist after build?
2. Does the standalone server respect Azure-provided `PORT`?
3. Should the artifact root be `.next/standalone` or a wrapper directory?
4. Does Azure App Service need an explicit startup command?
5. Can the app fail closed without `DATABASE_URL` and `BETTER_AUTH_SECRET`?

## Validation Required Before Deployment

Before another Azure deploy is authorized:

- `git diff --check`
- `npm test -- --run`
- `npm run build`
- confirm `.next/standalone/server.js` exists
- list standalone artifact contents
- confirm `.env*` files are excluded
- compute artifact SHA-256
- run local smoke if feasible without secrets
- record expected missing-env route behavior

## Future Deployment Gate Requirements

Even if standalone output is implemented successfully, a separate deployment
gate is still required before Azure receives another artifact.

That gate must specify:

- source commit
- artifact hash
- exact package layout
- whether Azure startup command may be set
- whether Azure app settings remain empty
- expected Azure route results
- rollback posture

## Rollback / Cleanup Posture

If standalone repair is not approved, or if owner does not want continued cost:

- run `WO-DEPLOY-014C - Azure Proof Resource Stop/Cleanup Gate`

If standalone implementation passes locally but Azure deployment fails later:

- do not add secrets
- do not change auth/access behavior
- do not mutate DB/schema
- stop and record logs
- choose cleanup, startup-command gate, Oryx gate, or IaC gate

## Cost Reminder

The Azure B1 Linux App Service Plan remains live and may continue accruing cost.

If the owner does not intend to approve a repair/deploy path soon, stop or clean
up the proof resources under a cleanup gate.

## Go / No-Go Table

| Gate | Status |
| --- | --- |
| Standalone output change approved | missing |
| Package/code changes approved | missing |
| Azure startup command approved | no |
| App settings approved | no |
| Another Azure deployment approved | no |
| Secrets approved | no |
| Connection strings approved | no |
| DNS/Vercel/cutover approved | no |
| Cleanup/stop approved | no |

## Explicitly Not Authorized

This packet does not authorize:

- package/code changes
- `next.config.ts` changes
- Azure config mutation
- App Service startup command changes
- app settings
- secrets
- connection strings
- another Azure deployment
- DNS changes
- Vercel changes
- production cutover
- GitHub settings or rules changes
- DB/schema changes
- auth/access behavior changes
- Hermes/MCP/autonomy
- release/tag
- production-write behavior beyond existing Azure proof resources

## Next Work Order Split

If approved:

- `WO-DEPLOY-018A - Next.js Standalone Output Implementation`

If owner wants to test startup command instead:

- `WO-DEPLOY-017B - Azure Startup Command Repair Gate`

If owner wants platform-native build repair:

- `WO-DEPLOY-017C - Oryx Build-On-Deploy Repair Gate`

If owner wants durable Azure deployment design:

- `WO-DEPLOY-017D - Azure App Service IaC/AZD Deployment Plan`

If owner wants to stop cost:

- `WO-DEPLOY-014C - Azure Proof Resource Stop/Cleanup Gate`

## Owner Decision Block

```text
OWNER_DECISION:
Approve WO-DEPLOY-018A Next.js standalone output implementation: YES/NO
Allowed code/config files:
Allow package changes: YES/NO
Allow Azure startup command change: NO unless separately approved
Allow Azure app settings: NO unless separately approved
Allow another Azure deploy: NO unless separately approved
Allow secrets: NO
Allow connection strings: NO
Rollback/cleanup posture:
Next authorized WO:
```
