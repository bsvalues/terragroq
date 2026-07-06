export type HermesStatus =
  | "NOT_INSTALLED"
  | "NOT_ACTIVE"
  | "BLOCKED_BY_AUTHORITY"
  | "PROPOSED"
  | "ACTIVATION_REVIEW_REQUIRED"
  | "DENIED"
  | "PARKED"
  | "FUTURE_GATE"

export type HermesStatusRecord = {
  status: HermesStatus
  label: string
  description: string
}

export type HermesAuthorityBoundary = {
  label: string
  required: boolean
  description: string
}

export type HermesActivationRequirement = {
  label: string
  required: true
  description: string
}

export type HermesWorkerPacketProposal = {
  packetId: string
  proposedTask: string
  purpose: string
  allowedActions: string[]
  blockedActions: string[]
  requiredAuthority: string[]
  requiredEvidence: string[]
  requiredSafetyProof: string[]
  rollbackPlan: string
  stopConditions: string[]
  whatThisDoesNotAuthorize: string[]
}

export type HermesBlockedState = {
  label: string
  blockedReason: string
  missingAuthority: string[]
  ownerDecisionNeeded: string
  prohibitedActions: string[]
  safeNextAction: string
  activationAvailable: false
}

export type HermesSafetyProofCard = {
  label: string
  value: string
  description: string
}

export type HermesBoundarySurface = {
  doctrine: {
    title: string
    statements: readonly string[]
  }
  currentStatus: HermesStatus
  statuses: HermesStatusRecord[]
  authorityBoundaries: HermesAuthorityBoundary[]
  activationRequirements: HermesActivationRequirement[]
  workerPacketProposals: HermesWorkerPacketProposal[]
  blockedStates: HermesBlockedState[]
  links: {
    authority: { label: string; href: string; description: string }[]
    ownerDecisions: { label: string; href: string; description: string }[]
    evidenceTrace: { label: string; href: string; description: string }[]
    memoryCouncil: { label: string; href: string; description: string }[]
    academyWiki: { label: string; href: string; description: string }[]
  }
  safetyProofCards: HermesSafetyProofCard[]
  nextLaneDecision: {
    options: { option: string; classification: string }[]
    recommendedOption: string
    nextRecommendedBatch: string
    reason: string
  }
  safety: {
    staticReadOnly: true
    hermesRuntimeAdded: false
    hermesActivationAdded: false
    workerActivationAdded: false
    toolCallsAdded: false
    commandExecutionAdded: false
    commandRunnerAdded: false
    mcpActivationAdded: false
    councilRuntimeAdded: false
    memoryWriteAdded: false
    runtimeMemoryReadAdded: false
    dynamicRetrievalAdded: false
    filesystemScanAdded: false
    dynamicIngestionAdded: false
    githubWriteAdded: false
    codexAutomationAdded: false
    vectorStoreAdded: false
    embeddingsAdded: false
    dockerMetadataAdded: false
    backupScanAdded: false
    portChecksAdded: false
    runtimeControlAdded: false
    persistenceImplemented: false
    dbSchemaChanged: false
    backgroundWorkerAdded: false
    serviceRegistered: false
    scheduleCreated: false
    lanExposureEnabled: false
    cloudChanged: false
    productionDeployAdded: false
    secretsDisclosed: false
    terraFusionPacsTouched: false
    unrelatedContainersTouched: false
    autonomyAdded: false
  }
}

export const HERMES_DOCTRINE = {
  title: "Hermes Boundary Doctrine",
  statements: [
    "Hermes is a governed worker-sidecar concept.",
    "Hermes is not active.",
    "Hermes is not autonomous.",
    "Hermes cannot execute commands or call tools in this batch.",
    "Hermes cannot mutate memory, repos, runtime, containers, databases, cloud, production, or authority.",
    "Hermes requires Work Order authority, Owner Decision authority, evidence, safety proof, scope limits, rollback planning, and activation review before any future activation.",
  ],
} as const

export const HERMES_STATUSES: HermesStatusRecord[] = [
  ["NOT_INSTALLED", "Not installed", "No Hermes runtime, worker process, service, queue, scheduler, or MCP activation exists."],
  ["NOT_ACTIVE", "Not active", "Hermes may be described and displayed, but no worker is running."],
  ["BLOCKED_BY_AUTHORITY", "Blocked by authority", "Authority gates prevent activation, tool calls, runtime control, and autonomous work."],
  ["PROPOSED", "Proposed", "Hermes can appear as a proposal artifact with required evidence and blocked actions."],
  ["ACTIVATION_REVIEW_REQUIRED", "Activation review required", "Future activation would require a separate owner-authorized activation Work Order."],
  ["DENIED", "Denied", "Unsafe or unauthorized actions remain denied with no bypass path."],
  ["PARKED", "Parked", "Hermes can remain parked until a future governance lane explicitly reopens it."],
  ["FUTURE_GATE", "Future gate", "Any runtime capability belongs behind future authority, safety, and implementation gates."],
].map(([status, label, description]) => ({
  status: status as HermesStatus,
  label,
  description,
}))

