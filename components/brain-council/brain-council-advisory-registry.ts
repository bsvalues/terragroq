export type CouncilAdvisoryState =
  | "NOT_REQUESTED"
  | "CONTEXT_NEEDED"
  | "EVIDENCE_REVIEW"
  | "OPTIONS_REVIEW"
  | "RISK_REVIEW"
  | "DECISION_PACKET_READY"
  | "OWNER_DECISION_NEEDED"
  | "WORK_ORDER_RECOMMENDED"
  | "BLOCKED_BY_AUTHORITY"
  | "ADVISORY_COMPLETE"

export type CouncilRiskLevel = "low" | "medium" | "high" | "critical"
export type CouncilConfidenceLevel = "low" | "medium" | "high"

export type CouncilRole = {
  roleId: string
  label: string
  perspective: string
  advisoryBoundary: string
}

export type CouncilDecisionPacket = {
  packetId: string
  title: string
  advisoryState: CouncilAdvisoryState
  question: string
  contextSummary: string
  evidenceUsed: string[]
  memoryUsed: string[]
  ownerDecisionLinks: string[]
  options: {
    label: string
    summary: string
    risk: CouncilRiskLevel
  }[]
  risks: string[]
  confidence: CouncilConfidenceLevel
  evidenceSufficiency: string
  authorityRequired: string
  uncertaintyNote: string
  stopCondition: string
  recommendation: string
  ownerDecisionNeeded: string
  recommendedWorkOrder: string
  blockedActions: string[]
  whatThisDoesNotAuthorize: string[]
}

export type CouncilRecommendation = {
  recommendedWorkOrder: string
  reason: string
  evidenceBasis: string[]
  memoryBasis: string[]
  authorityRequired: string
  blockedActions: string[]
  nextSafeOwnerAction: string
}

export type CouncilLink = {
  label: string
  packetId: string
  relatedItem: string
  description: string
}

export type CouncilSafetyProofCard = {
  label: string
  value: string
  description: string
}

export type BrainCouncilAdvisoryRegistry = {
  doctrine: {
    title: string
    statements: readonly string[]
  }
  roles: CouncilRole[]
  states: {
    state: CouncilAdvisoryState
    description: string
  }[]
  packets: CouncilDecisionPacket[]
  detailPacket: CouncilDecisionPacket
  recommendations: CouncilRecommendation[]
  evidenceLinks: CouncilLink[]
  memoryLinks: CouncilLink[]
  ownerDecisionLinks: CouncilLink[]
  safetyProofCards: CouncilSafetyProofCard[]
  navigation: {
    label: string
    href: string
    description: string
  }[]
  nextLaneDecision: {
    recommendedBatch: string
    recommendedOption: string
    blockedLanes: string[]
    reason: string
  }
  safety: {
    staticReadOnly: true
    councilRuntimeAdded: false
    commandExecutionAdded: false
    commandRunnerAdded: false
    toolCallsAdded: false
    workerActivationAdded: false
    hermesActivationAdded: false
    mcpActivationAdded: false
    memoryWriteAdded: false
    runtimeMemoryReadAdded: false
    dynamicRetrievalAdded: false
    vectorStoreAdded: false
    embeddingsAdded: false
    persistenceImplemented: false
    backgroundWorkerAdded: false
    schedulerAdded: false
    githubWriteAdded: false
    codexAutomationAdded: false
    dockerMetadataAdded: false
    backupScanAdded: false
    portChecksAdded: false
    serviceRegistered: false
    lanExposureEnabled: false
    cloudChanged: false
    productionDeployAdded: false
    secretsDisclosed: false
    terraFusionPacsTouched: false
    unrelatedContainersTouched: false
    autonomyAdded: false
  }
}

