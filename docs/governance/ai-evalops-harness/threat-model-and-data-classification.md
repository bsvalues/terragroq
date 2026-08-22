# AI Eval-Ops Harness Threat Model and Data Classification

Status: `CONTRACT_VERIFIED / REPOSITORY-SCOPED / NO_RUNTIME_ACTIVATION`

## Overview

WilliamOS is a Next.js governance console and a set of execution-fabric tools for
classifying goals, binding authority, issuing Work Orders, recording evidence,
and dispatching narrowly admitted work to small resident nodes. The intended AEH
architecture adds an Atlas-backed durable queue, a coordinator, and pull workers
on Hermes and AEGIS. This model covers the repository and those declared node
boundaries; it does not assert that the proposed runtime is deployed.

Primary security assets are owner authority, credentials and signing keys,
PostgreSQL governance/job state, immutable evidence and audit chains, source and
release bytes, worker identity, fencing tokens, private prompts/results, backup
generations, and the availability of Atlas, Hermes, and AEGIS.

## Threat Model, Trust Boundaries, and Assumptions

### Actors

- The owner makes consequential authority decisions but is not a credential,
  diagnostic, or operational courier.
- Authenticated operators use the web console and supported hosted sessions.
- Coordinators select only dependency-cleared, authority-matched, reserved work.
- Hermes and AEGIS workers pull signed, bounded envelopes and never infer scope.
- Model/provider output, retrieved documents, issue/PR content, prompts, uploaded
  files, network responses, and worker claims are untrusted data.
- A local or remote attacker may control a browser request, retrieved text,
  provider response, compromised worker process, replayed envelope, or LAN peer.

Input ownership is explicit:

- Attacker-controlled: HTTP fields, retrieved corpus text, issue/PR/repository
  content, model/provider output, uploads, replayed envelopes, worker claims, and
  network responses.
- Operator-controlled: goals, Work Orders, authority decisions, reservations,
  canary inputs, rollback requests, and reviewed configuration.
- Developer-controlled: source, tests, migrations, dependency locks, image/model
  manifests, CI definitions, adapters, and telemetry schemas. Provenance, review,
  exact scope, and runtime validation remain required for all three classes.

### Trust boundaries

1. Browser to Next.js authentication, Server Actions, and `/api/chat`.
2. Application/coordinator to Atlas PostgreSQL and append-only evidence storage.
3. Coordinator to the pull-worker protocol and its signing/revocation boundary.
4. Worker daemon to constrained subprocess/container/model execution.
5. Hermes Ollama inference to untrusted prompts and model output.
6. AEGIS execution scratch to source, network, backup mounts, and host privilege.
7. Local evidence to off-node/off-site replication and restore verification.
8. Git/GitHub/provider inputs to trusted-main, reviewed-release, and effect sinks.
9. Configuration and credentials to logs, metrics, traces, receipts, and reports.

### Data classes

| Class | Examples | Required handling |
|---|---|---|
| Public | published docs, public source | integrity and provenance |
| Internal | topology, capacity, queue state | authenticated access; redact unnecessary detail |
| Confidential | prompts, outputs, private source, retrieved corpus | least privilege; encryption; no telemetry payloads |
| Secret | API keys, passwords, signing/private keys, recovery tokens | never enter WOs/evidence/logs; scoped secret store only |
| Protected operational | authority grants, fences, backup receipts, audit chain | append-only integrity, signer attribution, freshness and revocation |
| Destructive-capability | sudo rules, firewall changes, pruning/cutover grants | exact R3 scope, time window, rollback and independent review |

Retention is purpose-bound: secrets never enter harness evidence; confidential
prompts/outputs use the shortest declared retention and delete primary/derived
payloads while retaining only permitted non-reversible audit digests; telemetry
has an explicit TTL and contains no raw payload; authority/attempt/receipt/audit
events remain append-only for the audit period; backups cannot be deleted until
a newer independently restore-verified recovery point exists. WO-AEH-029/030
must bind telemetry TTLs and WO-AEH-012/013/014 bind backup retention.

### Existing, planned, and required control map

| State | Control | Repository grounding |
|---|---|---|
| Existing | Authenticated mutation boundary and governance registers | `app/actions/`, `lib/governance/authority.ts`, `docs/ARCHITECTURE.md` |
| Existing | Retrieved context explicitly treated as untrusted | `app/api/chat/route.ts` |
| Existing | Closed release defaults and active-grant checks | `lib/governance/execute-guard.ts`, `docs/ARCHITECTURE.md` |
| Existing | Hash/event evidence primitives | `lib/governance/events.ts`, `lib/governance/hash.ts` |
| Existing, narrow | Digest/identity/authority-bound activation and fencing | `scripts/execution-fabric/live/remote-dev-offload-activation.mjs`, `scripts/execution-fabric/bounded-dispatch/run-resident-aegis-standing-hash.mjs` |
| Existing proof | Disposable restore invariants | `C:/HermesLab/aegis/backup-v1.sh`, `C:/HermesLab/aegis/tests/restore-verification-*` |
| Existing policy | Issue #357 terminal quarantine | `AGENTS.md`, `docs/governance/multi-agent-operator-playbook.md` |
| Planned | Durable jobs/attempts/leases/outbox and settlement | `docs/governance/ai-evalops-harness/architecture-and-protocol-adr.md`; WO-AEH-015 through 021 |
| Planned | Resident workers and dynamic placement | WO-AEH-022 through 028 |
| Required | Redacted correlated telemetry and bounded retention | WO-AEH-029 through 031 and 044 |
| Required | Off-site recovery, failure injection, soak and cutover proof | WO-AEH-014 and 034 through 042 |