export const HERMES_AUTHORITY_BOUNDARIES: HermesAuthorityBoundary[] = [
  ["Owner Decision required", "A Primary decision must approve any future activation boundary."],
  ["Authority gate required", "Authority Registry gates must identify exactly what is allowed and blocked."],
  ["Work Order required", "A separate Work Order must define scope, validation, and stop conditions."],
  ["Evidence required", "Evidence must prove readiness, safety, and results before trust."],
  ["Safety proof required", "Safety proof must show no bypass of command, tool, memory, runtime, or autonomy gates."],
  ["Scope restriction required", "Any future activation must be narrow, bounded, and reversible."],
  ["Rollback/disable plan required", "A rollback or disable plan must exist before any activation can be considered."],
].map(([label, description]) => ({ label, required: true, description }))

export const HERMES_ACTIVATION_REQUIREMENTS: HermesActivationRequirement[] = [
  ["Explicit owner authorization", "The Primary must explicitly authorize a future Hermes activation lane."],
  ["Approved activation Work Order", "A separate approved WO must define the activation scope."],
  ["Authority registry gate", "Authority gates must cover runtime, tools, memory, persistence, network, and production boundaries."],
  ["Evidence packet", "Activation must include preflight, validation, safety, and rollback evidence."],
  ["Scope limit", "Allowed targets, duration, and actions must be narrowly bounded."],
  ["Allowed tools list", "Only explicitly authorized tools could ever be available."],
  ["Blocked tools list", "Command runners, production writes, secrets, and unrelated systems remain blocked unless separately authorized."],
  ["Runtime boundary", "Process, network, filesystem, and service boundaries must be defined."],
  ["Rollback plan", "Disable and rollback steps must be documented before activation."],
  ["Monitoring/reporting boundary", "Reporting must be defined without background autonomy or hidden collection."],
  ["Stop conditions", "Activation must halt on authority drift, validation failure, safety failure, or scope expansion."],
].map(([label, description]) => ({ label, required: true, description }))

export const HERMES_WORKER_PACKET_PROPOSALS: HermesWorkerPacketProposal[] = [
  {
    packetId: "HERMES-PACKET-PROPOSAL-001",
    proposedTask: "Skill governance review packet",
    purpose: "Describe a future packet shape for reviewing Agent Forge skill governance without running a worker.",
    allowedActions: ["read static governance models", "summarize required evidence", "identify blocked actions"],
    blockedActions: ["execute commands", "call tools", "write files", "mutate memory", "start workers", "touch production"],
    requiredAuthority: ["Owner Decision", "Authority Registry gate", "approved activation Work Order"],
    requiredEvidence: ["scope evidence", "safety proof", "rollback plan", "validation record"],
    requiredSafetyProof: ["no command runner", "no tool calls", "no persistence", "no runtime control", "no autonomy"],
    rollbackPlan: "Keep Hermes inactive and remove any future packet from review if authority or evidence is missing.",
    stopConditions: ["missing owner authority", "missing evidence", "scope expansion", "runtime capability requested"],
    whatThisDoesNotAuthorize: ["Hermes activation", "worker execution", "tool calls", "command execution", "autonomy"],
  },
]

export const HERMES_BLOCKED_STATES: HermesBlockedState[] = [
  {
    label: "Activation blocked",
    blockedReason: "Hermes has no authorized activation Work Order.",
    missingAuthority: ["Owner Decision", "Authority Registry gate", "Activation Review"],
    ownerDecisionNeeded: "Decide whether a future Hermes activation proposal may be drafted.",
    prohibitedActions: ["activate Hermes", "start worker", "dispatch jobs"],
    safeNextAction: "Keep Hermes displayed as inactive and define skill governance first.",
    activationAvailable: false,
  },
  {
    label: "Tool calls denied",
    blockedReason: "No MCP or tool authority exists for Hermes.",
    missingAuthority: ["Tool call gate", "allowed tools list", "blocked tools list"],
    ownerDecisionNeeded: "Decide future tool boundaries only after governance proof exists.",
    prohibitedActions: ["call MCP tools", "run shell commands", "write repos"],
    safeNextAction: "Keep tool calls denied and document required authority.",
    activationAvailable: false,
  },
  {
    label: "Runtime control denied",
    blockedReason: "Runtime control, service registration, scheduling, and LAN exposure remain blocked.",
    missingAuthority: ["runtime control gate", "service gate", "network exposure gate"],
    ownerDecisionNeeded: "Decide runtime control only in a future explicit authority packet.",
    prohibitedActions: ["register services", "create schedules", "open LAN access", "control containers"],
    safeNextAction: "Keep Hermes as a read-only doctrine surface.",
    activationAvailable: false,
  },
]

