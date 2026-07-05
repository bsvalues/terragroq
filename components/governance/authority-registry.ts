export type AuthorityCategory =
  | "READ_ONLY"
  | "DOCS_ONLY"
  | "UI_COPY_TESTS"
  | "LOCAL_MANUAL_PROOF"
  | "LOCAL_RUNTIME_READ"
  | "LOCAL_RUNTIME_MUTATION"
  | "CONTAINER_CONTROL"
  | "DB_SCHEMA"
  | "PRODUCTION_VERIFY"
  | "PRODUCTION_DEPLOY"
  | "CLOUD_CONFIG"
  | "GITHUB_WRITE"
  | "AUTONOMY"
  | "LAN_EXPOSURE"
  | "SECRET_HANDLING"

export type AuthorityLevel =
  | "allowed-by-current-lane"
  | "blocked-by-default"
  | "owner-decision-required"
  | "future-explicit-gate-only"

export type RiskLevel = "low" | "medium" | "high" | "critical"

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

export type BlockedActionRecord = {
  action: string
  reason: string
  requiredAuthority: AuthorityCategory
  safeDefault: string
}

export type OwnerDecisionRecord = {
  decision: string
  status: "not-granted"
  requiredEvidence: string
  safeDefault: string
}

export type AuthorityLinkRecord = {
  label: string
  authorityId: string
  relatedItem: string
  description: string
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
  blockedActions: BlockedActionRecord[]
  ownerDecisions: OwnerDecisionRecord[]
  workOrderAuthorityLinks: AuthorityLinkRecord[]
  evidenceAuthorityLinks: AuthorityLinkRecord[]
  blockedDecisionAuthorityLinks: AuthorityLinkRecord[]
  safetyProofCards: AuthoritySafetyProofCard[]
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
    commandExecutionAdded: false
    commandRunnerAdded: false
    githubWriteAdded: false
    codexAutomationAdded: false
    dynamicAuthorityIngestionAdded: false
    dynamicEvidenceIngestionAdded: false
    filesystemScanAdded: false
    dockerMetadataAdded: false
    backupScanAdded: false
    portChecksAdded: false
    runtimeEnforcementEngineAdded: false
    permissionModelChanged: false
    authPolicyChanged: false
    dbSchemaChanged: false
    packageChanged: false
    serviceRegistered: false
    scheduleCreated: false
    lanExposureEnabled: false
    cloudChanged: false
    productionDeployAdded: false
    secretsDisclosed: false
    hermesMcpAutonomyChanged: false
    terraFusionPacsTouched: false
    unrelatedContainersTouched: false
  }
}

export const AUTHORITY_DOCTRINE = {
  title: "Authority Doctrine",
  statements: [
    "Authority is explicit.",
    "Mutation requires authority.",
    "Evidence proves completion.",
    "Work Orders define scope.",
    "Blocked decisions preserve safety.",
    "The Primary remains the approving authority.",
    "WilliamOS may display authority state.",
    "WilliamOS must not grant itself authority.",
    "Codex does not self-authorize.",
    "A batch packet may carry bounded authority only inside explicit scope.",
    "Anything outside scope stops.",
  ],
} as const

