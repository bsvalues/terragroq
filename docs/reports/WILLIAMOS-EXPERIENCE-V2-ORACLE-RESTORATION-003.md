# Experience V2 — authority oracle restoration, the narrow `#995` grant, and the terminal proof

**Lane:** ORACLE RESTORATION · **Date:** 2026-08-25 · `OWNER_COURIER_ACTIONS = 0`
**Branched from merged `main` `c3d822fa`** (post-`#1006`).
**Evidence:** `docs/reports/experience-v2-oracle-restoration/`

`#995` invariant 13's terminal leg has executed. The stamp exists on HERMES, a separate observation
found it, and the grant that authorised it has been revoked. This record says how, and it says the
four things that turned out to be wrong on the way — because three of them were only visible once
the one in front of them was fixed.

---

## The shape of it

The same driver, `RS-00-settle-stamp-identity.mjs`, run four times with the same arguments. Only the
world around it changed:

| # | When | Verdict |
| --- | --- | --- |
| 1 | before restoration | `BLOCKED_AT_AUTHORITY:AUTHORITY_UNREADABLE` |
| 2 | oracle republished, no grant | `BLOCKED_AT_AUTHORITY:AUTHORITY_NOT_GRANTED_NO_ROWS` |
| 3 | with `GRANT-0019` | **`SETTLED_MUTATION_EXECUTED`** |
| 4 | after revocation | `BLOCKED_AT_AUTHORITY:AUTHORITY_NOT_GRANTED_NO_COVERAGE` |

Run 4 left the ledger at exactly the byte count run 3 left it at, and the stamp's digest and mtime
unchanged. Nothing happened, which is the point of taking it.

---

## 1 · The oracle now has an owner

`williamos-postgres` was created by a hand-typed `docker run` on 2026-08-13 with its publish pinned
to `HostIp: 192.168.88.5`. When ATLAS's lease moved to `.8`, Docker could not create that binding and
started the container anyway — attached to no network, with no `docker-proxy`, serving on its own
socket. `#1006` could not repair it because there was nothing to re-apply: `.5` belongs to a
different device now, and no file anywhere said what the binding was supposed to be.

`deploy/atlas/williamos-authority-registry/` is that file. Same `#997` lesson, one subsystem over:
one owner, written down, so a reboot re-establishes the intent rather than the last thing typed.

`0.0.0.0:15432` names no interface deliberately — a literal here re-creates the original defect on
the next lease change. What makes it safe is two layers, neither optional and neither failing open.

**`pg_hba.conf`**, mounted read-only through `hba_file` so it cannot drift inside the data volume.
The server parsed five rules and no errors:

```
local  all          all                          trust      <- container unix socket only
local  replication  all                          trust
host   williamos    williamos   192.168.88.9     scram-sha-256
host   all          all         0.0.0.0/0        reject
host   all          all         ::/0             reject
```

It replaced `host all all all scram-sha-256` — every database, every role, from anywhere — which was
harmless only for as long as the publish was broken. The image's default `trust` on the container's
TCP loopback was deliberately not carried over. The copy inside `williamos_pgdata` is byte-unchanged
at `af0fdb73…` and is no longer consulted, so the rollback is "stop passing `hba_file`", not "restore
a file someone edited in place".

**`DOCKER-USER`**, applied by `apply-network-policy.sh` and re-applied at boot by
`williamos-authority-firewall.service` (`enabled`, `active`, `Result=success`). `ufw` cannot be this
layer: Docker publishes by DNAT in `nat` PREROUTING and that traffic never reaches the `INPUT` chain
`ufw` filters. `ufw` was, in fact, `inactive` on ATLAS the whole time.

The data was never at risk and is proven not to have moved: `williamos_pgdata` is declared
`external: true` — so compose cannot create an empty volume beside it, which is the worst available
failure here — and a `pg_dump` was taken before the container was replaced
(`b2a39ca4…`, 210,366 bytes, retained on ATLAS).

### The firewall rule that looked right and blocked nothing

Written the obvious way first:

```
-A WILLIAMOS-AUTHORITY -p tcp -m tcp --dport 15432 -j DROP
```

