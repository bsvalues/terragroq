# AI Eval-Ops Network and Identity Remediation Design

Status: `DESIGN_COMPLETE / NO_LIVE_MUTATION / DECISIONS_REQUIRED`

## Evidence boundary

This design consumes the WO-AEH-002 inventory and the WO-AEH-005 threat model. The inventory
observed Hermes listeners only: Ollama on loopback port 11434, and Open WebUI, Portainer,
PostgreSQL, and Redis on all host interfaces at ports 3000, 9000, 5433, and 6379. It did not prove
remote reachability, firewall behavior, authentication, or current Atlas/AEGIS state. Retained Atlas
and AEGIS snapshots were stale. Therefore this document specifies intended contracts but does not
invent addresses, interfaces, credentials, account names, executable paths, or active controls.

## Design invariants

- Default deny applies across node, management, database, worker, and backup boundaries.
- A hostname, role, or LAN membership is not an identity. Every allow entry binds a verified source
  address/prefix, transport, destination address/interface, port, service identity, and purpose.
- Runtime, deploy, backup, coordinator, database, and emergency administration identities are
  distinct. No runtime identity has an interactive shell or general elevation.
- TLS authenticates both endpoints for cross-node control, worker, database, backup, and management
  traffic. Browser management may terminate at an authenticated proxy; direct service ports remain
  loopback or management-boundary only.
- Secrets, private keys, passwords, tokens, and certificate bodies never enter this design or its
  evidence. Evidence may contain issuers, subjects, serials, fingerprints, validity, and revocation.
- A firewall rule does not substitute for application authentication; application authentication
  does not substitute for a firewall rule.
- Every live change is R3, separately authorized, preflighted from a retained console, protected by
  a timed automatic rollback, and followed by positive and denied-source tests.

## Required decision record

Before WO-AEH-007, 046, 047, or 048 can activate, one immutable decision record must fill every
applicable field below from fresh read-only discovery. An absent, wildcard, overlapping, stale, or
ambiguous field fails closed.

| Field | Required value |
|---|---|
| Node identity | exact Hermes, Atlas, and AEGIS host IDs, boot IDs, OS, and authoritative interface names |
| Address binding | exact stable address/prefix per node and network zone; DHCP reservation/static ownership evidence |
| Management sources | exact administrative source addresses/prefixes and authenticated operator group |
| Service endpoints | exact destination address/interface, protocol, port, and service for every allowed flow |
| Service identities | exact coordinator, worker, deploy, backup, database, proxy, and break-glass principals |
| Executables | immutable absolute command paths and digests for any privileged operation |
| TLS policy | trust roots, SAN rules, key usages, rotation/expiry thresholds, revocation source, minimum protocol/ciphers |
| Authentication | exact auth mechanism, authorization mapping, session/MFA policy, and failure behavior per service |
| Rollback | console type/path, independent operator identity, prior-config digest, watchdog mechanism and timeout |
| Change window | start/end, test sources, protected services, abort thresholds, and named authority/grant evidence |

## Intended bindings and allowlists

`DECISION_REQUIRED` means no address assumption is authorized.

