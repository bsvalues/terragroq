# WilliamOS AI Eval-Ops and Durable Harness Program

Program: `PROGRAM-WILLIAMOS-AI-EVALOPS-HARNESS-001`

Goal: `GOAL-WILLIAMOS-DURABLE-AI-EXECUTION-001`

Loop: `LOOP-WILLIAMOS-DURABLE-AI-EXECUTION-001`

Umbrella Work Order: `WO-AEH-000`

Status: `DRAFT / NOT_ACTIVATED / AUTHORITY_REQUIRED_FOR_IMPLEMENTATION`

Risk ceiling: `R3`

Planning baseline:

- `bsvalues/terragroq`: `13709f5789c25dea408283730a6bd35e8fd894ab`
- `C:\HermesLab`: `0481061acf1f683688a00b09795647d0288c7232`

The baselines are review anchors, not future execution bases. Every child Work Order must refresh and
record its exact base immediately before implementation.

## Executive objective

Deliver one restart-safe, observable, recoverable, bounded AI execution lane across Atlas, Hermes,
and AEGIS; correct the known backup, exposure, supply-chain, and status-truth hazards; and prove the
lane through fault injection, recovery exercises, a 72-hour pilot, and a seven-day unattended soak.

This document is a plan. It does not activate a runtime, scheduler, worker, service, database
migration, firewall change, backup destination, provider account, credential, deployment, or fault
injection. It does not add this program to the active queue.

## Current truth

- WilliamOS has a real governance and evidence control plane.
- The HERMES and AEGIS execution paths are narrow, bounded adapters rather than a general scheduler.
- The prior multi-agent certification closed with an evidence-backed rejection because no durable
  process spanned the required unattended interval.
- The nested local Codex adapter associated with issue `#357` is terminal, quarantined, disabled,
  and permanently ineligible for this program.
- The remote-development path acquires durable state but retains its supported settlement handle in
  process-local state, so restart-safe settlement is not proven.
- Hermes is suitable for one small-model inference lane; AEGIS is suitable for bounded CPU work;
  Atlas is the authoritative state host and must be protected from optional noisy work.
- Hermes runtime state has drifted from the service map: local PostgreSQL and Redis were observed
  running even though the map declares them stopped and non-authoritative.
- AEGIS backup restore verification can overstate success and the two local backup disks share a
  single host/site/privilege failure domain.
- Capability snapshots are five-minute-TTL evidence. Historical JSON is not live readiness.

## Non-goals

- General remote shell or caller-supplied command execution.
- Reuse, wrapping, renaming, or retry of the rejected issue `#357` adapter.
- Kubernetes, Kafka, or a distributed control plane for three small servers.
- Multi-model routing, fine-tuning, or high-concurrency inference in the first activation.
- Atlas high availability or automatic database failover in this program.
- County, PACS, production-data, or protected-data mutation.
- Production authorization inferred from tests, receipts, capability health, or soak success.
- Hardware purchasing without a separate owner decision.

## Target architecture

```text
OMEN / WilliamOS UI
  stateless operator surface
          |
          v
ATLAS / PostgreSQL control state
  jobs + attempts + leases + events + outbox + evidence references
          |
          +-----------------------------+
          | worker pull                 | worker pull
          v                             v
HERMES resident worker              AEGIS resident worker
  Ollama adapter                     hash/build/compression adapters
  concurrency 1                      cgroup/container confinement
  Windows service                    systemd service
```

Atlas owns durable coordination state. Workers pull authenticated envelopes. No node accepts an
arbitrary command or infers authority. A job records intent; append-only attempts record execution.
Every side effect requires the current lease and monotonically increasing fence.

## Capability maturity vocabulary

| State | Meaning |
| --- | --- |
| `MODEL_VERIFIED` | A deterministic or zero-input model passed tests; no live execution is implied. |
| `CONTRACT_VERIFIED` | Exact input, authority, output, and failure semantics passed contract tests. |
| `ADAPTER_PROVEN` | A bounded real operation executed through the reviewed adapter. |
| `RECOVERY_PROVEN` | Restart and ambiguous-outcome recovery passed live failure tests. |
| `SOAK_PROVEN` | The declared continuous-duration and useful-work soak passed. |
| `PRODUCTION_AUTHORIZED` | Separate active authority covers the exact deployment and operation. |

