# WO-DEPLOY-023A Azure PostgreSQL Proof Provisioning Gate

## Result

PASS / OWNER DECISION GATE.

No existing non-production `DATABASE_URL` was provided or confirmed for
WO-DEPLOY-022B. This packet defines the safer alternative: an explicit gate for
creating or selecting a dedicated Azure PostgreSQL proof dependency before any
Azure readiness remediation occurs.

This work order does not provision a database, configure `DATABASE_URL`, run
migrations, or mutate Azure.

## Base

`origin/main = baf93fd375d6419cd1be60114240e302605a938d`

## Current Proof State

Azure App Service proof:

| Field | Value |
| --- | --- |
| Resource group | `rg-williamos-proof-westus2` |
| App Service Plan | `asp-williamos-proof-westus2` |
| App Service | `williamos-proof-westus2` |
| Default hostname | `https://williamos-proof-westus2.azurewebsites.net` |
| Runtime | `NODE|22-lts` |
| Startup command | `node server.js` |

Current route posture:

| Route | Result |
| --- | --- |
| Azure `/` | 200 |
| Azure `/goal-console` | 200 |
| Azure `/api/health` | 503 |
| Azure `/api/auth/readiness` | 503 |
| Canonical `/api/health` | 200 |
| Canonical `/api/auth/readiness` | 200 |
| Canonical `/goal-console` | 200 |

Known cause:

`DATABASE_URL` is not configured on the Azure proof app.

## Why 022B Did Not Proceed

WO-DEPLOY-022B is valid only if the owner provides or confirms an existing
non-production database URL for Azure proof use.

No such value was provided. The agent must not:

- guess a database dependency
- borrow production credentials
- inspect or print local `.env` secret values
- create an Azure app setting without explicit value authority
- create or migrate a database under the 022B gate

Therefore the safe next gate is a dedicated Azure PostgreSQL proof decision.

## Owner Decision Required

The owner must decide whether to provision a new Azure PostgreSQL proof
dependency.

Decision options:

| Option | Meaning | Next Step |
| --- | --- | --- |
| Approve Azure PostgreSQL proof | Create a dedicated non-production PostgreSQL dependency for the Azure proof app. | `WO-DEPLOY-023B` |
| Defer DB proof | Keep Azure as shell-only proof; readiness APIs stay 503. | Continue design or cleanup. |
| Cleanup Azure proof | Stop/remove proof resources to control cost. | `WO-DEPLOY-014C` |
| Provide existing non-production DB | Return to existing-DB path with an owner-provided value. | `WO-DEPLOY-022B` |

No database provisioning is authorized by this packet.

## Proposed Azure PostgreSQL Proof Shape

Recommended default if owner approves provisioning later:

| Field | Recommendation |
| --- | --- |
| Service | Azure Database for PostgreSQL Flexible Server |
| Purpose | staging/proof only |
| Region | West US 2, matching current App Service proof |
| Resource group | reuse `rg-williamos-proof-westus2` unless owner chooses a DB-specific group |
| Server name | owner-approved globally unique name, for example `pg-williamos-proof-westus2` if available |
| Database name | `williamos_proof` |
| Public production use | blocked |
| DNS/cutover | blocked |
| Schema migration | separate gate |
| Secret delivery | out-of-band only; no secret values in git, reports, PRs, or logs |

Cost/SKU must be explicitly approved before provisioning. Do not assume a SKU.

## Infrastructure Approach

Preferred provisioning posture:

- use Infrastructure as Code for durable proof if this lane advances
- run preview/what-if before creation
- record resource IDs and cost posture
- avoid ad hoc commands unless explicitly authorized
- avoid hardcoded credentials
- use least privilege
- treat database credentials as secrets

If owner chooses a short-lived manual proof instead of IaC, that exception must
be stated in the provisioning work order.

## Network and Access Questions

Owner must decide:

