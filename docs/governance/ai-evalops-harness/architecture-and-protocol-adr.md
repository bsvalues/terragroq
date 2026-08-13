# ADR-AEH-004: Atlas-backed durable pull-worker protocol

Status: **Accepted design / not implemented / not activated**

Date: 2026-08-11

Work Order: `WO-AEH-004`

Program: `PROGRAM-WILLIAMOS-AI-EVALOPS-HARNESS-001`

Deciders: program architecture lane and independent assurance under the recorded WilliamOS owner
boundary. Acceptance selects a design; it grants no repository, database, host, worker, scheduler,
network, deployment, or production authority.

## Context

WilliamOS already has strong bounded-adapter, immutable-evidence, authority, single-use claim, and
fencing concepts. It does not yet have a durable coordinator that can own useful work across process
death, worker restart, network partition, or an ambiguous external effect. In particular, a current
remote-development path retains settlement capability in process-local state after acquiring durable
state. That is incompatible with restart-safe operation.

The target is one modest, supportable execution spine for three small servers:

- Atlas remains the only authoritative coordination-state node.
- Hermes provides one bounded Ollama inference lane.
- AEGIS provides bounded CPU operations, beginning with `HASH_VERIFY`.
- OMEN is an optional operator cockpit, never a continuity dependency.

The design must preserve the issue `#357` quarantine, avoid a general command runner, separate
capability from authority, prevent stale workers from committing effects, retain enough evidence to
reconstruct every attempt, and operate without Kubernetes, Kafka, or a new distributed database.

## Decision

Use Atlas PostgreSQL as the durable source of truth for jobs, append-only attempts, leases, fencing
tokens, events, transactional outbox entries, workers, and evidence references. A replaceable
coordinator and resident Hermes/AEGIS workers use a pull protocol. Workers never accept arbitrary
inbound execution and never infer authority from health or capability.

```text
WilliamOS/API
    |
    | authenticated, authority-bound job intent
    v
Atlas PostgreSQL
  jobs -> attempts -> leases/fences -> events/evidence
    |                         |
    +---- transactional outbox+
    |
    +---- worker pull ----> Hermes worker -> bounded Ollama adapter
    |
    +---- worker pull ----> AEGIS worker  -> bounded operation adapters
```

PostgreSQL is coordination state, not an execution transport. Workers poll with bounded backoff,
claim eligible work transactionally, and heartbeat only the attempt they currently hold.

## Data model

### Job: immutable intent

A job binds one admitted operation to:

- `job_id`, `work_order_id`, operation class, priority, and idempotency key;
- canonical input, authority, policy, base, and requested-output digests;
- creation time, admission expiry, terminal outcome, and terminal receipt reference.

The idempotency key is unique within the declared effect domain. Payloads and secrets are stored by
reference or encrypted facility, not copied into telemetry. Authority evidence is referenced and
revalidated; a job row cannot mint it.

### Attempt: append-only execution history

Every dispatch or retry creates a new attempt. An attempt binds:

- `attempt_id`, `job_id`, ordinal, worker/node identity, worker instance, and boot ID;
- claim, lease, and fencing identifiers;
- started, heartbeat, expiry, observation, and settlement times;
- input/output/evidence digests and a typed terminal classification.

Prior attempts are never overwritten to make a retry look like the original execution. Corrections
and reconciliation outcomes append events.

### Lease and fence

A lease has a server-issued ID, holder identity, expiry, renewal sequence, release state, and a
positive monotonically increasing fencing token allocated per protected effect domain. Acquisition,
attempt creation, and fence allocation are atomic. A partial unique constraint prevents more than
one active lease for the same exclusive domain.

Expiry makes a holder ineligible; it does not prove that the holder stopped or that an effect did
not occur. A new attempt receives a higher fence. Every effect-capable adapter must validate the
current lease and fence against authoritative state immediately before the effect. Downstream effect
stores must retain or compare the fence where technically possible.

### Events, evidence, and outbox

The event ledger is append-only and records state transitions with job, attempt, actor, boot,
authority, input/output, lease, fence, and prior-event digests. Evidence bytes live in an approved
durable evidence store; PostgreSQL retains content digests and immutable references.

State change and outbound intent are committed in one database transaction through an outbox row.
Outbox delivery is at least once. Consumers use the effect-domain idempotency key and fence so
redelivery produces one externally visible effect and one canonical receipt. An outbox delivery flag
alone is never accepted as proof of the external effect.

## Protocol

### Admission and creation

