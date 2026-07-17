export type CapabilityStatus =
  | "PROVEN"
  | "PILOT_AUTHORIZED"
  | "AVAILABLE_UNPROVEN"
  | "UNAVAILABLE"
  | "REJECTED"

export type CapabilityKind =
  | "CONTROL_PLANE"
  | "GOVERNANCE_SURFACE"
  | "EXECUTION_KERNEL"
  | "PROVIDER_SURFACE"
  | "PROVIDER_ADAPTER"
  | "MODEL_RUNTIME"

export type ExecutionClass = "NON_EXECUTABLE" | "WORKER_CANDIDATE" | "EXECUTABLE_WORKER"

export type MultiAgentCapabilityRecord = {
  capabilityId: string
  label: string
  kind: CapabilityKind
  status: CapabilityStatus
  executionClass: ExecutionClass
  coordinationEligible?: boolean
  claim: string
  reasonCode: string
  adapterRef: string | null
  authorityGrantRefs: readonly string[]
  trustGateRef: string | null
  evidence: readonly string[]
  restrictions: readonly string[]
}

export const PREVENTIVE_TRUST_GATE_V2_REF =
  "control-center/backend/workers.py#validate_preventive_trust_gate_v2"

const record = (value: MultiAgentCapabilityRecord) => Object.freeze({
  ...value,
  authorityGrantRefs: Object.freeze([...value.authorityGrantRefs]),
  evidence: Object.freeze([...value.evidence]),
  restrictions: Object.freeze([...value.restrictions]),
})

