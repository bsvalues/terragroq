# WO-LOCAL-020 — LAN Access Safety Gate

## Result

PASS / DESIGN GATE ONLY.

This report defines when WilliamOS may later become reachable from the local network. It does not enable LAN access, change bindings, modify firewall rules, change router/DNS settings, expose the app publicly, or mutate runtime infrastructure.

## Base

```text
origin/main = cd42259f9ef604b19a3d7c07f88818436e3cceba
```

## Localhost-Only Default

Default posture:

```text
localhost-only
```

WilliamOS local proof services must continue to bind only to loopback addresses until a later owner-approved implementation work order changes that boundary.

Allowed default bindings:

```text
127.0.0.1:<approved-port>
localhost:<approved-port>
```

Current local proof convention:

```text
app proof preferred: 127.0.0.1:3100 -> container 3000
app proof fallback: 127.0.0.1:3101 -> container 3000
database proof: 127.0.0.1:15432 -> container 5432
```

## LAN Access Conditions

LAN access may only be considered after a separate owner-approved implementation gate confirms:

- the dedicated host is selected and stable
- the app is healthy on localhost
- `/api/health` returns 200
- `/api/auth/readiness` returns 200
- operator authentication remains required
- access grants remain disabled unless separately authorized
- firewall scope is limited to the private LAN
- no public router/NAT exposure exists
- rollback can return the service to localhost-only
- logs and evidence capture are in place

LAN access is not authorized in this batch.

## Allowed Bind Addresses

Potential future LAN bind addresses must be explicit and limited.

Future allowed candidates, only after approval:

```text
127.0.0.1
localhost
dedicated host private LAN IP, for example 192.168.x.x or 10.x.x.x
```

The actual private LAN IP must be documented at implementation time. Dynamic or guessed bind addresses are not acceptable.

## Blocked Bind Addresses

Blocked in this batch and blocked by default:

```text
0.0.0.0
::
public IP addresses
host port 3000
wildcard host publishing
Docker default all-interface publish
```

If Docker Compose is used later, port publishing must use an explicit host IP:

```yaml
ports:
  - "127.0.0.1:3100:3000"
```

Future LAN access would require a deliberate private-LAN binding such as:

```yaml
ports:
  - "<approved-private-lan-ip>:<approved-port>:3000"
```

This report does not authorize that change.

## Firewall Rule Requirements

No firewall rule is created in this batch.

Future firewall rule requirements:

- rule name must identify WilliamOS
- allowed source must be limited to the trusted private LAN or specific operator device
- allowed destination port must be the approved WilliamOS app port
- database port must remain private and not exposed to the LAN
- rule must be removable with a documented rollback command
- rule must not allow public profiles unless explicitly approved

Windows proof host note:

```text
Windows Defender Firewall changes are blocked until a later implementation gate.
```

Ubuntu dedicated-host note:

```text
ufw or equivalent firewall changes are blocked until a later implementation gate.
```

## Router / DNS Prohibition

Blocked:

- router port forwarding
- UPnP exposure
- public DNS records
- dynamic DNS
- Cloudflare tunnel
- Tailscale funnel
- reverse proxy public ingress
- public certificate issuance for internet exposure

Private VPN access may be designed later, but it is not authorized here.

## Auth / Readiness Requirements

LAN access may not be enabled unless these are true:

```text
/api/health: 200
/api/auth/readiness: 200
operator sign-in: functional
signup policy: unchanged
access grants: disabled unless separately authorized
Hermes/MCP/autonomy: disabled unless separately authorized
```

If readiness is degraded, LAN access remains blocked.

## Device Trust Assumptions

LAN access must not assume every device on the LAN is trusted.

Minimum posture:

- only Primary Operator devices should be expected to access WilliamOS
- shared guest Wi-Fi should be treated as untrusted
- IoT devices should be treated as untrusted
- LAN access should be considered convenience access, not a security boundary

Preferred future remote-access model:

```text
VPN/private overlay first, public internet last
```

## Rollback Plan

Future rollback from LAN access must include:

1. change app binding back to `127.0.0.1`
2. remove firewall allow rule
3. restart app service/container
4. verify `127.0.0.1` route still works
5. verify private LAN route no longer responds
6. document rollback evidence

No rollback was needed for this work order because no LAN exposure was enabled.

## Stop Conditions

Stop before implementation if LAN access requires:

- `0.0.0.0` binding
- host port `3000`
- public IP exposure
- router or DNS change
- database LAN exposure
- degraded auth/readiness
- auth/access policy change
- access grant activation
- secrets disclosure
- Hermes/MCP/autonomy activation

## Validation

```text
git diff --check: pass
npm test -- --run: pass, 106 files / 437 tests
npm run build: pass
```

Note:

```text
Validation was run serially after parallel test/build execution timed out without a source failure.
The generated .next directory was removed before the successful build to avoid the known Windows stale standalone artifact scan issue.
```

## Safety Posture

```text
LAN_EXPOSURE_ENABLED: false
FIREWALL_CHANGED: false
ROUTER_CHANGED: false
DNS_CHANGED: false
PUBLIC_EXPOSURE_ENABLED: false
BIND_0_0_0_0_ALLOWED: false
HOST_3000_ALLOWED: false
DATABASE_EXPOSED_TO_LAN: false
AUTH_BEHAVIOR_CHANGED: false
ACCESS_GRANTS_ENABLED: false
SECRETS_DISCLOSED: false
AZURE_CHANGED: false
VERCEL_CHANGED: false
PRODUCTION_DEPLOYED: false
HERMES_MCP_AUTONOMY_CHANGED: false
```

## Next Recommended WO

```text
WO-LOCAL-021 — Persistent Local Service Gate
```
