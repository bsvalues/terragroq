export type SkillCategory =
  | "DOCUMENTATION_SKILL"
  | "UI_SKILL"
  | "TESTING_SKILL"
  | "EVIDENCE_SKILL"
  | "MEMORY_SKILL"
  | "COUNCIL_SKILL"
  | "HERMES_SKILL"
  | "LOCAL_RUNTIME_SKILL"
  | "DEPLOYMENT_SKILL"
  | "DB_SCHEMA_SKILL"
  | "COUNTY_OPS_SKILL"
  | "HIGH_RISK_SKILL"

export type SkillRiskLevel =
  | "LOW_READ_ONLY"
  | "UI_ONLY"
  | "DOCS_ONLY"
  | "TEST_ONLY"
  | "LOCAL_PROOF"
  | "METADATA_ACCESS"
  | "RUNTIME_CONTROL"
  | "DATA_MUTATION"
  | "PRODUCTION_IMPACT"
  | "AUTONOMY_RISK"
  | "BLOCKED"

export type SkillQuarantineState =
  | "PROPOSED"
  | "QUARANTINED"
  | "NEEDS_REVIEW"
  | "BLOCKED_BY_AUTHORITY"
  | "BLOCKED_BY_RISK"
  | "PARKED"
  | "DENIED"
  | "FUTURE_GATE"

export type SkillPermissionArea =
  | "READ_ONLY_UI"
  | "READ_ONLY_DOCS"
  | "READ_ONLY_EVIDENCE"
  | "TEST_EXECUTION_BY_OPERATOR"
  | "LOCAL_PROOF_BY_OPERATOR"
  | "FILESYSTEM_ACCESS"
  | "GITHUB_ACCESS"
  | "DOCKER_ACCESS"
  | "DB_ACCESS"
  | "CLOUD_ACCESS"
  | "COMMAND_EXECUTION"
  | "TOOL_CALLS"
  | "WORKER_RUNTIME"
  | "AUTONOMY"

export type SkillRegistryRecord = {
  skillId: string
  title: string
  category: SkillCategory
  purpose: string
  proposedBy: string
  relatedGoal: string
  relatedWorkOrder: string
  relatedEvidence: string[]
  relatedAuthorityGate: string[]
  riskLevel: SkillRiskLevel
  quarantineState: SkillQuarantineState
  permissionProfile: SkillPermissionArea[]
  activationRequirement: string[]
  blockedActions: string[]
  whatThisDoesNotAuthorize: string[]
}

export type SkillProposalPacket = {
  packetId: string
  skillId: string
  proposedCapability: string
  reason: string
  allowedScope: string[]
  blockedScope: string[]
  requiredAuthority: string[]
  requiredEvidence: string[]
  requiredTests: string[]
  requiredSafetyProof: string[]
  activationReview: string
  rollbackPlan: string
  stopConditions: string[]
  whatThisDoesNotAuthorize: string[]
}

export type SkillReviewQueueItem = {
  skillId: string
  title: string
  whyReviewIsNeeded: string
  riskLevel: SkillRiskLevel
  authorityRequired: string[]
  evidenceNeeded: string[]
  safeNextAction: string
  blockedActions: string[]
}

export type SkillBlockedUxItem = {
  skillId: string
  blockedReason: string
  quarantineReason: string
  missingEvidence: string[]
  missingAuthority: string[]
  prohibitedActions: string[]
  safeNextAction: string
}

export type SkillSafetyProofCard = {
  label: string
  value: string
  description: string
}

