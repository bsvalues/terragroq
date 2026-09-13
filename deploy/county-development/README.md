# WilliamOS County Development

`county-development` is a first-class deployment profile of the same WilliamOS product. It runs the WilliamOS service, PostgreSQL/pgvector state, native Cockpit, and Ollama inference locally on one Windows workstation under the signed-in user. It does not contact or depend on personal HERMES.

## Intended use

- TerraFusion source development from a verified local `bsvalues/terrafusion_os_1.0` checkout.
- Local coding assistance through a loopback-only OpenAI-compatible Ollama endpoint.
- Persistent WilliamOS Spaces, files, layout, developer preview, bounded runs, and review surfaces.
- Public, synthetic, and County-controlled development information kept inside the County workstation boundary.

This profile is **not** a way to bypass County security policy, application control, removable-media controls, or AI approval. The package can be copied by approved media or GitHub, but installation and execution still require County authorization.

## Hard boundary

County Development rejects:

- personal HERMES as its service, database, preview, or inference endpoint;
- non-loopback database, service, preview, or inference URLs;
- known remote-model provider secrets;
- silent external inference fallback;
- browser-selected repository identity or arbitrary workspace authority;
- inbound LAN/public listeners, firewall changes, Docker, WSL, and administrator-only services.

The packaged service binds to `127.0.0.1` only. Git/GitHub operations initiated for source development remain separate, visible project operations; no protected Benton data may be committed or transmitted.

## Package layout

The generated Windows x64 bundle contains:

- the production Next.js standalone WilliamOS application;
- a private Node.js runtime;
- portable PostgreSQL with pgvector;
- the pinned Ollama Windows runtime;
- the County Development native Cockpit;
- the WilliamOS schema bootstrap;
- user-token preflight/install/start/stop/status/verify/rollback/uninstall tooling;
- a source-revision and SHA-256 manifest.

Model weights are emitted as a separate `WilliamOS-County-Models` artifact so the application package can be reviewed and updated without repeatedly moving several gigabytes. Extract the model artifact beside the application bundle before first installation, or pass its `models` directory to the management script.

## First launch

Run `WilliamOS-County-Development.cmd` from the extracted bundle.

The launcher:

1. verifies the package manifest;
2. copies the application into `%LOCALAPPDATA%\\Programs\\WilliamOSCountyDevelopment`;
3. asks for the County owner email and the local TerraFusion checkout on first installation;
4. creates user-only secrets and data under `%LOCALAPPDATA%\\WilliamOSCountyDevelopment`;
5. initializes loopback PostgreSQL/pgvector and the WilliamOS schema;
6. starts loopback Ollama and verifies both required models;
7. starts WilliamOS on `http://127.0.0.1:3200`;
8. opens bootstrap sign-up for the first owner, then uses the native Cockpit on later launches.

No Windows service, scheduled task, firewall rule, Docker engine, WSL distribution, or machine-wide environment variable is created.

## Verified update and rollback

Before replacing an existing installation from a newer extracted package, the manager stops only the processes it owns, verifies the installed manifest, and creates one previous-version rollback slot under the user data directory. The slot contains the previous program payload, its exact source identity, and the matching non-secret deployment configuration. Secrets, PostgreSQL data, models, Spaces, files, and other user state remain in their normal data locations and are never copied into the program snapshot.

A failed update automatically attempts to restore and restart that verified previous version. `-Action Rollback` performs the same restoration explicitly. Rollback changes program/configuration identity only; it is not a database point-in-time restore. A package that cannot verify its hashes, source identity, required runtime, local models, or County boundary fails closed.

## TerraFusion developer preview

County Development binds its Preview surface to the canonical local TerraFusion preview origin `http://127.0.0.1:3102/`. Start the real preview from the verified TerraFusion checkout with:

```powershell
pnpm run dev:preview
```

WilliamOS admits that runtime only after it is reachable, frameable, and identifies itself as TerraFusion. The County package does not silently start a simulated preview or treat a health response as the product experience. A different County-approved loopback origin may be supplied during installation with `-PreviewUrl`; URLs with a non-loopback host, credentials, or query parameters are refused.

## Commands

```powershell
# Verify package hashes and workstation prerequisites without installing
.\deploy\county-development\Manage-WilliamOSCountyDevelopment.ps1 -Action Preflight

# Start or install from the extracted package
.\deploy\county-development\Manage-WilliamOSCountyDevelopment.ps1 -Action Launch

# Install/update with an alternate approved loopback TerraFusion preview
.\deploy\county-development\Manage-WilliamOSCountyDevelopment.ps1 -Action Install `
  -PreviewUrl http://127.0.0.1:3102/

# Current process/health evidence
.\deploy\county-development\Manage-WilliamOSCountyDevelopment.ps1 -Action Status

# Fail unless installed files, exact source identity, checkout, models, and boundary are healthy
.\deploy\county-development\Manage-WilliamOSCountyDevelopment.ps1 -Action Verify

# Restore the verified previous program/configuration version and re-verify it
.\deploy\county-development\Manage-WilliamOSCountyDevelopment.ps1 -Action Rollback

# Stop only processes started by this package
.\deploy\county-development\Manage-WilliamOSCountyDevelopment.ps1 -Action Stop

# Remove program files but preserve user data and the rollback slot
.\deploy\county-development\Manage-WilliamOSCountyDevelopment.ps1 -Action Uninstall

# Remove program files and all local WilliamOS data, including rollback
.\deploy\county-development\Manage-WilliamOSCountyDevelopment.ps1 -Action Uninstall -PurgeData
```

## Truthful completion boundary

A generated package and passing CI do not prove County acceptance. Final acceptance requires the bundle to be admitted by County endpoint policy and the real installed journey to pass on the intended County workstation. Until that occurs, report `COUNTY_ENDPOINT_ACCEPTANCE_NOT_EXECUTED` rather than claiming the County installation is complete.
