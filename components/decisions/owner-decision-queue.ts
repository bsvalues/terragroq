import type { AuthorityCategory, RiskLevel } from "@/components/governance/authority-registry"

export type OwnerDecisionCategory =
  | "LOCAL_RUNTIME"
  | "PERSISTENCE"
  | "LAN_EXPOSURE"
  | "DOCKER_METADATA"
  | "BACKUP_METADATA"
  | "PORT_CHECKS"
  | "COMMAND_EXECUTION"
  | "GITHUB_WRITE"
  | "CODEX_AUTOMATION"
  | "DB_SCHEMA"
  | "PRODUCTION_DEPLOY"
  | "CLOUD_CONFIG"
  | "SECRET_HANDLING"
  | "AUTONOMY"
  | "TERRAFUSION_PACS_TOUCH"

export type OwnerDecisionState =
  | "BLOCKED"
  | "READY_FOR_REVIEW"
  | "NEEDS_EVIDENCE"
  | "EXPLICITLY_DECLINED"
  | "PARKED"
  | "APPROVED_OUT_OF_BAND"

export type OwnerDecisionRecord = {
  decisionId: string
  title: string
  category: OwnerDecisionCategory
  status: OwnerDecisionState
  riskLevel: RiskLevel
  blockedLane: string
  whyBlocked: string
  authorityRequired: AuthorityCategory
  evidenceRequired: string[]
  relatedAuthorityRecords: string[]
  relatedEvidenceRecords: string[]
  relatedWorkOrders: string[]
  safeDefault: string
  ownerActionRequired: string
  nextValidAction: string
  blockedActions: string[]
}

export type DecisionLinkRecord = {
  label: string
  decisionId: string
  relatedItem: string
  description: string
}

export type DecisionSafetyProofCard = {
  label: string
  value: string
  description: string
}

