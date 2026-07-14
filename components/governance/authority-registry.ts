import {
  createOwnerOperationEvidencePlaceholder,
  type OwnerOperationEvidenceModel,
} from "@/lib/governance/owner-operation-evidence"

export type AuthorityCategory =
  | "READ_ONLY"
  | "DOCS_ONLY"
  | "UI_COPY_TESTS"
  | "LOCAL_MANUAL_PROOF"
  | "LOCAL_RUNTIME_READ"
  | "LOCAL_RUNTIME_MUTATION"
  | "CONTAINER_CONTROL"
  | "MEMORY_GOVERNANCE"
  | "COUNCIL_ADVISORY"
  | "DB_SCHEMA"
  | "PRODUCTION_VERIFY"
  | "PRODUCTION_DEPLOY"
  | "CLOUD_CONFIG"
  | "GITHUB_WRITE"
  | "AUTONOMY"
  | "LAN_EXPOSURE"
  | "SECRET_HANDLING"
  | "TERRAFUSION_PACS"

export type AuthorityLevel =
  | "allowed-by-current-lane"
  | "blocked-by-default"
  | "owner-decision-required"
  | "future-explicit-gate-only"

export type RiskLevel = "low" | "medium" | "high" | "critical"

export type AuthorityGateId =
  | "LOCAL_RUNTIME_METADATA_GATE"
  | "LOCAL_RUNTIME_CONTROL_GATE"
  | "MEMORY_WRITE_GATE"
  | "MEMORY_PROMOTION_GATE"
  | "COUNCIL_RUNTIME_GATE"
  | "HERMES_ACTIVATION_GATE"
  | "MCP_ACTIVATION_GATE"
  | "WORKER_ACTIVATION_GATE"
  | "DB_SCHEMA_CHANGE_GATE"
  | "PRODUCTION_DEPLOY_GATE"
  | "CLOUD_SETTING_CHANGE_GATE"
  | "SECRET_ACCESS_GATE"
  | "TERRAFUSION_TOUCH_GATE"
  | "DOCKER_METADATA_GATE"
  | "BACKUP_METADATA_GATE"
  | "PORT_STATUS_GATE"
  | "FILESYSTEM_METADATA_GATE"
  | "GITHUB_METADATA_GATE"
  | "START_STOP_GATE"
  | "SERVICE_REGISTRATION_GATE"
  | "SCHEDULER_GATE"
  | "LAN_EXPOSURE_GATE"
  | "COMMAND_RUNNER_GATE"
  | "DATA_MUTATION_GATE"
  | "BACKUP_RESTORE_GATE"
  | "TOOL_CALL_GATE"
  | "AUTONOMOUS_LOOP_GATE"
  | "OPERATOR_HOST_GATE"

export type AuthorityRecord = {
  authorityId: string
  title: string
  category: AuthorityCategory
  level: AuthorityLevel
  scope: string
  allowedActions: string[]
  blockedActions: string[]
  requiredEvidence: string[]
  ownerDecisionRequired: boolean
  relatedWorkOrders: string[]
  relatedEvidence: string[]
  status: "active" | "blocked" | "prepared" | "future-gate"
  riskLevel: RiskLevel
}

export type AuthorityGateRecord = {
  gateId: AuthorityGateId
  title: string
  category: AuthorityCategory
  level: AuthorityLevel
  status: "open-for-display" | "blocked" | "future-gate"
  summary: string
  requiredOwnerDecision: string
  requiredEvidence: string[]
  prohibitedActions: string[]
  safeNextAction: string
  riskLevel: RiskLevel
}

export type BlockedActionRecord = {
  action: string
  reason: string
  requiredAuthority: AuthorityCategory
  gateId: AuthorityGateId
  safeDefault: string
}

export type OwnerDecisionRecord = {
  decision: string
  status: "not-granted"
  gateId: AuthorityGateId
  requiredEvidence: string
  safeDefault: string
}

export type AuthorityLinkRecord = {
  label: string
  authorityId: string
  gateId: AuthorityGateId
  relatedItem: string
  description: string
  safeNextAction?: string
  prohibitedAction?: string
}

export type AuthoritySafetyProofCard = {
  label: string
  value: string
  description: string
}

export type AuthorityRegistrySurface = {
  doctrine: {
    title: string
    statements: readonly string[]
  }
  categories: {
    category: AuthorityCategory
    level: AuthorityLevel
    description: string
  }[]
  records: AuthorityRecord[]
  gates: AuthorityGateRecord[]
  blockedActions: BlockedActionRecord[]
  ownerDecisions: OwnerDecisionRecord[]
  workOrderAuthorityLinks: AuthorityLinkRecord[]
  evidenceAuthorityLinks: AuthorityLinkRecord[]
  ownerDecisionAuthorityLinks: AuthorityLinkRecord[]
  memoryAuthorityLinks: AuthorityLinkRecord[]
  councilAuthorityLinks: AuthorityLinkRecord[]
  localRuntimeAuthorityLinks: AuthorityLinkRecord[]
  metadataExpansionGates: AuthorityGateRecord[]
  runtimeControlGates: AuthorityGateRecord[]
  productionDeployGates: AuthorityGateRecord[]
  dbSchemaGates: AuthorityGateRecord[]
  autonomyWorkerGates: AuthorityGateRecord[]
  safetyProofCards: AuthoritySafetyProofCard[]
  ownerOperationEvidence: OwnerOperationEvidenceModel
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
    approvalControlsAdded: false
    authorityStateMutationAdded: false
    permissionModelChanged: false
    accessGrantsImplemented: false
    commandExecutionAdded: false
    commandRunnerAdded: false
    githubWriteAdded: false
    codexAutomationAdded: false
    councilRuntimeAdded: false
    hermesActivationAdded: false
    mcpActivationAdded: false
    workerActivationAdded: false
    memoryWriteAdded: false
    runtimeMemoryReadAdded: false
    dynamicRetrievalAdded: false
    vectorStoreAdded: false
    embeddingsAdded: false
    dynamicAuthorityIngestionAdded: false
    dynamicEvidenceIngestionAdded: false
    filesystemScanAdded: false
    dockerMetadataAdded: false
    backupScanAdded: false
    portChecksAdded: false
    runtimeControlAdded: false
    runtimeEnforcementEngineAdded: false
    authPolicyChanged: false
    dbSchemaChanged: false
    dataMutationAdded: false
    backupRestoreAdded: false
    packageChanged: false
    persistenceImplemented: false
    serviceRegistered: false
    scheduleCreated: false
    lanExposureEnabled: false
    cloudChanged: false
    productionDeployAdded: false
    secretsDisclosed: false
    hermesMcpAutonomyChanged: false
    autonomyAdded: false
    terraFusionPacsTouched: false
    unrelatedContainersTouched: false
  }
}