export const BRAIN_COUNCIL_ADVISORY_DOCTRINE = {
  title: "Brain Council Advisory Doctrine",
  statements: [
    "Brain Council may advise, reason, compare options, and prepare decision packets.",
    "Brain Council may recommend Work Orders, evidence needs, and owner decisions.",
    "Brain Council must not execute, mutate, call tools, activate workers, or bypass authority.",
    "Brain Council must not activate Hermes, MCP, autonomy, schedulers, or background loops.",
    "Brain Council must not write memory, ingest memory, read memory dynamically, or promote canon.",
    "Brain Council must not deploy, change cloud settings, control runtime, or expand metadata.",
    "Council roles are advisory labels, not independent agents.",
    "Decision packets are read models, not approval or execution controls.",
    "The Primary remains the approving authority.",
  ],
} as const

export const COUNCIL_ROLES: CouncilRole[] = [
  {
    roleId: "role-strategist",
    label: "Strategist",
    perspective: "Clarifies the decision, options, tradeoffs, and next safe lane.",
    advisoryBoundary: "Cannot select the lane for the owner or start work.",
  },
  {
    roleId: "role-evidence-reviewer",
    label: "Evidence Reviewer",
    perspective: "Checks whether recommendations are grounded in proof and validation.",
    advisoryBoundary: "Cannot fetch evidence dynamically or call GitHub.",
  },
  {
    roleId: "role-safety-reviewer",
    label: "Safety Reviewer",
    perspective: "Identifies stop conditions, blocked powers, and authority gaps.",
    advisoryBoundary: "Cannot enforce policy or mutate permissions.",
  },
  {
    roleId: "role-product-reviewer",
    label: "Product Reviewer",
    perspective: "Reviews operator usefulness, clarity, and surface ergonomics.",
    advisoryBoundary: "Cannot ship or deploy changes.",
  },
  {
    roleId: "role-governance-reviewer",
    label: "Governance Reviewer",
    perspective: "Maps recommendations to authority gates and owner decisions.",
    advisoryBoundary: "Cannot grant authority or approve decisions.",
  },
  {
    roleId: "role-local-runtime-reviewer",
    label: "Local Runtime Reviewer",
    perspective: "Checks local runtime posture against read-only/manual-only/localhost-only boundaries.",
    advisoryBoundary: "Cannot read Docker metadata, run port checks, or control runtime.",
  },
  {
    roleId: "role-memory-reviewer",
    label: "Memory Reviewer",
    perspective: "Checks memory governance context, staleness, contradictions, and sensitivity.",
    advisoryBoundary: "Cannot write memory, ingest memory, or read memory dynamically.",
  },
  {
    roleId: "role-work-order-reviewer",
    label: "Work Order Reviewer",
    perspective: "Converts advice into recommended bounded Work Order shape.",
    advisoryBoundary: "Cannot create, run, or automate the Work Order.",
  },
]

export const COUNCIL_ADVISORY_STATES = [
  ["NOT_REQUESTED", "No Council review has been requested."],
  ["CONTEXT_NEEDED", "The question needs more bounded context before advice is useful."],
  ["EVIDENCE_REVIEW", "Evidence is being displayed and checked for sufficiency."],
  ["OPTIONS_REVIEW", "Options are compared as advice only."],
  ["RISK_REVIEW", "Risk, uncertainty, and blocked actions are visible."],
  ["DECISION_PACKET_READY", "A static decision packet is ready for owner review."],
  ["OWNER_DECISION_NEEDED", "A recommendation needs explicit owner authority before action."],
  ["WORK_ORDER_RECOMMENDED", "A Work Order is recommended but not created or run."],
  ["BLOCKED_BY_AUTHORITY", "The lane remains blocked by an authority boundary."],
  ["ADVISORY_COMPLETE", "Advisory output is complete; no action is triggered."],
].map(([state, description]) => ({
  state: state as CouncilAdvisoryState,
  description,
}))