export type OwnerDecisionQueueSurface = {
  doctrine: {
    title: string
    statements: readonly string[]
  }
  categories: {
    category: OwnerDecisionCategory
    description: string
  }[]
  states: {
    state: OwnerDecisionState
    description: string
  }[]
  pendingDecisions: OwnerDecisionRecord[]
  detailDecision: OwnerDecisionRecord
  authorityDecisionLinks: DecisionLinkRecord[]
  evidenceDecisionLinks: DecisionLinkRecord[]
  workOrderDecisionLinks: DecisionLinkRecord[]
  blockedDecisionUx: {
    title: string
    statements: string[]
  }
  safetyProofCards: DecisionSafetyProofCard[]
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
    denyControlsAdded: false
    authorizeControlsAdded: false
    stateMutationAdded: false
    mutationControlsAdded: false
    commandExecutionAdded: false
    commandRunnerAdded: false
    githubWriteAdded: false
    codexAutomationAdded: false
    dynamicIngestionAdded: false
    filesystemScanAdded: false
    dockerMetadataAdded: false
    backupScanAdded: false
    portChecksAdded: false
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

export const OWNER_DECISION_DOCTRINE = {
  title: "Owner Decision Queue Doctrine",
  statements: [
    "Owner decisions are visible.",
    "Owner decisions are not self-granted.",
    "A decision may be prepared, explained, linked, categorized, and evidenced.",
    "A decision may not be executed by the queue.",
    "The Primary remains the approving authority.",
    "WilliamOS may show what is blocked.",
    "WilliamOS must not approve itself.",
    "Codex must not approve itself.",
    "A queued decision is not permission.",
    "The queue is read-only.",
    "The queue does not approve.",
    "The queue does not deny.",
    "The queue does not authorize.",
    "The queue does not execute.",
    "The queue does not mutate.",
  ],
} as const

export const OWNER_DECISION_CATEGORIES = [
  {
    category: "LOCAL_RUNTIME",
    description: "Local runtime reads or mutation beyond static display.",
  },
  {
    category: "PERSISTENCE",
    description: "Service, startup, schedule, or persistent runtime behavior.",
  },
  {
    category: "LAN_EXPOSURE",
    description: "LAN, firewall, router, DNS, or public exposure decisions.",
  },
  {
    category: "DOCKER_METADATA",
    description: "Docker metadata reads, socket access, or container inspection.",
  },
  {
    category: "BACKUP_METADATA",
    description: "Backup metadata reads, backup contents, or backup scanning.",
  },
  {
    category: "PORT_CHECKS",
    description: "Port checks or host network status beyond approved HTTP checks.",
  },
  {
    category: "COMMAND_EXECUTION",
    description: "Any command execution path or command runner.",
  },
  {
    category: "GITHUB_WRITE",
    description: "GitHub write actions, PR automation, or merge automation.",
  },
  {
    category: "CODEX_AUTOMATION",
    description: "Codex or agent automation initiated from WilliamOS surfaces.",
  },
  {
    category: "DB_SCHEMA",
    description: "Database creation, migration, schema mutation, restore, or production data mutation.",
  },
  {
    category: "PRODUCTION_DEPLOY",
    description: "Production deploy, cutover, release, or production-write behavior.",
  },
  {
    category: "CLOUD_CONFIG",
    description: "Azure, Vercel, DNS, cloud settings, or connection-string changes.",
  },
  {
    category: "SECRET_HANDLING",
    description: "Secret creation, inspection, printing, storage, or transfer.",
  },
  {
    category: "AUTONOMY",
    description: "Hermes, MCP, Brain Council action, background workers, or autonomous loops.",
  },
  {
    category: "TERRAFUSION_PACS_TOUCH",
    description: "Any touch of TerraFusion, PACS, or unrelated container resources.",
  },
] satisfies OwnerDecisionQueueSurface["categories"]

export const OWNER_DECISION_STATES = [
  {
    state: "BLOCKED",
    description: "Protected by default; owner decision required before work can proceed.",
  },
  {
    state: "READY_FOR_REVIEW",
    description: "Evidence is present, but no authority is granted by the queue.",
  },
  {
    state: "NEEDS_EVIDENCE",
    description: "Decision cannot be reviewed until required proof exists.",
  },
  {
    state: "EXPLICITLY_DECLINED",
    description: "Owner declined the lane or action; no work may proceed.",
  },
  {
    state: "PARKED",
    description: "Decision is intentionally deferred.",
  },
  {
    state: "APPROVED_OUT_OF_BAND",
    description:
      "Approval exists outside this static queue; this queue does not approve and the approval must still be represented by a separate Work Order.",
  },
] satisfies OwnerDecisionQueueSurface["states"]

function decision(input: OwnerDecisionRecord): OwnerDecisionRecord {
  return input
}

export const PENDING_OWNER_DECISIONS: OwnerDecisionRecord[] = [
  decision({
    decisionId: "decision-limited-omen-persistence",
    title: "Authorize limited OMEN persistence",
    category: "PERSISTENCE",
    status: "PARKED",
    riskLevel: "high",
    blockedLane: "LOCAL-OMEN-PERSISTENCE-IMPLEMENTATION",
    whyBlocked: "Manual-only posture is stable; persistence would create durable runtime behavior.",
    authorityRequired: "LOCAL_RUNTIME_MUTATION",
    evidenceRequired: ["Pre-persistence backup", "Rollback/removal plan", "Service stop procedure"],
    relatedAuthorityRecords: ["authority-local-runtime-mutation"],
    relatedEvidenceRecords: ["evidence-local-omen-status", "evidence-safety-boundary"],
    relatedWorkOrders: ["WO-LOCAL-031 through WO-LOCAL-036"],
    safeDefault: "Remain manual-only.",
    ownerActionRequired: "Explicitly approve or continue parked posture.",
    nextValidAction: "Create a persistence implementation gate only if owner approves.",
    blockedActions: ["service registration", "startup item", "scheduled task", "automatic startup"],
  }),
  decision({
    decisionId: "decision-docker-metadata",
    title: "Authorize Docker metadata reads",
    category: "DOCKER_METADATA",
    status: "BLOCKED",
    riskLevel: "medium",
    blockedLane: "LOCAL-OMEN-DOCKER-METADATA-GATE",
    whyBlocked: "Docker metadata expands the read model beyond static status and HTTP checks.",
    authorityRequired: "LOCAL_RUNTIME_READ",
    evidenceRequired: ["Named-container-only rule", "No socket mutation design", "Redaction plan"],
    relatedAuthorityRecords: ["authority-metadata-expansion"],
    relatedEvidenceRecords: ["evidence-blocked-runtime-metadata"],
    relatedWorkOrders: ["WO-LOCAL-120", "WO-AUTHORITY-004"],
    safeDefault: "Keep Docker metadata hidden.",
    ownerActionRequired: "Approve a Docker metadata gate or leave blocked.",
    nextValidAction: "Create a Docker metadata gate packet if needed.",
    blockedActions: ["Docker socket access", "docker inspect", "container metadata polling"],
  }),
  decision({
    decisionId: "decision-backup-metadata",
    title: "Authorize backup metadata reads",
    category: "BACKUP_METADATA",
    status: "BLOCKED",
    riskLevel: "medium",
    blockedLane: "LOCAL-OMEN-BACKUP-METADATA-GATE",
    whyBlocked: "Backup metadata can drift into filesystem scanning or secret exposure.",
    authorityRequired: "LOCAL_RUNTIME_READ",
    evidenceRequired: ["Metadata-only plan", "No backup contents", "Secret exclusion proof"],
    relatedAuthorityRecords: ["authority-metadata-expansion"],
    relatedEvidenceRecords: ["evidence-blocked-runtime-metadata"],
    relatedWorkOrders: ["WO-LOCAL-120", "WO-AUTHORITY-005"],
    safeDefault: "Keep backup metadata manual.",
    ownerActionRequired: "Approve a metadata-only backup gate or leave blocked.",
    nextValidAction: "Create a backup metadata gate packet if needed.",
    blockedActions: ["backup scan", "dump read", "filesystem scan"],
  }),
  decision({
    decisionId: "decision-port-checks",
    title: "Authorize port checks",
    category: "PORT_CHECKS",
    status: "BLOCKED",
    riskLevel: "medium",
    blockedLane: "LOCAL-OMEN-PORT-STATUS-GATE",
    whyBlocked: "Port checks were deferred from the first live status slice.",
    authorityRequired: "LOCAL_RUNTIME_READ",
    evidenceRequired: ["No shell-out design", "Timeout plan", "No host mutation proof"],
    relatedAuthorityRecords: ["authority-metadata-expansion"],
    relatedEvidenceRecords: ["evidence-blocked-runtime-metadata"],
    relatedWorkOrders: ["WO-LOCAL-120"],
    safeDefault: "Use HTTP status only.",
    ownerActionRequired: "Approve a port status gate or leave blocked.",
    nextValidAction: "Create a port status gate packet if needed.",
    blockedActions: ["OS port scan", "shell-out netstat", "host network mutation"],
  }),
  decision({
    decisionId: "decision-lan-exposure",
    title: "Authorize LAN exposure",
    category: "LAN_EXPOSURE",
    status: "BLOCKED",
    riskLevel: "critical",
    blockedLane: "LOCAL-LAN-ACCESS",
    whyBlocked: "WilliamOS remains localhost-only; LAN exposure changes threat posture.",
    authorityRequired: "LAN_EXPOSURE",
    evidenceRequired: ["Auth posture", "Firewall/router plan", "Rollback plan"],
    relatedAuthorityRecords: ["authority-local-runtime-mutation"],
    relatedEvidenceRecords: ["evidence-safety-boundary"],
    relatedWorkOrders: ["WO-LOCAL-020"],
    safeDefault: "Remain localhost-only.",
    ownerActionRequired: "Approve a LAN exposure safety gate or leave blocked.",
    nextValidAction: "Create a LAN access safety gate if needed.",
    blockedActions: ["firewall change", "router change", "DNS change", "0.0.0.0 binding"],
  }),
  decision({
    decisionId: "decision-service-startup",
    title: "Authorize service/startup registration",
    category: "PERSISTENCE",
    status: "BLOCKED",
    riskLevel: "high",
    blockedLane: "LOCAL-PERSISTENT-SERVICE",
    whyBlocked: "Service registration would make WilliamOS durable on the host.",
    authorityRequired: "LOCAL_RUNTIME_MUTATION",
    evidenceRequired: ["Manual stop path", "Log path", "Rollback/removal proof"],
    relatedAuthorityRecords: ["authority-local-runtime-mutation"],
    relatedEvidenceRecords: ["evidence-safety-boundary"],
    relatedWorkOrders: ["WO-LOCAL-033", "WO-AUTHORITY-005"],
    safeDefault: "Manual-only operation.",
    ownerActionRequired: "Approve a persistence implementation gate or leave blocked.",
    nextValidAction: "Create a service/startup implementation packet if approved.",
    blockedActions: ["service registration", "startup item", "scheduled task"],
  }),
  decision({
    decisionId: "decision-command-execution",
    title: "Authorize command execution",
    category: "COMMAND_EXECUTION",
    status: "BLOCKED",
    riskLevel: "critical",
    blockedLane: "COMMAND-EXECUTION",
    whyBlocked: "Command execution would turn WilliamOS from guidance into a host-control surface.",
    authorityRequired: "AUTONOMY",
    evidenceRequired: ["Command doctrine", "Sandbox model", "Owner approval", "Audit trail"],
    relatedAuthorityRecords: ["authority-autonomy"],
    relatedEvidenceRecords: ["evidence-safety-boundary"],
    relatedWorkOrders: ["WO-AUTHORITY-004", "WO-AUTHORITY-013"],
    safeDefault: "Show commands only; operator runs them manually.",
    ownerActionRequired: "Explicitly approve a command execution doctrine gate or leave blocked.",
    nextValidAction: "No implementation recommended now.",
    blockedActions: ["command runner", "shell bridge", "run button", "execute endpoint"],
  }),
  decision({
    decisionId: "decision-github-write",
    title: "Authorize GitHub write integration",
    category: "GITHUB_WRITE",
    status: "BLOCKED",
    riskLevel: "high",
    blockedLane: "GITHUB-WRITE",
    whyBlocked: "GitHub writes from the UI would mutate branches, PRs, or repo state.",
    authorityRequired: "GITHUB_WRITE",
    evidenceRequired: ["Audit trail", "Scope model", "Owner approval", "Rollback posture"],
    relatedAuthorityRecords: ["authority-github-write"],
    relatedEvidenceRecords: ["evidence-woe-detail-surfaces"],
    relatedWorkOrders: ["WO-AUTHORITY-005"],
    safeDefault: "Keep GitHub writes in operator/Codex workflows only.",
    ownerActionRequired: "Approve a GitHub write gate or leave blocked.",
    nextValidAction: "No implementation recommended now.",
    blockedActions: ["PR creation from UI", "merge from UI", "branch mutation"],
  }),
  decision({
    decisionId: "decision-codex-automation",
    title: "Authorize Codex automation",
    category: "CODEX_AUTOMATION",
    status: "BLOCKED",
    riskLevel: "critical",
    blockedLane: "CODEX-AUTOMATION",
    whyBlocked: "Codex automation from UI would create agent execution without a live owner handoff.",
    authorityRequired: "AUTONOMY",
    evidenceRequired: ["Agent boundary doctrine", "Owner approval", "Audit proof"],
    relatedAuthorityRecords: ["authority-autonomy"],
    relatedEvidenceRecords: ["evidence-safety-boundary"],
    relatedWorkOrders: ["WO-AUTHORITY-005"],
    safeDefault: "Owner continues to authorize Codex work in chat packets.",
    ownerActionRequired: "Approve an agent automation gate or leave blocked.",
    nextValidAction: "No implementation recommended now.",
    blockedActions: ["run Codex button", "batch automation", "background agent loop"],
  }),
  decision({
    decisionId: "decision-db-schema",
    title: "Authorize DB/schema migration",
    category: "DB_SCHEMA",
    status: "BLOCKED",
    riskLevel: "critical",
    blockedLane: "DB-SCHEMA",
    whyBlocked: "Schema migration or data mutation can affect recoverability and production posture.",
    authorityRequired: "DB_SCHEMA",
    evidenceRequired: ["Backup proof", "Migration plan", "Rollback plan", "Owner approval"],
    relatedAuthorityRecords: ["authority-db-schema"],
    relatedEvidenceRecords: ["evidence-safety-boundary"],
    relatedWorkOrders: ["WO-AUTHORITY-005"],
    safeDefault: "No schema change.",
    ownerActionRequired: "Approve a DB/schema gate or leave blocked.",
    nextValidAction: "Create a DB/schema authority packet if needed.",
    blockedActions: ["migration", "schema mutation", "backup restore", "seed/data mutation"],
  }),
  decision({
    decisionId: "decision-production-deploy",
    title: "Authorize production deploy",
    category: "PRODUCTION_DEPLOY",
    status: "BLOCKED",
    riskLevel: "critical",
    blockedLane: "PRODUCTION-DEPLOY",
    whyBlocked: "Production deploy, cutover, or release changes live user-facing behavior.",
    authorityRequired: "PRODUCTION_DEPLOY",
    evidenceRequired: ["Validation proof", "Production verification", "Rollback plan"],
    relatedAuthorityRecords: ["authority-production-change"],
    relatedEvidenceRecords: ["evidence-production-proof"],
    relatedWorkOrders: ["WO-AUTHORITY-005"],
    safeDefault: "No deploy.",
    ownerActionRequired: "Approve a production deploy gate or leave blocked.",
    nextValidAction: "Create a production deploy authority packet if needed.",
    blockedActions: ["production deploy", "release", "tag", "cutover"],
  }),
  decision({
    decisionId: "decision-cloud-config",
    title: "Authorize cloud config changes",
    category: "CLOUD_CONFIG",
    status: "BLOCKED",
    riskLevel: "critical",
    blockedLane: "CLOUD-CONFIG",
    whyBlocked: "Cloud settings, Vercel, Azure, DNS, and connection strings can alter production posture.",
    authorityRequired: "CLOUD_CONFIG",
    evidenceRequired: ["Config plan", "Rollback plan", "Owner approval"],
    relatedAuthorityRecords: ["authority-production-change"],
    relatedEvidenceRecords: ["evidence-production-proof"],
    relatedWorkOrders: ["WO-AUTHORITY-004", "WO-AUTHORITY-005"],
    safeDefault: "No cloud setting change.",
    ownerActionRequired: "Approve a cloud config gate or leave blocked.",
    nextValidAction: "Create a cloud config authority packet if needed.",
    blockedActions: ["Azure setting", "Vercel setting", "DNS change", "connection string"],
  }),
  decision({
    decisionId: "decision-secrets-handling",
    title: "Authorize secrets handling",
    category: "SECRET_HANDLING",
    status: "BLOCKED",
    riskLevel: "critical",
    blockedLane: "SECRET-HANDLING",
    whyBlocked: "Secret handling can disclose credentials or create unsafe storage paths.",
    authorityRequired: "SECRET_HANDLING",
    evidenceRequired: ["Redaction rules", "No-print policy", "Storage plan", "Owner approval"],
    relatedAuthorityRecords: ["authority-secret-handling"],
    relatedEvidenceRecords: ["evidence-safety-boundary"],
    relatedWorkOrders: ["WO-AUTHORITY-005"],
    safeDefault: "No secret inspection or disclosure.",
    ownerActionRequired: "Approve a secret handling gate or leave blocked.",
    nextValidAction: "Create a secret handling authority packet if needed.",
    blockedActions: ["secret print", "secret commit", "token handling", "env disclosure"],
  }),
  decision({
    decisionId: "decision-autonomy",
    title: "Authorize Hermes/MCP/autonomy activation",
    category: "AUTONOMY",
    status: "BLOCKED",
    riskLevel: "critical",
    blockedLane: "AUTONOMY",
    whyBlocked: "Autonomy activation would allow background or agentic behavior beyond read-only guidance.",
    authorityRequired: "AUTONOMY",
    evidenceRequired: ["Autonomy doctrine", "Control boundary proof", "Owner approval"],
    relatedAuthorityRecords: ["authority-autonomy"],
    relatedEvidenceRecords: ["evidence-safety-boundary"],
    relatedWorkOrders: ["WO-AUTHORITY-005"],
    safeDefault: "Hermes/MCP/autonomy remain parked.",
    ownerActionRequired: "Approve an autonomy doctrine gate or leave blocked.",
    nextValidAction: "No activation recommended now.",
    blockedActions: ["Hermes activation", "MCP activation", "background worker", "autonomous loop"],
  }),
  decision({
    decisionId: "decision-terrafusion-pacs-touch",
    title: "Authorize TerraFusion/PACS touch",
    category: "TERRAFUSION_PACS_TOUCH",
    status: "BLOCKED",
    riskLevel: "high",
    blockedLane: "TERRAFUSION-PACS-TOUCH",
    whyBlocked: "TerraFusion/PACS are separate systems and must not be touched by WilliamOS lanes.",
    authorityRequired: "LOCAL_RUNTIME_MUTATION",
    evidenceRequired: ["External system scope", "Impact assessment", "Rollback plan", "Owner approval"],
    relatedAuthorityRecords: ["authority-local-runtime-mutation"],
    relatedEvidenceRecords: ["evidence-safety-boundary"],
    relatedWorkOrders: ["WO-AUTHORITY-004", "WO-AUTHORITY-005"],
    safeDefault: "Do not touch TerraFusion/PACS.",
    ownerActionRequired: "Approve an explicit external-system packet or leave blocked.",
    nextValidAction: "No touch recommended.",
    blockedActions: ["TerraFusion Postgres touch", "PACS mutation", "unrelated container touch"],
  }),
]

export const AUTHORITY_DECISION_LINKS: DecisionLinkRecord[] = [
  {
    label: "Runtime mutation authority decisions",
    decisionId: "decision-limited-omen-persistence",
    relatedItem: "authority-local-runtime-mutation",
    description: "Persistence and runtime mutation require owner decision before implementation.",
  },
  {
    label: "Metadata expansion decisions",
    decisionId: "decision-docker-metadata",
    relatedItem: "authority-metadata-expansion",
    description: "Docker, backup, and port metadata remain future explicit gates.",
  },
  {
    label: "Production authority decisions",
    decisionId: "decision-production-deploy",
    relatedItem: "authority-production-change",
    description: "Deploy and cloud config remain blocked by production authority.",
  },
]

export const EVIDENCE_DECISION_LINKS: DecisionLinkRecord[] = [
  {
    label: "Local status evidence supports manual-only posture",
    decisionId: "decision-limited-omen-persistence",
    relatedItem: "evidence-local-omen-status",
    description: "Local proof supports the current safe default: manual-only operation.",
  },
  {
    label: "Blocked metadata evidence supports default-deny",
    decisionId: "decision-docker-metadata",
    relatedItem: "evidence-blocked-runtime-metadata",
    description: "Evidence explains why metadata expansion remains blocked.",
  },
  {
    label: "Safety boundary evidence supports blocked autonomy",
    decisionId: "decision-autonomy",
    relatedItem: "evidence-safety-boundary",
    description: "Safety proof shows no autonomy authority has been granted.",
  },
]

export const WORK_ORDER_DECISION_LINKS: DecisionLinkRecord[] = [
  {
    label: "Persistence gates supplied evidence",
    decisionId: "decision-limited-omen-persistence",
    relatedItem: "WO-LOCAL-031 through WO-LOCAL-036",
    description: "Persistence remains a future implementation decision.",
  },
  {
    label: "Metadata gate remains blocked",
    decisionId: "decision-docker-metadata",
    relatedItem: "WO-LOCAL-120",
    description: "The metadata decision packet preserved default deny.",
  },
  {
    label: "Authority registry supplies current governing records",
    decisionId: "decision-command-execution",
    relatedItem: "WO-AUTHORITY-001 through WO-AUTHORITY-015",
    description: "Authority records explain why command execution remains blocked.",
  },
]

export const BLOCKED_DECISION_UX = {
  title: "Blocked means protected",
  statements: [
    "Blocked is not failure.",
    "Blocked means owner decision required.",
    "The safe default remains no action.",
    "Evidence can prepare a decision.",
    "WilliamOS cannot self-approve.",
    "Codex cannot self-approve.",
    "Default deny is a safety posture.",
  ],
}

export const DECISION_SAFETY_PROOF_CARDS: DecisionSafetyProofCard[] = [
  ["No approval controls", "absent", "The queue has no approve, deny, or authorize buttons."],
  ["No mutation controls", "absent", "The queue does not mutate decision state."],
  ["No command execution", "absent", "The queue cannot execute commands or start work."],
  ["No dynamic ingestion", "absent", "The queue is static and read-only."],
  ["No authority escalation", "absent", "The queue cannot grant authority."],
  ["Default-deny posture", "visible", "Undecided items remain blocked by default."],
  ["Owner remains authority", "visible", "The Primary remains the approving authority."],
  ["Blocked lanes remain blocked", "visible", "Blocked lanes do not become permission by appearing in the queue."],
].map(([label, value, description]) => ({ label, value, description }))

export function getOwnerDecisionQueueSurface(): OwnerDecisionQueueSurface {
  return {
    doctrine: OWNER_DECISION_DOCTRINE,
    categories: OWNER_DECISION_CATEGORIES,
    states: OWNER_DECISION_STATES,
    pendingDecisions: PENDING_OWNER_DECISIONS,
    detailDecision: PENDING_OWNER_DECISIONS.find(
      (decisionRecord) => decisionRecord.decisionId === "decision-command-execution",
    ) ?? PENDING_OWNER_DECISIONS[0],
    authorityDecisionLinks: AUTHORITY_DECISION_LINKS,
    evidenceDecisionLinks: EVIDENCE_DECISION_LINKS,
    workOrderDecisionLinks: WORK_ORDER_DECISION_LINKS,
    blockedDecisionUx: BLOCKED_DECISION_UX,
    safetyProofCards: DECISION_SAFETY_PROOF_CARDS,
    navigation: [
      {
        label: "Authority",
        href: "/governance",
        description: "Inspect authority records that explain what is blocked.",
      },
      {
        label: "Evidence",
        href: "/audit",
        description: "Inspect proof that supports or is still required for review.",
      },
      {
        label: "Work Orders",
        href: "/work-orders",
        description: "Inspect Work Orders that supplied evidence or remain blocked.",
      },
      {
        label: "Runtime",
        href: "/runtime",
        description: "Inspect read-only local/runtime posture without control authority.",
      },
    ],
    nextLaneDecision: {
      recommendedBatch: "WILLIAMOS-MEMORY-GOVERNANCE-REGISTRY-BATCH-001",
      recommendedOption: "A - Memory governance registry",
      blockedLanes: [
        "Owner decision implementation",
        "Hermes/MCP/autonomy activation",
        "Command execution",
        "Runtime mutation",
      ],
      reason:
        "After decisions are visible, the next read-only spine should define memory governance before advisory Council or agent lanes expand context handling.",
    },
    safety: {
      staticReadOnly: true,
      approvalControlsAdded: false,
      denyControlsAdded: false,
      authorizeControlsAdded: false,
      stateMutationAdded: false,
      mutationControlsAdded: false,
      commandExecutionAdded: false,
      commandRunnerAdded: false,
      githubWriteAdded: false,
      codexAutomationAdded: false,
      dynamicIngestionAdded: false,
      filesystemScanAdded: false,
      dockerMetadataAdded: false,
      backupScanAdded: false,
      portChecksAdded: false,
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