export const AUTHORITY_DOCTRINE = {
  title: "Authority Doctrine",
  statements: [
    "Authority belongs to the Primary.",
    "Authority is explicit.",
    "Mutation requires authority.",
    "Evidence informs authority but does not grant it.",
    "Work Orders define scope but do not bypass owner authority.",
    "Owner decisions record needed gates but do not mutate state in this registry.",
    "Memory preserves context but does not authorize action.",
    "Brain Council recommends but does not authorize execution.",
    "Local OMEN remains read-only, manual-only, and localhost-only.",
    "Hermes, MCP, workers, and autonomy remain blocked until separate activation gates.",
    "WilliamOS may display authority state.",
    "WilliamOS must not grant itself authority.",
    "Codex does not self-authorize.",
    "Caller-supplied zero owner-operation counters are unverified until independently evidenced.",
    "Genuine owner authority decisions are distinct from routine owner operations.",
    "Anything outside scope stops.",
  ],
} as const

export const AUTHORITY_CATEGORIES = [
  ["READ_ONLY", "allowed-by-current-lane", "WilliamOS may display existing state, evidence, authority, memory, Council, and owner-decision posture."],
  ["DOCS_ONLY", "allowed-by-current-lane", "Documentation and report updates are allowed when scoped."],
  ["UI_COPY_TESTS", "allowed-by-current-lane", "Read-only UI, copy, and tests are allowed inside this batch."],
  ["LOCAL_MANUAL_PROOF", "future-explicit-gate-only", "Manual local proof requires an explicit proof Work Order."],
  ["LOCAL_RUNTIME_READ", "future-explicit-gate-only", "Runtime reads and metadata require scoped read-only gates."],
  ["LOCAL_RUNTIME_MUTATION", "owner-decision-required", "Runtime mutation requires explicit owner approval."],
  ["CONTAINER_CONTROL", "owner-decision-required", "Container start, stop, restart, rebuild, inspect, or delete remains blocked."],
  ["MEMORY_GOVERNANCE", "owner-decision-required", "Memory writes, ingestion, canon promotion, and runtime reads remain blocked."],
  ["COUNCIL_ADVISORY", "blocked-by-default", "Brain Council may advise but cannot run, call tools, or activate workers."],
  ["DB_SCHEMA", "owner-decision-required", "Database schema, migration, restore, or data mutation requires authority."],
  ["PRODUCTION_VERIFY", "blocked-by-default", "Production verification may be allowed only when scoped as read-only."],
  ["PRODUCTION_DEPLOY", "owner-decision-required", "Production deploy, cutover, or release remains blocked."],
  ["CLOUD_CONFIG", "owner-decision-required", "Azure, Vercel, DNS, and cloud settings changes remain blocked."],
  ["GITHUB_WRITE", "owner-decision-required", "GitHub write actions from the UI or runtime remain blocked."],
  ["AUTONOMY", "owner-decision-required", "Hermes, MCP, workers, schedulers, and autonomous loops remain blocked."],
  ["LAN_EXPOSURE", "owner-decision-required", "LAN or public exposure requires a separate safety gate."],
  ["SECRET_HANDLING", "owner-decision-required", "Secret creation, inspection, printing, storage, or transfer requires authority."],
  ["TERRAFUSION_PACS", "owner-decision-required", "TerraFusion/PACS touch requires explicit external-system authority."],
].map(([category, level, description]) => ({
  category: category as AuthorityCategory,
  level: level as AuthorityLevel,
  description,
}))

