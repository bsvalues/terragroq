# Change Request: WilliamOS bounded worker live staging

Requester: owner-directed `PROGRAM-WILLIAMOS-AI-EVALOPS-HARNESS-001`  
Date: 2026-08-11  
Priority: High  
Status: `BLOCKED_LIVE_PREFLIGHT / REPOSITORY_PRECONDITIONS_VALIDATED / OWNER_R3_DECISION_REQUIRED`

## Description

Stage one Hermes inference worker and one AEGIS `HASH_VERIFY` worker behind the accepted WilliamOS durable control protocol. This request covers WO-AEH-022 and WO-AEH-024 live installation and bounded canary proof only. It does not authorize BUILD, TEST, a scheduler, unattended operation, production effects, or production cutover.

Review anchors are terragroq `13709f5789c25dea408283730a6bd35e8fd894ab` and HermesLab `0481061acf1f683688a00b09795647d0288c7232`; both worktrees are dirty and must be refreshed and attributed before execution.

## Business justification

Repository and disposable-database contracts now prove the durable claim, fence, outbox, settlement, reconciliation, signed worker protocol, and inert Hermes/AEGIS adapter behavior. Live staging is required to establish the service identity, process supervision, filesystem, network, resource-containment, restart, and rollback properties that repository fixtures cannot prove.

## Current blocking truth

- WO-AEH-022 and WO-AEH-024 remain `R3_INSTALL_BLOCKED` and `NOT_LIVE_ADAPTER_PROVEN`.
- Neither worker is presently installable. WO-AEH-022 is a library with no packaged daemon or service definition. WO-AEH-024's unit is intentionally noninstallable and contains unresolved placeholders.
- AEGIS requires a separate networked protocol process outside its no-socket compute sandbox; that broker/runner is not implemented.
- Production configuration/key loading, immutable release packaging, Atlas least-privilege runtime role/TLS identity, and resolved service paths are not implemented or reviewed.
- Retained node/IP/readiness observations are historical. Hostname, machine identity, boot identity, address, capacity, listeners, time synchronization, and drift require a fresh preflight.
- The direct owner statement `Execute on my authority` authorized program pursuit and repository work, but does not identify the host/action/time-window/credential/network/DB scope required for these R3 mutations.
- Fresh read-only preflight on 2026-08-11 found Hermes time synchronization unavailable, `HermesLabHealth` last result `2`, all-interface exposure on 3000/5433/6379/9000, mutable image references, and materially dirty repositories. Atlas and AEGIS could not be freshly reached through an existing authenticated SSH configuration. See `docs/reports/ai-evalops-harness/PROGRAM-WILLIAMOS-AI-EVALOPS-HARNESS-001-live-preflight-2026-08-11.md`.

## Impact analysis

| Area | Impact | Details |
|---|---|---|
| Users | Low | No production users. A bounded staging interruption may affect local Hermes inference during canary/rollback. |
| Hermes | High | New dedicated service identity, immutable release, worker service, local Ollama access, control-plane connection, ACLs, and process supervision. |
| AEGIS | High | New protocol process, no-socket compute sandbox, service identity, systemd/cgroup/namespace policy, scratch/result storage, and cleanup controls. |
| Atlas | High | Runtime TLS identity/role and controlled access to the `ai_evalops` durable coordination schema. No migration is included unless separately granted. |
| Network | High | Exact outbound worker/protocol paths and Atlas inbound allowlist; no inbound worker listener. |
| Cost | None by default | New accounts, providers, certificates, hardware, storage, or spend require a separate owner decision. |

## Repository prerequisites — independently validated