export const COUNCIL_DECISION_PACKETS: CouncilDecisionPacket[] = [
  {
    packetId: "council-packet-advisory-next-lane",
    title: "Post-memory advisory next lane",
    advisoryState: "WORK_ORDER_RECOMMENDED",
    question: "What should WilliamOS do after static Memory Governance is in place?",
    contextSummary:
      "Memory Governance is static/read-only. Evidence, Authority, and Owner Decision surfaces are represented. The next lane should improve advisory clarity without opening autonomy.",
    evidenceUsed: ["evidence-authority-governance-registry", "evidence-owner-decision-queue", "evidence-pr-local-freeze"],
    memoryUsed: ["memory-evidence-spine-current", "memory-authority-registry-current", "memory-owner-decision-queue-current"],
    ownerDecisionLinks: ["decision-command-execution", "decision-autonomy", "decision-github-write"],
    options: [
      {
        label: "Continue advisory UX and evidence",
        summary: "Improve Council read models and recommendations without runtime power.",
        risk: "low",
      },
      {
        label: "Open Hermes or MCP",
        summary: "Would cross into worker/tool activation and requires separate owner authority.",
        risk: "critical",
      },
      {
        label: "Open metadata gates",
        summary: "Docker, backup, and port metadata remain blocked by local authority gates.",
        risk: "high",
      },
    ],
    risks: [
      "Advice could be mistaken for permission if blocked actions are not visible.",
      "Memory links could be mistaken for runtime retrieval if the boundary is unclear.",
      "Worker and tool language could imply autonomy unless explicitly denied.",
    ],
    confidence: "high",
    evidenceSufficiency: "Sufficient for static advisory display; insufficient for runtime authority.",
    authorityRequired: "Owner authority required for any action, worker, tool, memory write, or metadata expansion.",
    uncertaintyNote: "Future Council polish may need new evidence if authority or memory state changes.",
    stopCondition: "Stop if implementation adds execution, tool calls, worker activation, dynamic retrieval, or memory writes.",
    recommendation: "Create a static/read-only Brain Council Advisory layer and keep all runtime powers blocked.",
    ownerDecisionNeeded: "No owner decision needed for static read-only display; owner decision required for any action lane.",
    recommendedWorkOrder: "WO-COUNCIL-001 through WO-COUNCIL-015",
    blockedActions: [
      "run Council",
      "ask Council runtime action",
      "execute recommendation",
      "activate Hermes",
      "activate MCP",
      "call tools",
      "write memory",
      "create Work Order automatically",
    ],
    whatThisDoesNotAuthorize: [
      "runtime Council autonomy",
      "agent orchestration",
      "command execution",
      "worker activation",
      "dynamic retrieval",
      "memory mutation",
      "metadata expansion",
      "production deploy",
    ],
  },
  {
    packetId: "council-packet-authority-needed",
    title: "Authority is required before advisory-to-action",
    advisoryState: "OWNER_DECISION_NEEDED",
    question: "What boundary prevents Council advice from becoming action?",
    contextSummary:
      "Council recommendations can prepare options and Work Orders, but Authority Registry and Owner Decision Queue remain the gate before mutation.",
    evidenceUsed: ["evidence-authority-governance-registry", "evidence-owner-decision-queue"],
    memoryUsed: ["memory-authority-registry-current", "memory-stale-contradiction-review"],
    ownerDecisionLinks: ["decision-command-execution", "decision-codex-automation", "decision-autonomy"],
    options: [
      {
        label: "Keep advisory output read-only",
        summary: "Recommended; preserves owner authority and avoids runtime power.",
        risk: "low",
      },
      {
        label: "Add approval controls",
        summary: "Blocked; would create authority and decision mutation behavior.",
        risk: "critical",
      },
    ],
    risks: [
      "Approval controls would mutate decision posture.",
      "Automation controls would bypass explicit owner handoff.",
    ],
    confidence: "high",
    evidenceSufficiency: "Sufficient to keep action blocked.",
    authorityRequired: "Authority / Governance Registry required before any future action lane.",
    uncertaintyNote: "No approved autonomy or command authority exists in this packet.",
    stopCondition: "Stop if UI adds approve, run, execute, or dispatch controls.",
    recommendation: "Keep Council advice separate from action authority.",
    ownerDecisionNeeded: "Required before command execution, Codex automation, Hermes/MCP, or worker activation.",
    recommendedWorkOrder: "Future authority gate only if owner explicitly opens it.",
    blockedActions: ["approve action", "deny action", "dispatch worker", "create PR", "run command"],
    whatThisDoesNotAuthorize: ["authority engine", "approval controls", "GitHub writes", "Codex automation"],
  },
]

