# WilliamOS authority registry — ATLAS service definition

The lab has exactly one authority oracle. Every governed mutation in WilliamOS asks it the same
question before it acts: *is there an active, unexpired, unrevoked grant, for this scope, this
action, this authority level, and this operator?* When it cannot answer, the correct behaviour is
refusal — and that is what the runtime does. So the oracle being unreachable does not corrupt
anything; it stops everything.

Until 2026-08-25 nothing in this repository declared it.

## What went wrong, and why a definition is the fix

`williamos-postgres` was created by hand on 2026-08-13 with a `docker run` that pinned its publish to
a literal address:

```
PortBindings : {"5432/tcp":[{"HostIp":"192.168.88.5","HostPort":"15432"}]}
```

ATLAS's DHCP lease moved to `192.168.88.8` on the 2026-08-25 power cycle. The host no longer held
`192.168.88.5`, so Docker could not create the binding — and rather than failing the container it
started it anyway, attached to **no** network, with **no** `docker-proxy` for 15432. `pg_isready`
inside reported *accepting connections* while `127.0.0.1:15432` and `192.168.88.8:15432` both
refused **on ATLAS itself**. A healthy-looking container, reachable from nowhere.

It could not be *restored*, only re-decided: `192.168.88.5` now belongs to a different device, and no
file anywhere said what the binding was supposed to be. That is the actual defect. A hand-typed
container has no owner, no rollback, and no reboot behaviour — the same lesson `#997` paid for on
HERMES, one subsystem over.

## The three files that own it now

| File | Owns |
| --- | --- |
| `compose.yaml` | the container: image, name, restart policy, volume, network, and the `0.0.0.0:15432` publish |
| `pg_hba.conf` | who may authenticate, mounted read-only so it cannot drift inside the data volume |
| `fabric-callers.json` | the declared allowlist, read by both policy layers |

`apply-network-policy.sh` renders the packet-layer half of `fabric-callers.json`, and
`williamos-authority-firewall.service` re-runs it at boot.

## Why the publish names no address

Because ATLAS's address is not a fact this repository may rely on. It has already moved once, and a
literal here re-creates the original defect on the next lease change. `0.0.0.0` is only safe with
both layers below, and neither is optional:

**1 · `pg_hba.conf`.** One database, one role, one host, `scram-sha-256`, and an explicit `reject`
for everything else. The policy previously in force ended with `host all all all scram-sha-256` —
every database, every role, from anywhere — which was harmless only for as long as the publish was
broken.

**2 · `DOCKER-USER`.** `ufw` is *not* this layer and cannot be. Docker publishes ports by DNAT in
`nat` PREROUTING; that traffic never traverses the `INPUT` chain `ufw` filters, so a host firewall
configured the obvious way reports a tidy policy and blocks nothing. `apply-network-policy.sh`
installs a dedicated `WILLIAMOS-AUTHORITY` chain and jumps to it from `DOCKER-USER`, which Docker
guarantees to consult and never rewrites.

Neither layer fails open. A missing or malformed `fabric-callers.json` exits non-zero with the port
left as it was; "we could not read the allowlist" must never become "there was nothing to enforce".

That extends to *applying* the policy, which is one `iptables-restore` transaction rather than a
flush of the live chain followed by rule-by-rule appends. The obvious way has a window in the middle
where the chain is empty — and an empty chain falls through to Docker's accept rules, so a failure
part-way through leaves tcp/15432 open to the LAN permanently, reached by a sequence of commands
that all returned zero until the one that did not. The restore either commits the new policy or
leaves the old one exactly as it was. `apply` then re-reads what it installed and exits non-zero if
it differs from the declaration.

## Install

```bash
sudo mkdir -p /opt/williamos/deploy/atlas
sudo cp -r williamos-authority-registry /opt/williamos/deploy/atlas/
cd /opt/williamos/deploy/atlas/williamos-authority-registry

sudo docker compose up -d
sudo ./apply-network-policy.sh apply

sudo cp williamos-authority-firewall.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now williamos-authority-firewall.service
```

`./apply-network-policy.sh check` verifies the installed chain against the declared list and exits
non-zero on drift. The systemd unit runs it as `ExecStartPost`, so the unit fails loudly rather than
reporting `active` over an unfiltered port.

## Adding a caller

Edit `fabric-callers.json` **and** `pg_hba.conf` — they are two enforcement points for one
declaration and are kept in step by `tests/authority-registry-service-definition.test.ts`. Then
`docker compose up -d` (to reload the mounted policy) and re-run the apply script.

## Rollback

Nothing here edits state in place, which is the point.

- **The access policy** lives in this directory and is mounted read-only. The copy inside
  `williamos_pgdata` was never modified; reverting means dropping the `hba_file` argument.
- **The container** is disposable. `williamos_pgdata` is an *external* named volume declared here
  precisely so compose cannot create an empty one beside it — a fresh database that looks healthy
  and knows about no grants at all is the worst available failure, and `external: true` is what
  makes it impossible.
- **The firewall** is a dedicated chain. `iptables -F WILLIAMOS-AUTHORITY && iptables -D DOCKER-USER
  -j WILLIAMOS-AUTHORITY` removes it without touching another owner's rules.

## Known residual

The allowlist names L3 addresses, so it does not survive a caller's DHCP lease change on its own —
tracked as `CONT-EXPV2-ALLOWLIST-ADDRESS-BOUND`. The owner is handling reservations separately. The
*software* is already address-independent: HERMES resolves ATLAS through the fabric registry
(`scripts/fabric/resolve-authority-registry-url.mjs`), never through a written-down address.