export const AUTHORITY_RECORDS: AuthorityRecord[] = [
  {
    authorityId: "authority-read-only-registry",
    title: "Read-only Registry Authority",
    category: "READ_ONLY",
    level: "allowed-by-current-lane",
    scope: "Display authority state, evidence links, owner decisions, memory links, Council recommendations, gates, and safety posture.",
    allowedActions: ["Render static registry data", "Show Work Order links", "Show Evidence, Memory, Council, and Owner Decision links"],
    blockedActions: ["Execute commands", "Approve work", "Mutate authority", "Write GitHub", "Activate workers"],
    requiredEvidence: ["WO-AUTHORITY-015 safety sweep", "WO-AUTHORITY-016 rollup"],
    ownerDecisionRequired: false,
    relatedWorkOrders: ["WO-AUTHORITY-001 through WO-AUTHORITY-017"],
    relatedEvidence: ["docs/reports/WO-AUTHORITY-016-authority-registry-rollup.md"],
    status: "active",
    riskLevel: "low",
  },
  {
    authorityId: "authority-local-runtime-mutation",
    title: "Local Runtime Mutation Authority",
    category: "LOCAL_RUNTIME_MUTATION",
    level: "owner-decision-required",
    scope: "Start, stop, restart, repair, expose, persist, or automate local runtime behavior.",
    allowedActions: ["None in this batch"],
    blockedActions: ["Container control", "Runtime repair", "Service registration", "LAN exposure"],
    requiredEvidence: ["Runtime proof", "Rollback plan", "Owner approval packet"],
    ownerDecisionRequired: true,
    relatedWorkOrders: ["WO-LOCAL-120", "WO-AUTHORITY-008", "WO-AUTHORITY-010"],
    relatedEvidence: ["evidence-local-omen-status", "evidence-blocked-runtime-metadata"],
    status: "blocked",
    riskLevel: "high",
  },
  {
    authorityId: "authority-metadata-expansion",
    title: "Metadata Expansion Authority",
    category: "LOCAL_RUNTIME_READ",
    level: "future-explicit-gate-only",
    scope: "Docker metadata, backup metadata, port checks, filesystem metadata, or GitHub metadata.",
    allowedActions: ["None in this batch"],
    blockedActions: ["Docker metadata", "Backup scan", "Port checks", "Filesystem scan", "GitHub API integration"],
    requiredEvidence: ["Specific metadata gate", "Redaction plan", "Safety regression"],
    ownerDecisionRequired: true,
    relatedWorkOrders: ["WO-AUTHORITY-009"],
    relatedEvidence: ["evidence-blocked-runtime-metadata"],
    status: "future-gate",
    riskLevel: "medium",
  },
  {
    authorityId: "authority-memory-governance",
    title: "Memory Governance Authority",
    category: "MEMORY_GOVERNANCE",
    level: "owner-decision-required",
    scope: "Memory write, ingestion, canon promotion, runtime memory read, vector store, embeddings, or dynamic retrieval.",
    allowedActions: ["Display static Memory Governance records"],
    blockedActions: ["Memory write", "Memory ingestion", "Canon promotion", "Runtime memory read", "Embeddings"],
    requiredEvidence: ["Memory governance proof", "Owner approval", "Sensitivity and stale-memory review"],
    ownerDecisionRequired: true,
    relatedWorkOrders: ["WO-MEMORY-001 through WO-MEMORY-015", "WO-AUTHORITY-006"],
    relatedEvidence: ["memory-evidence-spine-current", "memory-authority-registry-current"],
    status: "blocked",
    riskLevel: "high",
  },
  {
    authorityId: "authority-council-runtime",
    title: "Brain Council Runtime Authority",
    category: "COUNCIL_ADVISORY",
    level: "owner-decision-required",
    scope: "Council runtime, ask/run Council, worker activation, tool calls, or Council-to-action flow.",
    allowedActions: ["Display static Council advice"],
    blockedActions: ["Council runtime", "Tool calls", "Worker activation", "Command execution"],
    requiredEvidence: ["Council advisory proof", "Autonomy gate", "Owner approval"],
    ownerDecisionRequired: true,
    relatedWorkOrders: ["WO-COUNCIL-001 through WO-COUNCIL-015", "WO-AUTHORITY-007", "WO-AUTHORITY-013"],
    relatedEvidence: ["council-packet-advisory-next-lane"],
    status: "blocked",
    riskLevel: "critical",
  },
  {
    authorityId: "authority-production-change",
    title: "Production / Cloud Change Authority",
    category: "PRODUCTION_DEPLOY",
    level: "owner-decision-required",
    scope: "Production deploy, Vercel/Azure/DNS settings, cloud config, env vars, secret access, or cutover.",
    allowedActions: ["None in this batch"],
    blockedActions: ["Production deploy", "Cloud config", "DNS change", "Vercel settings change", "Secret access"],
    requiredEvidence: ["Production verification", "Rollback plan", "Owner approval"],
    ownerDecisionRequired: true,
    relatedWorkOrders: ["WO-AUTHORITY-011"],
    relatedEvidence: ["evidence-production-proof"],
    status: "blocked",
    riskLevel: "critical",
  },
  {
    authorityId: "authority-db-schema",
    title: "Database / Schema Authority",
    category: "DB_SCHEMA",
    level: "owner-decision-required",
    scope: "DB creation, migration, schema mutation, data write, dump read, restore, or production DB touch.",
    allowedActions: ["None in this batch"],
    blockedActions: ["DB/schema migration", "Data mutation", "Backup restore", "Production DB touch"],
    requiredEvidence: ["Backup proof", "Migration plan", "Rollback plan", "Owner approval"],
    ownerDecisionRequired: true,
    relatedWorkOrders: ["WO-AUTHORITY-012"],
    relatedEvidence: ["evidence-safety-boundary"],
    status: "blocked",
    riskLevel: "critical",
  },
  {
    authorityId: "authority-autonomy",
    title: "Hermes / MCP / Worker / Autonomy Authority",
    category: "AUTONOMY",
    level: "owner-decision-required",
    scope: "Hermes activation, MCP activation, autonomous loops, workers, background actions, and tool calls.",
    allowedActions: ["None in this batch"],
    blockedActions: ["Hermes activation", "MCP activation", "Autonomous execution", "Background loop", "Tool calls"],
    requiredEvidence: ["Doctrine gate", "Control boundary proof", "Owner approval"],
    ownerDecisionRequired: true,
    relatedWorkOrders: ["WO-AUTHORITY-013"],
    relatedEvidence: ["evidence-safety-boundary", "council-packet-authority-needed"],
    status: "blocked",
    riskLevel: "critical",
  },
  {
    authorityId: "authority-secret-handling",
    title: "Secret Handling Authority",
    category: "SECRET_HANDLING",
    level: "owner-decision-required",
    scope: "Secret creation, inspection, disclosure, storage, printing, transfer, env var change, or credential access.",
    allowedActions: ["None in this batch"],
    blockedActions: ["Secret inspection", "Secret printing", "Committed env files", "Token handling"],
    requiredEvidence: ["Secret-handling plan", "Redaction proof", "Owner approval"],
    ownerDecisionRequired: true,
    relatedWorkOrders: ["WO-AUTHORITY-011", "WO-AUTHORITY-014"],
    relatedEvidence: ["evidence-safety-boundary"],
    status: "blocked",
    riskLevel: "critical",
  },
  {
    authorityId: "authority-terrafusion-pacs",
    title: "TerraFusion / PACS Touch Authority",
    category: "TERRAFUSION_PACS",
    level: "owner-decision-required",
    scope: "Any TerraFusion, PACS, external-system data, or unrelated container mutation.",
    allowedActions: ["None in this batch"],
    blockedActions: ["TerraFusion mutation", "PACS touch", "Unrelated container touch", "External-system DB touch"],
    requiredEvidence: ["Explicit external-system scope", "Impact assessment", "Rollback plan", "Owner approval"],
    ownerDecisionRequired: true,
    relatedWorkOrders: ["WO-AUTHORITY-012"],
    relatedEvidence: ["evidence-safety-boundary"],
    status: "blocked",
    riskLevel: "critical",
  },
]

function gate(input: AuthorityGateRecord): AuthorityGateRecord {
  return input
}

