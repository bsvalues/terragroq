export type AcademyLessonLevel = "onboarding" | "operator" | "governance" | "advanced"
export type WikiConceptType =
  | "core"
  | "surface"
  | "governance"
  | "safety"
  | "local-runtime"
  | "council"
  | "memory"
  | "trace"
  | "work-order-engine"
  | "forge"
  | "county-ops"

export type AcademyLesson = {
  lessonId: string
  title: string
  audience: string
  level: AcademyLessonLevel
  summary: string
  concepts: string[]
  relatedGoal: string
  relatedLoop: string
  relatedWorkOrders: string[]
  relatedEvidence: string[]
  relatedAuthorityGates: string[]
  whatThisTeaches: string[]
  whatThisDoesNotEnable: string[]
}

export type WikiPage = {
  pageId: string
  title: string
  conceptType: WikiConceptType
  summary: string
  canonicalDefinition: string
  relatedSurfaces: string[]
  relatedEvidence: string[]
  relatedAuthority: string[]
  relatedMemory: string[]
  relatedDecisions: string[]
  relatedTrace: string[]
  whatItIs: string
  whatItIsNot: string
}

export type GlossaryTerm = {
  term: string
  definition: string
  category: "core" | "governance" | "safety" | "system"
}

export type AcademySafetyProofCard = {
  label: string
  value: string
  description: string
}

