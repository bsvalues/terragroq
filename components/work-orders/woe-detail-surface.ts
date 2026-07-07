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

export type WoeOperatingMapItem = {
  label: string
  value: string
  description: string
}

export type WoeReadabilityCue = {
  label: string
  description: string
}

export type WoeProofChainItem = {
  label: string
  workOrder: string
  evidence: string
  proofSignal: string
  href: string
}

export type WoeProductionVerificationItem = {
  route: string
  expected: string
  proves: string
}

export type WoeSafetyFlagExplanation = {
  flag: WoeSafetyBadge
  meaning: string
}

export type WoeProofGap = {
  label: string
  status: "missing" | "blocked" | "not authorized"
  nextSafeMove: string
}

export type WoeDetailSurface = {
  title: "Work Order Engine Integration"
  description: string
  polish: {
    batch: "WILLIAMOS-WOE-SHELL-POLISH-BATCH-001"
    posture: "read-only/static-first"
    primarySignal: string
    operatingMap: WoeOperatingMapItem[]
    readabilityCues: WoeReadabilityCue[]
  }
  evidenceClarity: {
    batch: "WILLIAMOS-WOE-EVIDENCE-CLARITY-BATCH-001"
    posture: "read-only/static-first"
    proofChain: WoeProofChainItem[]
    productionVerification: WoeProductionVerificationItem[]
    prCheckReviewContext: WoeOperatingMapItem[]
    safetyFlagExplanations: WoeSafetyFlagExplanation[]
    proofGaps: WoeProofGap[]
  }
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
    name: "WILLIAMOS-WORK-ORDER-ENGINE-INTEGRATION-BATCH-001"
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
  goalRegistry: WoeDetailSection
  goalIndex: WoeDetailSection
  loopRegistry: WoeDetailSection
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
  "PR",
  "origin/main",
  "FILES_CHANGED",
  "VALIDATION",
  "PRODUCTION_VERIFICATION",
  "SAFETY_POSTURE",
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
      "A read-only operating map for the Primary: current intent, loop boundary, active work, blockers, proof, completion, and next lane.",
    polish: {
      batch: "WILLIAMOS-WOE-SHELL-POLISH-BATCH-001",
      posture: "read-only/static-first",
      primarySignal:
        "Primary can read the lane, inspect proof, and see what remains blocked without encountering execution affordances.",
      operatingMap: [
        {
          label: "Intent",
          value: "/goal",
          description: "What this lane is for and what completion means.",
        },
        {
          label: "Boundary",
          value: "/loop",
          description: "The authorized batch, validation, and stop conditions.",
        },
        {
          label: "Motion",
          value: "Queue",
          description: "Approved, active, review, and blocked Work Orders.",
        },
        {
          label: "Proof",
          value: "Evidence",
          description: "Validation and production facts tied to the work.",
        },
        {
          label: "Closure",
          value: "Report",
          description: "Machine-readable completion fields and next lane.",
        },
      ],
      readabilityCues: [
        {
          label: "Read first",
          description: "Intent, boundary, motion, proof, and closure are grouped in that order.",
        },
        {
          label: "Blocked stays visible",
          description: "Authority blockers are kept near the queue and safety posture.",
        },
        {
          label: "Navigation is evidence-led",
          description: "Links lead to existing read-only surfaces, not action paths.",
        },
      ],
    },
    evidenceClarity: {
      batch: "WILLIAMOS-WOE-EVIDENCE-CLARITY-BATCH-001",
      posture: "read-only/static-first",
      proofChain: [
        {
          label: "Scope proof",
          workOrder: "WO-WOE-033 through WO-WOE-035",
          evidence: "Doctrine, goal, and loop models define the bounded lane before implementation.",
          proofSignal: "The Primary can see intent, base, allowed scope, validators, and stop conditions.",
          href: "/goal-console",
        },
        {
          label: "Implementation proof",
          workOrder: "WO-WOE-036 through WO-WOE-043",
          evidence: "Goal, loop, evidence, queue, blocked decision, completion, and filter surfaces are native.",
          proofSignal: "The WOE lane is inspectable without adding run buttons, workers, or command paths.",
          href: "/work-orders",
        },
        {
          label: "Cross-link proof",
          workOrder: "WO-WOE-044 through WO-WOE-045",
          evidence: "Registry, Academy, Wiki, Work Orders, Goal Console, Evidence, and Decisions link together.",
          proofSignal: "Evidence can be followed back to the Work Order and forward to the next safe lane.",
          href: "/academy",
        },
        {
          label: "Closure proof",
          workOrder: "WO-WOE-046 through WO-WOE-047",
          evidence: "Safety sweep, validation gates, PR checks, merge state, production verification, and next lane.",
          proofSignal: "Completion is readable as proof of reality, not as permission to execute new work.",
          href: "/audit",
        },
      ],
      productionVerification: [
        {
          route: "/api/health",
          expected: "200",
          proves: "The deployed WilliamOS process responds after merge.",
        },
        {
          route: "/api/auth/readiness",
          expected: "ready/healthy",
          proves: "Owner-only auth readiness remains intact after WOE changes.",
        },
        {
          route: "/work-orders",
          expected: "200",
          proves: "The WOE surface touched by this lane renders in production.",
        },
        {
          route: "/goal-console",
          expected: "200",
          proves: "The native /goal and /loop placement remains reachable.",
        },
        {
          route: "/audit",
          expected: "200",
          proves: "Evidence and proof rollups remain reachable for inspection.",
        },
      ],
      prCheckReviewContext: [
        {
          label: "PR",
          value: "merged PR",
          description: "The final report records the PR number and merge state before the lane closes.",
        },
        {
          label: "Checks",
          value: "green",
          description: "Focused tests, lint, full test suite, build, and hosted checks must be visible as proof.",
        },
        {
          label: "Review threads",
          value: "0 unresolved",
          description: "Review findings are remediated narrowly or left as an explicit blocker before merge.",
        },
      ],
      safetyFlagExplanations: [
        {
          flag: "READ_ONLY",
          meaning: "The surface reads static/modelled WOE evidence and does not persist new evidence.",
        },
        {
          flag: "NO_COMMAND_RUNNER",
          meaning: "Validators may be listed as proof requirements, but no UI path runs them.",
        },
        {
          flag: "NO_AUTONOMOUS_LOOP",
          meaning: "Codex operation remains outside the app under owner-authorized packets.",
        },
        {
          flag: "NO_PRODUCTION_WRITE",
          meaning: "Production verification is observed evidence, not a deploy or settings mutation.",
        },
      ],
      proofGaps: [
        {
          label: "Missing production route proof",
          status: "missing",
          nextSafeMove: "Record the route, expected status, actual result, and blocker before claiming completion.",
        },
        {
          label: "Blocked review-thread evidence",
          status: "blocked",
          nextSafeMove: "Resolve the thread or return an owner-decision packet; do not merge as pass.",
        },
        {
          label: "Execution evidence request",
          status: "not authorized",
          nextSafeMove: "Create a separate authority packet; this WOE evidence surface stays read-only.",
        },
      ],
    },
    goal: {
      label: "Primary Shell Completion",
      id: "GOAL-WOS-002",
      purpose:
        "Make Work Orders the central operating primitive inside WilliamOS without adding execution authority, command runners, background workers, or production-write behavior.",
      successState:
        "WilliamOS can show active goals, active loops, ready Work Orders, blocked decisions, completion reports, evidence rollups, safety posture, and next recommended action.",
      activeBatches: ["WILLIAMOS-WORK-ORDER-ENGINE-INTEGRATION-BATCH-001"],
      completedWorkOrders: ["WO-WOE-009 through WO-WOE-022"],
      blockedDecisions: [
        "Command runner",
        "Autonomous loop execution",
        "Background worker",
        "Production-write behavior",
        "Hermes/MCP/runtime activation",
      ],
      nextRecommendedWork: "GOAL-WOS-011 WOE evidence clarity makes proof chains easier to inspect without opening execution.",
    },
    batch: {
      name: "WILLIAMOS-WORK-ORDER-ENGINE-INTEGRATION-BATCH-001",
      result: "PHASE_PASS",
      base: "0dc222d1bbfacd05f5ca1e0e8c815dc2dec3f133",
      originMain: "reconciled by final batch report",
      completedWorkOrders: [
        "WO-WOE-009 goal registry model",
        "WO-WOE-010 goal index surface",
        "WO-WOE-011 goal detail surface",
        "WO-WOE-012 loop registry model",
        "WO-WOE-013 loop detail surface",
        "WO-WOE-014 active work queue",
        "WO-WOE-015 blocked decision queue",
        "WO-WOE-016 evidence rollup model",
        "WO-WOE-017 evidence rollup surface",
        "WO-WOE-018 completion report renderer",
        "WO-WOE-019 work order search/filter",
        "WO-WOE-020 home integration",
        "WO-WOE-021 safety boundary tests",
        "WO-WOE-022 batch rollup + production verification",
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
      nextRecommendedBatch: "GOAL-WOS-003 - Brain Council Advisory Layer",
    },
    goalRegistry: {
      label: "Goal registry model",
      purpose: "Models governed goals with purpose, success state, status, active batch, evidence, blocked decisions, and next work.",
      nativeSurface: "/goal-console",
      records: ["goal id", "title", "purpose", "success state", "status", "active batch", "evidence", "blocked decisions", "next recommended WO"],
      blockedPowers: ["create goal action", "edit goal action", "delete goal action", "goal mutation"],
    },
    goalIndex: {
      label: "Goal index surface",
      purpose: "Groups active, completed, and blocked goals for Primary review without execution controls.",
      nativeSurface: "/goal-console",
      records: ["active goals", "completed goals", "blocked goals", "status labels", "navigation links"],
      blockedPowers: ["create goal button", "edit goal button", "delete goal button", "execution controls"],
    },
    goalDetail: {
      label: "/goal detail",
      purpose: "Shows goal id, purpose, success state, base, authority, stop conditions, and next lane.",
      nativeSurface: "/goal-console",
      records: ["goal id", "purpose", "success state", "current base", "authority scope", "stop conditions"],
      blockedPowers: ["goal mutation", "authority grant", "autonomous continuation"],
    },
    loopRegistry: {
      label: "Loop registry model",
      purpose: "Models /loop state with active goal, current WO, mode, safety posture, status, evidence links, and next gate.",
      nativeSurface: "/goal-console",
      records: ["loop id", "goal id", "current WO", "mode", "safety posture", "status", "evidence links", "next gate"],
      blockedPowers: ["loop execution", "auto-continue", "background runner", "scheduler"],
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
        "ready",
        "blocked",
        "completed",
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
      { label: "Wiki", href: "/academy", description: "Static WOE concept definitions and boundary language." },
    ],
    workOrder: {
      id: "WO-WOE-009..022",
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
      nextRecommendedWo: "WO-WOE-022 — Batch rollup + production verification",
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
      { label: "Wiki", href: "/academy", description: "Review WOE definitions and boundaries." },
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