It installed cleanly. `DOCKER-USER`'s counter climbed to 18 packets. OMEN still reached the Postgres
wire protocol. Both rules read **0 packets**, because `nat` PREROUTING runs before `filter` FORWARD
and the port had already been rewritten `15432 → 5432` by the time the chain saw it. *A firewall
that matches nothing is indistinguishable from a firewall that is working* — the counter on the
parent chain even moves.

The fix is `-m conntrack --ctorigdstport 15432 --ctdir ORIGINAL`, which asks what the connection was
*originally* addressed to. `--ctdir ORIGINAL` is equally load-bearing: without it the DROP also
catches the reply direction of an allowed connection — whose source is the container, not the
allowlisted caller — and the allowlist silently breaks the one caller it exists to permit.

Measured after, from both sides, with counters that move:

| From | to 15432 | to 5432 / 6379 / 27017 / 9001 |
| --- | --- | --- |
| HERMES `192.168.88.9` (allowlisted) | server asks for credentials | — |
| OMEN `192.168.88.11` (not) | **dropped, no RST, no banner** | all still `OPEN` |

Nine refusal controls on the apply script, all exiting 1 with the port left as it was: absent caller
list, malformed JSON, empty caller list, malformed CIDR, missing port, bad mode, and `check`
detecting a hand-added rule as drift. `check` runs as the unit's `ExecStartPost`, so the unit fails
loudly rather than reporting `active` over an unfiltered port.

---

## 2 · HERMES stopped holding ATLAS's address

`lib/fabric/authority-registry-url.mjs` resolves the authority registry's host from the fabric
registry and substitutes **only** the host — role, password, port, database and query carry through
byte-for-byte. Five typed refusals, no fallback, because a fallback to the address in the source
string is exactly how a stale value survives the repair meant to remove it: right on the day it is
written, quietly wrong the day the lease moves. `CONT-EXPV2-HARDCODED-ADDRESS-CLASS`, fourth
occurrence.

`#1006`'s repaired path was verified without being touched: the live
`sync-models-to-forge.ps1` is byte-identical to merged `main` (`0b67f758…`) and `-ResolveOnly`
answers `bs@192.168.88.8` from `nodes.json`.

---

## 3 · The registry read end-to-end, and the 28 grants proven untouched

`OR-00-authority-readback.mjs` enumerates every grant column-for-column and digests the rendering,
then applies the route's *own* lookup (`"scope" = $1 AND "userId" = $2`) and the canonical
`grantCovers`. Read from HERMES over the LAN it returned `count: 28`, digest

```
dba0006cc86c4c35abc7d2fc58b00cacb38c03bd5698439e3c2e4ce6128353b7
```

— **byte-identical** to the baseline `psql` produced on ATLAS before this lane touched anything. Two
tools, two hosts, two transports, one number. After everything below, the same 28 rows still hash to
it, with exactly one row added.

---

## 4 · `GRANT-0019`

Recorded through `app/actions/authority.ts` `createAuthorityGrantWithResult`. **No SQL was written by
this lane.** That is not pedantry: the grant registry is not one table, and a hand-written INSERT
produces a row while producing none of the `GRANT-nnnn` ref allocated under the advisory lock, the
content hash, the `AUTHORITY_GRANTED` governance event, the `authority.granted` register entry, or
the Tier-2 ledger export. A grant missing those is identical in a `SELECT *` and invisible to every
audit surface built on them. All four were produced:

- `authority_grant` id 32, `GRANT-0019`, `contentHash be172d51…`
- `governance_event` 1081 `AUTHORITY_GRANTED`, `afterHash 8750ac92…`
- `event_log` 147 `authority.granted`
- `docs/devkit/authority/GRANT-0019.{md,json}` — carried back into this repository, and the `.md`'s
  own `sha256` **is** that `afterHash`

Narrowed on every axis the machinery has:

| Field | Value | Why |
| --- | --- | --- |
| `scope` | `#995` | exact |
| `allowedActions` | `["node.stamp-identity"]` | `grantCovers` matches by substring, so this is the tightest allowance possible |
| `authorityLevel` | `A3_WRITE_SHARED` | not a choice — `route.ts` requires it by constant and ranks are compared |
| `grantedTo` | `claude` | the lane exercising it |
| `workOrderId` | `null` | omitted, so no work-order row is touched |
| `blockedActions` | 16 entries | blocks beat allowances; none is a substring of the one operation |
| `expiresInHours` | 2 | see the defect below |