1. Authenticate the caller and canonicalize the request.
2. Validate active authority for the exact subject, action, environment, resource, and time.
3. Validate fresh capability/placement evidence independently of authority.
4. Insert the job and initial event atomically, deduplicated by idempotency key.
5. Return a job reference. Job creation is not execution success.

### Pull, claim, and execution

1. A worker presents its registered node, instance, boot, adapter, and capability identity.
2. Within a short transaction, PostgreSQL selects one eligible job using
   `FOR UPDATE SKIP LOCKED`, creates an attempt, allocates the next fence, and creates the lease.
3. The worker receives a signed/canonical envelope containing exact input references, allowed
   adapter, limits, authority digest, claim, lease, fence, and expiry.
4. The worker repeats local admission and rejects unknown fields, stale evidence, unavailable
   resources, changed authority, or an unsupported adapter.
5. Immediately before an effect, the adapter revalidates authority, lease, and current fence.
6. The adapter records bounded outcome evidence and submits its digest-bound result.

The worker API is the fixed sequence:

```text
discover -> admit -> prepare -> start -> observe -> cancel
         -> reconcile -> collect -> settle
```

No step accepts caller-supplied shell text.

### Heartbeat, cancellation, and revocation

Heartbeats renew a lease only when holder, boot ID, attempt, renewal sequence, and fence match.
Cancellation stops new effects, signals the bounded process tree, and then reconciles; it does not
rewrite a possibly executed attempt as cancelled. Authority revocation prevents renewal and is
checked immediately before every effect boundary.

### Settlement and recovery

Settlement is reconstructable from a persisted authenticated descriptor binding:

```text
job + attempt + run + claim + lease + fence + holder + boot
+ authority digest + input digest + acquired/expiry times + schema version
```

`settle`, `recover`, and `reconcile` are idempotent. Reconciliation compares durable state, worker
identity/boot, adapter observations, effect receipts, and current fence before producing exactly one
of:

- `NOT_EXECUTED`
- `EXECUTED`
- `AMBIGUOUS`
- `EXPIRED`
- `FENCED`

`AMBIGUOUS` is terminal for automatic retry until an operation-specific reconciliation proves
safety. Unknown success is never success.

## Consistency and transaction boundaries

- Job admission plus its initial event is atomic.
- Claim, attempt, lease, and fence allocation is atomic.
- State transition plus outbound intent is atomic through the outbox.
- Receipt settlement plus terminal event and evidence reference is atomic.
- Network calls and model execution never occur while a database row lock is held.
- PostgreSQL advisory locks may elect one coordinator leader, but are not job or lease records.
- Database time, not worker wall clocks, controls lease expiry.
- Isolation and uniqueness are backed by constraints; application checks alone are insufficient.

This provides durable at-least-once delivery with idempotent, fenced effects. It does not claim
generic exactly-once execution, which is impossible across arbitrary external systems without their
cooperation.

## Required invariants

1. One immutable job intent may have many append-only attempts but only one terminal job outcome.
2. At most one unexpired active lease exists per exclusive effect domain.
3. A replacement attempt always receives a fence greater than every predecessor fence.
4. A stale, expired, revoked, wrong-boot, or wrong-holder fence cannot perform or settle an effect.
5. Duplicate request or outbox delivery creates no duplicate external effect.
6. Every terminal result has a digest-bound receipt and off-worker evidence reference.
7. No worker-local object, PID, file, or memory address is required to recover or settle.
8. Capability and health never imply authority.
9. Atlas protected reserves reject optional work before coordination or database SLOs are threatened.
10. Historical evidence is appended, never rewritten or deleted by reconciliation.
11. Worker loss, coordinator loss, or OMEN shutdown cannot erase accepted intent.
12. The quarantined issue `#357` adapter is never called, wrapped, renamed, or reused.

## Threat and abuse boundaries

| Threat | Required control |
| --- | --- |
| Forged/replayed envelope | Canonical digest, nonce/idempotency key, expiry, authority binding, single-use claim |
| Stale worker after partition | Database-time lease plus monotonically increasing fence checked at effect |
| Coordinator compromise | Least-privilege DB role, no worker shell, authority verifier separate from capability |
| Worker compromise | Pull-only fixed adapters, non-elevated identity, resource/network confinement, exact outputs |
| Prompt/tool injection | Retrieved content is untrusted; adapter/tool allowlist and output ceilings |
| Evidence forgery/loss | Content digests, append-only events, off-worker replication, gap alarms |
| Duplicate external effect | Effect idempotency key, current fence, receipt reconciliation |
| Secret leakage | Reference secrets; redact payloads/env/credentials from logs and evidence by default |
| Database outage | Stop admission/renewal, fail closed, reconcile after recovery; never fall back to local truth |
| Clock skew | Database time controls leases; future/ambiguous evidence is ineligible |

