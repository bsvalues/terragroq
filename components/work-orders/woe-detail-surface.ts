export type WoeSafetyBadge =
  | "READ_ONLY"
  | "STATIC_FIRST"
  | "UI_ONLY"
  | "DOCS_ONLY"
  | "PROOF_ONLY"
  | "BLOCKED_OWNER_DECISION"
  | "NO_COMMAND_EXECUTION"
  | "NO_COMMAND_RUNNER"
  | "NO_AUTONOMOUS_LOOP"
  | "NO_BACKGROUND_WORKER"
  | "NO_RUNTIME_MUTATION"
  | "NO_PRODUCTION_WRITE"

export type WoeDetailLink = {
  label: string
  href: string
  description: string
}

export type WoeDetailSection = {
  label: string
  purpose: string
  nativeSurface: string
  records: string[]
  blockedPowers: string[]
}

export type WoeQueueSection = {
  label: string
  purpose: string
  includedStates: string[]
  excludedPowers: string[]
}

export type WoeDetailSurface = {
  title: "Work Order Engine Integration"
  description: string
  goal: {
    label: string
    id: "GOAL-WOS-002"
    purpose: string
    successState: string
    activeBatches: string[]
    completedWorkOrders: string[]
    blockedDecisions: string[]
    nextRecommendedWork: string
  }
  batch: {
    name: "WILLIAMOS-WOE-INTEGRATION-BATCH-001"
    result: "PHASE_PASS"
    base: string
    originMain: string
    completedWorkOrders: string[]
    mergedPrs: string[]
    validation: string[]
    safetyPosture: string[]
    nextRecommendedBatch: string
  }
  goalDetail: WoeDetailSection
  loopDetail: WoeDetailSection
  evidenceRollup: WoeDetailSection
  activeQueue: WoeQueueSection
  blockedQueue: WoeQueueSection
  completionReport: WoeDetailSection
  searchFilter: {
    label: string
    fields: string[]
    readOnlyBehavior: string
  }
  registryCoverage: WoeDetailLink[]
  workOrder: {
    id: string
    title: string
    mode: "read-only/static-first"
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
    staticFirst: true
    runButtonsAdded: false
    executeButtonsAdded: false
    commandExecutionAdded: false
    commandRunnerAdded: false
    autonomousLoopExecutionAdded: false
    backgroundWorkerAdded: false
    schedulerAdded: false
    serviceRegistered: false
    githubWriteAdded: false
    codexAutomationAdded: false
    authBehaviorChanged: false
    authPolicyChanged: false
    publicSignupReintroduced: false
    databaseAdded: false
    dbSchemaChanged: false
    dataMutationAdded: false
    envChanged: false
    packageChanged: false
    vercelSettingsChanged: false
    deployAdded: false
    releaseAdded: false
    tagAdded: false
    productionWriteBehaviorAdded: false
    hermesActivationAdded: false
    mcpActivationAdded: false
    workerActivationAdded: false
    brainCouncilRuntimeAdded: false
    memoryWriteAdded: false
    runtimeMemoryReadAdded: false
    vectorStoreAdded: false
    embeddingsAdded: false
    ragRuntimeAdded: false
    dynamicIngestionAdded: false
    persistenceImplemented: false
    dockerMetadataAdded: false
    backupScanAdded: false
    portChecksAdded: false
    runtimeControlAdded: false
    lanExposureEnabled: false
    terraFusionPacsTouched: false
    secretsDisclosed: false
  }
}

export const WOE_SAFETY_BADGES: WoeSafetyBadge[] = [
  "READ_ONLY",
  "STATIC_FIRST",
  "UI_ONLY",
  "DOCS_ONLY",
  "PROOF_ONLY",
  "BLOCKED_OWNER_DECISION",
  "NO_COMMAND_EXECUTION",
  "NO_COMMAND_RUNNER",
  "NO_AUTONOMOUS_LOOP",
  "NO_BACKGROUND_WORKER",
  "NO_RUNTIME_MUTATION",
  "NO_PRODUCTION_WRITE",
]

