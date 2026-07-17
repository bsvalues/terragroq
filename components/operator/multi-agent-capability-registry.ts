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
    claim: "WO-MAO-031 consumes hardened WO-MAO-030 opaque assignment handles and host bridge operations to prove builder, independent assurance, original-builder remediation, and bounded re-review without caller-supplied provider responses.",
    reasonCode: "HOSTED_CODEX_ROLE_ADAPTERS_REPROVED",
    adapterRef: "scripts/multi-agent-operator/codex-role-adapters.mjs",
    authorityGrantRefs: ["docs/governance/active-program-queue.md#canonical-active-program"],
    trustGateRef: PREVENTIVE_TRUST_GATE_V2_REF,
    evidence: [
      "scripts/multi-agent-operator/codex-role-adapters.mjs",
      "tests/multi-agent-codex-role-adapters.test.ts",
      "docs/reports/WO-MAO-031-codex-builder-assurance-remediation-adapters.md",
    ],
    restrictions: [
      "Current-session role lifecycle proof only",
      "Standalone CLI remains typed fail-closed without a hardened opaque host plan",
      "Role stages use host bridge start, message, and independently captured evidence operations",
      "Assurance remains independent and cannot remediate its own finding",
      "Remediation is bound to the original builder and the envelope remediation budget",
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
    claim: "WO-MAO-034 proves static cross-provider routing and same-provider independent review only after authenticating the consumer-specific WO-MAO-034<-WO-MAO-033 unavailable-provider settlement through the pinned provider-assessment trust record.",
    reasonCode: "CROSS_PROVIDER_ROUTING_REVIEW_PROVEN",
    adapterRef: "scripts/multi-agent-operator/cross-provider-routing-review.mjs",
    authorityGrantRefs: [],
    trustGateRef: null,
    evidence: [
      "scripts/multi-agent-operator/cross-provider-routing-review.mjs",
      "tests/multi-agent-cross-provider-routing-review.test.ts",
      "docs/reports/WO-MAO-034-cross-provider-routing-review.md",
    ],
    restrictions: [
      "Static routing and review planning only",
      "WO-MAO-034 consumes only the consumer-specific WO-MAO-034<-WO-MAO-033 settlement",
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
    status: "AVAILABLE_UNPROVEN",
    executionClass: "NON_EXECUTABLE",
    claim: "WO-MAO-035 remains blocked because its separate direct WO-MAO-033 dependency edge cannot be satisfied by the WO-MAO-034 consumer-specific settlement.",
    reasonCode: "WO_MAO_035_DIRECT_WO_MAO_033_EDGE_REQUIRES_SEPARATE_CORRECTION",
    adapterRef: "scripts/multi-agent-operator/provider-health-reroute.mjs",
    authorityGrantRefs: [],
    trustGateRef: null,
    evidence: [
      "scripts/multi-agent-operator/provider-health-reroute.mjs",
      "tests/multi-agent-provider-health-reroute.test.ts",
      "docs/reports/WO-MAO-035-provider-health-reroute.md",
    ],
    restrictions: [
      "Static health and reroute planning only",
      "Historical entrypoint is typed fail-closed; trusted observations and stateful breaker transitions require re-proof",
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
    status: "AVAILABLE_UNPROVEN",
    executionClass: "NON_EXECUTABLE",
    claim: "The historical WO-MAO-036 conformance suite remains present but is mechanically invalidated because caller provider records and fixtures could manufacture coverage without operational evidence.",
    reasonCode: "POST_MERGE_ASSURANCE_INVALIDATED_PENDING_REPROOF",
    adapterRef: "scripts/multi-agent-operator/provider-conformance-suite.mjs",
    authorityGrantRefs: [],
    trustGateRef: null,
    evidence: [
      "scripts/multi-agent-operator/provider-conformance-suite.mjs",
      "tests/multi-agent-provider-conformance-suite.test.ts",
      "docs/reports/WO-MAO-036-provider-conformance-suite.md",
    ],
    restrictions: [
      "Static conformance suite only",
      "Historical entrypoint is typed fail-closed; independently captured operational evidence requires re-proof",
      "Hosted Codex remains session-only and non-executable",
      "Unavailable and rejected providers are excluded, not certified",
      "No provider dispatch, GitHub automation, runtime activation, authority grant, or owner relay",
      "No secrets, raw credentials, rejected nested-runtime reuse, or production operation",
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