export const AUTHORITY_CATEGORIES = [
  {
    category: "READ_ONLY",
    level: "allowed-by-current-lane",
    description: "WilliamOS may display existing state, evidence, and posture.",
  },
  {
    category: "DOCS_ONLY",
    level: "allowed-by-current-lane",
    description: "Documentation and report updates are allowed when scoped.",
  },
  {
    category: "UI_COPY_TESTS",
    level: "allowed-by-current-lane",
    description: "Read-only UI, copy, and tests are allowed inside this batch.",
  },
  {
    category: "LOCAL_MANUAL_PROOF",
    level: "future-explicit-gate-only",
    description: "Manual local proof requires an explicit proof Work Order.",
  },
  {
    category: "LOCAL_RUNTIME_READ",
    level: "future-explicit-gate-only",
    description: "Runtime reads require a scoped read-only gate.",
  },
  {
    category: "LOCAL_RUNTIME_MUTATION",
    level: "owner-decision-required",
    description: "Runtime mutation requires explicit owner approval.",
  },
  {
    category: "CONTAINER_CONTROL",
    level: "owner-decision-required",
    description: "Container start, stop, restart, rebuild, or delete remains blocked.",
  },
  {
    category: "DB_SCHEMA",
    level: "owner-decision-required",
    description: "Database schema or migration work requires explicit authority.",
  },
  {
    category: "PRODUCTION_VERIFY",
    level: "blocked-by-default",
    description: "Production verification may be allowed only when scoped as read-only.",
  },
  {
    category: "PRODUCTION_DEPLOY",
    level: "owner-decision-required",
    description: "Production deploy, cutover, or release remains blocked.",
  },
  {
    category: "CLOUD_CONFIG",
    level: "owner-decision-required",
    description: "Azure, Vercel, DNS, and cloud settings changes remain blocked.",
  },
  {
    category: "GITHUB_WRITE",
    level: "owner-decision-required",
    description: "GitHub write actions from the UI or runtime remain blocked.",
  },
  {
    category: "AUTONOMY",
    level: "owner-decision-required",
    description: "Hermes, MCP, agents, schedulers, and autonomous loops remain blocked.",
  },
  {
    category: "LAN_EXPOSURE",
    level: "owner-decision-required",
    description: "LAN or public exposure requires a separate safety gate.",
  },
  {
    category: "SECRET_HANDLING",
    level: "owner-decision-required",
    description: "Secret creation, inspection, printing, or storage requires explicit authority.",
  },
] satisfies AuthorityRegistrySurface["categories"]