export const WOE_COMPLETION_REPORT_FIELDS = [
  "RESULT",
  "WORK_ORDER",
  "GOAL",
  "BATCH",
  "BASE",
  "BRANCH",
  "COMMIT",
  "PR",
  "MERGED",
  "origin/main",
  "COMPLETED_WOS",
  "FILES_CHANGED",
  "NAVIGATION_CHANGED",
  "AUTH_BEHAVIOR_CHANGED",
  "AUTH_POLICY_CHANGED",
  "PUBLIC_SIGNUP_REINTRODUCED",
  "COMMAND_EXECUTION_ADDED",
  "AUTONOMOUS_LOOP_EXECUTION_ADDED",
  "BACKGROUND_WORKER_ADDED",
  "PRODUCTION_WRITE_BEHAVIOR_ADDED",
  "EVIDENCE_ROLLUP_NATIVE",
  "ACTIVE_QUEUE_NATIVE",
  "BLOCKED_DECISION_QUEUE_NATIVE",
  "COMPLETION_REPORT_NATIVE",
  "VALIDATION",
  "REVIEW_THREADS",
  "PRODUCTION_VERIFICATION",
  "SECRETS_EXPOSED",
  "SAFETY_POSTURE",
  "OWNER_DECISION_REQUIRED",
  "NEXT_RECOMMENDED_WO",
] as const