**The target restriction is not enforceable and is not claimed to be.** `authority_grant` has no
target column and `grantCovers` checks only level and action, so "the canonical HERMES node" is a
statement of intent recorded in `reason` and nothing more. What actually confines the mutation to one
machine is the route: it takes the endpoint from the transport registry rather than from the request,
and refuses any object absent from the canonical graph. `CONT-EXPV2-GRANT-HAS-NO-TARGET-PREDICATE`.

The recorder holds the grant as a **constant**, not arguments. There is no `--scope`, no `--level`,
no `--actions`. A general-purpose grant minter is precisely the tool that must not exist in a
repository whose whole authority story is that approval is not authority. It also refuses to run
twice: it applies the route's lookup first and reports an existing covering grant instead of creating
a second. Dry-run first — `28 → 28`, nothing recorded. Then `28 → 29`, `grantsCreated: 1`.

### The one honest gap

`createAuthorityGrantWithResult` calls `getUserId()`, which reads `next/headers`. There is no request
here. Exactly two modules were substituted, by a whitelist that matches literal specifiers and
nothing else:

- **`next/cache`** → a no-op `revalidatePath`. There is no Next render cache in this process, so
  doing nothing is correct rather than stubbed; the real function throws outside a request context,
  which would abort the caller *after* the grant had committed.
- **`@/lib/session`** → a named-actor assertion returning `YCAbP6TPTU1sxkpf4gVl5FcX9Nf4lrwZ`,
  recorded as `ASSERTED_BY_OPERATOR_NOT_AUTHENTICATED`, refusing `ACTOR_UNNAMED` when unnamed.

The alternatives were to fabricate a session row so the real path "succeeds" — minting an
authentication artifact to satisfy an authentication check, the same class of act as minting a grant
to satisfy an authority check — or to drop the user predicate, which is how *unable to scope* becomes
*scoped to everyone*. This is the same boundary `RS-00` already drew for the read side. Everything
downstream of that one call is the canonical module's unmodified code, digest-pinned:
`app/actions/authority.ts` `f71e47aa…`, `lib/governance/authority.ts` `525dc135…`,
`lib/governance/artifacts.ts` `2a7093a4…`, `lib/db/schema.ts` `5df34860…` — all four exactly merged
`main`.

---

## 5 · The terminal proof

```
verdict            SETTLED_MUTATION_EXECUTED
authority          grantsFound 1, grantRef GRANT-0019, selfMinted false
mutation           executed true, nodeContacted true, observedHostname HERMES
prior              priorDigest null, priorBytes 0        (no stamp existed)
postState          verified true, observed ba29cf1b… 158 bytes
postStateRecorded  true
ledger             1241147 -> 1242044 bytes
```

The **separate** post-state — a different process, a different mechanism, run by the harness and not
by the driver — found the same file, same digest `ba29cf1b…`, 158 bytes:

```json
{"contract":"williamos-node-stamp/1","nodeId":"hermes-node","hostname":"HERMES",
 "role":"local-ai-gpu-execution-worker","stampedAt":"2026-08-25T10:06:49.549Z"}
```

Then `GRANT-0019` was **revoked** through `revokeAuthorityGrant` — `AUTHORITY_REVOKED` event 1083,
register entry 148 — and the route refuses again. The revoker is bounded to scope `#995` and proved
it by refusing `GRANT-0017` (`#905`) as `REFUSED_OUT_OF_SCOPE`.

Revocation, not expiry, is what closes this grant. Which brings us to the fourth thing that was
wrong.

---

## Three defects found by measuring rather than assuming

**`CONT-EXPV2-GRANT-EXPIRY-TZ-SKEW`.** `route.ts` reads `expiresAt` with the raw `pg` client, bypassing
the schema's `utcWallTimestamp` type, so it interprets a stored UTC wall clock as *local* time. On
HERMES (UTC-7) the grant written to live two hours is one the route accepts for **nine** — measured
side by side: `routeReadsItAs 19:05:06Z` vs `schemaReadsItAs 12:05:06Z`, `skewHours: 7`. West of UTC
grants outlive their bound; east of UTC they die early. Not repaired here: the fix edits a module the
settlement driver digest-pins, mid-proof, and is outside the authorised sequence.