No prose, status page, or successful predecessor may skip a maturity state.

## Governing invariants

1. William remains owner-only. Routine execution must not make him a command runner, credential
   courier, diagnostic courier, merge operator, or status courier.
2. Planning and packet fields cannot create authority.
3. Capability health never grants scheduling or execution authority.
4. The rejected issue `#357` adapter remains `QUARANTINED_TERMINAL`.
5. Atlas remains the only authoritative state node in scope.
6. Workers pull exact authorized envelopes; no general inbound shell is introduced.
7. Jobs and attempts are separate records; attempts are append-only.
8. Every side effect validates the current fencing token immediately before execution.
9. Duplicate delivery produces zero duplicate effects.
10. Prompts, completions, credentials, tokens, protected data, and environment values are excluded
    from telemetry by default.
11. Historical evidence is immutable. Corrections are appended, not rewritten.
12. A failed phase blocks only dependent lanes unless its trust boundary may have been crossed.

## Authority and risk model

| Class | Examples | Required posture |
| --- | --- | --- |
| R0/R1 | Documentation, static contracts, unit tests, read-only inventory | May proceed only under matching repository authority. |
| R2 | Migration code, service code, CI, telemetry configuration, adapter implementation | Exact repository, path, contract, and environment authority required. |
| R3 | Live DB migration, firewall/port/sudo change, service installation, worker activation, off-site credentials, reboot/fault injection, soak | Separate active authority for the exact host/action/time window required. |

Owner decision conditions include new spend/account/provider, secrets or credentials, live database
mutation, firewall/DNS/network exposure, root/sudo policy, destructive retention, reboot/outage
injection, worker/scheduler activation, off-site storage, and certification/cutover acceptance.

## Roles and reservations

| Role | Responsibility |
| --- | --- |
| Coordinator | Dependencies, reservations, authority verification, evidence and transitions |
| Control-plane builder | Jobs, attempts, leases, fences, outbox and reconciliation |
| Hermes builder | Windows worker, Ollama adapter and model admission |
| AEGIS builder | Linux worker, containment, backup and CPU adapters |
| Atlas/SRE builder | Database, protected reserves, monitoring and recovery |
| Security builder | Network, identity, sudo, supply-chain and abuse testing |
| Observability builder | Metrics, logs, traces, dashboards and alert delivery |
| Independent assurance | Read-only review; never the original builder |
| Chaos operator | Only preauthorized fault injection in declared environments |

No two builders may own the same path, contract, host mutation, database object, service unit, port,
credential, or evidence target concurrently. Assurance owns no builder reservation.

## Work-order program

Numbering identifies records. Dependencies, reservations, and authority—not numeric order—control
execution. Dependency-cleared, non-overlapping WOs should run concurrently.

### Phase 0 — Truth, authority, and containment design