export type AcademyWikiSurface = {
  academyDoctrine: {
    title: string
    statements: readonly string[]
  }
  wikiDoctrine: {
    title: string
    statements: readonly string[]
  }
  lessons: AcademyLesson[]
  wikiPages: WikiPage[]
  glossary: GlossaryTerm[]
  featuredLesson: AcademyLesson
  featuredWikiPage: WikiPage
  safetyProofCards: AcademySafetyProofCard[]
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
    runtimeTrainingAdded: false
    progressPersistenceAdded: false
    quizStateMutationAdded: false
    certificationEngineAdded: false
    databaseAdded: false
    dbSchemaChanged: false
    filesystemScanAdded: false
    dynamicIngestionAdded: false
    githubApiIntegrationAdded: false
    commandExecutionAdded: false
    commandRunnerAdded: false
    codexAutomationAdded: false
    councilRuntimeAdded: false
    hermesActivationAdded: false
    mcpActivationAdded: false
    workerActivationAdded: false
    memoryWriteAdded: false
    runtimeMemoryReadAdded: false
    vectorStoreAdded: false
    embeddingsAdded: false
    evalExecutionAdded: false
    testGenerationAutomationAdded: false
    dockerMetadataAdded: false
    backupScanAdded: false
    portChecksAdded: false
    runtimeControlAdded: false
    persistenceImplemented: false
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

export const ACADEMY_DOCTRINE = {
  title: "Academy Doctrine",
  statements: [
    "Academy teaches WilliamOS operation.",
    "Academy is static and read-only.",
    "Academy helps Codex operate authorized loops without making the Owner the courier.",
    "Academy does not execute commands, automate Codex, start agents, or grant authority.",
    "Academy does not track progress in persistence, certify users, or mutate state.",
    "Academy lessons point to evidence, authority, memory, Council, trace, and local status as references only.",
  ],
} as const

export const WIKI_DOCTRINE = {
  title: "Wiki Doctrine",
  statements: [
    "Wiki records what WilliamOS concepts mean.",
    "Wiki links concepts to evidence, authority, memory, owner decisions, Work Orders, and trace records.",
    "Wiki is static and read-only.",
    "Wiki does not ingest dynamically, scan files, mutate state, or authorize action.",
    "Wiki definitions clarify boundaries; they do not open gates.",
  ],
} as const

export const ACADEMY_LESSONS: AcademyLesson[] = [
  {
    lessonId: "lesson-operator-onboarding",
    title: "Primary Operator Onboarding",
    audience: "Primary Operator and Codex",
    level: "onboarding",
    summary: "Explains WilliamOS as Primary-controlled and Codex-operated inside authorized batch boundaries.",
    concepts: ["Primary", "Owner is not the courier", "Authority gates", "Evidence", "Brain Council advisory"],
    relatedGoal: "GOAL-WOS-009",
    relatedLoop: "WILLIAMOS-ACADEMY-WIKI-BATCH-001",
    relatedWorkOrders: ["WO-ACADEMY-007"],
    relatedEvidence: ["Trace Ledger completion", "Authority refresh completion"],
    relatedAuthorityGates: ["COMMAND_RUNNER_GATE", "COUNCIL_RUNTIME_GATE"],
    whatThisTeaches: [
      "WilliamOS is Primary-controlled.",
      "Codex operates authorized loops.",
      "Evidence proves reality.",
      "Brain Council advises only.",
    ],
    whatThisDoesNotEnable: ["runtime training", "Codex automation from UI", "authority grants"],
  },
  {
    lessonId: "lesson-goal-loop",
    title: "/goal + /loop Operation",
    audience: "Codex operator",
    level: "operator",
    summary: "Defines how a goal sets intent and a loop carries a full authorized batch to completion.",
    concepts: ["/goal", "/loop", "self-advance", "stop condition", "batch completion"],
    relatedGoal: "GOAL-WOS-009",
    relatedLoop: "WILLIAMOS-ACADEMY-WIKI-BATCH-001",
    relatedWorkOrders: ["WO-ACADEMY-008"],
    relatedEvidence: ["trace-owner-not-courier-contract"],
    relatedAuthorityGates: ["AUTONOMOUS_LOOP_GATE"],
    whatThisTeaches: [
      "/goal defines intent.",
      "/loop operates batch progress.",
      "Codex continues through listed WOs until completion or a true stop condition.",
      "Owner decision boundaries remain active.",
    ],
    whatThisDoesNotEnable: ["autonomous runtime loops", "background collection", "UI automation"],
  },
  {
    lessonId: "lesson-work-order-governance",
    title: "Work Order Governance",
    audience: "Codex operator",
    level: "governance",
    summary: "Teaches narrow WOs, batch grouping, evidence closure, and next-lane decisions.",
    concepts: ["Work Order", "batch", "evidence rollup", "next lane decision"],
    relatedGoal: "GOAL-WOS-009",
    relatedLoop: "WILLIAMOS-ACADEMY-WIKI-BATCH-001",
    relatedWorkOrders: ["WO-ACADEMY-009"],
    relatedEvidence: ["WOE detail surfaces", "Trace Ledger"],
    relatedAuthorityGates: ["LOCAL_RUNTIME_CONTROL_GATE"],
    whatThisTeaches: [
      "WOs are narrow.",
      "Batches group WOs.",
      "Evidence closes WOs.",
      "Do not return one-off WO handoffs when a full batch exists.",
    ],
    whatThisDoesNotEnable: ["WO execution engine", "GitHub write integration", "approval controls"],
  },
  {
    lessonId: "lesson-work-order-engine-integration",
    title: "Work Order Engine Integration",
    audience: "Codex operator",
    level: "operator",
    summary: "Explains native read-only /goal, /loop, queue, evidence, blocked decision, and completion report surfaces.",
    concepts: ["Work Order Engine", "/goal", "/loop", "Active Work Queue", "Completion Report"],
    relatedGoal: "GOAL-WOS-002",
    relatedLoop: "WILLIAMOS-WOE-INTEGRATION-BATCH-001",
    relatedWorkOrders: ["WO-WOE-001 through WO-WOE-015"],
    relatedEvidence: ["WOE integration surface", "Academy/Wiki cross-link pass"],
    relatedAuthorityGates: ["COMMAND_RUNNER_GATE", "AUTONOMOUS_LOOP_GATE", "PRODUCTION_WRITE_GATE"],
    whatThisTeaches: [
      "WOE state can be native without becoming an executor.",
      "/goal and /loop can be inspected without being started from the UI.",
      "Completion reports are proof records, not production-write controls.",
      "Blocked decisions remain owner authority gates.",
    ],
    whatThisDoesNotEnable: ["command runner", "autonomous loop execution", "background worker", "production write"],
  },
  {
    lessonId: "lesson-evidence-authority-decision",
    title: "Evidence, Authority, and Owner Decisions",
    audience: "Primary Operator and Codex",
    level: "governance",
    summary: "Connects proof, gates, and owner decisions without turning any of them into automatic permission.",
    concepts: ["Evidence", "Authority", "Owner Decision", "default deny"],
    relatedGoal: "GOAL-WOS-009",
    relatedLoop: "WILLIAMOS-ACADEMY-WIKI-BATCH-001",
    relatedWorkOrders: ["WO-ACADEMY-010"],
    relatedEvidence: ["Evidence Spine", "Authority Registry", "Owner Decision Queue"],
    relatedAuthorityGates: ["SECRET_ACCESS_GATE", "PRODUCTION_DEPLOY_GATE"],
    whatThisTeaches: [
      "Evidence informs.",
      "Authority gates.",
      "Owner Decisions record blockers.",
      "Evidence does not authorize action.",
      "Decisions do not approve automatically.",
    ],
    whatThisDoesNotEnable: ["authority mutation", "approval controls", "state mutation"],
  },
  {
    lessonId: "lesson-memory-council-trace",
    title: "Memory, Brain Council, and Trace",
    audience: "Codex operator",
    level: "governance",
    summary: "Explains continuity, advisory reasoning, and reasoning records as non-executing layers.",
    concepts: ["Memory", "Brain Council", "Trace Ledger", "Failure-to-Eval"],
    relatedGoal: "GOAL-WOS-009",
    relatedLoop: "WILLIAMOS-ACADEMY-WIKI-BATCH-001",
    relatedWorkOrders: ["WO-ACADEMY-011"],
    relatedEvidence: ["Memory Governance Registry", "Brain Council Advisory Layer", "Trace Ledger"],
    relatedAuthorityGates: ["MEMORY_WRITE_GATE", "COUNCIL_RUNTIME_GATE"],
    whatThisTeaches: [
      "Memory preserves continuity.",
      "Brain Council advises.",
      "Trace records reasoning.",
      "None of these execute, mutate authority, or activate workers.",
    ],
    whatThisDoesNotEnable: ["memory writes", "Council runtime", "eval execution", "worker activation"],
  },
  {
    lessonId: "lesson-local-omen-runtime",
    title: "Local OMEN Read-Only Runtime Status",
    audience: "Primary Operator and Codex",
    level: "operator",
    summary: "Documents Local OMEN runtime status boundaries and blocked metadata/control lanes.",
    concepts: ["Local OMEN", "read-only", "manual-only", "localhost-only", "metadata gates"],
    relatedGoal: "GOAL-WOS-009",
    relatedLoop: "WILLIAMOS-ACADEMY-WIKI-BATCH-001",
    relatedWorkOrders: ["WO-ACADEMY-012"],
    relatedEvidence: ["Local OMEN authority freeze", "Authority Registry refresh"],
    relatedAuthorityGates: ["LOCAL_RUNTIME_METADATA_GATE", "LOCAL_RUNTIME_CONTROL_GATE"],
    whatThisTeaches: [
      "Local runtime status is read-only.",
      "Local operation is manual-only.",
      "Local exposure is localhost-only.",
      "Docker metadata, backup scans, port checks, runtime control, services, schedulers, and LAN exposure remain blocked.",
    ],
    whatThisDoesNotEnable: ["Docker metadata", "backup scan", "port check", "runtime control", "LAN exposure"],
  },
]

export const WIKI_PAGES: WikiPage[] = [
  {
    pageId: "wiki-primary",
    title: "Primary",
    conceptType: "core",
    summary: "The approving authority for WilliamOS.",
    canonicalDefinition: "The Primary is the human authority who approves boundaries, gates, and owner decisions.",
    relatedSurfaces: ["/decisions", "/governance"],
    relatedEvidence: ["Authority Registry"],
    relatedAuthority: ["authority-read-only-registry"],
    relatedMemory: ["memory-owner-decision-queue-current"],
    relatedDecisions: ["decision-command-execution"],
    relatedTrace: ["trace-owner-not-courier-contract"],
    whatItIs: "The final approving authority.",
    whatItIsNot: "A courier for WO-by-WO handoffs when a batch is already authorized.",
  },
  {
    pageId: "wiki-goal-loop",
    title: "/goal and /loop",
    conceptType: "core",
    summary: "The operating structure for intent and full-batch execution.",
    canonicalDefinition: "/goal defines intent; /loop carries the authorized batch through listed WOs.",
    relatedSurfaces: ["/goal-console", "/work-orders", "/trace"],
    relatedEvidence: ["Trace Ledger"],
    relatedAuthority: ["AUTONOMOUS_LOOP_GATE"],
    relatedMemory: ["memory-stale-contradiction-review"],
    relatedDecisions: ["decision-codex-automation"],
    relatedTrace: ["trace-owner-not-courier-contract"],
    whatItIs: "A governed operator workflow.",
    whatItIsNot: "A runtime autonomous loop or UI automation system.",
  },
  {
    pageId: "wiki-work-order-engine",
    title: "Work Order Engine",
    conceptType: "work-order-engine",
    summary: "The native read-only operating surface for governed Work Order state.",
    canonicalDefinition:
      "Work Order Engine integration makes /goal, /loop, queues, evidence rollups, blocked decisions, and completion reports inspectable inside WilliamOS without adding execution authority.",
    relatedSurfaces: ["/work-orders", "/goal-console", "/audit", "/decisions"],
    relatedEvidence: ["WOE integration surface", "Trace Ledger completion", "Academy/Wiki knowledge layer"],
    relatedAuthority: ["COMMAND_RUNNER_GATE", "AUTONOMOUS_LOOP_GATE", "PRODUCTION_WRITE_GATE"],
    relatedMemory: ["memory-stale-contradiction-review"],
    relatedDecisions: ["decision-command-execution", "decision-autonomy"],
    relatedTrace: ["trace-owner-not-courier-contract"],
    whatItIs: "A static-first read model for governed work.",
    whatItIsNot: "A command runner, autonomous loop engine, background worker, scheduler, or production-write surface.",
  },
  {
    pageId: "wiki-authority",
    title: "Authority",
    conceptType: "governance",
    summary: "The gate model for mutation and protected actions.",
    canonicalDefinition: "Authority defines what can be displayed, what remains blocked, and what requires owner approval.",
    relatedSurfaces: ["/governance", "/decisions", "/audit"],
    relatedEvidence: ["Authority refresh completion"],
    relatedAuthority: ["COMMAND_RUNNER_GATE", "PRODUCTION_DEPLOY_GATE"],
    relatedMemory: ["memory-authority-registry-current"],
    relatedDecisions: ["decision-autonomy"],
    relatedTrace: ["trace-authority-refresh-pass"],
    whatItIs: "A read-only representation of gates and boundaries.",
    whatItIsNot: "An approval engine or permission mutation system.",
  },
  {
    pageId: "wiki-memory",
    title: "Memory Governance",
    conceptType: "memory",
    summary: "The continuity layer for governed context.",
    canonicalDefinition: "Memory preserves context and review state without writing, ingesting, or authorizing action.",
    relatedSurfaces: ["/memory", "/trace"],
    relatedEvidence: ["Memory Governance Registry"],
    relatedAuthority: ["MEMORY_WRITE_GATE"],
    relatedMemory: ["memory-evidence-spine-current"],
    relatedDecisions: ["decision-secrets-handling"],
    relatedTrace: ["trace-memory-governance-boundary"],
    whatItIs: "Static governed continuity.",
    whatItIsNot: "Runtime memory, vector retrieval, or canon promotion.",
  },
  {
    pageId: "wiki-brain-council",
    title: "Brain Council",
    conceptType: "council",
    summary: "The advisory reasoning layer.",
    canonicalDefinition: "Brain Council may advise, reason, and recommend, but cannot execute, call tools, or activate workers.",
    relatedSurfaces: ["/brain-council", "/governance"],
    relatedEvidence: ["Brain Council Advisory Layer"],
    relatedAuthority: ["COUNCIL_RUNTIME_GATE"],
    relatedMemory: ["memory-owner-decision-queue-current"],
    relatedDecisions: ["decision-autonomy"],
    relatedTrace: ["trace-authority-refresh-pass"],
    whatItIs: "An advisory layer.",
    whatItIsNot: "A runtime agent system.",
  },
  {
    pageId: "wiki-hermes",
    title: "Hermes Sidecar",
    conceptType: "safety",
    summary: "The governed worker sidecar boundary.",
    canonicalDefinition: "Hermes is a proposed sidecar that remains disabled until explicit activation authority.",
    relatedSurfaces: ["/hermes", "/governance"],
    relatedEvidence: ["Hermes boundary doctrine"],
    relatedAuthority: ["HERMES_ACTIVATION_GATE", "MCP_ACTIVATION_GATE"],
    relatedMemory: ["memory-authority-registry-current"],
    relatedDecisions: ["decision-autonomy"],
    relatedTrace: ["trace-authority-refresh-pass"],
    whatItIs: "A documented sidecar boundary.",
    whatItIsNot: "An active worker, MCP runtime, scheduler, or autonomous service.",
  },
  {
    pageId: "wiki-agent-forge",
    title: "Agent Forge",
    conceptType: "forge",
    summary: "The skill and capability preparation surface.",
    canonicalDefinition: "Agent Forge prepares capability proposals, quarantine state, risk, evidence, and activation review requirements.",
    relatedSurfaces: ["/agent-forge", "/governance"],
    relatedEvidence: ["Agent Forge doctrine"],
    relatedAuthority: ["TOOL_CALL_GATE", "HERMES_ACTIVATION_GATE"],
    relatedMemory: ["memory-authority-registry-current"],
    relatedDecisions: ["decision-autonomy"],
    relatedTrace: ["trace-authority-refresh-pass"],
    whatItIs: "A capability preparation and quarantine model.",
    whatItIsNot: "An executable skill loader, dependency installer, or tool-calling runtime.",
  },
  {
    pageId: "wiki-trace-ledger",
    title: "Trace Ledger",
    conceptType: "trace",
    summary: "The reasoning record layer.",
    canonicalDefinition: "Trace Ledger records how goals, loops, WOs, evidence, memory, decisions, and authority gates were reasoned through.",
    relatedSurfaces: ["/trace", "/work-orders"],
    relatedEvidence: ["Trace Ledger completion"],
    relatedAuthority: ["READ_ONLY_TRACE_GATE"],
    relatedMemory: ["memory-stale-contradiction-review"],
    relatedDecisions: ["decision-command-execution"],
    relatedTrace: ["trace-authority-refresh-pass"],
    whatItIs: "A static reasoning record.",
    whatItIsNot: "Runtime tracing, background collection, or eval execution.",
  },
  {
    pageId: "wiki-county-ops",
    title: "County Ops Knowledge",
    conceptType: "county-ops",
    summary: "The static placement model for county operating knowledge.",
    canonicalDefinition: "County Ops knowledge may be documented as static guidance while PACS, county production systems, and TerraFusion production remain untouched.",
    relatedSurfaces: ["/projects", "/audit", "/governance"],
    relatedEvidence: ["county-ops-static-placement"],
    relatedAuthority: ["TERRAFUSION_TOUCH_GATE", "SECRET_ACCESS_GATE"],
    relatedMemory: ["memory-stale-contradiction-review"],
    relatedDecisions: ["decision-terrafusion-pacs-touch"],
    relatedTrace: ["trace-authority-refresh-pass"],
    whatItIs: "Static placement for PACS rules, levy workflows, BOE evidence, permits, redaction, ratio studies, and appeals knowledge.",
    whatItIsNot: "A PACS connection, county DB query, data extraction, or production county-system touch.",
  },
  {
    pageId: "wiki-local-omen",
    title: "Local OMEN",
    conceptType: "local-runtime",
    summary: "The local runtime status lane.",
    canonicalDefinition: "Local OMEN status is read-only, manual-only, and localhost-only.",
    relatedSurfaces: ["/runtime", "/governance"],
    relatedEvidence: ["Local OMEN authority freeze"],
    relatedAuthority: ["LOCAL_RUNTIME_METADATA_GATE", "LOCAL_RUNTIME_CONTROL_GATE"],
    relatedMemory: ["memory-local-omen-authority-freeze"],
    relatedDecisions: ["decision-docker-metadata", "decision-port-checks"],
    relatedTrace: ["trace-docker-runtime-timeout"],
    whatItIs: "A bounded local status surface.",
    whatItIsNot: "Runtime control, Docker metadata, backup scanning, port checks, service registration, or LAN exposure.",
  },
]

export const WILLIAMOS_GLOSSARY: GlossaryTerm[] = [
  ["Primary", "The human authority who approves gates, decisions, and boundaries.", "core"],
  ["Owner", "The person authorizing goals and safety boundaries; not a courier between WOs.", "core"],
  ["Operator", "A human or bounded agent operating inside authorized scope.", "core"],
  ["Codex Operator", "The bounded repo operator that executes authorized Work Orders end to end.", "core"],
  ["Courier", "The limited packet/result carrying role; not routine operator work.", "core"],
  ["/goal", "A governed intent packet that defines purpose and success state.", "core"],
  ["/loop", "A governed batch operation that Codex runs through authorized WOs.", "core"],
  ["Work Order", "A narrow unit of governed scope inside a batch.", "governance"],
  ["Work Order Engine", "The native read-only model for goals, loops, queues, evidence, blockers, and completion reports.", "governance"],
  ["Completion Report", "A final proof packet for a batch or Work Order; not an execution transcript or mutation control.", "governance"],
  ["Evidence", "Proof of reality; it informs but does not authorize.", "governance"],
  ["Authority", "The gate model for mutation and protected actions.", "governance"],
  ["Owner Decision", "A visible blocker or choice requiring Primary authority.", "governance"],
  ["Memory", "Governed continuity context; not runtime memory or permission.", "system"],
  ["Brain Council", "Advisory reasoning surface; not an agent runtime.", "system"],
  ["Trace Ledger", "Static reasoning record for work and blockers.", "system"],
  ["Failure-to-Eval", "A proposal to turn a failure into a future eval; not eval execution.", "system"],
  ["Eval", "A future test or evaluation proposal derived from a classified failure.", "system"],
  ["Hermes", "A worker/sidecar concept that remains blocked until activation gates.", "system"],
  ["MCP", "A tool-activation boundary that remains blocked until explicit authority.", "system"],
  ["Agent Forge", "The capability preparation surface for skills, risk, quarantine, and activation review.", "system"],
  ["Skill", "A proposed capability that remains quarantined until evidence and authority permit activation.", "system"],
  ["Quarantine", "The safe holding state for unreviewed capabilities, integrations, or skills.", "safety"],
  ["Local OMEN", "The local runtime host/status lane, currently read-only/manual-only/localhost-only.", "system"],
  ["Read-only subsystem", "A surface that displays state without mutation or execution.", "safety"],
  ["County Ops", "Static county-operating knowledge placement; no PACS or county production touch.", "system"],
  ["Production Write", "Any action that changes production state, data, runtime, release, or external-system posture.", "safety"],
  ["Autonomy", "System action without explicit bounded Work Order and owner authority.", "safety"],
  ["Stop condition", "A boundary crossing or validation failure that halts the loop.", "safety"],
  ["Safety posture", "The explicit set of powers that remain blocked.", "safety"],
].map(([term, definition, category]) => ({
  term,
  definition,
  category: category as GlossaryTerm["category"],
}))

export const ACADEMY_WIKI_SAFETY_PROOF_CARDS: AcademySafetyProofCard[] = [
  ["No runtime training engine", "blocked", "Academy lessons are static and do not train users or systems at runtime."],
  ["No progress persistence", "blocked", "No progress tracking, certification, quiz state, database, or schema change was added."],
  ["No command execution", "blocked", "Academy/Wiki has no command runner, run button, shell bridge, or execute endpoint."],
  ["No automation", "blocked", "No Codex automation, agent start, worker activation, Hermes/MCP activation, or autonomy was added."],
  ["No dynamic ingestion", "blocked", "Wiki pages and lessons do not scan files, call GitHub, ingest content, or build dynamic indexes."],
  ["No authority mutation", "blocked", "Academy/Wiki teaches gates but does not approve, deny, mutate, or grant authority."],
  ["No local/runtime expansion", "blocked", "No Docker metadata, backup scan, port check, runtime control, service, scheduler, or LAN exposure was added."],
].map(([label, value, description]) => ({ label, value, description }))

export function getAcademyWikiSurface(): AcademyWikiSurface {
  return {
    academyDoctrine: ACADEMY_DOCTRINE,
    wikiDoctrine: WIKI_DOCTRINE,
    lessons: ACADEMY_LESSONS,
    wikiPages: WIKI_PAGES,
    glossary: WILLIAMOS_GLOSSARY,
    featuredLesson:
      ACADEMY_LESSONS.find((lesson) => lesson.lessonId === "lesson-operator-onboarding") ??
      ACADEMY_LESSONS[0],
    featuredWikiPage: WIKI_PAGES.find((page) => page.pageId === "wiki-authority") ?? WIKI_PAGES[0],
    safetyProofCards: ACADEMY_WIKI_SAFETY_PROOF_CARDS,
    navigation: [
      { label: "Work Orders", href: "/work-orders", description: "Review WOs that Academy lessons explain." },
      { label: "Goal Console", href: "/goal-console", description: "Review /goal and /loop read-only placement." },
      { label: "Evidence", href: "/audit", description: "Review proof used by lessons and wiki concepts." },
      { label: "Authority", href: "/governance", description: "Review gates behind protected actions." },
      { label: "Memory", href: "/memory", description: "Review governed continuity context." },
      { label: "Brain Council", href: "/brain-council", description: "Review advisory reasoning boundaries." },
      { label: "Trace Ledger", href: "/trace", description: "Review reasoning records and failure-to-eval proposals." },
      { label: "Local Status", href: "/runtime", description: "Review read-only local runtime status." },
    ],
    nextLaneDecision: {
      recommendedBatch: "WILLIAMOS-WOE-SHELL-POLISH-BATCH-001",
      recommendedOption: "A - WOE Shell Polish",
      blockedLanes: [
        "Hermes activation",
        "MCP activation",
        "worker activation",
        "command runner",
        "autonomous loop execution",
        "background worker",
        "production-write behavior",
      ],
      reason:
        "After static-first WOE integration, the next safe lane is shell polish and evidence clarity, not execution authority.",
    },
    safety: {
      staticReadOnly: true,
      runtimeTrainingAdded: false,
      progressPersistenceAdded: false,
      quizStateMutationAdded: false,
      certificationEngineAdded: false,
      databaseAdded: false,
      dbSchemaChanged: false,
      filesystemScanAdded: false,
      dynamicIngestionAdded: false,
      githubApiIntegrationAdded: false,
      commandExecutionAdded: false,
      commandRunnerAdded: false,
      codexAutomationAdded: false,
      councilRuntimeAdded: false,
      hermesActivationAdded: false,
      mcpActivationAdded: false,
      workerActivationAdded: false,
      memoryWriteAdded: false,
      runtimeMemoryReadAdded: false,
      vectorStoreAdded: false,
      embeddingsAdded: false,
      evalExecutionAdded: false,
      testGenerationAutomationAdded: false,
      dockerMetadataAdded: false,
      backupScanAdded: false,
      portChecksAdded: false,
      runtimeControlAdded: false,
      persistenceImplemented: false,
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