Protected data and production mutation remain outside this program's initial lane.

## SRE contract and traceability

| Requirement | Design mechanism | Proving Work Orders |
| --- | --- | --- |
| Restart-safe state | Atlas jobs/attempts/events and persisted settlement descriptor | `WO-AEH-015`, `018`, `019`, `052` |
| Single claimant and stale-writer rejection | Atomic claim, unique active lease, monotonic fence | `WO-AEH-016`, `034` |
| Duplicate-effect prevention | Transactional outbox, effect idempotency key, receipt | `WO-AEH-017`, `034`, `040` |
| Bounded worker execution | Pull-only protocol and fixed adapters | `WO-AEH-021`–`025`, `050` |
| Resource protection | Live admission gates and Atlas reserves | `WO-AEH-023`, `026`, `027`, `037` |
| Reconstruction and alerting | Correlation IDs, events, evidence references, telemetry | `WO-AEH-029`–`031`, `044` |
| Recovery proof | Failure injection, coordinator/worker restart, partition tests | `WO-AEH-034`, `039`, `040`, `052` |
| Production separation | Canary, pilot, soak, certification, separate grant | `WO-AEH-036`, `039`–`042` |

Required operating objectives remain those in the program: no stale/replayed/unauthorized request,
duplicate effect, or missing terminal receipt; no orphan beyond two TTLs; safe coordinator recovery
within five minutes; and evidence replicated away from the worker for every settled attempt.

## Options considered

### Accepted: Atlas PostgreSQL durable pull queue

Advantages: reuses the authoritative state node; strong transactions, constraints, row locking, and
queryable reconciliation; low operational burden for three servers. Costs: Atlas needs protected
capacity and careful schema migrations; PostgreSQL remains a single-host availability dependency.

### Rejected: Redis queue or Redis as lease truth

Redis is useful for cache/ephemeral signaling but creates a second authoritative state path and makes
atomic job/outbox/evidence transitions harder. Hermes Redis is explicitly non-authoritative and
currently part of a containment concern.

### Rejected: inbound SSH or general remote command runner

It expands the trust boundary, permits caller-supplied behavior, complicates cancellation and process
reconciliation, and bypasses fixed adapter contracts. Workers pull exact envelopes instead.

### Rejected: Kafka plus a separate event-sourced control plane

It adds brokers, schemas, consumer operations, and dual state ownership without a workload scale that
justifies them. PostgreSQL events and outbox provide the required durability at this scale.

### Rejected: Kubernetes

It does not solve authority, idempotency, evidence, or ambiguous effects and would impose excessive
control-plane cost on three heterogeneous small servers.

### Rejected: advisory locks as jobs or leases

They disappear with sessions and do not retain holder, fence, expiry, evidence, or reconciliation
history. Advisory locks are limited to replaceable coordinator leader election.

### Rejected: process-local settlement handles

They are unrecoverable after coordinator death and can strand durable leases. Settlement identity is
persisted and authenticated instead.

### Rejected: OMEN-resident coordinator

An interactive laptop is not an unattended continuity boundary. OMEN remains an optional UI/client.

### Rejected: reuse of issue `#357`

The nested local Codex adapter is terminally quarantined by doctrine and lacks an independently
proven transport. It is not an implementation shortcut or fallback.

## Consequences

Positive:

- one inspectable durable truth for coordination and recovery;
- workers can restart or be replaced without losing accepted intent;
- authority, capability, placement, execution, and evidence stay separate;
- the design grows one bounded adapter at a time without becoming a shell platform.

Costs and limitations:

- Atlas is initially a single availability and recovery dependency;
- migrations, connection limits, vacuuming, evidence retention, and reserve monitoring become SRE
  responsibilities;
- effect destinations must support idempotency/fencing or receive operation-specific reconciliation;
- polling trades a small latency cost for a simpler firewall and trust boundary;
- production remains prohibited until implementation, failure injection, soak, assurance, and a
  separate activation grant pass.

## Implementation gates

This ADR releases design dependencies only. Implementation begins with checked-in migration and
rollback workflow (`WO-AEH-009`), then schema (`WO-AEH-015`), claim/lease/fence (`WO-AEH-016`),
outbox (`WO-AEH-017`), persisted settlement (`WO-AEH-018`), reconciliation (`WO-AEH-019`), and the
coordinator (`WO-AEH-020`). Each gate must retain the invariants above and independently prove its
failure modes.

No runtime, schema, database, worker, scheduler, service, host, network, or production change was
performed by this decision.