| Node / service | Intended binding | Allowed sources | Authentication | Explicit denies |
|---|---|---|---|---|
| Hermes Ollama | loopback only, preserving observed `127.0.0.1:11434` unless a later worker architecture proves a cross-node need | local Hermes worker identity only | local OS/container boundary plus adapter authorization | every remote source; arbitrary model or endpoint selection |
| Hermes Open WebUI | loopback behind the approved management proxy, or exact management interface only | decision-record management sources | named-user authentication, MFA if supported, bounded session; TLS at proxy/service | general LAN, worker identities, unauthenticated requests |
| Hermes Portainer server/agent | loopback or exact management interface; agent endpoints never generally published | decision-record management sources and exact paired server identity | mutual endpoint authentication plus named-user admin auth | general LAN, worker/runtime identities, unauthenticated Docker access |
| Hermes PostgreSQL/Redis | loopback or private application boundary pending WO-AEH-007 disposition; never authoritative for AEH | only exact declared local clients | PostgreSQL/Redis authentication and TLS where TCP crosses a process boundary | all cross-node sources unless separately justified; all uncredentialed clients |
| Atlas PostgreSQL | exact private service interface, not wildcard | coordinator, declared application clients, and exact backup identity only | mTLS plus least-privilege database roles; host rules mirror network allowlist | Hermes/AEGIS workers direct to DB, management clients absent a scoped admin grant, all other sources |
| Atlas Mongo/Redis, if fresh discovery confirms required use | exact private service interface; otherwise disabled/unpublished | only each declared application client | TLS and least-privilege service-specific auth | undeclared clients and all public/general-LAN sources |
| Atlas coordinator | loopback for local admin; outbound pull-state/data paths only as ADR requires | no inbound worker execution channel; management health only from declared monitors | coordinator service identity, mTLS to cross-node endpoints | arbitrary remote commands; OMEN/#357 dependency |
| Hermes/AEGIS worker control | pull-only outbound from worker to exact Atlas endpoint | worker's own registered identity | short-lived mTLS identity bound to node, instance, boot, adapter, grant, and revocation | inbound job execution, peer worker traffic, generic egress |
| AEGIS backup transfer | outbound or mutually initiated only as the approved backup design requires | exact Atlas backup source and exact approved replica identity | dedicated backup identity, mTLS/SSH host verification, encrypted payload | runtime/deploy identities, arbitrary paths, interactive forwarding |

Firewall implementations must use stable rule IDs, explicit profiles/zones, narrow direction, and
default-deny ordering. DNS names may aid readability but cannot be the sole enforcement selector.
IPv4 and IPv6 must have equivalent posture; if one family is unused it is explicitly disabled or
denied. Docker/container forwarding and host firewall paths must both be tested because published
ports can bypass an assumed host rule path.

## Identity and privilege contract

| Role | May do | Must not do |
|---|---|---|
| Deploy identity | install an approved digest, update owned config, invoke exact service lifecycle wrapper | run workloads, read runtime/backup data, general shell/elevation |
| Coordinator identity | read/write only AEH coordination schema and emit bounded worker envelopes | host administration, backup administration, arbitrary worker commands |
| Hermes worker identity | invoke the fixed Ollama adapter and write owned scratch/evidence handoff | Docker administration, database administration, arbitrary network/model/path selection |
| AEGIS runtime identity | invoke allowlisted bounded adapters in owned scratch | login shell, sudo, backup mounts, deploy keys, Docker socket, arbitrary egress |
| Backup identity | read declared backup sources and write declared generation destination | application mutation, interactive login, retention deletion unless separately authorized |
| Database identity | own only its service files/process and accept mapped least-privilege roles | interactive administration or reuse as coordinator/backup identity |
| Emergency rollback identity | restore only the signed prior configuration through retained console access | routine operation; unattended or shared use |

AEGIS sudo policy is generated only after exact paths and digests are recorded. The target form is
`NOPASSWD` for individually enumerated root-owned wrappers with fixed, validated argument grammars;
it is never `ALL`, a shell, interpreter, editor, package manager, service manager wildcard, Docker,
or a writable script. `NOEXEC`, environment reset, secure path, no user-controlled environment, and
I/O logging are required where supported. Each wrapper rejects extra arguments, path traversal,
symlinks, mutable executables, unexpected digests, and calls outside the authorized service set.
Runtime identities have locked passwords, no interactive shell, no SSH authorization, dedicated
groups, owned scratch, and no membership granting Docker/root-equivalent access.

## TLS, authentication, and certificate lifecycle

Cross-node connections use mutually authenticated TLS with distinct certificates per service
identity. Verification requires the intended trust root, exact SAN-to-node/service match, server and
client key usages, non-expired validity, current revocation, and no fallback to plaintext or
verification-disabled modes. Rotation is overlap-based: install the new trust/certificate, prove
both paths during the bounded window, switch, revoke the old identity, and prove rejection. Unknown,
expired, revoked, wrong-SAN, wrong-purpose, self-selected, or future-dated identities fail closed.