export const AUTHORITY_RECORDS: AuthorityRecord[] = [
  {
    authorityId: "authority-read-only-registry",
    title: "Read-only Registry Authority",
    category: "READ_ONLY",
    level: "allowed-by-current-lane",
    scope: "Display authority state, evidence links, blocked decisions, and safety posture.",
    allowedActions: ["Render static registry data", "Show Work Order links", "Show Evidence links"],
    blockedActions: ["Execute commands", "Approve work", "Mutate runtime", "Write GitHub"],
    requiredEvidence: ["WO-AUTHORITY-013 safety sweep", "WO-AUTHORITY-014 rollup"],
    ownerDecisionRequired: false,
    relatedWorkOrders: ["WO-AUTHORITY-001 through WO-AUTHORITY-015"],
    relatedEvidence: ["docs/reports/WO-AUTHORITY-014-authority-registry-evidence-rollup.md"],
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
    relatedWorkOrders: ["WO-LOCAL-120", "WO-AUTHORITY-004", "WO-AUTHORITY-005"],
    relatedEvidence: ["evidence-blocked-runtime-metadata", "evidence-safety-boundary"],
    status: "blocked",
    riskLevel: "high",
  },
  {
    authorityId: "authority-metadata-expansion",
    title: "Metadata Expansion Authority",
    category: "LOCAL_RUNTIME_READ",
    level: "future-explicit-gate-only",
    scope: "Docker metadata, backup metadata, port checks, filesystem reads, or dynamic ingestion.",
    allowedActions: ["None in this batch"],
    blockedActions: ["Docker metadata", "Backup scan", "Port checks", "Filesystem scan"],
    requiredEvidence: ["Specific metadata gate", "Redaction plan", "Safety regression"],
    ownerDecisionRequired: true,
    relatedWorkOrders: ["WO-EVIDENCE-010", "WO-AUTHORITY-004", "WO-AUTHORITY-005"],
    relatedEvidence: ["evidence-blocked-runtime-metadata"],
    status: "future-gate",
    riskLevel: "medium",
  },
  {
    authorityId: "authority-production-change",
    title: "Production / Cloud Change Authority",
    category: "PRODUCTION_DEPLOY",
    level: "owner-decision-required",
    scope: "Production deploy, Vercel/Azure/DNS settings, cloud config, or cutover.",
    allowedActions: ["None in this batch"],
    blockedActions: ["Production deploy", "Cloud config", "DNS change", "Vercel settings change"],
    requiredEvidence: ["Production verification", "Rollback plan", "Owner approval"],
    ownerDecisionRequired: true,
    relatedWorkOrders: ["WO-AUTHORITY-004", "WO-AUTHORITY-005"],
    relatedEvidence: ["evidence-production-proof"],
    status: "blocked",
    riskLevel: "critical",
  },
  {
    authorityId: "authority-db-schema",
    title: "Database / Schema Authority",
    category: "DB_SCHEMA",
    level: "owner-decision-required",
    scope: "DB creation, migration, schema mutation, seed/data mutation, or restore.",
    allowedActions: ["None in this batch"],
    blockedActions: ["DB/schema migration", "Backup restore", "Production data mutation"],
    requiredEvidence: ["Backup proof", "Migration plan", "Rollback plan", "Owner approval"],
    ownerDecisionRequired: true,
    relatedWorkOrders: ["WO-AUTHORITY-004", "WO-AUTHORITY-005"],
    relatedEvidence: ["evidence-safety-boundary"],
    status: "blocked",
    riskLevel: "critical",
  },
  {
    authorityId: "authority-github-write",
    title: "GitHub Write Authority",
    category: "GITHUB_WRITE",
    level: "owner-decision-required",
    scope: "GitHub write integration, PR creation/merge from UI, branch mutation, or automation.",
    allowedActions: ["None in this batch"],
    blockedActions: ["GitHub write from UI", "Codex automation from UI", "Run batch button"],
    requiredEvidence: ["Authority packet", "Audit trail", "Owner approval"],
    ownerDecisionRequired: true,
    relatedWorkOrders: ["WO-AUTHORITY-004", "WO-AUTHORITY-005"],
    relatedEvidence: ["evidence-woe-detail-surfaces"],
    status: "blocked",
    riskLevel: "high",
  },
  {
    authorityId: "authority-autonomy",
    title: "Hermes / MCP / Autonomy Authority",
    category: "AUTONOMY",
    level: "owner-decision-required",
    scope: "Hermes activation, MCP activation, autonomous loops, workers, and background actions.",
    allowedActions: ["None in this batch"],
    blockedActions: ["Hermes activation", "MCP activation", "Autonomous execution", "Background loop"],
    requiredEvidence: ["Doctrine gate", "Control boundary proof", "Owner approval"],
    ownerDecisionRequired: true,
    relatedWorkOrders: ["WO-AUTHORITY-004", "WO-AUTHORITY-005"],
    relatedEvidence: ["evidence-safety-boundary"],
    status: "blocked",
    riskLevel: "critical",
  },
  {
    authorityId: "authority-secret-handling",
    title: "Secret Handling Authority",
    category: "SECRET_HANDLING",
    level: "owner-decision-required",
    scope: "Secret creation, inspection, disclosure, storage, printing, or transfer.",
    allowedActions: ["None in this batch"],
    blockedActions: ["Secret inspection", "Secret printing", "Committed env files", "Token handling"],
    requiredEvidence: ["Secret-handling plan", "Redaction proof", "Owner approval"],
    ownerDecisionRequired: true,
    relatedWorkOrders: ["WO-AUTHORITY-004", "WO-AUTHORITY-005"],
    relatedEvidence: ["evidence-safety-boundary"],
    status: "blocked",
    riskLevel: "critical",
  },
]

export const BLOCKED_ACTIONS: BlockedActionRecord[] = [
  ["command execution", "Commands require explicit execution authority.", "AUTONOMY"],
  ["command runner", "A command runner would create a mutation path.", "AUTONOMY"],
  ["GitHub write integration", "Repository writes require owner authorization.", "GITHUB_WRITE"],
  ["Codex automation", "Agent execution from UI remains blocked.", "AUTONOMY"],
  ["Docker metadata", "Docker metadata expands local runtime visibility.", "LOCAL_RUNTIME_READ"],
  ["backup scanning", "Backup metadata or contents require a separate gate.", "LOCAL_RUNTIME_READ"],
  ["port checks", "Port checks were deferred from live status.", "LOCAL_RUNTIME_READ"],
  ["filesystem scan", "Filesystem scanning is dynamic ingestion.", "LOCAL_RUNTIME_READ"],
  ["dynamic ingestion", "Ingestion would change evidence/authority from static to live.", "READ_ONLY"],
  ["DB/schema mutation", "Schema changes require DB authority.", "DB_SCHEMA"],
  ["production deploy", "Deploy and cutover require production authority.", "PRODUCTION_DEPLOY"],
  ["cloud setting changes", "Cloud config requires cloud authority.", "CLOUD_CONFIG"],
  ["LAN exposure", "Network exposure requires LAN authority.", "LAN_EXPOSURE"],
  ["service/schedule creation", "Persistence requires explicit owner approval.", "LOCAL_RUNTIME_MUTATION"],
  ["secrets disclosure", "Secret handling requires an explicit secret authority packet.", "SECRET_HANDLING"],
  ["Hermes/MCP/autonomy activation", "Autonomy remains blocked.", "AUTONOMY"],
  ["TerraFusion/PACS touch", "External system touch is outside this lane.", "LOCAL_RUNTIME_MUTATION"],
  ["unrelated container touch", "Unrelated Docker resources are out of scope.", "CONTAINER_CONTROL"],
].map(([action, reason, requiredAuthority]) => ({
  action,
  reason,
  requiredAuthority: requiredAuthority as AuthorityCategory,
  safeDefault: "blocked until owner-approved gate",
}))