export const AUTHORITY_GATES: AuthorityGateRecord[] = [
  gate({
    gateId: "LOCAL_RUNTIME_METADATA_GATE",
    title: "Local runtime metadata gate",
    category: "LOCAL_RUNTIME_READ",
    level: "future-explicit-gate-only",
    status: "future-gate",
    summary: "Any local runtime metadata beyond approved static/read-only status requires a separate gate.",
    requiredOwnerDecision: "Authorize local runtime metadata expansion.",
    requiredEvidence: ["Named source scope", "No mutation proof", "Redaction plan"],
    prohibitedActions: ["Docker metadata", "backup scan", "port checks", "filesystem metadata"],
    safeNextAction: "Keep local status read-only and static until owner opens a metadata gate.",
    riskLevel: "medium",
  }),
  gate({
    gateId: "LOCAL_RUNTIME_CONTROL_GATE",
    title: "Local runtime control gate",
    category: "LOCAL_RUNTIME_MUTATION",
    level: "owner-decision-required",
    status: "blocked",
    summary: "Start, stop, restart, repair, service registration, scheduler, LAN, command runner, and background worker control are not authorized.",
    requiredOwnerDecision: "Authorize runtime control.",
    requiredEvidence: ["Rollback/removal plan", "Manual recovery proof", "Owner approval"],
    prohibitedActions: ["start/stop", "restart", "repair", "service registration", "scheduler", "LAN exposure"],
    safeNextAction: "Keep runtime control manual and outside WilliamOS.",
    riskLevel: "critical",
  }),
  gate({
    gateId: "MEMORY_WRITE_GATE",
    title: "Memory write gate",
    category: "MEMORY_GOVERNANCE",
    level: "owner-decision-required",
    status: "blocked",
    summary: "Memory write, ingestion, runtime reads, vector store, embeddings, and dynamic retrieval are blocked.",
    requiredOwnerDecision: "Authorize memory write or runtime memory read.",
    requiredEvidence: ["Memory governance proof", "Sensitivity plan", "Stale/contradiction review"],
    prohibitedActions: ["memory write", "memory ingestion", "runtime memory read", "vector store", "embeddings"],
    safeNextAction: "Display static Memory Governance records only.",
    riskLevel: "high",
  }),
  gate({
    gateId: "MEMORY_PROMOTION_GATE",
    title: "Memory canon promotion gate",
    category: "MEMORY_GOVERNANCE",
    level: "owner-decision-required",
    status: "blocked",
    summary: "Canon promotion requires separate authority and contradiction review.",
    requiredOwnerDecision: "Authorize memory canon promotion.",
    requiredEvidence: ["Evidence link", "Owner review", "Contradiction sweep"],
    prohibitedActions: ["canon promotion", "auto-promotion", "archive/delete mutation"],
    safeNextAction: "Keep memory canon promotion out of this batch.",
    riskLevel: "high",
  }),
  gate({
    gateId: "COUNCIL_RUNTIME_GATE",
    title: "Brain Council runtime gate",
    category: "COUNCIL_ADVISORY",
    level: "owner-decision-required",
    status: "blocked",
    summary: "Brain Council may advise but cannot run, dispatch, call tools, or execute.",
    requiredOwnerDecision: "Authorize Council runtime.",
    requiredEvidence: ["Autonomy doctrine", "Tool boundary proof", "Owner approval"],
    prohibitedActions: ["run Council", "ask Council runtime action", "dispatch worker", "execute recommendation"],
    safeNextAction: "Keep Council static/read-only and advisory.",
    riskLevel: "critical",
  }),
  gate({
    gateId: "HERMES_ACTIVATION_GATE",
    title: "Hermes activation gate",
    category: "AUTONOMY",
    level: "owner-decision-required",
    status: "blocked",
    summary: "Hermes activation remains blocked until separate activation authority exists.",
    requiredOwnerDecision: "Authorize Hermes activation.",
    requiredEvidence: ["Hermes doctrine", "Activation rubric", "Owner approval"],
    prohibitedActions: ["Hermes activation", "Hermes job dispatch", "worker dock activation"],
    safeNextAction: "Keep Hermes preview-only.",
    riskLevel: "critical",
  }),
  gate({
    gateId: "MCP_ACTIVATION_GATE",
    title: "MCP activation gate",
    category: "AUTONOMY",
    level: "owner-decision-required",
    status: "blocked",
    summary: "MCP activation and tool access remain blocked.",
    requiredOwnerDecision: "Authorize MCP activation.",
    requiredEvidence: ["MCP boundary proof", "Tool allowlist", "Owner approval"],
    prohibitedActions: ["MCP activation", "tool calls", "external tool execution"],
    safeNextAction: "Keep MCP disabled.",
    riskLevel: "critical",
  }),
  gate({
    gateId: "WORKER_ACTIVATION_GATE",
    title: "Worker activation gate",
    category: "AUTONOMY",
    level: "owner-decision-required",
    status: "blocked",
    summary: "No worker, background loop, scheduler, or autonomous process may activate.",
    requiredOwnerDecision: "Authorize worker activation.",
    requiredEvidence: ["Worker packet", "Rollback plan", "Owner approval"],
    prohibitedActions: ["worker activation", "background worker", "scheduler", "autonomous loop"],
    safeNextAction: "Keep worker surfaces preview/read-only.",
    riskLevel: "critical",
  }),
  gate({
    gateId: "DB_SCHEMA_CHANGE_GATE",
    title: "DB/schema change gate",
    category: "DB_SCHEMA",
    level: "owner-decision-required",
    status: "blocked",
    summary: "DB migration, schema change, data write, backup restore, dump read, production DB touch, and TerraFusion/PACS touch remain blocked.",
    requiredOwnerDecision: "Authorize DB/schema/data change.",
    requiredEvidence: ["Backup proof", "Migration plan", "Rollback plan"],
    prohibitedActions: ["DB migration", "schema change", "data write", "backup restore", "dump read"],
    safeNextAction: "Keep data and schema unchanged.",
    riskLevel: "critical",
  }),
  gate({
    gateId: "PRODUCTION_DEPLOY_GATE",
    title: "Production deploy gate",
    category: "PRODUCTION_DEPLOY",
    level: "owner-decision-required",
    status: "blocked",
    summary: "Production deploy, cutover, cloud settings, DNS, env var changes, and secret access are blocked.",
    requiredOwnerDecision: "Authorize production deploy or cutover.",
    requiredEvidence: ["Production proof", "Rollback plan", "Owner approval"],
    prohibitedActions: ["production deploy", "cutover", "release", "production write"],
    safeNextAction: "Keep production unchanged.",
    riskLevel: "critical",
  }),
  gate({
    gateId: "CLOUD_SETTING_CHANGE_GATE",
    title: "Cloud setting change gate",
    category: "CLOUD_CONFIG",
    level: "owner-decision-required",
    status: "blocked",
    summary: "Vercel, Azure, DNS, cloud config, and environment variable changes require explicit authority.",
    requiredOwnerDecision: "Authorize cloud setting change.",
    requiredEvidence: ["Config plan", "Rollback plan", "Owner approval"],
    prohibitedActions: ["Vercel setting change", "Azure setting change", "DNS change", "env var change"],
    safeNextAction: "Keep cloud settings unchanged.",
    riskLevel: "critical",
  }),
  gate({
    gateId: "SECRET_ACCESS_GATE",
    title: "Secret access gate",
    category: "SECRET_HANDLING",
    level: "owner-decision-required",
    status: "blocked",
    summary: "Secret access, inspection, printing, storage, transfer, and env secret changes are blocked.",
    requiredOwnerDecision: "Authorize secret access/change.",
    requiredEvidence: ["Redaction plan", "No-print policy", "Owner approval"],
    prohibitedActions: ["secret access", "secret print", "token handling", "env secret change"],
    safeNextAction: "Do not inspect or disclose secrets.",
    riskLevel: "critical",
  }),
  gate({
    gateId: "TERRAFUSION_TOUCH_GATE",
    title: "TerraFusion/PACS touch gate",
    category: "TERRAFUSION_PACS",
    level: "owner-decision-required",
    status: "blocked",
    summary: "TerraFusion, PACS, and unrelated containers remain out of scope.",
    requiredOwnerDecision: "Authorize TerraFusion/PACS touch.",
    requiredEvidence: ["External-system scope", "Impact assessment", "Rollback plan"],
    prohibitedActions: ["TerraFusion mutation", "PACS touch", "unrelated container touch"],
    safeNextAction: "Do not touch TerraFusion/PACS.",
    riskLevel: "critical",
  }),
  gate({
    gateId: "DOCKER_METADATA_GATE",
    title: "Docker metadata gate",
    category: "LOCAL_RUNTIME_READ",
    level: "future-explicit-gate-only",
    status: "future-gate",
    summary: "Docker metadata requires named-container-only scope and no socket mutation.",
    requiredOwnerDecision: "Authorize Docker metadata.",
    requiredEvidence: ["Named-container-only rule", "No socket mutation design", "Redaction proof"],
    prohibitedActions: ["Docker socket access", "docker inspect", "container metadata polling"],
    safeNextAction: "Keep Docker metadata hidden.",
    riskLevel: "medium",
  }),
  gate({
    gateId: "BACKUP_METADATA_GATE",
    title: "Backup metadata gate",
    category: "LOCAL_RUNTIME_READ",
    level: "future-explicit-gate-only",
    status: "future-gate",
    summary: "Backup metadata requires metadata-only scope and no backup contents.",
    requiredOwnerDecision: "Authorize backup metadata.",
    requiredEvidence: ["Metadata-only plan", "No backup contents", "Secret exclusion proof"],
    prohibitedActions: ["backup scan", "dump read", "filesystem scan"],
    safeNextAction: "Keep backup metadata manual.",
    riskLevel: "medium",
  }),
  gate({
    gateId: "PORT_STATUS_GATE",
    title: "Port status gate",
    category: "LOCAL_RUNTIME_READ",
    level: "future-explicit-gate-only",
    status: "future-gate",
    summary: "Port checks require no-shell-out design, timeouts, and no host mutation.",
    requiredOwnerDecision: "Authorize port checks.",
    requiredEvidence: ["No shell-out design", "Timeout plan", "No host mutation proof"],
    prohibitedActions: ["OS port scan", "shell-out netstat", "host network mutation"],
    safeNextAction: "Use approved HTTP status only.",
    riskLevel: "medium",
  }),
  gate({
    gateId: "FILESYSTEM_METADATA_GATE",
    title: "Filesystem metadata gate",
    category: "LOCAL_RUNTIME_READ",
    level: "future-explicit-gate-only",
    status: "future-gate",
    summary: "Filesystem metadata requires explicit path scope and secret exclusion.",
    requiredOwnerDecision: "Authorize filesystem metadata.",
    requiredEvidence: ["Path allowlist", "No content scan", "Secret exclusion proof"],
    prohibitedActions: ["filesystem scan", "backup contents read", "secret discovery"],
    safeNextAction: "Do not scan the filesystem.",
    riskLevel: "high",
  }),
  gate({
    gateId: "GITHUB_METADATA_GATE",
    title: "GitHub metadata gate",
    category: "GITHUB_WRITE",
    level: "future-explicit-gate-only",
    status: "future-gate",
    summary: "GitHub metadata/API integration requires explicit read-only scope and no write authority.",
    requiredOwnerDecision: "Authorize GitHub metadata integration.",
    requiredEvidence: ["Read-only API scope", "No write token proof", "Owner approval"],
    prohibitedActions: ["GitHub API write", "PR automation", "merge automation"],
    safeNextAction: "Use recorded PR evidence only.",
    riskLevel: "high",
  }),
  gate({
    gateId: "START_STOP_GATE",
    title: "Start/stop/restart gate",
    category: "LOCAL_RUNTIME_MUTATION",
    level: "owner-decision-required",
    status: "blocked",
    summary: "Start, stop, restart, and repair actions require runtime-control authority.",
    requiredOwnerDecision: "Authorize start/stop/restart.",
    requiredEvidence: ["Manual recovery proof", "Rollback plan", "Owner approval"],
    prohibitedActions: ["start", "stop", "restart", "repair"],
    safeNextAction: "Operator runs runtime commands manually outside WilliamOS.",
    riskLevel: "high",
  }),
  gate({
    gateId: "SERVICE_REGISTRATION_GATE",
    title: "Service registration gate",
    category: "LOCAL_RUNTIME_MUTATION",
    level: "owner-decision-required",
    status: "blocked",
    summary: "Service, startup, and persistence behavior requires explicit authority.",
    requiredOwnerDecision: "Authorize service/startup registration.",
    requiredEvidence: ["Manual stop path", "Logs", "Removal proof"],
    prohibitedActions: ["service registration", "startup item", "persistent service"],
    safeNextAction: "Remain manual-only.",
    riskLevel: "high",
  }),
  gate({
    gateId: "SCHEDULER_GATE",
    title: "Scheduler gate",
    category: "AUTONOMY",
    level: "owner-decision-required",
    status: "blocked",
    summary: "Scheduled tasks and recurring background work require explicit owner authority.",
    requiredOwnerDecision: "Authorize scheduler.",
    requiredEvidence: ["Schedule plan", "Stop/removal plan", "Owner approval"],
    prohibitedActions: ["scheduled task", "cron", "background collection"],
    safeNextAction: "No schedule is created.",
    riskLevel: "high",
  }),
  gate({
    gateId: "LAN_EXPOSURE_GATE",
    title: "LAN exposure gate",
    category: "LAN_EXPOSURE",
    level: "owner-decision-required",
    status: "blocked",
    summary: "LAN, firewall, router, DNS, or 0.0.0.0 binding requires explicit safety authority.",
    requiredOwnerDecision: "Authorize LAN exposure.",
    requiredEvidence: ["Auth posture", "Firewall/router plan", "Rollback plan"],
    prohibitedActions: ["firewall change", "router change", "DNS change", "0.0.0.0 binding"],
    safeNextAction: "Remain localhost-only.",
    riskLevel: "critical",
  }),
  gate({
    gateId: "COMMAND_RUNNER_GATE",
    title: "Command runner gate",
    category: "AUTONOMY",
    level: "owner-decision-required",
    status: "blocked",
    summary: "Command runner or shell bridge would create host-control authority and is blocked.",
    requiredOwnerDecision: "Authorize command runner.",
    requiredEvidence: ["Command doctrine", "Sandbox model", "Audit trail", "Owner approval"],
    prohibitedActions: ["command runner", "shell bridge", "run button", "execute endpoint"],
    safeNextAction: "Show commands only when scoped; operator runs manually.",
    riskLevel: "critical",
  }),
  gate({
    gateId: "DATA_MUTATION_GATE",
    title: "Data mutation gate",
    category: "DB_SCHEMA",
    level: "owner-decision-required",
    status: "blocked",
    summary: "Data write, seed/data mutation, restore, or production DB touch remains blocked.",
    requiredOwnerDecision: "Authorize data mutation.",
    requiredEvidence: ["Backup proof", "Mutation plan", "Rollback plan"],
    prohibitedActions: ["data write", "seed mutation", "production data mutation"],
    safeNextAction: "No data mutation.",
    riskLevel: "critical",
  }),
  gate({
    gateId: "BACKUP_RESTORE_GATE",
    title: "Backup restore gate",
    category: "DB_SCHEMA",
    level: "owner-decision-required",
    status: "blocked",
    summary: "Backup restore and dump reads require explicit DB/schema authority.",
    requiredOwnerDecision: "Authorize backup restore or dump read.",
    requiredEvidence: ["Restore plan", "Target isolation", "Rollback proof"],
    prohibitedActions: ["backup restore", "dump read", "production restore"],
    safeNextAction: "No restore or dump read.",
    riskLevel: "critical",
  }),
  gate({
    gateId: "TOOL_CALL_GATE",
    title: "Tool-call gate",
    category: "AUTONOMY",
    level: "owner-decision-required",
    status: "blocked",
    summary: "Any runtime tool invocation from Council, Hermes, MCP, or workers requires explicit authority.",
    requiredOwnerDecision: "Authorize tool calls.",
    requiredEvidence: ["Tool allowlist", "Audit trail", "Owner approval"],
    prohibitedActions: ["tool invocation", "API action", "external tool call"],
    safeNextAction: "Keep all tool references static.",
    riskLevel: "critical",
  }),
  gate({
    gateId: "AUTONOMOUS_LOOP_GATE",
    title: "Autonomous loop gate",
    category: "AUTONOMY",
    level: "owner-decision-required",
    status: "blocked",
    summary: "Autonomous loops, background debate loops, and recurring agent work remain blocked.",
    requiredOwnerDecision: "Authorize autonomous loop.",
    requiredEvidence: ["Autonomy doctrine", "Stop control", "Owner approval"],
    prohibitedActions: ["autonomous loop", "background debate loop", "agent loop"],
    safeNextAction: "No autonomy.",
    riskLevel: "critical",
  }),
  gate({
    gateId: "OPERATOR_HOST_GATE",
    title: "Runtime operator host gate",
    category: "AUTONOMY",
    level: "owner-decision-required",
    status: "blocked",
    summary: "The native HP OMEN Windows user context is the authorized Phase 1 identity host. Docker is validation-only; GitHub Actions and dedicated Ubuntu hosting are not selectable without a new explicit owner decision.",
    requiredOwnerDecision: "Explicitly name and authorize a replacement operator host.",
    requiredEvidence: ["Host threat boundary", "Credential storage boundary", "Activation and kill-switch proof"],
    prohibitedActions: ["GitHub Actions operator hosting", "Docker identity hosting", "implicit host selection", "concurrent operator hosts"],
    safeNextAction: "Keep the native OMEN operator disabled until owner browser login and keyring gates pass.",
    riskLevel: "critical",
  }),
]