export const HERMES_SAFETY_PROOF_CARDS: HermesSafetyProofCard[] = [
  ["Hermes inactive", "blocked", "Hermes is described and displayed only; no runtime exists."],
  ["No worker activation", "blocked", "No worker process, queue, scheduler, service, or background worker was added."],
  ["No tool calls", "blocked", "No MCP activation, tool bridge, GitHub write path, or shell bridge was added."],
  ["No command execution", "blocked", "No command runner, execute endpoint, run button, or terminal bridge was added."],
  ["No runtime control", "blocked", "No Docker metadata, backup scan, port check, runtime control, service, schedule, or LAN exposure was added."],
  ["No memory write/read", "blocked", "No memory write, runtime memory read, vector store, embeddings, or dynamic retrieval was added."],
  ["No autonomy", "blocked", "No autonomous loop, Codex automation, Council runtime handoff, or worker activation was added."],
  ["Future authority required", "required", "Any future activation requires owner authorization, authority gates, evidence, and activation review."],
].map(([label, value, description]) => ({ label, value, description }))

export function getHermesBoundarySurface(): HermesBoundarySurface {
  return {
    doctrine: HERMES_DOCTRINE,
    currentStatus: "BLOCKED_BY_AUTHORITY",
    statuses: HERMES_STATUSES,
    authorityBoundaries: HERMES_AUTHORITY_BOUNDARIES,
    activationRequirements: HERMES_ACTIVATION_REQUIREMENTS,
    workerPacketProposals: HERMES_WORKER_PACKET_PROPOSALS,
    blockedStates: HERMES_BLOCKED_STATES,
    links: {
      authority: [
        { label: "Authority Registry", href: "/governance", description: "Review gates that keep Hermes inactive." },
        { label: "Agent Forge", href: "/agent-forge", description: "Review skill preparation before worker activation is considered." },
      ],
      ownerDecisions: [
        { label: "Owner Decisions", href: "/decisions", description: "Review blocked decisions and future authority questions." },
      ],
      evidenceTrace: [
        { label: "Evidence", href: "/audit", description: "Review proof records required before trust." },
        { label: "Trace Ledger", href: "/trace", description: "Review reasoning history and failure-to-eval proposals." },
      ],
      memoryCouncil: [
        { label: "Memory", href: "/memory", description: "Review governed continuity boundaries." },
        { label: "Brain Council", href: "/brain-council", description: "Review advisory Hermes analysis; no activation." },
      ],
      academyWiki: [
        { label: "Academy / Wiki", href: "/academy", description: "Review the Hermes glossary and operator lessons." },
      ],
    },
    safetyProofCards: HERMES_SAFETY_PROOF_CARDS,
    nextLaneDecision: {
      options: [
        { option: "A - Continue Hermes polish", classification: "safe but lower priority" },
        { option: "B - Phase 2 Ubuntu Server planning", classification: "planning only" },
        { option: "C - County Ops knowledge pack", classification: "knowledge lane" },
        { option: "D - Agent Forge skill governance", classification: "recommended" },
        { option: "E - Brain Council runtime proposal packet", classification: "blocked by runtime authority" },
        { option: "F - Local metadata gate", classification: "blocked by metadata authority" },
        { option: "G - Eval implementation authority packet", classification: "blocked by eval authority" },
      ],
      recommendedOption: "D - Agent Forge skill governance",
      nextRecommendedBatch: "WILLIAMOS-AGENT-FORGE-SKILL-GOVERNANCE-BATCH-001",
      reason:
        "After Hermes boundaries are defined, the next safe step is skill governance before any worker, sidecar, MCP, runtime, or autonomy capability can be considered.",
    },
    safety: {
      staticReadOnly: true,
      hermesRuntimeAdded: false,
      hermesActivationAdded: false,
      workerActivationAdded: false,
      toolCallsAdded: false,
      commandExecutionAdded: false,
      commandRunnerAdded: false,
      mcpActivationAdded: false,
      councilRuntimeAdded: false,
      memoryWriteAdded: false,
      runtimeMemoryReadAdded: false,
      dynamicRetrievalAdded: false,
      filesystemScanAdded: false,
      dynamicIngestionAdded: false,
      githubWriteAdded: false,
      codexAutomationAdded: false,
      vectorStoreAdded: false,
      embeddingsAdded: false,
      dockerMetadataAdded: false,
      backupScanAdded: false,
      portChecksAdded: false,
      runtimeControlAdded: false,
      persistenceImplemented: false,
      dbSchemaChanged: false,
      backgroundWorkerAdded: false,
      serviceRegistered: false,
      scheduleCreated: false,
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