export const OWNER_DECISIONS: OwnerDecisionRecord[] = [
  ["authorize limited persistence", "Pre-persistence backup, rollback plan, service removal plan"],
  ["authorize Docker metadata", "Named-container-only design, no Docker socket mutation, redaction proof"],
  ["authorize backup metadata", "Metadata-only plan, no backup contents, no secrets, no schedule"],
  ["authorize port checks", "No shell-out design, timeout plan, no host mutation"],
  ["authorize LAN exposure", "Firewall/router/DNS plan, auth posture, rollback plan"],
  ["authorize service/startup", "Manual stop path, logs, rollback/removal proof"],
  ["authorize GitHub write", "Audit trail, scope, owner approval, no hidden execution"],
  ["authorize production deploy", "Production proof, rollback plan, deployment authority"],
  ["authorize DB/schema migration", "Backup proof, migration plan, rollback plan"],
  ["authorize autonomy/Hermes/MCP", "Autonomy doctrine, safety model, owner approval"],
  ["authorize secrets handling", "Redaction, storage, no-print, no-commit rules"],
  ["authorize TerraFusion/PACS touch", "Explicit external-system scope and rollback plan"],
].map(([decision, requiredEvidence]) => ({
  decision,
  status: "not-granted" as const,
  requiredEvidence,
  safeDefault: "deny by default",
}))

export const WORK_ORDER_AUTHORITY_LINKS: AuthorityLinkRecord[] = [
  {
    label: "WOE detail surfaces",
    authorityId: "authority-read-only-registry",
    relatedItem: "WO-WOE-022 through WO-WOE-032",
    description: "Read-only WOE surfaces used display authority but did not add execution.",
  },
  {
    label: "Evidence Spine",
    authorityId: "authority-read-only-registry",
    relatedItem: "WO-EVIDENCE-001 through WO-EVIDENCE-014",
    description: "Evidence was classified and displayed under static read-only authority.",
  },
  {
    label: "Local metadata gate",
    authorityId: "authority-metadata-expansion",
    relatedItem: "WO-LOCAL-120",
    description: "Metadata expansion remains blocked until a future explicit gate.",
  },
]

export const EVIDENCE_AUTHORITY_LINKS: AuthorityLinkRecord[] = [
  {
    label: "Evidence safety boundary",
    authorityId: "authority-read-only-registry",
    relatedItem: "evidence-safety-boundary",
    description: "Safety proof supports the read-only registry posture.",
  },
  {
    label: "Blocked runtime metadata",
    authorityId: "authority-metadata-expansion",
    relatedItem: "evidence-blocked-runtime-metadata",
    description: "Blocked metadata evidence explains why Docker, backup, and port expansion remain gated.",
  },
  {
    label: "Production proof boundary",
    authorityId: "authority-production-change",
    relatedItem: "evidence-production-proof",
    description: "Production proof can be displayed without authorizing production mutation.",
  },
]