export const BLOCKED_ACTIONS: BlockedActionRecord[] = [
  ["command execution", "Commands require explicit execution authority.", "AUTONOMY", "COMMAND_RUNNER_GATE"],
  ["command runner", "A command runner would create host-control authority.", "AUTONOMY", "COMMAND_RUNNER_GATE"],
  ["GitHub write", "Repository writes require owner authorization.", "GITHUB_WRITE", "GITHUB_METADATA_GATE"],
  ["Codex automation", "Agent execution from UI remains blocked.", "AUTONOMY", "AUTONOMOUS_LOOP_GATE"],
  ["GitHub Actions operator host", "Cloud CI is not an authorized WilliamOS runtime host.", "AUTONOMY", "OPERATOR_HOST_GATE"],
  ["Docker metadata", "Docker metadata expands local runtime visibility.", "LOCAL_RUNTIME_READ", "DOCKER_METADATA_GATE"],
  ["backup scan", "Backup metadata or contents require a separate gate.", "LOCAL_RUNTIME_READ", "BACKUP_METADATA_GATE"],
  ["port checks", "Port checks were deferred from live status.", "LOCAL_RUNTIME_READ", "PORT_STATUS_GATE"],
  ["runtime control", "Runtime control requires owner authority.", "LOCAL_RUNTIME_MUTATION", "LOCAL_RUNTIME_CONTROL_GATE"],
  ["service/scheduler", "Persistence and schedules require explicit owner approval.", "LOCAL_RUNTIME_MUTATION", "SERVICE_REGISTRATION_GATE"],
  ["LAN exposure", "Network exposure requires LAN authority.", "LAN_EXPOSURE", "LAN_EXPOSURE_GATE"],
  ["memory write", "Memory mutation requires memory authority.", "MEMORY_GOVERNANCE", "MEMORY_WRITE_GATE"],
  ["canon promotion", "Canon promotion requires owner review and authority.", "MEMORY_GOVERNANCE", "MEMORY_PROMOTION_GATE"],
  ["Council runtime", "Brain Council may advise but not run.", "COUNCIL_ADVISORY", "COUNCIL_RUNTIME_GATE"],
  ["Hermes/MCP activation", "Hermes and MCP remain blocked.", "AUTONOMY", "HERMES_ACTIVATION_GATE"],
  ["worker activation", "Workers and background loops remain blocked.", "AUTONOMY", "WORKER_ACTIVATION_GATE"],
  ["DB/schema migration", "Schema changes require DB authority.", "DB_SCHEMA", "DB_SCHEMA_CHANGE_GATE"],
  ["cloud setting change", "Cloud config requires cloud authority.", "CLOUD_CONFIG", "CLOUD_SETTING_CHANGE_GATE"],
  ["production deploy", "Deploy and cutover require production authority.", "PRODUCTION_DEPLOY", "PRODUCTION_DEPLOY_GATE"],
  ["TerraFusion/PACS mutation", "External system touch is outside this lane.", "TERRAFUSION_PACS", "TERRAFUSION_TOUCH_GATE"],
].map(([action, reason, requiredAuthority, gateId]) => ({
  action,
  reason,
  requiredAuthority: requiredAuthority as AuthorityCategory,
  gateId: gateId as AuthorityGateId,
  safeDefault: "blocked until owner-approved gate",
}))

