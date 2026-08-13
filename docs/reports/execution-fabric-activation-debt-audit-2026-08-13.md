# Execution Fabric Activation Debt Audit — 2026-08-13

## Verdict

The repository contains substantial fail-closed execution-fabric engineering, but its OMEN-off remote-development path is not operationally activatable in the current state. The only checked-in activation is expired and single-use, validators require an inactive scheduler posture, the prerequisite package is unapplied, and the live controller suite is unconditionally skipped.

**Static proof is not runtime proof.** Contract tests and deterministic simulations can prove rejection, parsing, state transitions, and evidence rules. They cannot prove that Hermes dispatched work, AEGIS executed it, OMEN remained workload-free, or the complete service flow recovered and finished.

## Priority method

Each item is scored from 1–5 for Impact, Risk, and Effort. Priority is:

```text
(Impact + Risk) * (6 - Effort)
```

Higher scores should be remediated first. Risk measures the harm of leaving the condition in place; effort measures remediation cost.

| ID | Class | Impact | Risk | Effort | Score |
| --- | --- | ---: | ---: | ---: | ---: |
| A1 | P0 | 5 | 5 | 2 | 40 |
| A2 | P0 | 5 | 5 | 2 | 40 |
| A3 | P0 | 5 | 4 | 3 | 27 |
| A4 | P0 | 5 | 4 | 3 | 27 |
| A5 | P1 | 4 | 4 | 2 | 32 |
| A6 | P1 | 4 | 4 | 3 | 24 |
| A7 | P1 | 4 | 3 | 3 | 21 |
| A8 | P2 | 3 | 3 | 2 | 24 |

## Findings

### P0 — blocks real operation or valid acceptance

#### A1 — The only activation is an expired one-shot artifact

The activation declares `FUTURE_DATED_SINGLE_USE_AUTHORITY`, cannot authorize execution by itself, and hardcodes a four-hour window that ended on 2026-08-11: `config/execution-fabric/remote-dev-offload-v1-activation.json:6-7,16-17`. It also keeps the scheduler disabled and both standing authority and autonomous dispatch false: `config/execution-fabric/remote-dev-offload-v1-activation.json:176-179`.

The validator does not merely tolerate this historical shape; it requires it. It demands the future-dated single-use status and non-authorizing file at `scripts/execution-fabric/live/remote-dev-offload-activation.mjs:139-143`, requires a future-dated window of at most four hours at `:151-156`, requires the disabled scheduler posture at `:185`, and rejects execution outside the window at `:224-225`.

**Classification:** accidental handcuff. Preserve expiry, revocation, scope binding, single-use consumption, and replay rejection; replace the hardcoded dated artifact with a renewable, externally authenticated grant path.

#### A2 — The live controller acceptance suite never runs

The entire future-activation controller suite is under unconditional `describe.skip` at `tests/execution-fabric-remote-dev-offload-controller.test.ts:146`. The same test hardcodes `pwsh.exe` at `:17`, so machines without PowerShell 7 cannot execute even the non-skipped controller coverage.

**Classification:** accidental handcuff and evidence gap. Environmental skips may be legitimate, but a required CI or lab lane must run the live suite and fail when prerequisites are absent or stale.

#### A3 — Policy and scope require an inactive scheduler

The policy calls itself a `NON_ACTIVE_CONTRACT` and fixes standing AEGIS authority false at `config/execution-fabric/remote-dev-offload-v1.policy.json:46,53-55`. The inactive scope repeats `OWNER_AUTHORIZED_EXCEPTION_INACTIVE`, disabled scheduler, false standing authority, and false autonomous dispatch at `config/execution-fabric/remote-dev-offload-v1-inactive-scope.json:7,151-154`. Contract validation requires that exact inactive shape at `scripts/execution-fabric/live/remote-dev-offload-contract.mjs:89,129` and rejects transition while disabled at `:303`.

**Classification:** accidental handcuff at the activation boundary. Default-deny is correct; making the inactive baseline the only valid contract is not.

#### A4 — Prerequisite provisioning is package-only

The checked-in prerequisite state is `PACKAGE_ONLY_NOT_APPLIED` and explicitly records standing AEGIS authority disabled at `config/execution-fabric/aegis-remote-dev-prerequisites.json:4,20-21`. The provisioning report states that it is a fail-closed dry-run package and does not authorize execution at `docs/reports/WO-TF-REMOTE-DEV-OFFLOAD-001-prerequisite-provisioning.md:7`; it records the general scheduler and standing authority disabled at `:22-23`.

**Classification:** valid safety gate that became an operational blocker because no promotion/apply ceremony was completed. Preserve independent prerequisite attestation; implement and exercise its apply, refresh, revoke, and rollback lifecycle.

### P1 — misleading capability state or systemic operational debt

#### A5 — External workers are catalog entries, not executable workers

Codex is disabled and `provider_lane_unproven` at `control-center/backend/worker_registry.json:10-12`, with proposal execution disabled at `:79-80`. Claude is disabled and `hosted_transport_unproven` at `:110-112`, with proposal execution disabled at `:187-188`. Hermes is disabled and `not_connected` at `:218-220`, limited to `proposal_only` at `:234`, and requires operator configuration while proposal execution remains disabled at `:245-247`.

**Classification:** truthful registry state, but an accidental product handcuff if these entries are presented as available execution capacity. Keep catalog/executable separation; add a supported promotion and continuous conformance path.

#### A6 — Static models received certification-style completion labels