**`CONT-EXPV2-RUNTIME-CREDENTIAL-STALE`.** With transport restored and both policy layers admitting
HERMES, the driver still reported `AUTHORITY_UNREADABLE` — `28P01`, *password authentication failed*.
The resolver was ruled out first (the 64-character password is byte-identical through parse and
substitution; only the host changed). Three distinct `DATABASE_URL` passwords exist across HERMES's
env files, and **the live runtime's is not the role's** — established arithmetically against the
role's stored SCRAM-SHA-256 verifier rather than by trying logins, because a wrong guess is
indistinguishable in the server log from someone else's. The deployed WilliamOS runtime therefore
cannot read the authority registry even now; every governed route it serves would refuse. Repairing
it means editing a live service's configuration and restarting it, which is outside a
reads-and-driver-run boundary.

**`CONT-EXPV2-ALLOWLIST-ADDRESS-BOUND`.** An L3 allowlist can only name addresses, and the callers are
on DHCP. The software is address-independent; the allowlist is not. The owner is handling
reservations separately.

---

## What this may NOT be read as

**`CONT-EXPV2-AUTHORITY-REGISTRY-SINGLE-POINT` stays typed open**, by the owner's explicit
instruction and on the merits. Everything above makes the lab's single authority oracle *functional*.
None of it makes it *resilient*: it is still one Postgres, on one machine, on one LAN, and when it is
unreachable every governed mutation in WilliamOS refuses. That is correct behaviour and it is still a
single point.

**No grant wider than specified exists**, and after revocation no standing `#995` permission exists at
all. Re-authorising is a new owner decision, not a re-run.

**The 28 pre-existing grants were not modified.** One row was added. The digest of the other 28 is
unchanged.

**`ufw` was never enabled** on ATLAS and enabling it would not have helped; do not read "firewall" here
as "ufw".

---

## Retained artifacts

| File | What it holds |
| --- | --- |
| `OR-00-authority-readback.mjs` | read-only enumeration + digest, and the route's own lookup |
| `OR-01-record-grant.mjs`, `OR-01-loader.mjs`, `OR-01-session-shim.mjs`, `OR-01-next-cache-shim.mjs` | the grant recorder and its two named substitutions |
| `OR-02-revoke-grant.mjs` | single-use closure, bounded to scope `#995` |
| `OR-03-atlas-service-restoration.txt` | identity, compose ownership, mounts, parsed `pg_hba`, listener, unit, digests, backup |
| `OR-04-network-policy.txt` | both sides measured, blast radius, the `--dport` defect, nine refusal controls |
| `OR-05-registry-resolution.txt` | registry-based resolution, five refusals, `#1006`'s path verified untouched |
| `OR-06-grants-before.json` | the 28 grants and the digest, read through the governed transport |
| `OR-07-pre-grant-settlement-NOTE.md` | the run whose JSON was lost, what corroborates it |
| `OR-08-grant-record.json` | the grant, its three side-evidence records, the module pins |
| `OR-09-expiry-skew.txt` | the timezone defect, measured |
| `OR-10-settlement.json` | the terminal proof |
| `OR-11-revoke.json` | revocation and the route refusing again |
| `OR-12-closed.json` | the same driver, after |
| `OR-13-credential-finding.txt` | the fourth wall |
| `docs/devkit/authority/GRANT-0019.{md,json}` | the Tier-2 ledger the canonical path produced |

## Tests

`tests/authority-registry-url.test.ts` (18) and `tests/authority-registry-service-definition.test.ts`
(14) are new. The second guards the service definition as a contract: no literal IPv4 in the compose
configuration, external volume, `hba_file` mounted, no blanket `host all all` rule that authenticates
rather than refuses, no `trust` on any TCP rule, every network grant narrowed to one database and one
role, `pg_hba` and `fabric-callers.json` agreeing on the caller set, and the unit both applying and
verifying.

Stated rather than glossed: **the ATLAS-side shell script, compose file, unit and `pg_hba` have no
executable test in CI** — CI has no Docker host and no `iptables`. Their evidence is the nine live
refusal controls and the two-sided measurement in `OR-04`, taken against the deployed files. A test
file that could not run would be worse than saying so.