Management consoles require named users, least-privilege roles, brute-force/rate controls, bounded
sessions, secure cookies where web based, and auditable login/admin events. Default/shared accounts
and anonymous access are prohibited. Credential provisioning and rotation require a separate exact
authority; operators never paste secrets into WOs, reports, commands, chat, or evidence.

## Timed rollback contract

Each live successor must first capture the signed prior configuration digest and prove an
independent, retained console session that does not traverse the rule being changed. It then arms a
one-shot watchdog, owned by the emergency rollback identity, to restore the exact prior network,
service, or sudo configuration and reload it after the decision-record timeout. The timeout must be
long enough for all required tests and short enough to satisfy the declared lockout tolerance.

The watchdog is disarmed only after authorized-source success, denied-source failure, service
health, audit delivery, and independent reviewer evidence all pass. Loss of console, watchdog,
telemetry, identity mapping, or any protected service triggers rollback. Rollback verification
includes restored digest equality, authorized access, denied unintended access, service health, and
watchdog terminal evidence. A reboot, rescue mode, or owner-mediated recovery is not the primary
rollback plan.

## Rule simulation and lockout analysis

Before live application, successors must evaluate a machine-readable candidate ruleset in a
disposable namespace/VM or platform-native offline policy evaluator. The matrix must include:

1. each exact authorized source/service flow succeeds with the intended identity;
2. adjacent address, wrong node, wrong role, wrong port, IPv6 bypass, container-forward path, and
   spoofed hostname fail;
3. missing, expired, revoked, wrong-SAN, wrong-purpose, and untrusted TLS identities fail;
4. anonymous, stale-session, overprivileged, and cross-role console/database access fail;
5. AEGIS exact wrapper invocation succeeds, while extra arguments, shell metacharacters, alternate
   binaries, symlinks, mutable paths, interactive sudo, and `sudo -l` expansion beyond the manifest fail;
6. application and backup access remain functional while workers cannot directly reach Atlas data
   services unless explicitly declared;
7. rule ordering, stateful return traffic, DNS failure, dual-stack behavior, restart, and reboot
   persistence match the candidate model;
8. simulated loss of the primary management path leaves the independent console able to inspect,
   restore, and verify the signed prior configuration before timeout.

Lockout analysis must draw the management, data, worker, backup, and rollback paths and identify any
shared switch, address, credential, identity provider, firewall, proxy, or host dependency. If the
primary and rollback paths share the changed control, rollback is not independent and activation
is blocked. Simulation is design evidence only and cannot prove live enforcement.

## Successor-specific gates

- WO-AEH-007: decide whether Hermes PostgreSQL/Redis are stopped, loopback-only, or explicitly
  retained; prove data ownership and management-console rollback before any containment change.
- WO-AEH-046: bind exact WebUI/Portainer endpoints and management sources; prove denied-source and
  Docker-root-equivalent isolation with the timed rollback contract.
- WO-AEH-047: discover live Atlas services, ports, clients, and backup flows; reconcile host and
  service allowlists; prove all declared clients and deny all undeclared sources.
- WO-AEH-048: discover exact AEGIS accounts, groups, sudo policy, executable paths/digests, service
  ownership, SSH posture, and backup mounts; replace broad elevation only through validated wrappers.

No successor is released to mutation by this document. Each remains subject to fresh dependency,
reservation, exact R3 authority, credential, environment, and change-window checks.

## Validation and non-proof

Design validation consists of reference existence, decision-field completeness, internal flow and
deny consistency, textual secret scanning, changed-path inspection, `git diff --check`, and
independent review. No network probe, firewall command, service command, account command, sudo
command, credential access, live rule simulation, or host mutation was performed.

Repository: bsvalues/terragroq
Version: 13709f5789c25dea408283730a6bd35e8fd894ab