export type AgentForgeSurface = {
  title: string
  eyebrow: string
  description: string
  doctrine: {
    title: string
    statements: readonly string[]
  }
  categories: SkillCategory[]
  riskLevels: { level: SkillRiskLevel; description: string }[]
  quarantineStates: { state: SkillQuarantineState; description: string }[]
  permissionMatrix: { area: SkillPermissionArea; posture: "allowed-read-only" | "operator-only" | "blocked"; description: string }[]
  skills: SkillRegistryRecord[]
  proposalPackets: SkillProposalPacket[]
  reviewQueue: SkillReviewQueueItem[]
  blockedUx: SkillBlockedUxItem[]
  links: {
    authorityOwner: { label: string; href: string; description: string }[]
    evidenceTraceMemory: { label: string; href: string; description: string }[]
    hermesCouncilAcademy: { label: string; href: string; description: string }[]
  }
  safetyProofCards: SkillSafetyProofCard[]
  nextLaneDecision: {
    recommendedOption: string
    nextRecommendedBatch: string
    reason: string
    options: { option: string; classification: string }[]
  }
  safety: {
    readOnly: true
    skillExecutionAdded: false
    runtimeSkillLoaderAdded: false
    dependencyInstallAdded: false
    toolCallsAdded: false
    commandExecutionAdded: false
    commandRunnerAdded: false
    hermesActivationAdded: false
    mcpActivationAdded: false
    workerActivationAdded: false
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

export const AGENT_FORGE_DOCTRINE = {
  title: "Agent Forge Skill Governance Doctrine",
  statements: [
    "Agent Forge proposes capabilities and skill records.",
    "Agent Forge does not execute skills.",
    "Agent Forge does not load skills at runtime.",
    "Agent Forge does not install packages or dependencies.",
    "Agent Forge does not call tools, execute commands, activate Hermes, or start workers.",
    "Skills require authority, evidence, quarantine review, and activation review before any future use.",
    "Proposed skills are records, not executable runtime behavior.",
  ],
} as const

export const SKILL_CATEGORIES: SkillCategory[] = [
  "DOCUMENTATION_SKILL",
  "UI_SKILL",
  "TESTING_SKILL",
  "EVIDENCE_SKILL",
  "MEMORY_SKILL",
  "COUNCIL_SKILL",
  "HERMES_SKILL",
  "LOCAL_RUNTIME_SKILL",
  "DEPLOYMENT_SKILL",
  "DB_SCHEMA_SKILL",
  "COUNTY_OPS_SKILL",
  "HIGH_RISK_SKILL",
]

export const SKILL_RISK_LEVELS: { level: SkillRiskLevel; description: string }[] = [
  ["LOW_READ_ONLY", "Static display, documentation, or reference-only skill proposal."],
  ["UI_ONLY", "UI-only proposal with no mutation or runtime authority."],
  ["DOCS_ONLY", "Documentation-only proposal."],
  ["TEST_ONLY", "Operator-run test proposal; no background execution."],
  ["LOCAL_PROOF", "Operator-run local proof proposal with explicit boundary review."],
  ["METADATA_ACCESS", "Metadata proposal requiring future authority before any access."],
  ["RUNTIME_CONTROL", "Runtime-control proposal; blocked until explicit authority."],
  ["DATA_MUTATION", "Data mutation proposal; blocked until explicit authority and rollback proof."],
  ["PRODUCTION_IMPACT", "Production-impact proposal; blocked until release authority."],
  ["AUTONOMY_RISK", "Autonomy-risk proposal; blocked by default."],
  ["BLOCKED", "Blocked proposal with no execution authority."],
].map(([level, description]) => ({ level: level as SkillRiskLevel, description }))

export const SKILL_QUARANTINE_STATES: { state: SkillQuarantineState; description: string }[] = [
  ["PROPOSED", "Skill exists as a proposal record only."],
  ["QUARANTINED", "Skill is held for review and cannot run."],
  ["NEEDS_REVIEW", "Skill needs authority, evidence, or risk review."],
  ["BLOCKED_BY_AUTHORITY", "Skill cannot proceed without owner and authority gates."],
  ["BLOCKED_BY_RISK", "Skill risk blocks promotion."],
  ["PARKED", "Skill is parked until a future lane reopens it."],
  ["DENIED", "Skill is denied with no activation path in this batch."],
  ["FUTURE_GATE", "Skill belongs behind future authority and activation gates."],
].map(([state, description]) => ({ state: state as SkillQuarantineState, description }))

export const SKILL_PERMISSION_MATRIX: AgentForgeSurface["permissionMatrix"] = [
  ["READ_ONLY_UI", "allowed-read-only", "May be displayed as static UI."],
  ["READ_ONLY_DOCS", "allowed-read-only", "May be documented as static doctrine or reports."],
  ["READ_ONLY_EVIDENCE", "allowed-read-only", "May reference evidence without dynamic ingestion."],
  ["TEST_EXECUTION_BY_OPERATOR", "operator-only", "May describe tests for the operator to run in an authorized lane."],
  ["LOCAL_PROOF_BY_OPERATOR", "operator-only", "May describe local proof for future operator-run validation."],
  ["FILESYSTEM_ACCESS", "blocked", "No filesystem scanning or runtime access is granted."],
  ["GITHUB_ACCESS", "blocked", "No GitHub write path or dynamic integration is granted."],
  ["DOCKER_ACCESS", "blocked", "No Docker metadata or container control is granted."],
  ["DB_ACCESS", "blocked", "No database access or schema authority is granted."],
  ["CLOUD_ACCESS", "blocked", "No cloud, Vercel, Azure, or production authority is granted."],
  ["COMMAND_EXECUTION", "blocked", "No command runner or shell bridge is granted."],
  ["TOOL_CALLS", "blocked", "No MCP or tool bridge is granted."],
  ["WORKER_RUNTIME", "blocked", "No worker process, service, queue, or scheduler is granted."],
  ["AUTONOMY", "blocked", "No autonomous loop or self-activation is granted."],
].map(([area, posture, description]) => ({
  area: area as SkillPermissionArea,
  posture: posture as AgentForgeSurface["permissionMatrix"][number]["posture"],
  description,
}))

export const SKILL_REGISTRY: SkillRegistryRecord[] = [
  {
    skillId: "skill-docs-boundary-review",
    title: "Documentation Boundary Review Skill",
    category: "DOCUMENTATION_SKILL",
    purpose: "Review future governance docs for boundary clarity as a proposal record.",
    proposedBy: "Agent Forge",
    relatedGoal: "GOAL-WOS-011",
    relatedWorkOrder: "WO-FORGE-002",
    relatedEvidence: ["Evidence Spine", "Trace Ledger"],
    relatedAuthorityGate: ["READ_ONLY_DOCS_GATE"],
    riskLevel: "DOCS_ONLY",
    quarantineState: "PROPOSED",
    permissionProfile: ["READ_ONLY_DOCS", "READ_ONLY_EVIDENCE"],
    activationRequirement: ["Owner Decision", "activation Work Order", "evidence packet", "safety proof"],
    blockedActions: ["execute skill", "install dependency", "call tools", "write files"],
    whatThisDoesNotAuthorize: ["skill execution", "runtime loader", "dependency installation", "autonomy"],
  },
  {
    skillId: "skill-hermes-packet-review",
    title: "Hermes Packet Review Skill",
    category: "HERMES_SKILL",
    purpose: "Propose review criteria for future Hermes packets without activating Hermes.",
    proposedBy: "Agent Forge",
    relatedGoal: "GOAL-WOS-011",
    relatedWorkOrder: "WO-FORGE-014",
    relatedEvidence: ["Hermes Boundary Doctrine", "Authority Registry"],
    relatedAuthorityGate: ["HERMES_ACTIVATION_GATE", "WORKER_RUNTIME_GATE"],
    riskLevel: "AUTONOMY_RISK",
    quarantineState: "BLOCKED_BY_AUTHORITY",
    permissionProfile: ["READ_ONLY_UI", "READ_ONLY_EVIDENCE", "WORKER_RUNTIME", "AUTONOMY"],
    activationRequirement: ["Owner Decision", "Hermes activation authority", "worker runtime authority"],
    blockedActions: ["activate Hermes", "start worker", "call MCP tools", "dispatch jobs"],
    whatThisDoesNotAuthorize: ["Hermes activation", "worker activation", "tool calls", "autonomy"],
  },
  {
    skillId: "skill-local-runtime-proof",
    title: "Local Runtime Proof Skill",
    category: "LOCAL_RUNTIME_SKILL",
    purpose: "Define future operator-run local proof requirements without adding metadata or control.",
    proposedBy: "Agent Forge",
    relatedGoal: "GOAL-WOS-011",
    relatedWorkOrder: "WO-FORGE-011",
    relatedEvidence: ["Local OMEN authority freeze", "Authority Registry"],
    relatedAuthorityGate: ["LOCAL_RUNTIME_METADATA_GATE", "LOCAL_RUNTIME_CONTROL_GATE"],
    riskLevel: "METADATA_ACCESS",
    quarantineState: "QUARANTINED",
    permissionProfile: ["READ_ONLY_UI", "LOCAL_PROOF_BY_OPERATOR", "DOCKER_ACCESS", "COMMAND_EXECUTION"],
    activationRequirement: ["Owner Decision", "metadata gate", "local proof Work Order"],
    blockedActions: ["scan Docker metadata", "run port checks", "control runtime", "create service"],
    whatThisDoesNotAuthorize: ["Docker metadata", "backup scan", "port checks", "runtime control"],
  },
]

export const SKILL_PROPOSAL_PACKETS: SkillProposalPacket[] = [
  {
    packetId: "FORGE-PACKET-001",
    skillId: "skill-docs-boundary-review",
    proposedCapability: "Static governance document boundary review",
    reason: "Improve future governance clarity without introducing runtime execution.",
    allowedScope: ["static documentation review", "evidence reference review", "blocked-action labeling"],
    blockedScope: ["execute skills", "install packages", "write files automatically", "call tools"],
    requiredAuthority: ["Owner Decision", "Authority Registry gate"],
    requiredEvidence: ["scope proof", "safety proof", "review evidence"],
    requiredTests: ["registry test", "navigation test", "safety regression test"],
    requiredSafetyProof: ["no runtime loader", "no tool calls", "no command execution"],
    activationReview: "Future activation review required before any executable use.",
    rollbackPlan: "Keep the skill as a static proposal or remove it from the registry.",
    stopConditions: ["requested execution", "missing evidence", "scope expands beyond docs"],
    whatThisDoesNotAuthorize: ["runtime skill loading", "dependency installation", "worker activation"],
  },
]

export const SKILL_REVIEW_QUEUE: SkillReviewQueueItem[] = [
  {
    skillId: "skill-hermes-packet-review",
    title: "Hermes Packet Review Skill",
    whyReviewIsNeeded: "Hermes-related skills carry worker and autonomy risk.",
    riskLevel: "AUTONOMY_RISK",
    authorityRequired: ["HERMES_ACTIVATION_GATE", "WORKER_RUNTIME_GATE", "Owner Decision"],
    evidenceNeeded: ["Hermes boundary proof", "blocked actions", "activation review packet"],
    safeNextAction: "Keep quarantined and define skill governance before any activation proposal.",
    blockedActions: ["activate Hermes", "start worker", "call tools"],
  },
  {
    skillId: "skill-local-runtime-proof",
    title: "Local Runtime Proof Skill",
    whyReviewIsNeeded: "Local runtime metadata and control lanes remain blocked.",
    riskLevel: "METADATA_ACCESS",
    authorityRequired: ["LOCAL_RUNTIME_METADATA_GATE", "Owner Decision"],
    evidenceNeeded: ["local authority proof", "manual-only boundary", "no runtime control proof"],
    safeNextAction: "Keep as an operator-run proof proposal only.",
    blockedActions: ["scan Docker metadata", "run port checks", "control runtime"],
  },
]

export const SKILL_BLOCKED_UX: SkillBlockedUxItem[] = [
  {
    skillId: "skill-hermes-packet-review",
    blockedReason: "Hermes activation and worker runtime authority do not exist.",
    quarantineReason: "Autonomy and worker-runtime risk.",
    missingEvidence: ["activation proof", "worker safety proof", "owner decision"],
    missingAuthority: ["Hermes activation gate", "worker runtime gate"],
    prohibitedActions: ["activate Hermes", "dispatch jobs", "call MCP tools"],
    safeNextAction: "Keep quarantined and use Agent Forge skill governance only.",
  },
  {
    skillId: "skill-local-runtime-proof",
    blockedReason: "Local runtime metadata and control gates remain closed.",
    quarantineReason: "Metadata access and runtime-control risk.",
    missingEvidence: ["metadata gate decision", "manual-only proof", "rollback plan"],
    missingAuthority: ["local metadata gate", "runtime control gate"],
    prohibitedActions: ["Docker metadata", "backup scan", "port checks", "runtime control"],
    safeNextAction: "Keep as read-only proposal and require future authority packet.",
  },
]

export const SKILL_SAFETY_PROOF_CARDS: SkillSafetyProofCard[] = [
  ["No skill execution", "blocked", "Skills are records and proposals only; no execute path exists."],
  ["No runtime skill loader", "blocked", "No dynamic loader, runtime registry, or import path was added."],
  ["No dependency installation", "blocked", "No packages, installers, package manager calls, or dependency changes were added."],
  ["No command execution", "blocked", "No command runner, shell bridge, execute endpoint, or run control was added."],
  ["No tool calls", "blocked", "No MCP activation, tool bridge, GitHub write path, or API runner was added."],
  ["No worker activation", "blocked", "No worker process, service, queue, scheduler, or Hermes activation was added."],
  ["No autonomy", "blocked", "No autonomous loop, Codex automation, self-activation, or Council runtime was added."],
].map(([label, value, description]) => ({ label, value, description }))

export function getAgentForgeSurface(): AgentForgeSurface {
  return {
    title: "Agent Forge",
    eyebrow: "Skill governance",
    description:
      "Agent Forge is the governed WilliamOS layer for proposing, classifying, risk-rating, quarantining, and reviewing future skills before any execution can be considered.",
    doctrine: AGENT_FORGE_DOCTRINE,
    categories: SKILL_CATEGORIES,
    riskLevels: SKILL_RISK_LEVELS,
    quarantineStates: SKILL_QUARANTINE_STATES,
    permissionMatrix: SKILL_PERMISSION_MATRIX,
    skills: SKILL_REGISTRY,
    proposalPackets: SKILL_PROPOSAL_PACKETS,
    reviewQueue: SKILL_REVIEW_QUEUE,
    blockedUx: SKILL_BLOCKED_UX,
    links: {
      authorityOwner: [
        { label: "Authority", href: "/governance", description: "Review gates required before any future skill activation." },
        { label: "Owner Decisions", href: "/decisions", description: "Review owner decisions that keep skill execution blocked." },
      ],
      evidenceTraceMemory: [
        { label: "Evidence", href: "/audit", description: "Review proof required before trust." },
        { label: "Trace Ledger", href: "/trace", description: "Review reasoning and failure-to-eval records." },
        { label: "Memory", href: "/memory", description: "Review governed continuity boundaries." },
      ],
      hermesCouncilAcademy: [
        { label: "Hermes", href: "/hermes", description: "Review worker-sidecar boundaries before any skill activation." },
        { label: "Brain Council", href: "/brain-council", description: "Review advisory risk analysis; no runtime handoff." },
        { label: "Academy / Wiki", href: "/academy", description: "Review operator lessons and glossary context." },
      ],
    },
    safetyProofCards: SKILL_SAFETY_PROOF_CARDS,
    nextLaneDecision: {
      recommendedOption: "B - Phase 2 Ubuntu Server planning",
      nextRecommendedBatch: "WILLIAMOS-PHASE-2-UBUNTU-SERVER-PLANNING-BATCH-001",
      reason:
        "After defining skill governance, the next safest operational step is Phase 2 infrastructure planning, not activation. Dedicated Ubuntu planning reduces Windows/Docker Desktop fragility before any future worker or runtime capability is considered.",
      options: [
        { option: "A - Continue Agent Forge polish", classification: "safe but lower priority" },
        { option: "B - Phase 2 Ubuntu Server planning", classification: "recommended" },
        { option: "C - County Ops knowledge pack", classification: "knowledge lane" },
        { option: "D - Brain Council runtime proposal packet", classification: "blocked by runtime authority" },
        { option: "E - Eval implementation authority packet", classification: "blocked by eval authority" },
        { option: "F - Local metadata gate", classification: "blocked by metadata authority" },
        { option: "G - Hermes activation proposal packet", classification: "blocked by activation authority" },
      ],
    },
    safety: {
      readOnly: true,
      skillExecutionAdded: false,
      runtimeSkillLoaderAdded: false,
      dependencyInstallAdded: false,
      toolCallsAdded: false,
      commandExecutionAdded: false,
      commandRunnerAdded: false,
      hermesActivationAdded: false,
      mcpActivationAdded: false,
      workerActivationAdded: false,
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
