export type WoeSafetyBadge =
  | "READ_ONLY"
  | "UI_ONLY"
  | "DOCS_ONLY"
  | "PROOF_ONLY"
  | "BLOCKED_OWNER_DECISION"
  | "LOCAL_STATUS_READ_ONLY"
  | "NO_COMMAND_EXECUTION"
  | "NO_AUTONOMY"
  | "NO_RUNTIME_MUTATION"

export type WoeDetailLink = {
  label: string
  href: string
  description: string
}

export type WoeDetailSurface = {
  title: "Work Order Engine Detail Surfaces"
  description: string
  goal: {
    label: string
    purpose: string
    successState: string
    activeBatches: string[]
    completedWorkOrders: string[]
    blockedDecisions: string[]
    nextRecommendedWork: string
  }
  batch: {
    name: string
    result: "PHASE_PASS"
    originMain: string
    completedWorkOrders: string[]
    mergedPrs: string[]
    validation: string[]
    safetyPosture: string[]
    nextRecommendedBatch: string
  }
  workOrder: {
    id: string
    title: string
    mode: "read-model/ui"
    goal: string
    allowedScope: string[]
    blockedScope: string[]
    result: "planned"
    validation: string[]
    evidence: WoeDetailLink[]
    safetyPosture: WoeSafetyBadge[]
    nextRecommendedWo: string
  }
  blockedDecision: {
    blocker: string
    whyBlocked: string
    ownerDecisionNeeded: string
    safeNextAction: string
    prohibitedActions: string[]
    relatedEvidence: WoeDetailLink[]
  }
  reportFields: string[]
  navigation: WoeDetailLink[]
  safetyBadges: WoeSafetyBadge[]
  safety: {
    readOnly: true
    runButtonsAdded: false
    executeButtonsAdded: false
    commandExecutionAdded: false
    commandRunnerAdded: false
    githubWriteAdded: false
    codexAutomationAdded: false
    schedulerAdded: false
    persistenceImplemented: false
    dockerMetadataAdded: false
    backupScanAdded: false
    portChecksAdded: false
    lanExposureEnabled: false
    secretsDisclosed: false
  }
}

export const WOE_SAFETY_BADGES: WoeSafetyBadge[] = [
  "READ_ONLY",
  "UI_ONLY",
  "DOCS_ONLY",
  "PROOF_ONLY",
  "BLOCKED_OWNER_DECISION",
  "LOCAL_STATUS_READ_ONLY",
  "NO_COMMAND_EXECUTION",
  "NO_AUTONOMY",
  "NO_RUNTIME_MUTATION",
]

export const WOE_COMPLETION_REPORT_FIELDS = [
  "RESULT",
  "BATCH",
  "WORK_ORDER",
  "COMPLETED_WOS",
  "MERGED_PRS",
  "origin/main",
  "VALIDATION",
  "SAFETY_POSTURE",
  "NEXT_RECOMMENDED_BATCH",
] as const