export const COUNCIL_RECOMMENDATIONS: CouncilRecommendation[] = [
  {
    recommendedWorkOrder: "WO-COUNCIL-001 through WO-COUNCIL-015",
    reason: "Create the first static advisory layer after Memory Governance.",
    evidenceBasis: ["PR #289", "evidence-owner-decision-queue", "evidence-authority-governance-registry"],
    memoryBasis: ["memory-evidence-spine-current", "memory-owner-decision-queue-current"],
    authorityRequired: "Read-only UI/model authority only.",
    blockedActions: ["run Council", "execute recommendation", "call tools", "write memory"],
    nextSafeOwnerAction: "Review the static Council packet; do not open runtime authority from this batch.",
  },
  {
    recommendedWorkOrder: "Future Authority / Governance Registry refresh",
    reason: "Needed before advisory output can ever approach action, workers, metadata, or automation.",
    evidenceBasis: ["evidence-authority-governance-registry"],
    memoryBasis: ["memory-authority-registry-current"],
    authorityRequired: "Explicit owner authority.",
    blockedActions: ["authority engine", "approval controls", "autonomy", "runtime control"],
    nextSafeOwnerAction: "Open only as a decision packet if action authority becomes necessary.",
  },
]

export const COUNCIL_EVIDENCE_LINKS: CouncilLink[] = [
  {
    label: "Authority evidence",
    packetId: "council-packet-authority-needed",
    relatedItem: "evidence-authority-governance-registry",
    description: "Authority evidence explains why Council advice cannot become action.",
  },
  {
    label: "Owner decision evidence",
    packetId: "council-packet-advisory-next-lane",
    relatedItem: "evidence-owner-decision-queue",
    description: "Owner decision evidence keeps blocked actions visible.",
  },
  {
    label: "Local runtime freeze evidence",
    packetId: "council-packet-advisory-next-lane",
    relatedItem: "evidence-pr-local-freeze",
    description: "Local runtime evidence keeps metadata and runtime-control lanes blocked.",
  },
]

export const COUNCIL_MEMORY_LINKS: CouncilLink[] = [
  {
    label: "Evidence Spine memory",
    packetId: "council-packet-advisory-next-lane",
    relatedItem: "memory-evidence-spine-current",
    description: "Static memory context only; no runtime memory read is performed.",
  },
  {
    label: "Authority memory",
    packetId: "council-packet-authority-needed",
    relatedItem: "memory-authority-registry-current",
    description: "Memory describes authority posture but does not grant it.",
  },
  {
    label: "Stale memory warning",
    packetId: "council-packet-authority-needed",
    relatedItem: "memory-stale-contradiction-review",
    description: "Stale or contradicted memory must be reviewed before trust.",
  },
]

export const COUNCIL_OWNER_DECISION_LINKS: CouncilLink[] = [
  {
    label: "Command execution blocked",
    packetId: "council-packet-authority-needed",
    relatedItem: "decision-command-execution",
    description: "Command execution remains blocked until explicit owner authority exists.",
  },
  {
    label: "Autonomy blocked",
    packetId: "council-packet-advisory-next-lane",
    relatedItem: "decision-autonomy",
    description: "Hermes, MCP, workers, and autonomy remain blocked.",
  },
  {
    label: "Codex automation blocked",
    packetId: "council-packet-authority-needed",
    relatedItem: "decision-codex-automation",
    description: "Council recommendations do not launch Codex automation.",
  },
]