| WO | Title | Depends | Risk | Deliverable and acceptance gate |
| --- | --- | --- | --- | --- |
| `WO-AEH-001` | Program activation, registration and authority map | 000 | R1 | After a separate matching activation grant exists, register the exact program, repositories, nodes, authority classes, blocked actions, reservations, evidence paths, owner counters and stop conditions; #357 quarantine preserved. Without that grant remain `BLOCKED_AUTHORITY`. |
| `WO-AEH-002` | Current-state and drift inventory | 001 | R1 | Timestamped read-only inventory of services, ports, tasks, containers, images, models, disks, backups, identities and config/runtime drift. |
| `WO-AEH-003` | Canonical maturity/status projection | 002 | R1 | One generated current-status view using the six maturity states; historical evidence remains immutable. |
| `WO-AEH-004` | Target architecture and protocol ADR | 002 | R1 | Accepted Postgres-backed pull-worker, job/attempt, lease/fence, outbox, reconciliation and evidence design with rejected alternatives. |
| `WO-AEH-005` | Threat model and data classification | 002 | R1 | Trust boundaries, threats, payload classifications, telemetry redaction and retention requirements. |
| `WO-AEH-006` | Network and identity remediation design | 005 | R1 | Exact target bindings, firewall allowlists, identities, sudo commands, TLS/auth and console-safe rollback. No mutation. |
| `WO-AEH-007` | Hermes state-service containment | 006 | R3 | Stop or isolate recovery-only PostgreSQL/Redis, remove accidental state authority, bind permitted recovery endpoints safely, and prove rollback without data deletion. |
| `WO-AEH-008` | Reproducible CI foundation | 003 | R2 | Required frozen-install, tests, lint/type, build, Python, fabric-contract, API/DB integration, component/Playwright smoke, secret-scan and artifact checks. |
| `WO-AEH-009` | Database migration and rollback workflow | 004 | R2 | Checked-in migrations, drift detection, expand/contract process, backup-before-migrate and rollback/forward-fix test. No live application. |
| `WO-AEH-010` | Dependency, image and model provenance | 003,005 | R2 | Modify and verify dependency locks/manifests, immutable image/model digests, SBOM, scan and last-known-good manifest; no live deployment. |
| `WO-AEH-046` | Management-plane exposure remediation | 006 | R3 | Restrict WebUI, Portainer server/agents and Docker-root-equivalent surfaces to the approved management boundary; prove denied-source behavior and console-safe rollback. |
| `WO-AEH-047` | Atlas database network allowlisting | 006 | R3 | Permit only declared clients to PostgreSQL/Mongo/Redis; verify application/backup access and deny all other sources with timed rule rollback. |
| `WO-AEH-048` | AEGIS runtime identity and sudo hardening | 006 | R3 | Separate deploy/runtime identities, replace `NOPASSWD:ALL` with exact commands, prohibit interactive escalation and retain audited rollback access. |
| `WO-AEH-049` | Setup, topology and metadata reconciliation | 002,003 | R1 | Reconcile README/service map with the three-node truth; document supported/optional/deprecated surfaces, exact commands/env variables, package/workspace ownership and root package metadata. |

Phase gate: truth is reconciled, hazards have reviewed designs, and unreviewed supply-chain drift is
blocked. No runtime activation is implied.

### Phase 1 — Backup correctness and disaster recovery

| WO | Title | Depends | Risk | Deliverable and acceptance gate |
| --- | --- | --- | --- | --- |
| `WO-AEH-011` | PostgreSQL restore-verification code and fixtures | 001 | R2 | Modify backup/restore automation to enforce `ON_ERROR_STOP=1`, bound exit status and expected DB/schema/table/row/application-query invariants; corrupt, partial and empty fixture restores fail without touching live backups. |
| `WO-AEH-012` | Complete-manifest secondary verification | 011 | R2 | Primary and secondary complete manifests match for every protected source, not only PostgreSQL. |
| `WO-AEH-013` | Receipt-driven retention contract and tests | 001 | R1 | Newest successful, newest fully restore-verified and active recovery-point generations are protected by tested policy; no live pruning occurs in this WO. |
| `WO-AEH-014` | Independent encrypted off-site backup | 012,013 | R3 | Separate credentials, encryption, immutability, daily replication and successful recovery from off-site copy. Provider/spend is an explicit decision gate. |
| `WO-AEH-043` | Live restore and retention proof | 011,012,013 | R3 | Run preauthorized disposable restores, application invariants and retention dry-run/live proof while preserving every protected generation; retain measured RPO/RTO evidence. |

Phase gate: false-positive restore is prevented, all protected copies are verified, retention is
proof-driven, and at least one recovery copy is outside the AEGIS failure domain.

### Phase 2 — Durable control-plane spine