export const MULTI_AGENT_CAPABILITY_INVENTORY = Object.freeze([
  record({
    capabilityId: "williamos-governance-control-plane",
    label: "WilliamOS governance control plane",
    kind: "CONTROL_PLANE",
    status: "PROVEN",
    executionClass: "NON_EXECUTABLE",
    claim: "Goals, loops, Work Orders, authority boundaries, evidence, and portfolio decisions exist as governed control-plane records.",
    reasonCode: "CONTROL_PLANE_EVIDENCED",
    adapterRef: null,
    authorityGrantRefs: [],
    trustGateRef: null,
    evidence: [
      "docs/governance/goal-registry.md",
      "docs/governance/loop-registry.md",
      "docs/governance/williamos-work-order-playbook.md",
    ],
    restrictions: ["Does not itself dispatch a provider", "Does not turn the owner into a worker"],
  }),
  record({
    capabilityId: "codex-operator-decision-model",
    label: "Codex operator decision model",
    kind: "GOVERNANCE_SURFACE",
    status: "PROVEN",
    executionClass: "NON_EXECUTABLE",
    claim: "The completed Codex Operator program models continuation, authority walls, review, merge eligibility, and evidence.",
    reasonCode: "DECISION_MODEL_EVIDENCED",
    adapterRef: null,
    authorityGrantRefs: [],
    trustGateRef: null,
    evidence: [
      "components/operator/codex-operator-registry.ts",
      "components/operator/codex-operator-resolver.ts",
      "docs/reports/WO-CODEX-OPERATOR-024-final-rollup.md",
    ],
    restrictions: ["Completed predecessor model", "Not a provider transport or worker pool"],
  }),
  record({
    capabilityId: "serial-operational-kernel",
    label: "Serial operational kernel",
    kind: "EXECUTION_KERNEL",
    status: "PROVEN",
    executionClass: "NON_EXECUTABLE",
    claim: "The serial kernel implementation and its bounded lifecycle behavior are covered by repository tests.",
    reasonCode: "SERIAL_KERNEL_IMPLEMENTATION_EVIDENCED",
    adapterRef: null,
    authorityGrantRefs: [],
    trustGateRef: null,
    evidence: [
      "scripts/runtime-operator/operational-kernel.mjs",
      "tests/runtime-operator-operational-kernel.test.ts",
      "docs/reports/WO-RUNTIME-KERNEL-001-operational-kernel.md",
    ],
    restrictions: [
      "Its only implemented provider adapter is terminally rejected",
      "It is not a concurrent multi-agent scheduler",
    ],
  }),
  record({
    capabilityId: "local-nested-codex-adapter",
    label: "Local nested Codex adapter",
    kind: "PROVIDER_ADAPTER",
    status: "REJECTED",
    executionClass: "WORKER_CANDIDATE",
    claim: "The local nested codex exec path is terminally quarantined after the authenticated transport wall.",
    reasonCode: "CODEX_NETWORK_WALL",
    adapterRef: "local-nested-codex-exec",
    authorityGrantRefs: [],
    trustGateRef: null,
    evidence: [
      "runtime-operator/native/authority-registry.json",
      "docs/reports/WO-MAO-001-terminal-local-adapter.md",
      "https://github.com/bsvalues/terragroq/issues/357",
    ],
    restrictions: ["No dispatch", "No retry", "No reactivation, wrapping, renaming, or silent reuse"],
  }),
  record({
    capabilityId: "multi-agent-phase-two-local-contracts",
    label: "Multi-agent Phase 2 local contracts",
    kind: "EXECUTION_KERNEL",
    status: "PROVEN",
    executionClass: "NON_EXECUTABLE",
    claim: "Provider-neutral envelope, DAG, reservation and atomic-ledger, provider-eligibility, lifecycle, per-lane lease, checkpoint, evidence-ledger, and owner-meter contracts are proven locally.",
    reasonCode: "PHASE_TWO_LOCAL_CONTRACTS_PROVEN",
    adapterRef: null,
    authorityGrantRefs: [],
    trustGateRef: null,
    evidence: [
      "docs/reports/WO-MAO-016-work-order-envelope-v2.md",
      "docs/reports/WO-MAO-017-dag-eligible-set-resolver.md",
      "docs/reports/WO-MAO-018-reservation-ledger.md",
      "docs/reports/WO-MAO-019-provider-capability-dispatch-contract.md",
      "docs/reports/WO-MAO-020-lifecycle-escalation-taxonomy.md",
      "docs/reports/WO-MAO-021-per-lane-leases-checkpoints.md",
      "docs/reports/WO-MAO-022-evidence-ledger-owner-touch-meter.md",
    ],
    restrictions: [
      "Local contracts only",
      "No durable provider dispatch or unattended scheduler",
      "No GitHub delivery automation",
      "No authority minting",
    ],
  }),
  record({
    capabilityId: "multi-agent-phase-three-team-topology-plan",
    label: "Multi-agent Phase 3 team topology and fan-in plan",
    kind: "EXECUTION_KERNEL",
    status: "PROVEN",
    executionClass: "NON_EXECUTABLE",
    claim: "WO-MAO-024 provides a deterministic planning model for assigning team roles and waiting only on declared fan-in dependencies; it does not execute the plan.",
    reasonCode: "PHASE_THREE_TEAM_TOPOLOGY_PLAN_PROVEN",
    adapterRef: null,
    authorityGrantRefs: [],
    trustGateRef: null,
    evidence: [
      "docs/governance/multi-agent-operator-playbook.md#phase-3--multi-agent-scheduler-and-isolation",
      "scripts/multi-agent-operator/team-topology.mjs",
      "tests/multi-agent-team-topology.test.ts",
    ],
    restrictions: [
      "Planning only; no dispatch or runtime activation",
      "No authority grant, minting, or expansion",
      "No provider, GitHub, or production operation",
      "No rejected nested-runtime reuse",
      "Owner operations remain prohibited and owner-touch counters remain zero",
    ],
  }),
  record({
    capabilityId: "multi-agent-phase-three-isolated-workspace-manager",
    label: "Multi-agent Phase 3 isolated workspace manager",
    kind: "EXECUTION_KERNEL",
    status: "PROVEN",
    executionClass: "NON_EXECUTABLE",
    claim: "WO-MAO-025 provides deterministic planning plus bounded create, validate, reconcile, and clean operations for lease- and evidence-bound per-lane branches and worktrees.",
    reasonCode: "PHASE_THREE_ISOLATED_WORKSPACE_MANAGER_PROVEN",
    adapterRef: null,
    authorityGrantRefs: [],
    trustGateRef: null,
    evidence: [
      "docs/governance/multi-agent-operator-playbook.md#phase-3--multi-agent-scheduler-and-isolation",
      "scripts/multi-agent-operator/isolated-workspace-manager.mjs",
      "tests/multi-agent-isolated-workspace-manager.test.ts",
    ],
    restrictions: [
      "Git mutation is bounded to exact owned branch/worktree lifecycle under an authorized coordinator",
      "No shared worktree, foreign or dirty change absorption, forced deletion, or unsafe cleanup",
      "No authority grant, provider dispatch, runtime activation, push, PR, merge, or production operation",
      "No rejected nested-runtime reuse",
      "Owner operations remain prohibited and owner-touch counters remain zero",
    ],
  }),
  record({
    capabilityId: "multi-agent-phase-three-reservation-aware-handoff",
    label: "Multi-agent Phase 3 reservation-aware handoff",
    kind: "EXECUTION_KERNEL",
    status: "PROVEN",
    executionClass: "NON_EXECUTABLE",
    claim: "WO-MAO-026 provides a durable, fail-closed handoff contract that transfers role custody without releasing the builder reservation, lease, or one-writer fence.",
    reasonCode: "PHASE_THREE_RESERVATION_AWARE_HANDOFF_PROVEN",
    adapterRef: null,
    authorityGrantRefs: [],
    trustGateRef: null,
    evidence: [
      "docs/governance/multi-agent-operator-playbook.md#phase-3--multi-agent-scheduler-and-isolation",
      "scripts/multi-agent-operator/reservation-aware-handoff.mjs",
      "scripts/multi-agent-operator/reservation-aware-handoff-host.mjs",
      "tests/multi-agent-reservation-aware-handoff.test.ts",
    ],
    restrictions: [
      "No reservation or lease release during handoff",
      "Reviewer and verifier remain read-only; remediation returns only to the original builder",
      "No second writer, authority grant, provider dispatch, runtime activation, or GitHub operation",
      "No rejected nested-runtime reuse",
      "Owner operations remain prohibited and owner-touch counters remain zero",
    ],
  }),
  record({
    capabilityId: "multi-agent-phase-three-concurrency-fairness",
    label: "Multi-agent Phase 3 concurrency, priority, and fairness",
    kind: "EXECUTION_KERNEL",
    status: "PROVEN",
    executionClass: "NON_EXECUTABLE",
    claim: "WO-MAO-027 extends the durable eligible-set scheduler with trust-signed priority claims, scheduler-derived aging, starvation protection, bounded security drain requests, and exact-dispatch backpressure from pinned-signed provider 429 observations.",
    reasonCode: "PHASE_THREE_CONCURRENCY_FAIRNESS_PROVEN",
    adapterRef: null,
    authorityGrantRefs: [],
    trustGateRef: null,
    evidence: [
      "docs/governance/multi-agent-operator-playbook.md#phase-3--multi-agent-scheduler-and-isolation",
      "scripts/multi-agent-operator/eligible-set-scheduler.mjs",
      "tests/multi-agent-eligible-set-scheduler.test.ts",
      "docs/reports/WO-MAO-027-concurrency-budgets-priority-fairness.md",
    ],
    restrictions: [
      "Priority cannot bypass trust, authority, DAG, provider, reservation, lease, risk, or capacity gates",
      "Security preemption emits a bounded drain request and never releases capacity or cancels work",
      "No authority grant, runtime activation, provider dispatch, or GitHub operation",
      "No rejected nested-runtime reuse",
      "Owner operations remain prohibited and owner-touch counters remain zero",
    ],
  }),
  record({
    capabilityId: "multi-agent-phase-three-scheduler-model-check",
    label: "Multi-agent Phase 3 scheduler simulation and model checking",
    kind: "EXECUTION_KERNEL",
    status: "PROVEN",
    executionClass: "NON_EXECUTABLE",
    claim: "WO-MAO-028 performs bounded canonical-state exploration for scheduler DAG, cycle, collision, fan-in, duplicate-delivery, expiry, starvation, deadlock, cancellation, and replay behavior without external effects; incomplete searches are explicitly inconclusive.",
    reasonCode: "PHASE_THREE_SCHEDULER_MODEL_CHECK_PROVEN",
    adapterRef: null,
    authorityGrantRefs: [],
    trustGateRef: null,
    evidence: [
      "docs/governance/multi-agent-operator-playbook.md#phase-3--multi-agent-scheduler-and-isolation",
      "scripts/multi-agent-operator/scheduler-model-check.mjs",
      "tests/scheduler-model-check.test.ts",
      "docs/reports/WO-MAO-028-scheduler-simulation-model-checking.md",
    ],
    restrictions: [
      "Pure deterministic simulation only; no provider or runtime execution",
      "Depth-bound, state-bound, or truncated exploration is inconclusive and cannot satisfy a pass claim",
      "No external dispatch, GitHub operation, production mutation, or authority grant",
      "No rejected nested-runtime reuse",
      "Owner operations remain prohibited and owner-touch counters remain zero",
    ],
  }),
  record({
    capabilityId: "hosted-codex-session",
    label: "Supported hosted Codex session",
    kind: "PROVIDER_SURFACE",
    status: "PROVEN",
    executionClass: "WORKER_CANDIDATE",
    coordinationEligible: true,
    claim: "A hosted Codex session completed the bounded Phase 1 R1 coordination proof through independent remediation re-review and zero unresolved substantive threads.",
    reasonCode: "HOSTED_BOUNDED_COORDINATION_PROVEN",
    adapterRef: null,
    authorityGrantRefs: ["docs/governance/active-program-queue.md#canonical-active-program"],
    trustGateRef: PREVENTIVE_TRUST_GATE_V2_REF,
    evidence: [
      "docs/governance/multi-agent-operator-playbook.md",
      "docs/reports/WO-MAO-015-hosted-team-proof-rollup.md",
      "AGENTS.md",
    ],
    restrictions: [
      "Bounded R0/R1 repository coordination proven",
      "Not dispatch-eligible through the worker registry",
      "No durable-runtime claim",
      "No local nested adapter",
    ],
  }),
  record({
    capabilityId: "codex-native-subagent-team",
    label: "Codex native coordinator and subagents",
    kind: "PROVIDER_SURFACE",
    status: "PROVEN",
    executionClass: "WORKER_CANDIDATE",
    coordinationEligible: true,
    claim: "Native coordinator, independent builders, assurance, original-builder remediation, and fan-in roles completed the bounded Phase 1 proof.",
    reasonCode: "CODEX_NATIVE_TEAM_BOUNDED_PROOF",
    adapterRef: null,
    authorityGrantRefs: ["docs/governance/active-program-queue.md#canonical-active-program"],
    trustGateRef: PREVENTIVE_TRUST_GATE_V2_REF,
    evidence: [
      "docs/governance/multi-agent-operator-playbook.md",
      "docs/reports/WO-MAO-015-hosted-team-proof-rollup.md",
      "AGENTS.md",
    ],
    restrictions: [
      "Not dispatch-eligible through the worker registry",
      "No durable WilliamOS dispatch claim",
      "No atomic-reservation claim",
    ],
  }),
  record({
    capabilityId: "hosted-codex-coordinator-adapter",
    label: "Hosted Codex coordinator adapter",
    kind: "PROVIDER_ADAPTER",
    status: "PROVEN",
    executionClass: "WORKER_CANDIDATE",
    coordinationEligible: true,
    claim: "WO-MAO-030 compiles canonical team plans into opaque, host-trusted current-session native assignments with bridge-backed messaging, cancellation, sanitized evidence, replay sealing, and ambiguous-side-effect quarantine without durable dispatch.",
    reasonCode: "HOSTED_CODEX_COORDINATOR_ADAPTER_PROVEN",
    adapterRef: "scripts/multi-agent-operator/codex-coordinator-adapter.mjs",
    authorityGrantRefs: ["docs/governance/active-program-queue.md#canonical-active-program"],
    trustGateRef: PREVENTIVE_TRUST_GATE_V2_REF,
    evidence: [
      "scripts/multi-agent-operator/codex-coordinator-adapter.mjs",
      "tests/multi-agent-codex-coordinator-adapter.test.ts",
      "docs/reports/WO-MAO-030-hosted-codex-coordinator-adapter.md",
      "docs/reports/WO-MAO-030-post-merge-assurance-remediation.md",
    ],
    restrictions: [
      "Current-session native assignment translation only",
      "Production host-session, trust, and native-bridge registries remain empty and immutable",
      "Host side effects require exact idempotency, lookup-only reconciliation, and quarantine on uncertain outcomes",
      "Provider-contract dispatch remains false",
      "No durable persistence, service worker, runtime activation, or authority grant",
      "No GitHub write, production operation, rejected nested-runtime reuse, or owner relay",
    ],
  }),
  record({
    capabilityId: "hosted-codex-role-adapters",
    label: "Hosted Codex builder, assurance, remediation, and re-review adapters",
    kind: "PROVIDER_ADAPTER",
    status: "PROVEN",
    executionClass: "WORKER_CANDIDATE",
    coordinationEligible: true,
    claim: "WO-MAO-031 proves a reusable current-session one-cycle builder, independent assurance, original-builder remediation, and zero-unresolved-thread re-review lifecycle through the atomically authority-fenced WO-MAO-030 bridge.",
    reasonCode: "HOSTED_CODEX_ONE_CYCLE_ROLE_LIFECYCLE_PROVEN",
    adapterRef: "scripts/multi-agent-operator/codex-role-adapters.mjs",
    authorityGrantRefs: ["docs/governance/active-program-queue.md#canonical-active-program"],
    trustGateRef: PREVENTIVE_TRUST_GATE_V2_REF,
    evidence: [
      "scripts/multi-agent-operator/codex-role-adapters.mjs",
      "tests/multi-agent-codex-role-adapters.test.ts",
      "tests/multi-agent-codex-coordinator-adapter.test.ts",
      "docs/reports/WO-MAO-031-codex-builder-assurance-remediation-adapters.md",
    ],
    restrictions: [
      "Current-session role lifecycle proof only",
      "Exactly one bounded remediation and re-review cycle; no multi-cycle or unattended claim",
      "Assurance remains independent and cannot remediate its own finding",
      "Remediation is bound to the original builder and the envelope remediation budget",
      "Opaque same-plan handles, live authority fences, bounded retries, and lookup-only ambiguous-effect reconciliation remain mandatory",
      "Provider-contract dispatch remains false",
      "No durable persistence, service worker, runtime activation, or authority grant",
      "No GitHub review automation, production operation, rejected nested-runtime reuse, or owner relay",
    ],
  }),
  record({
    capabilityId: "cross-provider-routing-review-model",
    label: "Cross-provider routing and review model",
    kind: "CONTROL_PLANE",
    status: "PROVEN",
    executionClass: "NON_EXECUTABLE",
    claim: "WO-MAO-034 proves a zero-input canonical control-plane route to hosted Codex and a distinct logical same-provider review route while excluding unavailable Claude; exact independent candidate assurance is bound separately.",
    reasonCode: "CANONICAL_ROUTING_AND_INDEPENDENT_CANDIDATE_ASSURANCE_VERIFIED",
    adapterRef: "scripts/multi-agent-operator/cross-provider-routing-review.mjs",
    authorityGrantRefs: [],
    trustGateRef: null,
    evidence: [
      "scripts/multi-agent-operator/cross-provider-routing-review.mjs",
      "scripts/multi-agent-operator/cross-provider-routing-review-registry.mjs",
      "scripts/multi-agent-operator/cross-provider-routing-review-cli.mjs",
      "scripts/multi-agent-operator/wo-mao-034-provider-settlement.mjs",
      "components/operator/multi-agent-provider-settlement-registry.ts",
      "components/operator/multi-agent-routing-review-registry.ts",
      "tests/multi-agent-cross-provider-routing-review.test.ts",
      "tests/multi-agent-wo-mao-034-provider-settlement.test.ts",
      "docs/reports/WO-MAO-034-cross-provider-routing-review.md",
    ],
    restrictions: [
      "Bounded zero-input control-plane routing evaluation only; no provider execution or dispatch",
      "Logical route-role separation is proven; host-native worker identity is not claimed",
      "WO-MAO-034 is complete through independently reviewed candidate evidence; WO-MAO-035 and WO-MAO-036 now complete the ordered Phase 4 re-proof chain",
      "The settlement remains scoped only to WO-MAO-034<-WO-MAO-033; the graph correction does not retarget or generalize it",
      "Callers cannot submit roots, writers, trust bundles, ledger anchors, signatures, or raw trust material",
      "Unavailable providers contribute no capability",
      "No provider dispatch, GitHub review automation, runtime activation, or authority grant",
      "No secrets, raw credentials, workspace sharing, rejected nested-runtime reuse, or owner relay",
    ],
  }),
  record({
    capabilityId: "provider-health-reroute-model",
    label: "Provider health, circuit breaker, and reroute model",
    kind: "CONTROL_PLANE",
    status: "PROVEN",
    executionClass: "NON_EXECUTABLE",
    claim: "WO-MAO-035 proves a zero-input canonical provider-health registry with trusted observations, stateful breaker transitions, bounded static reroute selection, and explicit unavailable-provider deferment.",
    reasonCode: "CANONICAL_PROVIDER_HEALTH_REROUTE_VERIFIED",
    adapterRef: "scripts/multi-agent-operator/provider-health-reroute.mjs",
    authorityGrantRefs: [],
    trustGateRef: null,
    evidence: [
      "scripts/multi-agent-operator/provider-health-reroute.mjs",
      "scripts/multi-agent-operator/provider-health-reroute-cli.mjs",
      "components/operator/multi-agent-provider-health-registry.ts",
      "tests/multi-agent-provider-health-reroute.test.ts",
      "docs/reports/WO-MAO-035-provider-health-reroute.md",
    ],
    restrictions: [
      "Static health and reroute planning only",
      "Caller-supplied providers, observations, breaker state, and reroute requests are rejected",
      "Trusted observations and stateful breaker transitions come only from the sealed canonical registry",
      "WO-MAO-035 is complete; WO-MAO-036 is now complete and releases WO-MAO-037 through retained prerequisites",
      "Unavailable providers remain disabled and deferred",
      "Circuit breakers do not dispatch, cancel, persist, or mutate provider state",
      "No provider call, GitHub automation, runtime activation, authority grant, or owner relay",
      "No secrets, raw credentials, rejected nested-runtime reuse, or production operation",
    ],
  }),
  record({
    capabilityId: "provider-conformance-suite-model",
    label: "Provider conformance suite model",
    kind: "CONTROL_PLANE",
    status: "PROVEN",
    executionClass: "NON_EXECUTABLE",
    claim: "WO-MAO-036 proves a zero-input canonical provider conformance suite: hosted Codex is session-only conformant, Claude remains deferred, and the rejected local nested adapter remains rejected.",
    reasonCode: "CANONICAL_PROVIDER_CONFORMANCE_SUITE_VERIFIED",
    adapterRef: "scripts/multi-agent-operator/provider-conformance-suite.mjs",
    authorityGrantRefs: [],
    trustGateRef: null,
    evidence: [
      "scripts/multi-agent-operator/provider-conformance-suite.mjs",
      "scripts/multi-agent-operator/provider-conformance-suite-cli.mjs",
      "components/operator/multi-agent-provider-conformance-registry.ts",
      "tests/multi-agent-provider-conformance-suite.test.ts",
      "docs/reports/WO-MAO-036-provider-conformance-suite.md",
    ],
    restrictions: [
      "Static conformance suite only",
      "Caller-supplied provider records, fixture coverage, and contract sets are rejected",
      "Hosted Codex is session-only conformant, not executable-worker certified",
      "Hosted Codex remains session-only and non-executable",
      "Unavailable and rejected providers are excluded, not certified",
      "WO-MAO-036 is complete; WO-MAO-037 is released to READY through retained prerequisites",
      "No provider dispatch, GitHub automation, runtime activation, authority grant, or owner relay",
      "No secrets, raw credentials, rejected nested-runtime reuse, or production operation",
    ],
  }),
  record({
    capabilityId: "branch-commit-push-automation-model",
    label: "Branch, commit, and push automation model",
    kind: "CONTROL_PLANE",
    status: "PROVEN",
    executionClass: "NON_EXECUTABLE",
    claim: "WO-MAO-037 proves a zero-input governed branch/commit/push lifecycle plan with active-grant, trust-gate, reservation, lease-fence, reserved-path, secret-scan, attribution, and rollback gates.",
    reasonCode: "CANONICAL_BRANCH_COMMIT_PUSH_AUTOMATION_VERIFIED",
    adapterRef: "scripts/multi-agent-operator/branch-commit-push-automation.mjs",
    authorityGrantRefs: ["PROGRAM-WILLIAMOS-MULTI-AGENT-OPERATOR-001"],
    trustGateRef: "WO-MAO-007",
    evidence: [
      "scripts/multi-agent-operator/branch-commit-push-automation.mjs",
      "scripts/multi-agent-operator/branch-commit-push-automation-cli.mjs",
      "components/operator/multi-agent-branch-delivery-registry.ts",
      "tests/multi-agent-branch-commit-push-automation.test.ts",
      "docs/reports/WO-MAO-037-branch-commit-push-automation.md",
    ],
    restrictions: [
      "Zero-input control-plane plan only; no git command is executed by the model",
      "Caller-supplied branch, path, authority, attribution, secret-scan, or rollback data is rejected",
      "Only reserved paths are eligible; foreign changes and secret-like findings fail closed",
      "Force-push, tag, release, production write, destructive operations, and secret material remain blocked",
      "WO-MAO-037 is complete; WO-MAO-038 is released to READY through retained prerequisites",
      "No command runner, background worker, runtime activation, credential access, authority minting, or owner relay",
    ],
  }),
  record({
    capabilityId: "pr-creation-packet-linkage-model",
    label: "PR creation and packet linkage model",
    kind: "CONTROL_PLANE",
    status: "PROVEN",
    executionClass: "NON_EXECUTABLE",
    claim: "WO-MAO-038 provides a deterministic PR packet linkage model that derives PR title/body/linkage requirements from verified Work Order, authority, validation, and evidence records.",
    reasonCode: "CANONICAL_PR_CREATION_PACKET_LINKAGE_VERIFIED",
    adapterRef: "scripts/multi-agent-operator/pr-creation-packet-linkage.mjs",
    authorityGrantRefs: ["PROGRAM-WILLIAMOS-MULTI-AGENT-OPERATOR-001"],
    trustGateRef: "WO-MAO-007",
    evidence: [
      "scripts/multi-agent-operator/pr-creation-packet-linkage.mjs",
      "tests/multi-agent-pr-creation-packet-linkage.test.ts",
      "docs/reports/WO-MAO-038-pr-creation-packet-linkage.md",
    ],
    restrictions: [
      "Zero-input control-plane packet model only; no pull request is created by the model",
      "PR body generation must link verified Work Order, authority, validation, and evidence records",
      "Review thread handling, check ingestion, and merge remain downstream gated work",
      "WO-MAO-038 is complete; WO-MAO-039 is released to READY through retained prerequisites",
      "No command runner, background worker, runtime activation, credential access, authority minting, production write, or owner relay",
    ],
  }),
  record({
    capabilityId: "ci-review-ingestion-model",
    label: "CI and review ingestion model",
    kind: "CONTROL_PLANE",
    status: "PROVEN",
    executionClass: "NON_EXECUTABLE",
    claim: "WO-MAO-039 provides a deterministic CI and review ingestion model that classifies check terminal states, review threads, and failure sources for downstream remediation gates.",
    reasonCode: "CANONICAL_CI_REVIEW_INGESTION_VERIFIED",
    adapterRef: "scripts/multi-agent-operator/ci-review-ingestion.mjs",
    authorityGrantRefs: ["PROGRAM-WILLIAMOS-MULTI-AGENT-OPERATOR-001"],
    trustGateRef: "WO-MAO-007",
    evidence: [
      "scripts/multi-agent-operator/ci-review-ingestion.mjs",
      "tests/multi-agent-ci-review-ingestion.test.ts",
      "docs/reports/WO-MAO-039-ci-review-ingestion.md",
    ],
    restrictions: [
      "Zero-input control-plane ingestion model only; no GitHub API is called by the model",
      "Check reruns, review thread resolution, remediation, and merge remain downstream gated work",
      "Failure classes remain classification records: product, flaky infrastructure, provider, policy, and stale base",
      "WO-MAO-039 is complete; WO-MAO-040 is released to READY through retained prerequisites",
      "No command runner, background worker, runtime activation, credential access, authority minting, production write, or owner relay",
    ],
  }),
  record({
    capabilityId: "remediation-rereview-model",
    label: "Automated remediation and re-review model",
    kind: "CONTROL_PLANE",
    status: "PROVEN",
    executionClass: "NON_EXECUTABLE",
    claim: "WO-MAO-040 provides a deterministic bounded remediation and independent re-review model that routes actionable findings back to the original builder contract.",
    reasonCode: "CANONICAL_REMEDIATION_REREVIEW_VERIFIED",
    adapterRef: "scripts/multi-agent-operator/remediation-rereview.mjs",
    authorityGrantRefs: ["PROGRAM-WILLIAMOS-MULTI-AGENT-OPERATOR-001"],
    trustGateRef: "WO-MAO-007",
    evidence: [
      "scripts/multi-agent-operator/remediation-rereview.mjs",
      "tests/multi-agent-remediation-rereview.test.ts",
      "docs/reports/WO-MAO-040-remediation-rereview.md",
    ],
    restrictions: [
      "Zero-input control-plane remediation model only; no branch is mutated by the model",
      "Actionable findings route only to the original builder with one bounded cycle",
      "Independent re-review and zero unresolved threads are required before merge eligibility",
      "WO-MAO-040 is complete; WO-MAO-041 is released to READY through retained prerequisites",
      "No command runner, background worker, runtime activation, credential access, authority minting, production write, or owner relay",
    ],
  }),
  record({
    capabilityId: "bounded-merge-controller-model",
    label: "Bounded merge controller model",
    kind: "CONTROL_PLANE",
    status: "PROVEN",
    executionClass: "NON_EXECUTABLE",
    claim: "WO-MAO-041 provides a deterministic merge-eligibility model that verifies authority, freshness, checks, review-thread, security, authority, and branch-protection gates.",
    reasonCode: "CANONICAL_BOUNDED_MERGE_CONTROLLER_VERIFIED",
    adapterRef: "scripts/multi-agent-operator/bounded-merge-controller.mjs",
    authorityGrantRefs: ["PROGRAM-WILLIAMOS-MULTI-AGENT-OPERATOR-001"],
    trustGateRef: "WO-MAO-007",
    evidence: [
      "scripts/multi-agent-operator/bounded-merge-controller.mjs",
      "tests/multi-agent-bounded-merge-controller.test.ts",
      "docs/reports/WO-MAO-041-bounded-merge-controller.md",
    ],
    restrictions: [
      "Zero-input control-plane merge eligibility model only; no merge is performed by the model",
      "Branch-protection bypass, stale-head merge, failing-check merge, and security or authority thread dismissal remain denied",
      "Merge eligibility requires active authority, fresh head, green required checks, and zero unresolved review threads",
      "WO-MAO-041 is complete; WO-MAO-042 is released to READY through retained prerequisites",
      "No command runner, background worker, runtime activation, credential access, authority minting, production write, or owner relay",
    ],
  }),
  record({
    capabilityId: "post-merge-verification-cleanup-model",
    label: "Post-merge verification and cleanup model",
    kind: "CONTROL_PLANE",
    status: "PROVEN",
    executionClass: "NON_EXECUTABLE",
    claim: "WO-MAO-042 provides a deterministic post-merge verification and safe-cleanup decision model that records main, production-route, evidence-preservation, and cleanup denial gates.",
    reasonCode: "CANONICAL_POST_MERGE_VERIFICATION_CLEANUP_VERIFIED",
    adapterRef: "scripts/multi-agent-operator/post-merge-verification-cleanup.mjs",
    authorityGrantRefs: ["PROGRAM-WILLIAMOS-MULTI-AGENT-OPERATOR-001"],
    trustGateRef: "WO-MAO-007",
    evidence: [
      "scripts/multi-agent-operator/post-merge-verification-cleanup.mjs",
      "tests/multi-agent-post-merge-verification-cleanup.test.ts",
      "docs/reports/WO-MAO-042-post-merge-verification-cleanup.md",
    ],
    restrictions: [
      "Zero-input control-plane verification model only; no cleanup is performed by the model",
      "Main, production route, evidence preservation, and cleanup-safety gates must pass before dependent release",
      "Shared worktree cleanup, dirty worktree cleanup, foreign path cleanup, unmerged branch deletion, and .obsidian touch remain denied",
      "WO-MAO-042 is complete; WO-MAO-043 is released to READY through retained prerequisites",
      "No command runner, background worker, runtime activation, credential access, authority minting, production write, destructive cleanup, or owner relay",
    ],
  }),
  record({
    capabilityId: "automatic-dependent-release-model",
    label: "Automatic dependent release model",
    kind: "CONTROL_PLANE",
    status: "PROVEN",
    executionClass: "NON_EXECUTABLE",
    claim: "WO-MAO-043 provides a deterministic dependent-release decision model that recomputes the eligible set and releases only dependency-cleared work without owner polling.",
    reasonCode: "CANONICAL_AUTOMATIC_DEPENDENT_RELEASE_VERIFIED",
    adapterRef: "scripts/multi-agent-operator/automatic-dependent-release.mjs",
    authorityGrantRefs: ["PROGRAM-WILLIAMOS-MULTI-AGENT-OPERATOR-001"],
    trustGateRef: "WO-MAO-007",
    evidence: [
      "scripts/multi-agent-operator/automatic-dependent-release.mjs",
      "tests/multi-agent-automatic-dependent-release.test.ts",
      "docs/reports/WO-MAO-043-automatic-dependent-release.md",
    ],
    restrictions: [
      "Zero-input control-plane release model only; no provider is dispatched by the model",
      "Only dependency-cleared work is released; blocked dependents remain pending",
      "Owner polling remains prohibited for routine continuation",
      "WO-MAO-043 is complete; WO-MAO-044 is released to READY through retained prerequisites",
      "No command runner, background worker, runtime activation, credential access, authority minting, GitHub operation, production write, or owner relay",
    ],
  }),
  record({
    capabilityId: "github-lifecycle-conformance-model",
    label: "GitHub lifecycle conformance model",
    kind: "CONTROL_PLANE",
    status: "PROVEN",
    executionClass: "NON_EXECUTABLE",
    claim: "WO-MAO-044 proves the Phase 5 GitHub lifecycle model chain from branch delivery through dependent release without executing GitHub operations.",
    reasonCode: "CANONICAL_GITHUB_LIFECYCLE_CONFORMANCE_VERIFIED",
    adapterRef: "scripts/multi-agent-operator/github-lifecycle-conformance.mjs",
    authorityGrantRefs: ["PROGRAM-WILLIAMOS-MULTI-AGENT-OPERATOR-001"],
    trustGateRef: "WO-MAO-007",
    evidence: [
      "scripts/multi-agent-operator/github-lifecycle-conformance.mjs",
      "tests/multi-agent-github-lifecycle-conformance.test.ts",
      "docs/reports/WO-MAO-044-github-lifecycle-conformance.md",
    ],
    restrictions: [
      "Zero-input control-plane conformance model only; no GitHub operation is performed by the model",
      "The lifecycle chain must include branch delivery, PR linkage, CI/review, remediation, merge gating, post-merge verification, and dependent release",
      "Security bypass, authority bypass, direct review-thread resolution, and branch-protection bypass remain denied",
      "WO-MAO-044 is complete; WO-MAO-045 is released to READY through retained prerequisites",
      "No command runner, background worker, runtime activation, credential access, authority minting, GitHub execution, production write, or owner relay",
    ],
  }),
  record({
    capabilityId: "independent-secret-identity-trust-audit-model",
    label: "Independent secret, identity, and trust-boundary audit model",
    kind: "CONTROL_PLANE",
    status: "PROVEN",
    executionClass: "NON_EXECUTABLE",
    claim: "WO-MAO-045 proves a sealed independent audit over secret, identity, GitHub authority, runtime, and owner-operation boundaries.",
    reasonCode: "CANONICAL_INDEPENDENT_SECRET_IDENTITY_TRUST_AUDIT_VERIFIED",
    adapterRef: "scripts/multi-agent-operator/independent-secret-identity-trust-audit.mjs",
    authorityGrantRefs: ["PROGRAM-WILLIAMOS-MULTI-AGENT-OPERATOR-001"],
    trustGateRef: "WO-MAO-007",
    evidence: [
      "scripts/multi-agent-operator/independent-secret-identity-trust-audit.mjs",
      "tests/multi-agent-independent-secret-identity-trust-audit.test.ts",
      "docs/reports/WO-MAO-045-independent-secret-identity-trust-boundary-audit.md",
    ],
    restrictions: [
      "Zero-input independent audit model only; no secret or credential value is read",
      "Identity mutation, GitHub write activity, runtime activation, trust-boundary expansion, and owner couriering remain denied",
      "The audit covers the registered WO-MAO-022 and WO-MAO-036 through WO-MAO-044 dependency chain",
      "WO-MAO-045 is complete; downstream eligibility is governed by the DAG",
      "No command runner, background worker, runtime activation, credential access, authority minting, GitHub execution, production write, or owner relay",
    ],
  }),
  record({
    capabilityId: "retry-idempotency-duplicate-prevention-model",
    label: "Retry, idempotency, and duplicate prevention model",
    kind: "CONTROL_PLANE",
    status: "PROVEN",
    executionClass: "NON_EXECUTABLE",
    claim: "WO-MAO-046 proves bounded retry classification, compare-and-swap idempotency, and duplicate prevention fences without executing a scheduler or provider.",
    reasonCode: "CANONICAL_RETRY_IDEMPOTENCY_DUPLICATE_PREVENTION_VERIFIED",
    adapterRef: "scripts/multi-agent-operator/retry-idempotency-duplicate-prevention.mjs",
    authorityGrantRefs: ["PROGRAM-WILLIAMOS-MULTI-AGENT-OPERATOR-001"],
    trustGateRef: "WO-MAO-007",
    evidence: [
      "scripts/multi-agent-operator/retry-idempotency-duplicate-prevention.mjs",
      "tests/multi-agent-retry-idempotency-duplicate-prevention.test.ts",
      "docs/reports/WO-MAO-046-retry-idempotency-duplicate-prevention.md",
    ],
    restrictions: [
      "Zero-input retry/idempotency model only; no scheduler or provider is executed",
      "Retries are bounded to classified transient states and terminal classes fail closed",
      "Duplicate branch, commit, PR, comment, merge, deploy, cleanup, and evidence replay are fenced",
      "WO-MAO-046 released WO-MAO-047 and WO-MAO-049 through retained prerequisites; WO-MAO-047 through WO-MAO-049 are now complete",
      "No command runner, background worker, runtime activation, credential access, authority minting, GitHub execution, production write, or owner relay",
    ],
  }),
  record({
    capabilityId: "worker-coordinator-recovery-model",
    label: "Worker and coordinator recovery model",
    kind: "CONTROL_PLANE",
    status: "PROVEN",
    executionClass: "NON_EXECUTABLE",
    claim: "WO-MAO-047 proves durable recovery decisions for worker or coordinator death before write, during edit, after commit, after push, and with PR open.",
    reasonCode: "CANONICAL_WORKER_COORDINATOR_RECOVERY_VERIFIED",
    adapterRef: "scripts/multi-agent-operator/worker-coordinator-recovery.mjs",
    authorityGrantRefs: ["PROGRAM-WILLIAMOS-MULTI-AGENT-OPERATOR-001"],
    trustGateRef: "WO-MAO-007",
    evidence: [
      "scripts/multi-agent-operator/worker-coordinator-recovery.mjs",
      "tests/multi-agent-worker-coordinator-recovery.test.ts",
      "docs/reports/WO-MAO-047-worker-coordinator-recovery.md",
    ],
    restrictions: [
      "Zero-input recovery model only; no worker is restarted and no process control is performed",
      "Recovery requires durable lease, checkpoint, workspace, remote-ref, and PR-linkage evidence",
      "Concurrent writers, ambiguous commits, ambiguous remote refs, duplicate PRs, and missing checkpoints fail closed",
      "WO-MAO-047 is complete; WO-MAO-048 is released to READY through retained prerequisites",
      "No command runner, background worker, runtime activation, credential access, authority minting, GitHub execution, production write, or owner relay",
    ],
  }),
  record({
    capabilityId: "provider-outage-failover-drill-model",
    label: "Provider outage and failover drill",
    kind: "CONTROL_PLANE",
    status: "PROVEN",
    executionClass: "NON_EXECUTABLE",
    claim: "WO-MAO-048 proves network, 401/403, 429, 5xx, timeout, and stream-failure classification with bounded retry, quarantine, reroute, or block decisions.",
    reasonCode: "CANONICAL_PROVIDER_OUTAGE_FAILOVER_DRILL_VERIFIED",
    adapterRef: "scripts/multi-agent-operator/provider-outage-failover-drill.mjs",
    authorityGrantRefs: ["PROGRAM-WILLIAMOS-MULTI-AGENT-OPERATOR-001"],
    trustGateRef: "WO-MAO-007",
    evidence: [
      "scripts/multi-agent-operator/provider-outage-failover-drill.mjs",
      "tests/multi-agent-provider-outage-failover-drill.test.ts",
      "docs/reports/WO-MAO-048-provider-outage-failover-drill.md",
    ],
    restrictions: [
      "Zero-input outage drill only; no provider is called and no network failure is injected",
      "401/403 and stream ambiguity quarantine without owner diagnostics",
      "Retry and reroute remain bounded by the retry/idempotency and worker-recovery proofs",
      "WO-MAO-048 is complete; WO-MAO-050 is released to READY through retained prerequisites",
      "No command runner, background worker, runtime activation, credential access, authority minting, GitHub execution, production write, or owner relay",
    ],
  }),
  record({
    capabilityId: "stale-base-ci-review-merge-race-model",
    label: "Stale-base, CI, review, and merge-race drill",
    kind: "CONTROL_PLANE",
    status: "PROVEN",
    executionClass: "NON_EXECUTABLE",
    claim: "WO-MAO-049 proves stale-base, CI failure, review, and merge-race classification without rebasing, rerunning CI, resolving review threads, or merging.",
    reasonCode: "CANONICAL_STALE_BASE_CI_REVIEW_MERGE_RACE_VERIFIED",
    adapterRef: "scripts/multi-agent-operator/stale-base-ci-review-merge-race.mjs",
    authorityGrantRefs: ["PROGRAM-WILLIAMOS-MULTI-AGENT-OPERATOR-001"],
    trustGateRef: "WO-MAO-007",
    evidence: [
      "scripts/multi-agent-operator/stale-base-ci-review-merge-race.mjs",
      "tests/multi-agent-stale-base-ci-review-merge-race.test.ts",
      "docs/reports/WO-MAO-049-stale-base-ci-review-merge-race.md",
    ],
    restrictions: [
      "Zero-input control-plane drill only; no GitHub API, rebase, CI rerun, review-thread resolution, or merge is performed",
      "Stale or concurrently changed merge candidates are denied until refreshed and fully revalidated",
      "Only one classified flaky retry is modeled; deterministic failures route back to the original builder",
      "WO-MAO-049 is complete; WO-MAO-050 is now READY after WO-MAO-048 completion",
      "No command runner, background worker, runtime activation, credential access, authority minting, GitHub execution, production write, or owner relay",
    ],
  }),
  record({
    capabilityId: "malicious-defective-worker-drill-model",
    label: "Malicious/defective worker drill",
    kind: "CONTROL_PLANE",
    status: "PROVEN",
    executionClass: "NON_EXECUTABLE",
    claim: "WO-MAO-050 proves scope escape, fabricated evidence, secret request, policy override, prompt injection, unauthorized production intent, and unsafe cleanup containment.",
    reasonCode: "CANONICAL_MALICIOUS_DEFECTIVE_WORKER_DRILL_VERIFIED",
    adapterRef: "scripts/multi-agent-operator/malicious-defective-worker-drill.mjs",
    authorityGrantRefs: ["PROGRAM-WILLIAMOS-MULTI-AGENT-OPERATOR-001"],
    trustGateRef: "WO-MAO-007",
    evidence: [
      "scripts/multi-agent-operator/malicious-defective-worker-drill.mjs",
      "tests/multi-agent-malicious-defective-worker-drill.test.ts",
      "docs/reports/WO-MAO-050-malicious-defective-worker-drill.md",
    ],
    restrictions: [
      "Zero-input control-plane drill only; no provider execution, GitHub API call, production write, cleanup, or authority mutation is performed",
      "Defective workers are stopped or quarantined rather than trusted, retried, or promoted",
      "Fabricated evidence, secret requests, policy override attempts, prompt injection, production intent, and unsafe cleanup fail closed",
      "WO-MAO-050 is complete; WO-MAO-051 is now READY through retained prerequisites",
      "No command runner, background worker, runtime activation, credential access, authority minting, GitHub execution, production write, or owner relay",
    ],
  }),
  record({
    capabilityId: "status-evidence-owner-decision-ux-model",
    label: "Status, evidence, and owner-decision UX",
    kind: "GOVERNANCE_SURFACE",
    status: "PROVEN",
    executionClass: "NON_EXECUTABLE",
    claim: "WO-MAO-051 makes outcomes, active lanes, dependencies, reservations, providers, evidence, and exact owner authority walls visible in the Portfolio Operator surface.",
    reasonCode: "CANONICAL_STATUS_EVIDENCE_OWNER_DECISION_UX_VERIFIED",
    adapterRef: "components/operator/portfolio-operator-surface.ts",
    authorityGrantRefs: ["PROGRAM-WILLIAMOS-MULTI-AGENT-OPERATOR-001"],
    trustGateRef: "WO-MAO-007",
    evidence: [
      "components/operator/portfolio-operator-surface.ts",
      "components/operator/portfolio-operator-panel.tsx",
      "components/operator/multi-agent-status-ux-registry.ts",
      "tests/portfolio-operator-surface.test.ts",
      "docs/reports/WO-MAO-051-status-evidence-owner-decision-ux.md",
    ],
    restrictions: [
      "Read-only status and evidence UX only; no run, retry, fix, merge, dispatch, or owner operation controls are exposed",
      "Authority walls are displayed as exact reasons rather than converted into routine owner work",
      "WO-MAO-051 is complete; WO-MAO-052 is now READY through retained prerequisites",
      "No command runner, background worker, runtime activation, credential access, authority minting, GitHub execution, production write, or owner relay",
    ],
  }),
  record({
    capabilityId: "claude-code-provider",
    label: "Claude Code provider lane",
    kind: "PROVIDER_SURFACE",
    status: "UNAVAILABLE",
    executionClass: "WORKER_CANDIDATE",
    claim: "The completed static provider assessment finds no authenticated supported Claude transport or conformant adapter; the provider is disabled and its affected lane remains resumably deferred.",
    reasonCode: "PROVIDER_UNAVAILABLE",
    adapterRef: null,
    authorityGrantRefs: [],
    trustGateRef: null,
    evidence: [
      "control-center/backend/worker_registry.json",
      "docs/reports/WO-MAO-032-claude-capability-transport-proof.md",
    ],
    restrictions: [
      "Enabled false; max concurrency zero; not service compatible",
      "Preventive trust gate not evaluated because no supported transport exists",
      "No owner-assisted launch, authentication, diagnostics, or smoke",
      "Unavailable Claude must not block healthy Codex lanes",
    ],
  }),
  record({
    capabilityId: "brain-council-advisory",
    label: "Brain Council advisory surface",
    kind: "GOVERNANCE_SURFACE",
    status: "PROVEN",
    executionClass: "NON_EXECUTABLE",
    claim: "Brain Council is a static advisory and decision-packet read model.",
    reasonCode: "ADVISORY_SURFACE_EVIDENCED",
    adapterRef: null,
    authorityGrantRefs: [],
    trustGateRef: null,
    evidence: [
      "components/brain-council/brain-council-advisory-registry.ts",
      "docs/governance/brain-council-advisory-layer.md",
    ],
    restrictions: ["No worker dispatch", "No command execution", "No autonomous Council runtime"],
  }),
  record({
    capabilityId: "agent-forge-governance",
    label: "Agent Forge governance surface",
    kind: "GOVERNANCE_SURFACE",
    status: "PROVEN",
    executionClass: "NON_EXECUTABLE",
    claim: "Agent Forge provides skill governance, quarantine, review, and safety read models.",
    reasonCode: "FORGE_GOVERNANCE_EVIDENCED",
    adapterRef: null,
    authorityGrantRefs: [],
    trustGateRef: null,
    evidence: ["components/agent-forge/agent-forge-surface.ts"],
    restrictions: ["No executable skills", "No runtime loader", "No worker activation"],
  }),
  record({
    capabilityId: "hermes-worker-sidecar",
    label: "Hermes worker sidecar",
    kind: "PROVIDER_SURFACE",
    status: "UNAVAILABLE",
    executionClass: "WORKER_CANDIDATE",
    claim: "Hermes exists as a governed boundary and packet concept; no worker process or conformant adapter exists.",
    reasonCode: "PROVIDER_UNAVAILABLE",
    adapterRef: null,
    authorityGrantRefs: [],
    trustGateRef: null,
    evidence: [
      "components/hermes/hermes-boundary-registry.ts",
      "docs/governance/hermes-sidecar-boundary-doctrine.md",
    ],
    restrictions: ["No worker process", "No scheduler or queue", "No MCP or tool activation"],
  }),
  record({
    capabilityId: "ollama-local-model",
    label: "Ollama local model capacity",
    kind: "MODEL_RUNTIME",
    status: "PROVEN",
    executionClass: "NON_EXECUTABLE",
    claim: "The existing registry records local reasoning capacity; model availability is not an agent or repository-delivery worker claim.",
    reasonCode: "MODEL_CAPACITY_ONLY",
    adapterRef: null,
    authorityGrantRefs: [],
    trustGateRef: null,
    evidence: ["control-center/backend/worker_registry.json"],
    restrictions: ["No repository delivery authority", "No provider fallback or autonomous dispatch"],
  }),
] satisfies readonly MultiAgentCapabilityRecord[])