1. `PASS_PACKAGING_CONTRACT_ONLY`: a versioned Hermes resident runner/daemon, OS-reference configuration/key loading, immutable manifest/SBOM, inert task definition, and snapshot-bound install/uninstall/rollback planner.
2. `PASS_REPOSITORY_CONTRACT_ONLY`: the Hermes fixed-loopback inference lifecycle and cancellation/reconciliation contract.
3. `PASS_PACKAGING_CONTRACT_ONLY`: an AEGIS networked protocol process, separately isolated no-socket `HASH_VERIFY` child contract, immutable manifest/SBOM, inert systemd units, and snapshot-bound install/uninstall/rollback planner.
4. `PASS_REPOSITORY_CONTRACT_ONLY`: AEGIS `HASH_VERIFY`, BUILD, and TEST adapter contracts with content-addressed staging, containment receipts, cancellation, cleanup, result storage and durable handoff.
5. `PASS_REPOSITORY_POLICY_ONLY`: Atlas deploy/runtime role separation, exact wrapper grants, TLS/HBA policy rendering, complete privilege negatives, and catalog/HBA preimage-exact rollback in disposable PostgreSQL.
6. These are repository/disposable proofs only. Live host discovery, bundle rendering with real identities/paths/digests, certificate issuance, network decisions and installation remain R3 work.

## Target architecture and network boundary

- Hermes: dedicated non-admin `williamos-hermes-worker`; Ollama only at `127.0.0.1:11434`; control protocol only to the approved Atlas endpoint. Hermes PostgreSQL/Redis drift is explicitly excluded.
- AEGIS: dedicated non-root `williamos-aegis-worker`; networked protocol process connects only to Atlas; `HASH_VERIFY` compute child has no sockets and no access to `/backup-primary` or `/backup-secondary`.
- Atlas: authoritative PostgreSQL only. Runtime role is restricted to reviewed `ai_evalops` wrapper functions/objects over TLS. Redis and Mongo are not coordination dependencies.
- No inbound worker port, general shell, SSH dispatch, model pull, arbitrary URL, proxy, redirect, or issue #357 path.

Exact IP/CIDR, interface, address family, port, socket path, rule IDs/order, TLS certificate IDs, and database role names are intentionally unassigned until owner approval and fresh discovery.

## Risk assessment

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| Wrong/stale host identity | Medium | High | Bind hostname plus machine/node/boot identity; stop on mismatch. |
| Worker over-privilege | Medium | High | Dedicated non-admin identity, fixed executable, empty capabilities/no-new-privileges, exact ACL and negative tests. |
| Network exposure or lockout | Medium | High | Exact allowlist, dual-stack/container path tests, independent console, timed automatic rollback. |
| Stale worker performs an effect | Low | Critical | Current lease/fence/authority/capability check immediately before work; kill switch; durable reconciliation. |
| AEGIS sandbox reaches network/backups | Low | Critical | Separate broker, no-socket namespace, mount denial, backup-path negative tests, cgroup/process evidence. |
| Hermes model/runtime drift | Medium | High | Exact image/runtime/model/config digests and concurrency one. |
| Atlas role or schema overreach | Medium | High | Separate deploy/runtime identities, TLS, exact grants, negative privilege tests, no unlisted DDL. |
| Failed install or orphan process | Medium | High | Install disabled, no-claim canary, process-tree/cgroup checks, deterministic uninstall and retained evidence. |
| Ambiguous outcome during rollback | Medium | High | Stop admission, fence workers, reconcile attempts, preserve receipts; never delete history. |

## Implementation plan

| Step | Owner | Window | Dependencies |
|---|---|---|---|
| Materialize and independently review repository prerequisites | Builder + independent reviewer | Before live window | Repository R2 authority and exact reservations |
| Capture fresh host, service, listener, identity, capacity, backup, LKG and clock evidence | Authorized operator | Start of window | Exact diagnostic authority |
| Verify Atlas backup/restore, migrations 0000-0007, least-privilege TLS role and negative grants | Authorized DB operator | Start of window | Exact Atlas/DB authority |
| Arm automatic firewall/service rollback and prove independent console access | Authorized host/network operator | Start of window | Exact network/host authority |
| Install immutable release/config/credentials with services disabled | Authorized operator | Window | Approved hashes, identities and credential refs |
| Start one protocol/worker in no-claim mode; verify identity, health and denied paths | Authorized operator | Window | Successful install prechecks |
| Run one disposable signed canary per approved operation at concurrency one | Authorized operator | Window | Exact canary data/model/object authority |
| Exercise timeout, cancellation, restart reconciliation and kill switch | Authorized operator | Window | Healthy canary and rollback readiness |
| Independent evidence review; either retain disabled staging or rollback | Independent reviewer | Before window end | Complete evidence manifest |