| WO | Title | Depends | Risk | Deliverable and acceptance gate |
| --- | --- | --- | --- | --- |
| `WO-AEH-015` | Durable schema implementation | 003,004,009,010 | R2 | Jobs, attempts, leases, events, outbox, workers and evidence references with unique idempotency and monotonic fences. |
| `WO-AEH-016` | Claim, lease and fencing engine | 015 | R2 | Atomic claims, TTL renewal, fence increment, stale-fence rejection and one-active-claimant property tests. |
| `WO-AEH-017` | Transactional outbox and effect idempotency | 016 | R2 | State and outbound intent commit atomically; repeated delivery produces one effect and one receipt. |
| `WO-AEH-018` | Restart-safe settlement descriptor | 016 | R2 | Persisted authenticated job/attempt/run/claim/lease/fence/holder/boot/authority/input/expiry binding replaces process-only settlement authority. |
| `WO-AEH-019` | Reconciliation and recovery service | 017,018 | R2 | Idempotent settle/recover/reconcile and typed `NOT_EXECUTED`, `EXECUTED`, `AMBIGUOUS`, `EXPIRED`, `FENCED` outcomes. |
| `WO-AEH-020` | Coordinator implementation and packaging | 016 | R2 | Implement Atlas-backed leadership, automatic-restart packaging, health/readiness and safe-replacement contracts with deterministic tests; no live installation or restart proof. |

Phase gate: durable state, fencing, settlement and coordinator recovery contracts are implemented
and deterministically tested. Live installation and restart recovery are not claimed before
WO-AEH-052 and the failure-injection gates.

### Phase 3 — Worker protocol and bounded adapters

All adapters implement:

```text
discover -> admit -> prepare -> start -> observe -> cancel
         -> reconcile -> collect -> settle
```

| WO | Title | Depends | Risk | Deliverable and acceptance gate |
| --- | --- | --- | --- | --- |
| `WO-AEH-021` | Common worker protocol | 019,020 | R2 | Signed envelopes, worker pull, heartbeat, cancellation, digests, revocation and conformance suite. |
| `WO-AEH-022` | Hermes resident worker | 021 | R3 | Non-elevated service, concurrency one, exact Ollama allowlist, process-tree cancellation and restart reconciliation; no command runner. |
| `WO-AEH-023` | Model-aware GPU admission | 021 | R2 | Measured weights/runtime/KV/context envelope plus free VRAM, reserve, temperature, queue and residency admission. |
| `WO-AEH-024` | AEGIS bounded worker | 021 | R3 | Non-root systemd worker with CPU, memory, scratch, time, process and network containment; `HASH_VERIFY` first. |
| `WO-AEH-025` | AEGIS bounded build adapter | 024 | R3 | Content-addressed read-only input, isolated scratch, declared build outputs, explicit dependency/network policy, evidence and cancellation cleanup. |
| `WO-AEH-050` | AEGIS bounded test adapter | 024 | R3 | Separate test-operation profile, read-only source, isolated scratch, declared test artifacts, exact network policy, evidence and cancellation cleanup. |
| `WO-AEH-026` | Dynamic resource admission | 023,024,025,050 | R2 | Hard gates for live RAM/disk/VRAM, pressure, temperature, leases, queue, identity, transfer cost and protected reserves. |
| `WO-AEH-027` | Placement policy v2 | 026 | R2 | Rank only admitted nodes; freshness, capability, authority and capacity remain separate; saturation and partition simulations pass. |
| `WO-AEH-028` | One end-to-end AI lane | 022,023,027 | R3 | Authenticated request through durable job, Hermes pull, model admission, bounded generation, receipt, evidence replication and restart-safe settlement. |

Phase gate: one useful real operation traverses the durable protocol and survives a worker restart
plus a process-level coordinator restart inside the preauthorized test boundary with no duplicate
effect. This is not proof of an installed Atlas service, host restart, or service replacement;
those claims remain blocked until WO-AEH-052.

### Phase 4 — Observability, evals, and SLOs