1. Should the proof database accept Azure App Service access only?
2. Should public access be disabled or restricted?
3. Is VNet integration required for the proof, or deferred?
4. Should SSL be required? Recommended: yes.
5. Should administrator password auth be used for proof, or should identity-based
   access be designed first?
6. Should database logs/auditing be enabled for the proof?

Any answer requiring additional Azure networking resources should trigger a
separate network gate before provisioning.

## Schema and Migration Authority

Provisioning a PostgreSQL server is not the same as making WilliamOS ready.

Azure readiness can only become green if:

- the database exists
- the app receives `DATABASE_URL`
- the database schema matches the current application requirements
- connectivity succeeds from Azure App Service

Schema migration remains blocked until separately authorized.

If the proof database is empty, expected outcomes are:

- `/api/health` may change from `DATABASE_URL is not configured` to a database
  connectivity or schema error
- `/api/auth/readiness` may remain 503 until schema readiness is resolved

Therefore the next provisioning WO must clearly state whether it includes:

- DB server creation only
- database creation only
- schema migration
- app setting configuration
- readiness verification

Default recommendation: split provisioning from migration.

## Secret-Handling Rules

Mandatory:

- never print the generated password or connection string
- never commit `DATABASE_URL`
- never paste secret values into PRs, reports, logs, or chat
- report only presence, resource names, route statuses, and non-secret metadata
- rotate any credential that is accidentally exposed
- do not use production database credentials
- prefer Key Vault reference before any durable/staging posture

## Validation Plan After Future Provisioning

If a later WO provisions PostgreSQL, validate in stages:

1. Resource exists and metadata matches owner approval.
2. Cost/SKU/region/resource group match approval.
3. Secret value is not disclosed.
4. No `DATABASE_URL` app setting is configured unless explicitly approved.
5. No schema migration ran unless explicitly approved.
6. Canonical production remains healthy.

If a later WO also configures Azure `DATABASE_URL`, validate:

| Route | Expected |
| --- | --- |
| Azure `/` | 200 |
| Azure `/goal-console` | 200 |
| Azure `/api/health` | 200 or documented DB/schema-specific 503 |
| Azure `/api/auth/readiness` | 200 or documented DB/schema-specific 503 |
| Canonical `/api/health` | 200 |
| Canonical `/api/auth/readiness` | 200 |
| Canonical `/goal-console` | 200 |

## Rollback Plan

Rollback depends on what a future owner approves:

If only PostgreSQL resources are created:

1. Stop or delete proof DB resources as authorized.
2. Confirm no Azure App Service app setting was created.
3. Confirm Azure proof shell routes remain unchanged or document expected app
   posture.

If `DATABASE_URL` is later configured:

1. Remove only `DATABASE_URL` from Azure App Service app settings.
2. Restart App Service only if required.
3. Verify Azure returns to known shell-only posture:
   - shell routes 200
   - readiness APIs structured 503
4. Stop/delete DB resources only if owner authorizes cleanup.

No rollback may change DNS, Vercel, production traffic, auth/access behavior,
Hermes/MCP/autonomy, release, or tag state.

## Explicit Non-Mutation Statement

This work order does not create Azure PostgreSQL. It does not configure
`DATABASE_URL`. It does not create secrets. It does not run migrations. It does
not deploy. It does not change DNS, Vercel, production traffic, auth/access
behavior, Hermes/MCP/autonomy, releases, or tags.

## Next Recommended Work Order

Owner must choose one:

- `WO-DEPLOY-023B - Azure PostgreSQL Proof Provisioning`
- `WO-DEPLOY-023A-R - Azure PostgreSQL Proof Deferral Packet`
- `WO-DEPLOY-014C - Azure Proof Resource Stop/Cleanup Gate`
- `WO-DEPLOY-022B - Azure Existing Non-Production DATABASE_URL Apply Gate` if an
  existing non-production value is provided out-of-band

No Azure PostgreSQL resource should be created without explicit owner approval.