export function getWoeDetailSurface(): WoeDetailSurface {
  const evidence = [
    {
      label: "Shell / WOE resume evidence spine record",
      href: "/audit",
      description: "PR #280 and WO-SHELL-021 through WO-SHELL-028 reports are represented in the Evidence Spine.",
    },
    {
      label: "Local OMEN status evidence spine record",
      href: "/audit",
      description: "Completed local status proof remains a read-only governed subsystem in the Evidence Spine.",
    },
  ]

  return {
    title: "Work Order Engine Detail Surfaces",
    description:
      "Read-only detail views for the Primary Operator: goal, batch, Work Order, evidence, blockers, safety posture, completion fields, and next lane.",
    goal: {
      label: "Primary command environment",
      purpose:
        "Show what goal is active, what batch is recommended, what evidence proves completion, and what decision is needed next.",
      successState:
        "The Primary can inspect goal, batch, Work Order, evidence, blocked decision, safety, and navigation detail without triggering execution.",
      activeBatches: ["WILLIAMOS-WOE-DETAIL-SURFACES-BATCH-001"],
      completedWorkOrders: ["WO-SHELL-021 through WO-SHELL-028", "WO-WOE-019 through WO-WOE-021"],
      blockedDecisions: ["Metadata expansion", "Runtime control", "Autonomy"],
      nextRecommendedWork: "Authority / Governance Registry after Evidence Spine pass.",
    },
    batch: {
      name: "WILLIAMOS-SHELL-WOE-RESUME-BATCH-001",
      result: "PHASE_PASS",
      originMain: "9818f323be95f48fe32e015f6fd9f6eef81980d1",
      completedWorkOrders: [
        "WO-SHELL-021",
        "WO-SHELL-022",
        "WO-SHELL-023",
        "WO-SHELL-024",
        "WO-WOE-019",
        "WO-WOE-020",
        "WO-WOE-021",
        "WO-SHELL-025",
        "WO-SHELL-026",
        "WO-SHELL-027",
        "WO-SHELL-028",
      ],
      mergedPrs: ["#280"],
      validation: ["git diff --check", "focused Shell/WOE tests", "full suite", "production build", "Vercel", "CodeRabbit"],
      safetyPosture: [
        "No command execution",
        "No command runner",
        "No metadata expansion",
        "No runtime control",
        "No autonomy",
      ],
      nextRecommendedBatch: "WILLIAMOS-EVIDENCE-SPINE-BATCH-001",
    },
    workOrder: {
      id: "WO-WOE-022..032",
      title: "Work Order Engine Detail Surfaces",
      mode: "read-model/ui",
      goal: "Make WOE detail inspectable without adding execution.",
      allowedScope: [
        "Goal detail UI",
        "Batch detail UI",
        "Work Order detail UI",
        "Evidence linkage UI",
        "Blocked decision detail UI",
        "Safety badge model",
        "Completion report renderer",
        "Read-only navigation",
      ],
      blockedScope: [
        "Run WO or run batch controls",
        "GitHub write actions",
        "Codex automation",
        "Command runner",
        "Docker, backup, or port metadata expansion",
        "Scheduler, persistence, LAN exposure, autonomy",
      ],
      result: "planned",
      validation: ["focused detail-surface tests", "full suite", "build", "PR checks"],
      evidence,
      safetyPosture: WOE_SAFETY_BADGES,
      nextRecommendedWo: "WO-WOE-023 — Batch Detail Surface",
    },
    blockedDecision: {
      blocker: "Runtime and metadata expansion remain closed.",
      whyBlocked:
        "The current lane is read-model/UI only. Metadata, runtime control, command execution, and autonomy require separate owner authority.",
      ownerDecisionNeeded:
        "Choose a future gate before Docker metadata, backup metadata, port checks, runtime control, or autonomy can be considered.",
      safeNextAction: "Complete Evidence Spine and then move to the Authority / Governance Registry.",
      prohibitedActions: [
        "run WO",
        "run batch",
        "execute command",
        "write GitHub",
        "start Codex automation",
        "scan Docker",
        "scan backups",
        "check ports",
      ],
      relatedEvidence: evidence,
    },
    reportFields: [...WOE_COMPLETION_REPORT_FIELDS],
    navigation: [
      { label: "Back to Work Orders", href: "/work-orders", description: "Return to governed work queue." },
      { label: "View Evidence", href: "/audit", description: "Inspect proof and report surfaces." },
      { label: "View Runtime", href: "/runtime", description: "Inspect read-only local/runtime posture." },
      { label: "View Decisions", href: "/decisions", description: "Inspect owner decision surfaces." },
    ],
    safetyBadges: WOE_SAFETY_BADGES,
    safety: {
      readOnly: true,
      runButtonsAdded: false,
      executeButtonsAdded: false,
      commandExecutionAdded: false,
      commandRunnerAdded: false,
      githubWriteAdded: false,
      codexAutomationAdded: false,
      schedulerAdded: false,
      persistenceImplemented: false,
      dockerMetadataAdded: false,
      backupScanAdded: false,
      portChecksAdded: false,
      lanExposureEnabled: false,
      secretsDisclosed: false,
    },
  }
}