| WO | Title | Depends | Risk | Deliverable and acceptance gate |
| --- | --- | --- | --- | --- |
| `WO-AEH-029` | Metrics, traces and event schema | 019,024,028 | R2 | Correlation across program/WO/job/attempt/lease/fence/node/boot/model/commit/authority/input/output digests; payload leakage tests pass. |
| `WO-AEH-030` | Monitoring stack configuration | 029 | R2 | Versioned central metrics/logs/traces, Windows/Linux/GPU exporter, blackbox, retention and resource-budget configuration; no live installation. |
| `WO-AEH-031` | Dashboard, alert and dead-man definitions | 030 | R2 | Versioned queue, lease, AI, worker, DB, backup, restart, evidence and alert-delivery dashboards/rules; no claim of live delivery. |
| `WO-AEH-032` | AI model qualification harness implementation | 031 | R2 | Implement cold/warm, context/output/concurrency measurement with TTFT, tokens/sec, latency, memory, thermal, OOM, cancellation and structured-validity capture; no live qualification verdict. |
| `WO-AEH-037` | Node, power and network capacity qualification | 044,045 | R3 | Run sustained CPU/GPU thermal and throttle tests, power/UPS shutdown proof, SMART/NVMe wear trends, iperf latency/loss/throughput and backup/index contention; produce explicit RAM/GPU/LAN upgrade thresholds. Purchases remain separately owner-gated. |
| `WO-AEH-038` | Immutable deployment and rollback pipeline implementation | 008,009,010,030 | R2 | Build once from locks; retain digest, SBOM, scan, provenance, migration plan, staging promotion, canary and last-known-good rollback automation; no live deployment. |
| `WO-AEH-044` | Monitoring deployment and alert-delivery proof | 030,031 | R3 | Install the approved bounded stack, prove cross-node telemetry, blackbox and dead-man delivery, test retention/overhead and verify complete uninstall rollback. |
| `WO-AEH-045` | Live Hermes model qualification | 032,044 | R3 | Run the approved model/context/output/concurrency matrix on Hermes and publish empirical admission envelopes without expanding concurrency. |
| `WO-AEH-051` | Staging deployment and rollback rehearsal | 038,044 | R3 | Deploy the exact artifact to staging, run login/work-order/evidence/AI canaries, promote within staging, restore the last-known-good artifact and verify DB forward-fix rules. |
| `WO-AEH-052` | Atlas coordinator installation and restart proof | 020,044 | R3 | Install the reviewed coordinator on Atlas, prove single leadership, automatic restart, fenced replacement, health/readiness, uninstall rollback and no OMEN dependency. |

Phase gate: every attempt is reconstructable without worker-local state, live model envelopes are
empirical after WO-AEH-045, and SLO failures are visible and actionable.

### Phase 5 — Security, chaos, soak, and certification

| WO | Title | Depends | Risk | Deliverable and acceptance gate |
| --- | --- | --- | --- | --- |
| `WO-AEH-033` | Independent security and isolation audit | 007,046,047,048,045,051,052 | R2 | Identity, sudo, Docker, coordinator, secret, injection, egress, deployment and evidence review; no critical finding waived. |
| `WO-AEH-034` | Deterministic failure-injection suite | 033 | R3 | Coordinator/worker death, descendant survival, OOM, full disk, fsync, stale fence, duplicates, clock, DB/network/provider and cancellation faults. |
| `WO-AEH-035` | Network-boundary and AI-abuse evaluation | 034 | R3 | Atlas denial plus IPv6/proxy/raw-IP/redirect bypass, prompt injection, tool allowlist, output ceiling, model drift and repeated-request tests. |
| `WO-AEH-036` | Bounded live canary activation | 014,028,033,035,037,043,044,051 | R3 | Activate only one Hermes inference lane and the already reviewed AEGIS HASH_VERIFY class at concurrency one; prove kill switch, signed receipts and rollback before pilot entry. |
| `WO-AEH-039` | Seventy-two-hour limited pilot | 036 | R3 | Run 72 continuous hours with useful canary work, at least one coordinator restart and zero prohibited events; issue an independent pass/reject verdict. |
| `WO-AEH-040` | Seven-day unattended soak | 039 | R3 | Run seven additional continuous days after the pilot with at least 25 heterogeneous useful jobs, 200 admitted Hermes requests, 1,000 settled attempts, required restarts/reboots/outages/safe retry/off-site restore, zero prohibited events, and complete terminal receipts. |
| `WO-AEH-041` | Independent certification rollup | 040 | R2 | Independently verify all gates, receipts, SLO samples, owner counters, review closure and safety negatives; emit `SOAK_PROVEN` or evidence-backed rejection. |
| `WO-AEH-042` | Production authorization and cutover decision | 041 | R3 | Separate owner decision and exact activation grant. Certification cannot self-authorize cutover; absent authority, remain `SOAK_PROVEN / NOT_PRODUCTION_AUTHORIZED`. |