export const BLOCKED_DECISION_AUTHORITY_LINKS: AuthorityLinkRecord[] = [
  {
    label: "Runtime control blocked",
    authorityId: "authority-local-runtime-mutation",
    relatedItem: "Blocked Decision: Runtime control not authorized",
    description: "Start, stop, restart, repair, persist, schedule, or expose runtime requires owner authority.",
  },
  {
    label: "Autonomy blocked",
    authorityId: "authority-autonomy",
    relatedItem: "Blocked Decision: Autonomy not authorized",
    description: "Hermes, MCP, workers, and autonomous loops remain blocked.",
  },
  {
    label: "Secret handling blocked",
    authorityId: "authority-secret-handling",
    relatedItem: "Blocked Decision: Secrets not authorized",
    description: "Secret inspection, disclosure, and committed env files remain blocked.",
  },
]

export const AUTHORITY_SAFETY_PROOF_CARDS: AuthoritySafetyProofCard[] = [
  ["No command execution", "blocked", "No UI/API command execution was added."],
  ["No Docker metadata", "blocked", "No Docker metadata, socket, or command integration was added."],
  ["No backup scan", "blocked", "No backup metadata or contents were scanned."],
  ["No port checks", "blocked", "No port status checks were added."],
  ["No persistence", "blocked", "No service, startup item, schedule, or persistence was added."],
  ["No LAN exposure", "blocked", "No firewall, router, DNS, LAN, or public exposure was added."],
  ["No GitHub write", "blocked", "No GitHub write action or PR automation was added."],
  ["No autonomy", "blocked", "No Hermes, MCP, background worker, or autonomous loop was activated."],
  ["No TerraFusion/PACS touch", "blocked", "No TerraFusion, PACS, or unrelated container touch occurred."],
].map(([label, value, description]) => ({ label, value, description }))

export function getAuthorityRegistrySurface(): AuthorityRegistrySurface {
  return {
    doctrine: AUTHORITY_DOCTRINE,
    categories: AUTHORITY_CATEGORIES,
    records: AUTHORITY_RECORDS,
    blockedActions: BLOCKED_ACTIONS,
    ownerDecisions: OWNER_DECISIONS,
    workOrderAuthorityLinks: WORK_ORDER_AUTHORITY_LINKS,
    evidenceAuthorityLinks: EVIDENCE_AUTHORITY_LINKS,
    blockedDecisionAuthorityLinks: BLOCKED_DECISION_AUTHORITY_LINKS,
    safetyProofCards: AUTHORITY_SAFETY_PROOF_CARDS,
    navigation: [
      {
        label: "Work Orders",
        href: "/work-orders",
        description: "Inspect scope, allowed work, blocked work, and authority links.",
      },
      {
        label: "Evidence",
        href: "/audit",
        description: "Inspect proof that supports authority boundaries.",
      },
      {
        label: "Decisions",
        href: "/decisions",
        description: "Inspect blocked owner decisions before authority can expand.",
      },
      {
        label: "Runtime",
        href: "/runtime",
        description: "Inspect read-only local/runtime posture without control authority.",
      },
    ],
    nextLaneDecision: {
      recommendedBatch: "WILLIAMOS-OWNER-DECISION-QUEUE-BATCH-001",
      recommendedOption: "D - Owner decision queue surface",
      blockedLanes: [
        "Hermes/MCP/autonomy activation",
        "Command execution",
        "Runtime mutation",
        "Local metadata expansion",
      ],
      reason:
        "After authority records exist, the next useful read-only layer is a queue that makes unresolved owner decisions inspectable without granting approval controls.",
    },
    safety: {
      staticReadOnly: true,
      commandExecutionAdded: false,
      commandRunnerAdded: false,
      githubWriteAdded: false,
      codexAutomationAdded: false,
      dynamicAuthorityIngestionAdded: false,
      dynamicEvidenceIngestionAdded: false,
      filesystemScanAdded: false,
      dockerMetadataAdded: false,
      backupScanAdded: false,
      portChecksAdded: false,
      runtimeEnforcementEngineAdded: false,
      permissionModelChanged: false,
      authPolicyChanged: false,
      dbSchemaChanged: false,
      packageChanged: false,
      serviceRegistered: false,
      scheduleCreated: false,
      lanExposureEnabled: false,
      cloudChanged: false,
      productionDeployAdded: false,
      secretsDisclosed: false,
      hermesMcpAutonomyChanged: false,
      terraFusionPacsTouched: false,
      unrelatedContainersTouched: false,
    },
  }
}
