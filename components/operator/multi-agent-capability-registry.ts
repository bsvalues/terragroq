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
    capabilityId: "hosted-codex-session",
    label: "Supported hosted Codex session",
    kind: "PROVIDER_SURFACE",
    status: "PILOT_AUTHORIZED",
    executionClass: "WORKER_CANDIDATE",
    coordinationEligible: true,
    claim: "The current hosted Codex session may coordinate the bounded Phase 1 R0/R1 pilot, but it is not wired through the WilliamOS worker gate and is not a registered durable adapter.",
    reasonCode: "HOSTED_COORDINATION_AVAILABLE_ADAPTER_UNPROVEN",
    adapterRef: null,
    authorityGrantRefs: ["docs/governance/active-program-queue.md#canonical-active-program"],
    trustGateRef: PREVENTIVE_TRUST_GATE_V2_REF,
    evidence: ["docs/governance/multi-agent-operator-playbook.md", "AGENTS.md"],
    restrictions: [
      "R0/R1 repository coordination only",
      "Not dispatch-eligible through the worker registry",
      "No durable-runtime claim",
      "No local nested adapter",
    ],
  }),
  record({
    capabilityId: "codex-native-subagent-team",
    label: "Codex native coordinator and subagents",
    kind: "PROVIDER_SURFACE",
    status: "PILOT_AUTHORIZED",
    executionClass: "WORKER_CANDIDATE",
    coordinationEligible: true,
    claim: "Coordinator, builder, and assurance roles may run inside the current hosted session, but no WilliamOS adapter binds native team dispatch to the preventive gate.",
    reasonCode: "CODEX_NATIVE_TEAM_COORDINATION_AVAILABLE_ADAPTER_UNPROVEN",
    adapterRef: null,
    authorityGrantRefs: ["docs/governance/active-program-queue.md#canonical-active-program"],
    trustGateRef: PREVENTIVE_TRUST_GATE_V2_REF,
    evidence: ["docs/governance/multi-agent-operator-playbook.md", "AGENTS.md"],
    restrictions: [
      "Not dispatch-eligible through the worker registry",
      "No CODEX_NATIVE_TEAM=PROVEN claim before WO-MAO-015",
      "No atomic-reservation claim",
    ],
  }),
  record({
    capabilityId: "claude-code-provider",
    label: "Claude Code provider lane",
    kind: "PROVIDER_SURFACE",
    status: "UNAVAILABLE",
    executionClass: "WORKER_CANDIDATE",
    claim: "Claude Code is catalogued, but no authenticated supported provider surface or conformant adapter is evidenced in the repository.",
    reasonCode: "PROVIDER_UNAVAILABLE",
    adapterRef: null,
    authorityGrantRefs: [],
    trustGateRef: null,
    evidence: ["control-center/backend/worker_registry.json"],
    restrictions: ["No owner-assisted launch or authentication", "Unavailable Claude must not block healthy Codex lanes"],
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