No service may be enabled for automatic startup until the independent canary verdict and a separately recorded activation transition.

## Stop conditions

Stop and roll back on any stale/mismatched identity or digest; unresolved placeholder/fixture digest; dirty-scope ambiguity; backup/restore or migration drift; over-granted database/service identity; plaintext DB connection; clock skew; missing out-of-band console; inability to isolate AEGIS sockets/backups; Hermes non-loopback Ollama; descriptor reconstruction failure; unexpected listener/process/child; fence or receipt inconsistency; secret exposure; or any issue #357 reference.

## Rollback plan

Trigger rollback on any stop condition, failed canary, incomplete evidence, alert, or owner/reviewer kill-switch request.

1. Stop new admission and revoke the exact worker capability/key.
2. Fence, drain and reconcile all attributed attempts in Atlas; preserve events, receipts and evidence.
3. Stop and disable only the new worker/protocol units; verify no descendants, listeners, sockets, cgroups or scratch remain.
4. Restore the captured service/unit/config/ACL/firewall/`pg_hba` last-known-good state under the armed rollback timer.
5. Revoke runtime certificate/role sessions if compromised or no longer needed.
6. Remove only manifest-owned current-release pointers, units and configuration. Retain immutable release/evidence and descriptors until review permits disposal.
7. Verify Ollama, existing backup/health tasks, Atlas services and AEGIS backup mounts remain unchanged.

Rollback may continue past the change window only if the owner explicitly grants that authority before execution.

## Required evidence

Before/after host identity, boot, listeners, services, filesystem ownership, network and DB grants; release/SBOM/config/unit/rule hashes; effective UID/GID/capabilities/cgroup/namespace; TLS peer/certificate/role; migration/checker IDs; signed envelope/claim/lease/fence/heartbeat/outbox/settlement/reconciliation IDs and digests; Hermes Ollama/model identity; AEGIS no-socket and backup-mount denial; timeout/cancel/restart/rollback results; secret-safe logs; independent verdict; all five owner-operation counters; explicit nonproofs.

## Communication and support

Audience is the owner/operator and independent reviewer. Announce preflight start, mutation start, canary start, any stop condition, rollback start, and final verdict in the authenticated work thread. No end-user training is required for this staging-only change. The executor and reviewer must remain reachable throughout the window.

## Approvals required

| Approval | Status |
|---|---|
| WO-AEH-022 exact owner R3 grant (host, actions, window, rollback-after-window) | Pending |
| WO-AEH-024 exact owner R3 grant (host, actions, window, rollback-after-window) | Pending |
| Credential/key/certificate custody and access | Pending |
| Exact network/firewall/Atlas TLS and runtime-role scope | Pending |
| Exact canary model/object/data classification | Pending |
| Named executor, independent reviewer, on-call/kill-switch contact | Pending |
| Repository prerequisite independent PASS | Complete — repository/disposable scope only |

## Owner-supplied decision fields

- Valid-from / valid-until with timezone:
- Hermes hostname + machine/boot identity:
- AEGIS hostname + machine/boot identity:
- Atlas endpoint/cluster/schema/runtime role/TLS certificate references:
- Exact network sources/destinations/protocols/ports/rule identifiers:
- Hermes and AEGIS service account identities and approved privilege/ACL scope:
- Credential/key references, custodian and expiry (no secret values):
- Approved release/config/unit hashes:
- Canary model digest and data classification for Hermes:
- Canary object digest and data classification for AEGIS:
- Executor / independent reviewer / on-call:
- Rollback authority after the window: yes/no and expiry:
- Maintenance impact accepted:

Until every required field, prerequisite and independent review is complete, this change remains non-authorizing and no host, service, credential, database, firewall, or network mutation is permitted.