## Topological groups

```text
000 -> 001 -> 002 -> 003 + 004 + 005
005 -> 006 -> 007 + 046 + 047 + 048
002 + 003 -> 049
003 -> 008 + 010
004 -> 009
001 -> 011 + 013
011 -> 012; 011 + 012 + 013 -> 043; 012 + 013 -> 014
003 + 004 + 009 + 010 -> 015 -> 016
016 -> 017 + 018 + 020; 017 + 018 -> 019
019 + 020 -> 021 -> 022 + 023 + 024
024 -> 025 + 050; 023 + 024 + 025 + 050 -> 026 -> 027
022 + 023 + 027 -> 028
019 + 024 + 028 -> 029 -> 030 -> 031 -> 032
030 + 031 -> 044; 032 + 044 -> 045; 044 + 045 -> 037
008 + 009 + 010 + 030 -> 038; 038 + 044 -> 051
020 + 044 -> 052
007 + 046 + 047 + 048 + 045 + 051 + 052 -> 033 -> 034 -> 035
014 + 028 + 033 + 035 + 037 + 043 + 044 + 051 -> 036
036 -> 039 -> 040 -> 041 -> 042
```

## Recommendation traceability

| Review recommendation | Owning Work Orders |
| --- | --- |
| Reconcile live state, stale status and service-map drift | 002, 003, 049 |
| Contain Hermes PostgreSQL/Redis and management surfaces | 006, 007, 046 |
| Protect Atlas state services with explicit network allowlists | 006, 047 |
| Replace broad AEGIS sudo and separate deploy/runtime identities | 006, 048 |
| Correct false-positive PostgreSQL restore verification | 011, 043 |
| Require full primary/secondary protected-manifest equality | 012, 043 |
| Make retention receipt-driven and preserve final verified recovery points | 013, 043 |
| Add encrypted immutable recovery outside the AEGIS failure domain | 014, 040 |
| Add locked dependencies, CI, migrations, image/model digests and SBOMs | 008, 009, 010, 038 |
| Add real staging, canaries and last-known-good rollback | 038, 051 |
| Replace process-local settlement with durable restart-safe reconciliation | 015-019 |
| Run the coordinator independently of OMEN and prove restart recovery | 020, 052 |
| Introduce a versioned pull-worker harness without general shell | 021, 022, 024 |
| Keep Hermes concurrency at one until empirical qualification | 022, 023, 032, 045 |
| Give build and test separate AEGIS authority/output/network contracts | 025, 050 |
| Make placement admission consume live headroom and protected reserves | 023, 026, 027 |
| Centralize metrics, logs, traces, dashboards, blackbox and dead-man checks | 029-031, 044 |
| Measure TTFT, tokens/sec, context, cancellation, thermals and OOM behavior | 032, 045 |
| Trend SMART/NVMe wear, prove UPS shutdown and measure LAN contention | 037 |
| Make RAM/GPU/LAN upgrades conditional on measured thresholds and owner spend | 037 |
| Test prompt/tool injection, egress bypass, duplicate effects and stale fences | 033-035 |
| Prove restart, partition, disk-full, OOM and ambiguous-outcome recovery | 034, 039, 040 |
| Separate canary, pilot, soak, certification and production authorization | 036, 039-042 |
| Preserve zero-owner-touch and the issue #357 quarantine | 001, 033, 041 |

## Draft graph validation

Machine-produced validation on 2026-08-11 parsed the Work Order tables and applied Kahn topological
sorting:

```text
WORK_ORDER_NODES: 53
DEPENDENCY_EDGES: 90
MISSING_DEPENDENCY_REFERENCES: 0
VISITED_NODES: 53
ACYCLIC: true
IDENTIFIER_RANGE: WO-AEH-000..WO-AEH-052
```

Activation must rerun this validation after any program amendment.

## Materialized child packets

Every child Work Order is materialized as a standalone Markdown packet and standalone draft envelope
under [the packet index](./ai-evalops-harness/work-orders/README.md). The files are generated from this
canonical program by `scripts/ai-evalops-harness/materialize-work-orders.mjs` and checked by
`scripts/ai-evalops-harness/validate-work-order-packets.mjs`.

The current structural result is recorded in
`docs/governance/ai-evalops-harness/work-orders/draft-structural-validation.json`:

```text
STATUS: PASS_LEXICAL_DRAFT_COMPLETENESS_NON_AUTHORIZING
CHILD_PACKETS: 52
STANDALONE_ENVELOPES: 52
GRAPH_NODES: 53
GRAPH_EDGES: 90
MISSING_DEPENDENCIES: 0
DISPATCH_READINESS: BLOCKED_AUTHORITY_AND_RESERVATION
```

Structural success is not executable v2 approval. Exact named roles, refreshed bases,
collision-checked path reservations, active authority, and checkout identity bindings remain required
before any child can enter `DEPENDENCY_CLEARED` or dispatch.

## SLO objectives and certification samples

The percentages below are operating objectives, not lifetime reliability claims produced by one
short soak. Certification applies deterministic safety gates plus minimum empirical samples:

- zero unauthorized, replayed, stale-fence, duplicate-effect, evidence-gap or credential-touch events;
- at least 200 admitted Hermes inference requests for the 99% success and 0.5% invalid-output checks;
- at least 1,000 total safely settled attempts, including non-mutating synthetic/canary attempts,
  for the empirical 99.9% settlement check;
- at least 25 heterogeneous useful jobs within the seven-day soak;
- the seven-day soak starts only after the separate 72-hour pilot passes and is additional to it.

Long-term SLO compliance remains an ongoing monthly/rolling-window operational measurement after
certification. Passing the minimum sample does not prove future statistical reliability.

### Control plane

- 99.5% monthly availability during declared operating hours.
- Non-AI API p95 below 750 ms and p99 below two seconds.
- Zero unauthorized state transitions.
- Zero acceptance of invalid evidence chains.
- Database connection p95 below 300 ms.

### Hermes AI lane

- At least 99% admitted-request success over seven days.
- Interactive queue wait p95 below ten seconds.
- TTFT p95 no worse than 1.5 times the qualified unloaded baseline.
- Zero OOM kills.
- Invalid or empty generations below 0.5%.
- Five-minute synthetic canary while enabled.

### Execution fabric

- Zero accepted stale, replayed, unauthorized or out-of-scope requests.
- Zero duplicate external effects.
- 100% terminal-receipt coverage and evidence replication away from the worker.
- 99.9% settlement within lease TTL plus recovery allowance.
- No orphan lease older than two TTLs.
- Safe coordinator recovery within five minutes.

### Backup and recovery

- State RPO at most 24 hours initially and four hours before critical use.
- Governance/evidence RPO at most one hour or synchronous append replication.
- Control-plane RTO at most four hours; execution-fabric RTO at most eight hours.
- Weekly partial restore and monthly full restore.
- Off-site copy freshness below 24 hours.

## Required validation matrix

- Unit, property, integration and negative tests for each contract.
- Claim concurrency, lease expiry, stale/forged fences and duplicate delivery.
- Coordinator death after claim, lease, spawn, result and release.
- Worker death, reboot, PID reuse and cancellation with surviving descendants.
- Disk full, read-only filesystem, OOM and evidence-fsync failure.
- DNS, TLS, latency, packet loss, partition and provider outage.
- Authority expiry/revocation immediately before a side effect.
- Model cold/warm state, long context, structured output and digest drift.
- Prompt injection and tool-call allowlist enforcement.
- Backup corruption, partial restore, empty restore and off-site recovery.