Assumptions: Atlas is the single authoritative state host until a separately
proven failover exists; local filesystem leases are single-node constructs; node
clocks, PIDs, and boot identity can change; workers and providers can crash after
an effect but before acknowledgement; model output never carries authority.

### Invariants

- Approval, capability health, model output, documentation, and packet prose do
  not mint authority. Active, fresh, unrevoked grants cover exact actions.
- Jobs are idempotent; attempts and events are append-only; every effect compares
  the current fencing token and has a reconciled terminal state.
- A coordinator restart cannot destroy the only settlement/release capability.
- No worker accepts arbitrary shell, paths, network, models, or output locations.
- Secret or protected payload content never appears in logs, traces, prompts,
  receipts, reports, error strings, or model-training/evaluation corpora.
- Stale, future-clock, ambiguous, malformed, duplicate, or unverifiable evidence
  fails closed and never becomes readiness.
- Backup success requires complete manifest equality and independently verified
  restoration; retention never deletes the last verified recovery point.
- Issue #357 is permanently terminal, quarantined, and non-selectable.

## Attack Surface, Mitigations, and Attacker Stories

### Web and retrieval surfaces

Session theft, CSRF, authorization confusion, injection into Server Actions,
stored/reflected XSS, unbounded requests, and retrieval prompt injection can
alter governance state or exfiltrate data. Existing mutation boundaries require
authentication and Server Actions; retrieved chat context is explicitly labeled
untrusted. Required controls include object-level authorization, origin/CSRF
checks, output encoding, payload/rate/stream limits, prompt-data separation, and
redaction tests. A model instruction to grant authority or call a tool is data.

### Durable control plane

Duplicate delivery, stale leases, coordinator death, clock rollback, PID reuse,
DB partition, and result/release ambiguity can duplicate effects or strand work.
Mitigations are transactional job/outbox creation, append-only attempts, boot IDs,
monotonic fences, bounded lease renewal, authenticated restart-safe settlement
descriptors, typed ambiguity, and reconciliation before retry.

### Worker and provider boundary

A forged/replayed envelope, compromised worker, malicious repository, dependency
script, provider response, or model output may seek host execution, network
egress, secret access, path escape, or evidence forgery. Workers must run
non-root, pull only signed/revocation-checked envelopes, enforce digest-bound
operations, read-only source, dedicated scratch, process-tree cancellation,
resource/timeout/output caps, default-deny egress, and fence every result/effect.
Manifest assertions are admission evidence, not proof of OS confinement.

### Supply chain and deployment

Floating images/models, lock drift, compromised dependencies/actions, mutable
tags, or an unreviewed release can change behavior after review. Required controls
are immutable digests, frozen locks, SBOM and scanning, trusted-main ancestry,
signed provenance, build-once promotion, least-privilege deploy identities, and a
retained last-known-good manifest with tested rollback.

### Telemetry and evidence

Prompts, completions, environment values, tokens, topology, or credentials can
leak through high-cardinality labels and evidence. The planned AEH event contract
must carry identifiers and digests, not payloads, and must enforce redaction,
writer attribution, hash linkage, off-worker replication, bounded retention, and
independent checking. Existing event/hash primitives do not prove that runtime.
An attacker deleting local logs must not erase the only terminal receipt.

### Backups and node operations

A false-positive restore, incomplete secondary copy, unsafe prune, shared failure
domain, ransomware, disk exhaustion, or broad management/database exposure can
destroy recovery or authoritative state. Required controls are strict restore
errors and application invariants, complete manifest equality, receipt-driven
retention, immutable encrypted off-site copies, least-privilege network rules,
UPS/SMART monitoring, tested recovery, and explicit RPO/RTO. Recoverability is
not availability.

Out of scope as current capability: autonomous multi-provider scheduling,
unattended production operation, high-concurrency models, and HA Atlas. These are
not assumed defenses and may not be represented as active.

## Severity Calibration (Critical, High, Medium, Low)

- Critical: authority forgery enabling production effects; secret/signing-key
  extraction; arbitrary root execution across nodes; backup destruction with no
  recoverable copy; silent fence bypass causing destructive duplicate effects.
- High: cross-user governance mutation; worker sandbox escape; broad DB exposure
  with write access; prompt/retrieval injection reaching an authorized effect;
  false restore verification that permits destructive retention.
- Medium: denial of a bounded lane, stale readiness causing safe rejection or
  capacity loss, internal topology disclosure, telemetry leakage without secrets,
  or cancellation failure confined to disposable scratch.
- Low: inaccurate non-security metadata, cosmetic status drift, verbose errors
  without sensitive content, or developer-only failures that cannot cross an
  authority/runtime boundary.

Severity drops when an attack is reachable only in static/demo code with all
dispatch flags false and no privileged consumer. It rises when the same contract
is consumed by an active worker, release controller, credentialed effect sink, or
backup-retention process.

Repository: bsvalues/terragroq
Version: 13709f5789c25dea408283730a6bd35e8fd894ab
