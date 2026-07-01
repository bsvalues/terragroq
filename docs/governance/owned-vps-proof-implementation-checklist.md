# WO-DEPLOY-005 Owned VPS/VM Proof Implementation Checklist

## Result

CHECKLIST READY FOR OWNER REVIEW.

This checklist translates the owned VPS/VM runbook into a staged proof plan.
It is not an authorization to provision, access, configure, deploy, migrate, or
change production.

## Scope

Allowed in this Work Order:

- implementation sequence
- placeholder command templates
- environment inventory template without secrets
- server requirement checklist
- DNS/TLS checklist
- CI/provenance checklist
- rollback checklist
- owner approval gates

Blocked in this Work Order:

- server provisioning or purchase
- server login
- package installation on a server
- deploy
- DNS changes
- Vercel changes
- env secret creation
- GitHub rules changes
- code/runtime behavior changes
- DB/schema changes
- auth/access behavior changes
- Hermes/MCP/autonomy
- release or tag
- production-write behavior

## Phase 0 - Owner Inputs Required

Do not proceed to provisioning until these are filled:

| Input | Value |
| --- | --- |
| Provider | `<provider>` |
| Region | `<region>` |
| Budget ceiling | `<monthly-budget>` |
| Proof hostname | `<temporary-hostname-or-domain>` |
| SSH key owner | `<owner>` |
| Admin source IP policy | `<ip-policy>` |
| Process manager | `<process-manager>` |
| Reverse proxy | `<reverse-proxy>` |
| TLS approach | `<tls-approach>` |
| Backup location | `<backup-location>` |
| Log retention | `<retention-window>` |
| Provenance mechanism | `<provenance-file-or-endpoint>` |
| Vercel role | `<preview-only-or-temporary-production>` |

Owner gate:

```text
OWNER_APPROVAL:
Proceed to VPS proof provisioning: YES/NO
Provider:
Region:
Budget ceiling:
Proof hostname:
SSH/key policy:
Env migration authorized: NO unless separately approved
DNS cutover authorized: NO unless separately approved
Production traffic authorized: NO unless separately approved
```

## Phase 1 - Pre-Provisioning Checklist

Before any server exists:

- confirm current `origin/main`
- confirm no uncommitted local changes
- confirm full test suite passes
- confirm production build passes
- confirm current production remains healthy
- confirm access grants remain disabled
- confirm Hermes/MCP/autonomy remain disabled
- confirm no env secrets are in git
- confirm rollback target remains current Vercel production

Command templates:

```powershell
git status --short
git rev-parse origin/main
npm test -- --run
npm run build
Invoke-WebRequest https://terragroq.vercel.app/api/health -UseBasicParsing
Invoke-WebRequest https://terragroq.vercel.app/api/auth/readiness -UseBasicParsing
```

## Phase 2 - Provisioning Gate

Provisioning is not authorized by this checklist.

If the owner later authorizes provisioning, the next Work Order must specify:

- exact provider
- exact instance size
- exact region
- exact image
- exact SSH key
- firewall rules
- snapshot/backup posture
- billing owner
- cancellation/rollback plan

Do not execute:

```text
<provider-cli> server create ...
ssh <user>@<host>
```

## Phase 3 - Server Bootstrap Template

Server bootstrap is not authorized by this checklist.

Future command template only:

```bash
# Placeholder only. Do not run without a provisioning Work Order.
sudo apt-get update
sudo apt-get install -y git curl build-essential <reverse-proxy> <process-manager>
node --version
npm --version
```

Required bootstrap evidence:

- OS version
- firewall status
- non-root app user exists
- SSH access policy confirmed
- reverse proxy installed
- process manager installed
- log rotation configured

## Phase 4 - Environment Template

Do not create or copy secrets in this Work Order.

Future env file template:

```dotenv
DATABASE_URL=<secret>
BETTER_AUTH_SECRET=<secret>
BETTER_AUTH_URL=https://<proof-hostname>
BETTER_AUTH_TRUSTED_ORIGINS=https://<proof-hostname>
OPENAI_API_KEY=<secret-or-gateway-equivalent>
AUTH_EMAIL_OTP_ENABLED=false
ACCESS_GRANTS_ENABLED=false
```

Rules:

- no env file committed
- no secrets in shell history
- no secrets in logs
- access grants remain disabled
- OTP sending remains disabled unless separately authorized