export function getWoeDetailSurface(): WoeDetailSurface {
  const evidence = [
    {
      label: "Trace Ledger operator contract",
      href: "/trace",
      description:
        "Codex operates authorized batches end to end while the Owner remains authority, not courier.",
    },
    {
      label: "Academy/Wiki knowledge layer",
      href: "/academy",
      description:
        "Academy and Wiki teach /goal, /loop, Work Orders, evidence, authority, and stop conditions as static guidance.",
    },
    {
      label: "Hermes boundary doctrine",
      href: "/hermes",
      description:
        "Hermes remains doctrine-only and inactive; WOE integration does not open sidecar, MCP, worker, or runtime gates.",
    },
  ]

  return {
    title: "Work Order Engine Integration",
    description:
      "Native read-only WilliamOS surfaces for /goal, /loop, Work Orders, evidence rollups, active queues, blocked decisions, completion reports, and next-lane safety.",
    goal: {
      label: "Primary Shell Completion",
      id: "GOAL-WOS-002",
      purpose:
        "Make Work Order Engine state visible inside WilliamOS without adding execution authority, command runners, background workers, or production-write behavior.",
      successState:
        "The Primary can inspect goals, loops, active work, blocked decisions, evidence, completion reports, and safety posture from native shell surfaces.",
      activeBatches: ["WILLIAMOS-WOE-INTEGRATION-BATCH-001"],
      completedWorkOrders: ["WO-WOE-001 through WO-WOE-015"],
      blockedDecisions: [
        "Command runner",
        "Autonomous loop execution",
        "Background worker",
        "Production-write behavior",
        "Hermes/MCP/runtime activation",
      ],
      nextRecommendedWork: "GOAL-WOS-002 follow-on surface polish after this read-only integration is merged.",
    },
    batch: {
      name: "WILLIAMOS-WOE-INTEGRATION-BATCH-001",
      result: "PHASE_PASS",
      base: "1423aa6885eba0d5ec0860ee8e7a6ba761a196f2",
      originMain: "1423aa6885eba0d5ec0860ee8e7a6ba761a196f2",
      completedWorkOrders: [
        "WO-WOE-001 doctrine reconciliation",
        "WO-WOE-002 /goal detail model",
        "WO-WOE-003 /loop detail model",
        "WO-WOE-004 evidence rollup model",
        "WO-WOE-005 goal detail surface",
        "WO-WOE-006 loop detail surface",
        "WO-WOE-007 active work queue",
        "WO-WOE-008 blocked decision queue",
        "WO-WOE-009 completion report model",
        "WO-WOE-010 completion report renderer",
        "WO-WOE-011 work order search/filter",
        "WO-WOE-012 registry/index coverage",
        "WO-WOE-013 Academy/Wiki cross-link pass",
        "WO-WOE-014 safety sweep",
        "WO-WOE-015 final rollup + next-lane decision",
      ],
      mergedPrs: [],
      validation: [
        "focused WOE tests",
        "forbidden SaaS/auth language scan on touched shell surfaces",
        "git diff --check",
        "npm run lint",
        "npm test -- --run",
        "NEXT_PRIVATE_BUILD_WORKER=0 NEXT_TELEMETRY_DISABLED=1 npm run build",
        "PR checks",
        "production /api/health",
        "production /api/auth/readiness",
        "production /work-orders",
      ],
      safetyPosture: [
        "No command runner",
        "No autonomous loop execution",
        "No background worker",
        "No production-write behavior",
        "No auth, DB, env, package, or Vercel setting change",
        "No Hermes, MCP, Brain Council, memory, vector, or ingestion activation",
      ],
      nextRecommendedBatch: "WILLIAMOS-WOE-SHELL-POLISH-BATCH-001",
    },
    goalDetail: {
      label: "/goal detail",
      purpose: "Shows goal id, purpose, success state, base, authority, stop conditions, and next lane.",
      nativeSurface: "/goal-console",
      records: ["goal id", "purpose", "success state", "current base", "authority scope", "stop conditions"],
      blockedPowers: ["goal mutation", "authority grant", "autonomous continuation"],
    },
    loopDetail: {
      label: "/loop detail",
      purpose: "Shows batch, WO list, validation gates, stop conditions, and return contract.",
      nativeSurface: "/goal-console",
      records: ["batch id", "WO sequence", "validation gates", "return format", "stop conditions"],
      blockedPowers: ["loop start button", "background loop", "scheduler", "worker execution"],
    },
    evidenceRollup: {
      label: "Evidence rollup",
      purpose: "Summarizes proof signals tied to Work Orders, decisions, authority, and validation.",
      nativeSurface: "/audit",
      records: ["Work Order evidence", "decision evidence", "authority proof", "validation proof"],
      blockedPowers: ["evidence ingestion", "file scan", "GitHub write", "dynamic crawler"],
    },
    activeQueue: {
      label: "Active Work Queue",
      purpose: "Shows approved, active, review, and blocked Work Orders without starting work.",
      includedStates: ["approved", "active", "review", "blocked"],
      excludedPowers: ["start loop", "execute WO", "grant authority", "write production"],
    },
    blockedQueue: {
      label: "Blocked Decision Queue",
      purpose: "Shows proposed owner decisions and missing evidence before a lane can advance.",
      includedStates: ["proposed decisions", "missing evidence", "owner decision needed"],
      excludedPowers: ["approve decision", "reject decision", "grant authority", "mutate decision"],
    },
    completionReport: {
      label: "Completion report",
      purpose: "Renders final batch result fields as evidence, not as an execution transcript.",
      nativeSurface: "/work-orders",
      records: [...WOE_COMPLETION_REPORT_FIELDS],
      blockedPowers: ["record result", "merge PR", "write GitHub", "publish release"],
    },
    searchFilter: {
      label: "Work Order search/filter",
      fields: [
        "query",
        "status",
        "goal",
        "batch/loop",
        "lane",
        "authority",
        "owner decision",
        "safety posture",
        "completion state",
      ],
      readOnlyBehavior:
        "Filters only the local browser view of existing Work Order records; it does not mutate rows or trigger workflows.",
    },
    registryCoverage: [
      { label: "Work Orders", href: "/work-orders", description: "Native WOE queue, detail, completion, and filter surfaces." },
      { label: "Goal Console", href: "/goal-console", description: "Native /goal and /loop read-only placement." },
      { label: "Evidence", href: "/audit", description: "Evidence rollups and completion proof references." },
      { label: "Decisions", href: "/decisions", description: "Blocked owner decision queue and authority blockers." },
      { label: "Academy", href: "/academy", description: "Static lessons for WOE operation and stop conditions." },
      { label: "Wiki", href: "/wiki", description: "Static WOE concept definitions and boundary language." },
    ],
    workOrder: {
      id: "WO-WOE-001..015",
      title: "Work Order Engine Integration",
      mode: "read-only/static-first",
      goal: "Make WOE state native inside WilliamOS without adding execution authority.",
      allowedScope: [
        "Static/read-only WOE data models",
        "Native shell surfaces",
        "Search and filter views",
        "Evidence and completion report rendering",
        "Academy/Wiki cross-links",
        "Docs/report evidence",
        "Focused tests",
      ],
      blockedScope: [
        "Command runner",
        "Autonomous loop execution",
        "Background worker",
        "Scheduler or service",
        "Execution buttons that mutate state",
        "Production writes",
        "Auth, DB, env, package, or Vercel changes",
        "Hermes, MCP, Brain Council, memory, vector, RAG, or ingestion activation",
      ],
      result: "planned",
      validation: [
        "focused WOE tests",
        "Academy/Wiki registry tests",
        "forbidden language and authority scan",
        "full test suite",
        "build",
      ],
      evidence,
      safetyPosture: WOE_SAFETY_BADGES,
      nextRecommendedWo: "WO-WOE-015 — Final rollup + next-lane decision",
    },
    blockedDecision: {
      blocker: "Execution authority remains closed.",
      whyBlocked:
        "This lane makes Work Order Engine state visible. It does not authorize WilliamOS to run commands, continue loops autonomously, start workers, or write production state.",
      ownerDecisionNeeded:
        "A future owner gate is required before command execution, autonomous continuation, background workers, production writes, or runtime activation can be considered.",
      safeNextAction: "Complete read-only WOE integration, validate, merge, and keep the next lane in UI/evidence scope.",
      prohibitedActions: [
        "run command from WilliamOS UI",
        "run Work Order from WilliamOS UI",
        "auto-continue a loop",
        "start worker",
        "schedule service",
        "write GitHub",
        "write production",
        "activate Hermes or MCP",
      ],
      relatedEvidence: evidence,
    },
    reportFields: [...WOE_COMPLETION_REPORT_FIELDS],
    navigation: [
      { label: "Work Orders", href: "/work-orders", description: "Inspect WOE queue, details, filters, and completion reports." },
      { label: "Goal Console", href: "/goal-console", description: "Inspect /goal and /loop native placement." },
      { label: "Evidence", href: "/audit", description: "Inspect proof and evidence rollups." },
      { label: "Decisions", href: "/decisions", description: "Inspect owner blockers before a lane advances." },
      { label: "Academy", href: "/academy", description: "Review static WOE operating lessons." },
      { label: "Wiki", href: "/wiki", description: "Review WOE definitions and boundaries." },
    ],
    safetyBadges: WOE_SAFETY_BADGES,
    safety: {
      readOnly: true,
      staticFirst: true,
      runButtonsAdded: false,
      executeButtonsAdded: false,
      commandExecutionAdded: false,
      commandRunnerAdded: false,
      autonomousLoopExecutionAdded: false,
      backgroundWorkerAdded: false,
      schedulerAdded: false,
      serviceRegistered: false,
      githubWriteAdded: false,
      codexAutomationAdded: false,
      authBehaviorChanged: false,
      authPolicyChanged: false,
      publicSignupReintroduced: false,
      databaseAdded: false,
      dbSchemaChanged: false,
      dataMutationAdded: false,
      envChanged: false,
      packageChanged: false,
      vercelSettingsChanged: false,
      deployAdded: false,
      releaseAdded: false,
      tagAdded: false,
      productionWriteBehaviorAdded: false,
      hermesActivationAdded: false,
      mcpActivationAdded: false,
      workerActivationAdded: false,
      brainCouncilRuntimeAdded: false,
      memoryWriteAdded: false,
      runtimeMemoryReadAdded: false,
      vectorStoreAdded: false,
      embeddingsAdded: false,
      ragRuntimeAdded: false,
      dynamicIngestionAdded: false,
      persistenceImplemented: false,
      dockerMetadataAdded: false,
      backupScanAdded: false,
      portChecksAdded: false,
      runtimeControlAdded: false,
      lanExposureEnabled: false,
      terraFusionPacsTouched: false,
      secretsDisclosed: false,
    },
  }
}