export const COUNCIL_SAFETY_PROOF_CARDS: CouncilSafetyProofCard[] = [
  ["No command execution", "blocked", "Council has no run, execute, or shell bridge."],
  ["No command runner", "blocked", "No command runner or command endpoint is added."],
  ["No tool calls", "blocked", "Council cannot invoke tools, APIs, GitHub, Docker, or filesystem scans."],
  ["No worker activation", "blocked", "No Brain Council worker, Hermes worker, MCP, or background loop is activated."],
  ["No memory write", "blocked", "No memory write, ingestion, canon promotion, vector store, embeddings, or dynamic retrieval is added."],
  ["No persistence", "blocked", "No DB/schema migration, service, schedule, or background worker is added."],
  ["No autonomy", "blocked", "Council remains advisory and cannot bypass owner authority."],
  ["Owner remains authority", "visible", "Decision packets and recommendations are not permission."],
].map(([label, value, description]) => ({ label, value, description }))

export function getBrainCouncilAdvisoryRegistry(): BrainCouncilAdvisoryRegistry {
  return {
    doctrine: BRAIN_COUNCIL_ADVISORY_DOCTRINE,
    roles: COUNCIL_ROLES,
    states: COUNCIL_ADVISORY_STATES,
    packets: COUNCIL_DECISION_PACKETS,
    detailPacket:
      COUNCIL_DECISION_PACKETS.find((packet) => packet.packetId === "council-packet-advisory-next-lane") ??
      COUNCIL_DECISION_PACKETS[0],
    recommendations: COUNCIL_RECOMMENDATIONS,
    evidenceLinks: COUNCIL_EVIDENCE_LINKS,
    memoryLinks: COUNCIL_MEMORY_LINKS,
    ownerDecisionLinks: COUNCIL_OWNER_DECISION_LINKS,
    safetyProofCards: COUNCIL_SAFETY_PROOF_CARDS,
    navigation: [
      {
        label: "Evidence",
        href: "/audit",
        description: "Review proof behind Council advice.",
      },
      {
        label: "Memory",
        href: "/memory",
        description: "Review static memory governance links without runtime memory reads.",
      },
      {
        label: "Decisions",
        href: "/decisions",
        description: "Review owner decisions required before action.",
      },
      {
        label: "Work Orders",
        href: "/work-orders",
        description: "Review recommended Work Orders without creating or running them.",
      },
    ],
    nextLaneDecision: {
      recommendedBatch: "WILLIAMOS-AUTHORITY-GOVERNANCE-REGISTRY-REFRESH-BATCH-001",
      recommendedOption: "B - Authority / Governance Registry",
      blockedLanes: [
        "Hermes/MCP/autonomy activation",
        "command execution",
        "worker activation",
        "memory mutation",
        "metadata expansion",
        "runtime control",
      ],
      reason:
        "After Memory and Brain Council advisory surfaces, authority needs to stay explicit before any future advisory-to-action, worker, metadata, deploy, DB/schema, memory mutation, or autonomy lane.",
    },
    safety: {
      staticReadOnly: true,
      councilRuntimeAdded: false,
      commandExecutionAdded: false,
      commandRunnerAdded: false,
      toolCallsAdded: false,
      workerActivationAdded: false,
      hermesActivationAdded: false,
      mcpActivationAdded: false,
      memoryWriteAdded: false,
      runtimeMemoryReadAdded: false,
      dynamicRetrievalAdded: false,
      vectorStoreAdded: false,
      embeddingsAdded: false,
      persistenceImplemented: false,
      backgroundWorkerAdded: false,
      schedulerAdded: false,
      githubWriteAdded: false,
      codexAutomationAdded: false,
      dockerMetadataAdded: false,
      backupScanAdded: false,
      portChecksAdded: false,
      serviceRegistered: false,
      lanExposureEnabled: false,
      cloudChanged: false,
      productionDeployAdded: false,
      secretsDisclosed: false,
      terraFusionPacsTouched: false,
      unrelatedContainersTouched: false,
      autonomyAdded: false,
    },
  }
}