Every failure must produce a typed state. Unknown or ambiguous success is never success.

## Rollback model

| Change class | Required rollback |
| --- | --- |
| Repository code | Revert owned reviewed commit or restore last-known-good artifact; retain evidence. |
| Database schema | Expand/contract; verified backup first; prefer forward fix after writes. |
| Worker/service | Stop admission, drain or fence attempts, disable service, restore signed prior config/unit. |
| Firewall/network | Stage with retained rules and automatic timeout rollback on management loss. |
| Container/model | Restore exact last-known-good image/model digest. |
| Coordinator | Fence old instance, promote replacement, reconcile durable attempts. |
| Backup | Never delete current verified generation; revert and rerun proof. |
| Activation | Kill switch stops new claims, revokes authority, fences workers and retains evidence. |

Rollback never deletes historical evidence or foreign/dirty state. Ambiguous effects are reconciled,
not blindly retried.

## Immediate stop conditions

- Secret, token, keyring, browser or authentication-cache exposure.
- Out-of-scope repository, host, database, production or protected-data mutation.
- Concurrent writers on one reservation.
- Duplicate externally visible effect or stale-fence acceptance.
- Evidence deletion, mutation, fabrication or unexplained gap.
- Worker, boot, lease, authority, input or base ambiguity.
- Network-boundary, prompt-injection or provider-impersonation bypass.
- Loss of the last restore-verified backup generation.
- Any request that makes William a routine operator or courier.
- Any attempt to retry or reuse issue `#357`.

## Evidence contract

Every completed child WO records:

- exact base and head commits;
- changed paths and reservation evidence;
- active authority references and freshness result;
- tests, benchmarks, fault injections and rollback verification;
- immutable configuration, image, model and input/output digests where applicable;
- worker identity, boot ID, claim, lease and fence evidence for live work;
- independent review identity and resolved findings;
- all five owner-touch/contact counters;
- capability maturity before and after;
- explicit statements of what the evidence does not prove.

Child evidence belongs under `docs/reports/ai-evalops-harness/`. Machine evidence belongs under
`docs/reports/ai-evalops-harness/evidence/`. Report artifacts are created by their executing WOs,
not speculatively by this draft.

## Certification verdict

Program implementation is complete only when:

```text
BACKUP_RESTORE_CORRECTNESS=PROVEN
OFFSITE_RECOVERY=PROVEN
NETWORK_AND_IDENTITY_BOUNDARIES=PROVEN
REPRODUCIBLE_SUPPLY_CHAIN=PROVEN
DURABLE_JOB_ATTEMPT_LEDGER=PROVEN
LEASE_FENCING_AND_IDEMPOTENCY=PROVEN
RESTART_SAFE_SETTLEMENT=PROVEN
HERMES_BOUNDED_AI_ADAPTER=PROVEN
AEGIS_BOUNDED_WORKER=PROVEN
RESOURCE_AWARE_PLACEMENT=PROVEN
OBSERVABILITY_AND_ALERTING=PROVEN
AI_MODEL_ENVELOPES=MEASURED
CHAOS_RECOVERY=PROVEN
SEVEN_DAY_SOAK=PROVEN
OWNER_OPERATION_TOUCH_COUNT=0
OWNER_CREDENTIAL_TOUCH_COUNT=0
OWNER_DIAGNOSTIC_TOUCH_COUNT=0
OWNER_ROUTINE_DECISION_COUNT=0
OWNER_ROUTINE_CONTACT_COUNT=0
```

Passing sets the bounded capability to `SOAK_PROVEN`. It does not create
`PRODUCTION_AUTHORIZED`; that requires a separate active grant.

## Activation procedure

1. Refresh both repository baselines and reconcile dirty/foreign changes.
2. Materialize a complete canonical packet for each dependency-cleared child WO.
3. Record exact authority for repository-only work; leave live/mutating WOs blocked.
4. Independently review program scope, DAG, reservations, authority and rollback.
5. Only then update the active-program, goal and loop registries through a separate activation WO.