export const OWNER_DECISIONS: OwnerDecisionRecord[] = [
  ["authorize limited persistence", "SERVICE_REGISTRATION_GATE", "Pre-persistence backup, rollback plan, service removal plan"],
  ["authorize Docker metadata", "DOCKER_METADATA_GATE", "Named-container-only design, no Docker socket mutation, redaction proof"],
  ["authorize backup metadata", "BACKUP_METADATA_GATE", "Metadata-only plan, no backup contents, no secrets, no schedule"],
  ["authorize port checks", "PORT_STATUS_GATE", "No shell-out design, timeout plan, no host mutation"],
  ["authorize LAN exposure", "LAN_EXPOSURE_GATE", "Firewall/router/DNS plan, auth posture, rollback plan"],
  ["authorize service/startup", "SERVICE_REGISTRATION_GATE", "Manual stop path, logs, rollback/removal proof"],
  ["authorize GitHub write", "GITHUB_METADATA_GATE", "Audit trail, scope, owner approval, no hidden execution"],
  ["authorize production deploy", "PRODUCTION_DEPLOY_GATE", "Production proof, rollback plan, deployment authority"],
  ["authorize DB/schema migration", "DB_SCHEMA_CHANGE_GATE", "Backup proof, migration plan, rollback plan"],
  ["authorize memory write/canon", "MEMORY_WRITE_GATE", "Memory governance proof, sensitivity review, contradiction review"],
  ["authorize Council runtime", "COUNCIL_RUNTIME_GATE", "Council runtime doctrine, tool boundary proof, owner approval"],
  ["authorize autonomy/Hermes/MCP", "HERMES_ACTIVATION_GATE", "Autonomy doctrine, safety model, owner approval"],
  ["authorize secrets handling", "SECRET_ACCESS_GATE", "Redaction, storage, no-print, no-commit rules"],
  ["authorize TerraFusion/PACS touch", "TERRAFUSION_TOUCH_GATE", "Explicit external-system scope and rollback plan"],
].map(([decision, gateId, requiredEvidence]) => ({
  decision,
  gateId: gateId as AuthorityGateId,
  status: "not-granted" as const,
  requiredEvidence,
  safeDefault: "deny by default",
}))