## Phase 5 - Build and Release Template

Deployment is not authorized by this checklist.

Future release template:

```bash
# Placeholder only. Do not run without a deployment Work Order.
git clone git@github.com:bsvalues/terragroq.git /opt/williamos/releases/<sha>
cd /opt/williamos/releases/<sha>
git checkout <approved-main-sha>
npm ci
npm test -- --run
npm run build
ln -sfn /opt/williamos/releases/<sha> /opt/williamos/current
```

Required evidence:

- approved main SHA
- test result
- build result
- release path
- package manager used
- no package changes

## Phase 6 - Process Manager Template

Process manager activation is not authorized by this checklist.

Future template:

```bash
# Placeholder only. Do not run without a deployment Work Order.
<process-manager> start npm --name williamos -- start
<process-manager> status williamos
<process-manager> logs williamos --lines 100
```

Required evidence:

- process runs as non-root app user
- restart policy defined
- boot policy defined
- logs available
- rollback command known

## Phase 7 - Reverse Proxy and TLS Template

Reverse proxy and TLS changes are not authorized by this checklist.

Future template:

```nginx
# Placeholder only. Do not install without a deployment Work Order.
server {
  listen 443 ssl;
  server_name <proof-hostname>;

  location / {
    proxy_pass http://127.0.0.1:<app-port>;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
  }
}
```

Required evidence:

- TLS certificate valid
- internal app port not exposed publicly
- headers preserved
- proof hostname returns expected route

## Phase 8 - Provenance Requirement

Before any proof can be considered valid, it must expose or record:

- deployed commit SHA
- deploy timestamp
- deploy actor/process
- target host
- release directory
- test/build evidence
- health result
- auth readiness result
- security-header result
- rollback target

Future provenance template:

```json
{
  "commit": "<approved-main-sha>",
  "deployedAt": "<iso-timestamp>",
  "targetHost": "<proof-hostname>",
  "releasePath": "/opt/williamos/releases/<sha>",
  "rollbackTarget": "<previous-release-or-vercel>",
  "health": "pending",
  "authReadiness": "pending",
  "securityHeaders": "pending"
}
```

## Phase 9 - Verification Checklist

Proof verification must include:

```powershell
Invoke-WebRequest https://<proof-hostname>/api/health -UseBasicParsing
Invoke-WebRequest https://<proof-hostname>/api/auth/readiness -UseBasicParsing
Invoke-WebRequest https://<proof-hostname>/goal-console -UseBasicParsing
Invoke-WebRequest https://<proof-hostname>/api/access-grants/issue -Method POST -Body '{}' -ContentType 'application/json' -UseBasicParsing
Invoke-WebRequest https://<proof-hostname>/api/access-grants/accept -Method POST -Body '{}' -ContentType 'application/json' -UseBasicParsing
```

Expected:

- health returns `200` and `status: ok`
- auth readiness returns `200` and `ready: true`
- `goal-console` returns `200`
- security headers are present
- `x-powered-by` is absent
- access grant issue/accept routes return disabled status
- Hermes/MCP/autonomy remain disabled
- deployed commit provenance matches approved SHA

## Phase 10 - Rollback Checklist

Rollback must be proven before traffic migration.

Rollback template:

```bash
# Placeholder only. Do not run without rollback authorization.
ln -sfn /opt/williamos/releases/<last-known-good-sha> /opt/williamos/current
<process-manager> restart williamos
```

Rollback verification:

- health passes
- auth readiness passes
- security headers remain present
- deployed commit matches rollback target
- logs show clean restart

## Phase 11 - DNS and Traffic Gate

DNS and traffic changes are not authorized by this checklist.

Before DNS cutover:

- proof host is healthy
- rollback is proven
- auth trusted origins are approved for the final domain
- Vercel fallback posture is documented
- TTL strategy is approved
- owner explicitly authorizes DNS cutover

## Final Stop Condition

This checklist stops before:

- provisioning
- server access
- deploy
- DNS
- env secret creation
- production traffic

Next authorized Work Order must explicitly state which one of those gates, if
any, is approved.

## Next Recommended Work Order

`WO-DEPLOY-006 - Owned VPS/VM Proof Provisioning Gate`

Mode: owner approval required before any provider, server, SSH, DNS, env, or
deployment action.