export type CapabilityDispatchDecision = {
  allowed: boolean
  reasonCode:
    | "CAPABILITY_NOT_FOUND"
    | "NOT_EXECUTABLE_WORKER"
    | "CAPABILITY_NOT_AUTHORIZED"
    | "ADAPTER_NOT_CONFORMANT"
    | "AUTHORITY_GRANT_MISSING"
    | "PREVENTIVE_TRUST_GATE_MISSING"
    | "PREVENTIVE_TRUST_GATE_UNRECOGNIZED"
    | "EXECUTABLE_CAPABILITY_ELIGIBLE"
}

export function capability(capabilityId: string) {
  return MULTI_AGENT_CAPABILITY_INVENTORY.find((entry) => entry.capabilityId === capabilityId)
}

export function evaluateCapabilityDispatch(entry: MultiAgentCapabilityRecord | undefined): CapabilityDispatchDecision {
  if (!entry) return { allowed: false, reasonCode: "CAPABILITY_NOT_FOUND" }
  if (entry.executionClass !== "EXECUTABLE_WORKER") {
    return { allowed: false, reasonCode: "NOT_EXECUTABLE_WORKER" }
  }
  if (!new Set<CapabilityStatus>(["PROVEN", "PILOT_AUTHORIZED"]).has(entry.status)) {
    return { allowed: false, reasonCode: "CAPABILITY_NOT_AUTHORIZED" }
  }
  if (!entry.adapterRef) return { allowed: false, reasonCode: "ADAPTER_NOT_CONFORMANT" }
  if (entry.authorityGrantRefs.length === 0) return { allowed: false, reasonCode: "AUTHORITY_GRANT_MISSING" }
  if (!entry.trustGateRef) return { allowed: false, reasonCode: "PREVENTIVE_TRUST_GATE_MISSING" }
  if (entry.trustGateRef !== PREVENTIVE_TRUST_GATE_V2_REF) {
    return { allowed: false, reasonCode: "PREVENTIVE_TRUST_GATE_UNRECOGNIZED" }
  }
  return { allowed: true, reasonCode: "EXECUTABLE_CAPABILITY_ELIGIBLE" }
}

export function validateCapabilityInventory(records: readonly MultiAgentCapabilityRecord[] = MULTI_AGENT_CAPABILITY_INVENTORY) {
  const violations: string[] = []
  const ids = new Set<string>()
  for (const entry of records) {
    if (ids.has(entry.capabilityId)) violations.push(`${entry.capabilityId}:DUPLICATE_CAPABILITY_ID`)
    ids.add(entry.capabilityId)
    if (entry.evidence.length === 0) violations.push(`${entry.capabilityId}:EVIDENCE_MISSING`)
    if (entry.executionClass === "EXECUTABLE_WORKER") {
      const decision = evaluateCapabilityDispatch(entry)
      if (!decision.allowed) violations.push(`${entry.capabilityId}:${decision.reasonCode}`)
    }
    if (["UNAVAILABLE", "REJECTED"].includes(entry.status) && entry.executionClass === "EXECUTABLE_WORKER") {
      violations.push(`${entry.capabilityId}:INACTIVE_CAPABILITY_MARKED_EXECUTABLE`)
    }
  }
  return Object.freeze({ valid: violations.length === 0, violations: Object.freeze(violations) })
}