export const WORK_ORDER_AUTHORITY_LINKS: AuthorityLinkRecord[] = [
  {
    label: "WOE detail surfaces",
    authorityId: "authority-read-only-registry",
    gateId: "LOCAL_RUNTIME_METADATA_GATE",
    relatedItem: "WO-WOE-022 through WO-WOE-032",
    description: "Read-only WOE surfaces display scope, evidence, and blockers without execution.",
  },
  {
    label: "Authority refresh batch",
    authorityId: "authority-read-only-registry",
    gateId: "LOCAL_RUNTIME_METADATA_GATE",
    relatedItem: "WO-AUTHORITY-001 through WO-AUTHORITY-017",
    description: "This refresh records gates and links; it does not enforce or mutate them.",
  },
]

export const EVIDENCE_AUTHORITY_LINKS: AuthorityLinkRecord[] = [
  {
    label: "Authority registry proof",
    authorityId: "authority-read-only-registry",
    gateId: "LOCAL_RUNTIME_METADATA_GATE",
    relatedItem: "evidence-authority-governance-registry",
    description: "Evidence supports display of authority records but does not grant authority.",
    safeNextAction: "Use as proof only.",
    prohibitedAction: "Treat evidence as approval.",
  },
  {
    label: "Owner decision proof",
    authorityId: "authority-read-only-registry",
    gateId: "COUNCIL_RUNTIME_GATE",
    relatedItem: "evidence-owner-decision-queue",
    description: "Owner decision evidence explains blockers without approving or denying decisions.",
    safeNextAction: "Keep blocked decisions visible.",
    prohibitedAction: "Mutate decision state.",
  },
  {
    label: "Local runtime freeze proof",
    authorityId: "authority-local-runtime-mutation",
    gateId: "LOCAL_RUNTIME_CONTROL_GATE",
    relatedItem: "evidence-local-omen-status",
    description: "Local OMEN proof supports read-only/manual-only/localhost-only posture.",
    safeNextAction: "Keep local runtime static/read-only.",
    prohibitedAction: "Start, stop, inspect, or expose runtime.",
  },
]

export const OWNER_DECISION_AUTHORITY_LINKS: AuthorityLinkRecord[] = [
  {
    label: "Command execution decision",
    authorityId: "authority-autonomy",
    gateId: "COMMAND_RUNNER_GATE",
    relatedItem: "decision-command-execution",
    description: "Command execution requires explicit owner authority and remains blocked.",
    safeNextAction: "No implementation recommended now.",
    prohibitedAction: "Add run/execute controls.",
  },
  {
    label: "Autonomy decision",
    authorityId: "authority-autonomy",
    gateId: "AUTONOMOUS_LOOP_GATE",
    relatedItem: "decision-autonomy",
    description: "Hermes, MCP, workers, and autonomous loops remain blocked.",
    safeNextAction: "Keep preview/advisory surfaces read-only.",
    prohibitedAction: "Activate autonomy.",
  },
  {
    label: "Metadata decision",
    authorityId: "authority-metadata-expansion",
    gateId: "DOCKER_METADATA_GATE",
    relatedItem: "decision-docker-metadata",
    description: "Metadata expansion needs owner approval, source scope, and safety proof.",
    safeNextAction: "Keep metadata hidden.",
    prohibitedAction: "Read Docker/backup/port metadata.",
  },
]

export const MEMORY_AUTHORITY_LINKS: AuthorityLinkRecord[] = [
  {
    label: "Memory Governance Registry",
    authorityId: "authority-memory-governance",
    gateId: "MEMORY_WRITE_GATE",
    relatedItem: "memory-authority-registry-current",
    description: "Memory can display authority context but cannot authorize action.",
    safeNextAction: "Use static memory context only.",
    prohibitedAction: "Runtime memory read or write.",
  },
  {
    label: "Stale memory warning",
    authorityId: "authority-memory-governance",
    gateId: "MEMORY_PROMOTION_GATE",
    relatedItem: "memory-stale-contradiction-review",
    description: "Stale or contradicted memory needs review before trust.",
    safeNextAction: "Keep stale memory visible as review context.",
    prohibitedAction: "Promote contradicted memory to canon.",
  },
]

export const COUNCIL_AUTHORITY_LINKS: AuthorityLinkRecord[] = [
  {
    label: "Council recommendation authority",
    authorityId: "authority-council-runtime",
    gateId: "COUNCIL_RUNTIME_GATE",
    relatedItem: "council-packet-advisory-next-lane",
    description: "Council may recommend Work Orders but cannot execute or authorize them.",
    safeNextAction: "Treat Council output as advice only.",
    prohibitedAction: "Run Council or execute recommendation.",
  },
  {
    label: "Council authority-needed packet",
    authorityId: "authority-autonomy",
    gateId: "TOOL_CALL_GATE",
    relatedItem: "council-packet-authority-needed",
    description: "Council explicitly points back to authority before any action lane.",
    safeNextAction: "Open a separate authority packet if action is desired.",
    prohibitedAction: "Call tools or dispatch workers.",
  },
]

export const LOCAL_RUNTIME_AUTHORITY_LINKS: AuthorityLinkRecord[] = [
  {
    label: "Local OMEN read-only boundary",
    authorityId: "authority-local-runtime-mutation",
    gateId: "LOCAL_RUNTIME_CONTROL_GATE",
    relatedItem: "WO-LOCAL-120 through WO-LOCAL-124",
    description: "Local status remains read-only, manual-only, and localhost-only.",
    safeNextAction: "Keep runtime control manual.",
    prohibitedAction: "Runtime control, service, scheduler, or LAN exposure.",
  },
  {
    label: "Local metadata blocked",
    authorityId: "authority-metadata-expansion",
    gateId: "LOCAL_RUNTIME_METADATA_GATE",
    relatedItem: "WO-LOCAL-121",
    description: "Docker, backup, and port metadata remain blocked.",
    safeNextAction: "Use recorded status evidence only.",
    prohibitedAction: "Metadata expansion.",
  },
]