`docs/reports/WO-MAO-056-cross-review-ci-remediation-certification.md:3` says `PASS / STATIC CERTIFICATION COMPLETE`, while `:8` states that the evidence is static/read-only and does not dispatch providers, call GitHub APIs, or run a workflow; `:103` records `providerExecutionPerformed: false`. `docs/reports/WO-MAO-055-concurrent-certification-lanes.md:6` calls the lanes static and `:79` records no GitHub API call.

Later reports correctly reject unattended certification: `docs/reports/WO-MAO-059-sustained-zero-touch-soak-rejection.md:14` states there was no background runtime, scheduler, provider dispatcher, or continuous unattended execution; `docs/reports/WO-MAO-061-unattended-multi-agent-certification-rejection.md:27-28` records `NOT_PROVEN` and `NOT_ACTIVE`.

**Classification:** evidence-semantics defect. Static model verification is useful, but `PASS`, `COMPLETE`, and `PROVEN` must be namespace-qualified and must not satisfy runtime gates.

#### A7 — The active queue cannot dispatch itself

The active-program queue says the scheduler and background worker are inactive at `docs/governance/active-program-queue.md:220-221`, while also declaring a standing `READY` node at `:152` and treating `NO_ACTIVE_PROGRAM` as invalid while useful work remains at `:173,188`.

**Classification:** governance/runtime contradiction. A deterministic read model is valuable; it must not claim autonomous continuation without a live dispatcher, lease owner, and provider.

### P2 — conditional coverage that can silently remain unexercised

#### A8 — Host-dependent tests lack an evident mandatory execution lane

Hermes supervisor integration tests use conditional skips at `tests/hermes-bridge-supervisor.test.ts:52,102,191,225,263,292,351`; the kill-path test conditionally skips at `tests/hermes-bridge-kill.test.ts:62`; the Atlas runtime-role policy test skips when its image is absent at `tests/ai-evalops-harness-atlas-runtime-role-policy.test.mjs:62`.

**Classification:** potentially valid portability controls. They become accidental blind spots if no required environment executes them and reports their result.

## Controls to preserve

- Default-deny activation and exact repository, commit, identity, operation, resource, and network binding.
- Short-lived grants, expiry, revocation, single-use claim, consumption limits, and replay rejection.
- Lease fencing, reservation collision prevention, idempotency, evidence chaining, and bounded retries.
- AEGIS containment and the OMEN zero-project-workload invariant.
- Independent prerequisite and trust attestation; no self-authorizing configuration file.
- Secret redaction, path confinement, independent review, and quarantine of the rejected issue #357 adapter.

## Handcuffs to remove

- A dated one-shot artifact as the only concrete activation route.
- Validators that define the inactive scheduler shape as the only acceptable shape.
- An unapplied prerequisite package with no proven promotion path.
- Unconditional skipping of live acceptance.
- Provider registrations with no supported path from cataloged to executable.
- Operator-required setup that conflicts with the owner-only/no-routine-operator doctrine.
- Unqualified certification language for static models and synthetic evidence.

## Phased remediation

### Phase 0 — restore truthful state

1. Mark the expired activation historical and non-current without deleting its evidence.
2. Split capability states into `STATIC_CONTRACT_VERIFIED`, `INTEGRATION_VERIFIED`, and `LIVE_RUNTIME_VERIFIED`; prohibit static states from satisfying live gates.
3. Remove unconditional live-suite skips. Use explicit environment selection and make at least one required lane execute every live acceptance test.
4. Make PowerShell discovery portable (`pwsh`/configured path) and report a typed prerequisite failure instead of a null process result.

### Phase 1 — build a renewable activation path

1. Introduce an externally authenticated, renewable grant referencing immutable policy and exact work scope.
2. Model inactive and active scheduler postures as separate valid states with explicit, audited transitions.
3. Apply and attest AEGIS prerequisites on the target host; support freshness checks, revocation, rollback, and re-provisioning.
4. Preserve all containment and replay defenses while removing hardcoded dates and one-run repository constants from reusable runtime code.

### Phase 2 — prove OMEN-off execution end to end

1. Start Hermes through the supported service surface.
2. Issue a fresh bounded grant, dispatch one harmless representative job, and execute it on AEGIS.
3. Capture independent evidence for transport, identity, workspace, process placement, network enforcement, resource bounds, result, cleanup, and zero OMEN project workload.
4. Exercise cancel, expiry, replay, stale evidence, worker failure, and cleanup failure paths.
5. Publish a runtime acceptance result that includes commands, timestamps, hashes, service status, and unskipped test totals.

### Phase 3 — eliminate adjacent inert machinery

1. Audit every worker and UI capability claim against an executable adapter and recent conformance evidence.
2. Require CI lanes for all conditionally skipped host tests.
3. Rename historical static `PASS/COMPLETE/PROVEN` records or add machine-readable maturity qualifiers that prevent promotion.
4. Reconcile queue `READY` state with actual scheduler, provider, authority, and lease availability.

## Acceptance criteria for closing this debt

- A fresh grant can be issued without editing source-controlled timestamps.
- Activation transitions from inactive to active and back through authenticated, tested paths.
- All prerequisites are independently attested and fresh.
- The controller acceptance suite runs with zero unconditional skips in a required environment.
- Hermes dispatches a bounded job that executes on AEGIS and produces independently verifiable evidence.
- OMEN performs zero TerraFusion project workloads during the run.
- Expired, revoked, replayed, malformed, or out-of-scope grants still fail closed.
- Repository capability labels distinguish static, integration, and live runtime proof.