export const AUTHORITY_SAFETY_PROOF_CARDS: AuthoritySafetyProofCard[] = [
  ["No approval controls", "blocked", "No approve, deny, grant, or authority mutation controls were added."],
  ["No state mutation", "blocked", "No authority state, permission model, access grant, or auth behavior changed."],
  ["No command execution", "blocked", "No command runner, shell bridge, run button, or execute endpoint was added."],
  ["No runtime control", "blocked", "No start, stop, restart, repair, service, scheduler, LAN, or background control was added."],
  ["No metadata expansion", "blocked", "No Docker metadata, backup scan, port check, filesystem scan, GitHub API, or dynamic graph was added."],
  ["No memory write", "blocked", "No memory write, ingestion, canon promotion, runtime memory read, vector store, or embeddings were added."],
  ["No Council runtime", "blocked", "Brain Council remains advisory and cannot call tools, workers, Hermes, or MCP."],
  ["No production deploy", "blocked", "No production deploy, Vercel/Azure/DNS/cloud/env change, or secret access occurred."],
  ["No DB/schema mutation", "blocked", "No DB/schema migration, data write, backup restore, dump read, or production DB touch occurred."],
  ["No autonomy", "blocked", "No Hermes, MCP, worker activation, autonomous loop, or background collection was added."],
  ["No TerraFusion/PACS touch", "blocked", "No TerraFusion, PACS, or unrelated container touch occurred."],
].map(([label, value, description]) => ({ label, value, description }))

function gates(ids: AuthorityGateId[]): AuthorityGateRecord[] {
  return ids.map((id) => AUTHORITY_GATES.find((gateRecord) => gateRecord.gateId === id) ?? AUTHORITY_GATES[0])
}

export function getAuthorityRegistrySurface(): AuthorityRegistrySurface {
  return {
    doctrine: AUTHORITY_DOCTRINE,
    categories: AUTHORITY_CATEGORIES,
    records: AUTHORITY_RECORDS,
    gates: AUTHORITY_GATES,
    blockedActions: BLOCKED_ACTIONS,
    ownerDecisions: OWNER_DECISIONS,
    workOrderAuthorityLinks: WORK_ORDER_AUTHORITY_LINKS,
    evidenceAuthorityLinks: EVIDENCE_AUTHORITY_LINKS,
    ownerDecisionAuthorityLinks: OWNER_DECISION_AUTHORITY_LINKS,
    memoryAuthorityLinks: MEMORY_AUTHORITY_LINKS,
    councilAuthorityLinks: COUNCIL_AUTHORITY_LINKS,
    localRuntimeAuthorityLinks: LOCAL_RUNTIME_AUTHORITY_LINKS,
    metadataExpansionGates: gates([
      "LOCAL_RUNTIME_METADATA_GATE",
      "DOCKER_METADATA_GATE",
      "BACKUP_METADATA_GATE",
      "PORT_STATUS_GATE",
      "FILESYSTEM_METADATA_GATE",
      "GITHUB_METADATA_GATE",
    ]),
    runtimeControlGates: gates([
      "LOCAL_RUNTIME_CONTROL_GATE",
      "START_STOP_GATE",
      "SERVICE_REGISTRATION_GATE",
      "SCHEDULER_GATE",
      "LAN_EXPOSURE_GATE",
      "COMMAND_RUNNER_GATE",
    ]),
    productionDeployGates: gates([
      "PRODUCTION_DEPLOY_GATE",
      "CLOUD_SETTING_CHANGE_GATE",
      "SECRET_ACCESS_GATE",
    ]),
    dbSchemaGates: gates([
      "DB_SCHEMA_CHANGE_GATE",
      "DATA_MUTATION_GATE",
      "BACKUP_RESTORE_GATE",
      "TERRAFUSION_TOUCH_GATE",
    ]),
    autonomyWorkerGates: gates([
      "COUNCIL_RUNTIME_GATE",
      "HERMES_ACTIVATION_GATE",
      "MCP_ACTIVATION_GATE",
      "WORKER_ACTIVATION_GATE",
      "TOOL_CALL_GATE",
      "AUTONOMOUS_LOOP_GATE",
      "OPERATOR_HOST_GATE",
    ]),
    safetyProofCards: AUTHORITY_SAFETY_PROOF_CARDS,
    ownerOperationEvidence: createOwnerOperationEvidencePlaceholder({
      surface: "authority",
      programId: null,
      goalId: null,
      loopId: null,
      workOrderId: null,
      decisionId: null,
      action: null,
    }),
    navigation: [
      {
        label: "Work Orders",
        href: "/work-orders",
        description: "Inspect scope, allowed work, blocked work, and authority links.",
      },
      {
        label: "Evidence",
        href: "/audit",
        description: "Inspect proof that supports authority boundaries without granting them.",
      },
      {
        label: "Decisions",
        href: "/decisions",
        description: "Inspect blocked owner decisions before authority can expand.",
      },
      {
        label: "Memory",
        href: "/memory",
        description: "Inspect memory governance context without runtime memory reads or writes.",
      },
      {
        label: "Brain Council",
        href: "/brain-council",
        description: "Inspect advisory packets that can recommend but not execute.",
      },
      {
        label: "Runtime",
        href: "/runtime",
        description: "Inspect read-only local/runtime posture without control authority.",
      },
    ],
    nextLaneDecision: {
      recommendedBatch: "WO-SHELL-009 - Memory Placement",
      recommendedOption: "A - Primary shell memory placement",
      blockedLanes: [
        "runtime tracing",
        "background collection",
        "Hermes/MCP/autonomy activation",
        "metadata expansion",
        "runtime control",
        "memory write",
        "dynamic memory retrieval",
      ],
      reason:
        "After Work Orders, Evidence, Systems, and Governance are aligned inside the Primary shell, the next safe shell step is to place Memory as a static governance-aware context surface without adding memory writes, runtime reads, embeddings, or dynamic retrieval.",
    },
    safety: {
      staticReadOnly: true,
      approvalControlsAdded: false,
      authorityStateMutationAdded: false,
      permissionModelChanged: false,
      accessGrantsImplemented: false,
      commandExecutionAdded: false,
      commandRunnerAdded: false,
      githubWriteAdded: false,
      codexAutomationAdded: false,
      councilRuntimeAdded: false,
      hermesActivationAdded: false,
      mcpActivationAdded: false,
      workerActivationAdded: false,
      memoryWriteAdded: false,
      runtimeMemoryReadAdded: false,
      dynamicRetrievalAdded: false,
      vectorStoreAdded: false,
      embeddingsAdded: false,
      dynamicAuthorityIngestionAdded: false,
      dynamicEvidenceIngestionAdded: false,
      filesystemScanAdded: false,
      dockerMetadataAdded: false,
      backupScanAdded: false,
      portChecksAdded: false,
      runtimeControlAdded: false,
      runtimeEnforcementEngineAdded: false,
      authPolicyChanged: false,
      dbSchemaChanged: false,
      dataMutationAdded: false,
      backupRestoreAdded: false,
      packageChanged: false,
      persistenceImplemented: false,
      serviceRegistered: false,
      scheduleCreated: false,
      lanExposureEnabled: false,
      cloudChanged: false,
      productionDeployAdded: false,
      secretsDisclosed: false,
      hermesMcpAutonomyChanged: false,
      autonomyAdded: false,
      terraFusionPacsTouched: false,
      unrelatedContainersTouched: false,
    },
  }
}
