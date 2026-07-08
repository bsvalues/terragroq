export type TraceCategory =
  | "GOAL_TRACE"
  | "LOOP_TRACE"
  | "WORK_ORDER_TRACE"
  | "EVIDENCE_TRACE"
  | "MEMORY_TRACE"
  | "COUNCIL_TRACE"
  | "AUTHORITY_TRACE"
  | "OWNER_DECISION_TRACE"
  | "BLOCKED_TRACE"
  | "FAILURE_TRACE"
  | "EVAL_PROPOSAL_TRACE"
  | "SAFETY_TRACE"

export type FailureType =
  | "VALIDATION_FAILURE"
  | "BUILD_FAILURE"
  | "ROUTE_PROOF_FAILURE"
  | "DOCKER_RUNTIME_FAILURE"
  | "AUTHORITY_BLOCKER"
  | "SCOPE_CONFLICT"
  | "STALE_IMAGE_LIMITATION"
  | "ENVIRONMENT_DEPENDENCY"
  | "OWNER_DECISION_REQUIRED"
  | "SAFETY_STOP"
  | "UNKNOWN"

export type EvidenceGapType =
  | "MISSING_BASE_PROOF"
  | "MISSING_PR_CHECKS"
  | "MISSING_PRODUCTION_ROUTE_PROOF"
  | "MISSING_OWNER_DECISION"
  | "MISSING_AUTHORITY_GATE"
  | "MISSING_SAFETY_FLAGS"
  | "CONTRADICTED_EVIDENCE"
  | "STALE_CONTEXT"

export type ConfidenceMovement =
  | "confidence-raised"
  | "confidence-lowered"
  | "confidence-blocked"
  | "confidence-unchanged"

export type TraceRecord = {
  traceId: string
  title: string
  category: TraceCategory
  relatedGoal: string
  relatedLoop: string
  relatedBatch: string
  relatedWorkOrder: string
  relatedPr: string
  originMain: string
  inputSummary: string
  reasoningSummary: string
  evidenceUsed: string[]
  memoryReferenced: string[]
  councilPacket: string
  ownerDecision: string
  authorityGate: string
  result: "pass" | "blocked" | "proposal" | "review"
  failureType: FailureType | "NONE"
  proposedEval: string
  whatItProves: string
  whatItDoesNotAuthorize: string
}

export type EvidenceGapClassification = {
  gapType: EvidenceGapType
  description: string
  safeDefault: string
  confidenceEffect: ConfidenceMovement
}

export type ConfidenceMovementRule = {
  movement: ConfidenceMovement
  trigger: string
  traceRequirement: string
  authorityBoundary: string
}

export type FailureClassification = {
  failureType: FailureType
  description: string
  safeDefault: string
  proposedEvalUse: string
}

export type FailureToEvalCandidateField = {
  label: string
  required: boolean
  description: string
}

export type FailureToEvalCandidatePacket = {
  title: string
  rule: string
  requiredFields: FailureToEvalCandidateField[]
  blockedUntilAuthorized: string[]
}

export type FailureToEvalProposal = {
  proposalId: string
  sourceTrace: string
  failureType: FailureType
  proposedEvalTitle: string
  proposedEvalScope: string
  evidenceNeeded: string[]
  expectedAssertion: string
  riskLevel: "low" | "medium" | "high" | "critical"
  authorityRequired: string
  status: "proposal-only" | "blocked" | "needs-owner-decision"
  whatThisDoesNotDo: string
}

export type TraceLink = {
  traceId: string
  relatedItem: string
  relationship: string
  boundary: string
}

export type TraceSafetyProofCard = {
  label: string
  value: string
  description: string
}

export type TraceLedgerSurface = {
  currentBatch: {
    goal: string
    batch: string
    base: string
    mode: string
    workOrders: string[]
  }
  doctrine: {
    title: string
    statements: readonly string[]
  }
  categories: {
    category: TraceCategory
    description: string
  }[]
  records: TraceRecord[]
  failureClassifications: FailureClassification[]
  evidenceGapClassifications: EvidenceGapClassification[]
  confidenceMovementModel: ConfidenceMovementRule[]
  evalCandidatePacket: FailureToEvalCandidatePacket
  evalProposals: FailureToEvalProposal[]
  workOrderLinks: TraceLink[]
  evidenceLinks: TraceLink[]
  memoryLinks: TraceLink[]
  ownerDecisionLinks: TraceLink[]
  authorityLinks: TraceLink[]
  councilLinks: TraceLink[]
  safetyProofCards: TraceSafetyProofCard[]
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
    runtimeTracingAdded: false
    backgroundCollectionAdded: false
    evalExecutionAdded: false
    testGenerationAdded: false
    evalFileCreationAdded: false
    filesystemScanAdded: false
    githubApiIntegrationAdded: false
    dynamicIngestionAdded: false
    persistenceImplemented: false
    databaseAdded: false
    dbSchemaChanged: false
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
    vectorStoreAdded: false
    embeddingsAdded: false
    dockerMetadataAdded: false
    backupScanAdded: false
    portChecksAdded: false
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

export const TRACE_DOCTRINE = {
  title: "Trace Ledger Doctrine",
  statements: [
    "Traces explain how work was reasoned through.",
    "A trace may connect a goal, loop, batch, Work Order, evidence, memory, owner decision, authority gate, and Council packet.",
    "Trace records in this batch are static and read-only.",
    "Traces do not collect runtime data.",
    "Traces do not create, generate, or execute evals automatically.",
    "Failure-to-eval proposals identify future test ideas; they do not create tests.",
    "Trace evidence informs review but does not grant authority.",
    "The Primary remains the approving authority.",
  ],
} as const

export const TRACE_CATEGORIES = [
  ["GOAL_TRACE", "Captures the governed intent and success state behind a goal."],
  ["LOOP_TRACE", "Captures the authorized batch loop and continuation contract."],
  ["WORK_ORDER_TRACE", "Captures the scope, result, validation, and next work for a WO."],
  ["EVIDENCE_TRACE", "Captures which proof records informed the conclusion."],
  ["MEMORY_TRACE", "Captures which governed memory records were relevant and bounded."],
  ["COUNCIL_TRACE", "Captures advisory Council packets without allowing runtime Council action."],
  ["AUTHORITY_TRACE", "Captures the authority gate that governed a decision or blocker."],
  ["OWNER_DECISION_TRACE", "Captures owner-decision requirements without mutating decision state."],
  ["BLOCKED_TRACE", "Captures why protected work stopped or remained parked."],
  ["FAILURE_TRACE", "Captures a failure or blocker classification for later review."],
  ["EVAL_PROPOSAL_TRACE", "Captures a proposed eval idea without creating or running it."],
  ["SAFETY_TRACE", "Captures the safety boundary preserved by the work."],
].map(([category, description]) => ({ category: category as TraceCategory, description }))

export const FAILURE_CLASSIFICATIONS: FailureClassification[] = [
  ["VALIDATION_FAILURE", "A focused or full validation command failed.", "Stop and fix only inside scope.", "Assert the failed validation stays covered."],
  ["BUILD_FAILURE", "The production build failed.", "Classify tooling vs code defect before continuing.", "Add build regression coverage if source-caused."],
  ["ROUTE_PROOF_FAILURE", "An expected route did not return the expected state.", "Stop proof and capture exact failing route.", "Add a route contract test if authorized."],
  ["DOCKER_RUNTIME_FAILURE", "Docker or container runtime blocked proof.", "Do not prune/reset; create repair gate.", "Add runtime repair decision fixture if authorized."],
  ["AUTHORITY_BLOCKER", "The next action requires authority not granted by the packet.", "Default deny.", "Add authority boundary assertion."],
  ["SCOPE_CONFLICT", "The implementation would cross packet scope.", "Stop and return a decision packet.", "Add a scope guard test."],
  ["STALE_IMAGE_LIMITATION", "A container image did not include current source behavior.", "Refresh only through authorized proof lane.", "Add image freshness proof if authorized."],
  ["ENVIRONMENT_DEPENDENCY", "A local or external dependency was unavailable.", "Classify as environment, not code, until proven otherwise.", "Add environment readiness check if authorized."],
  ["OWNER_DECISION_REQUIRED", "The Primary must decide before work can proceed.", "Stop and queue owner decision.", "Add decision queue evidence if authorized."],
  ["SAFETY_STOP", "A stop condition protected the system.", "Preserve evidence and do not proceed.", "Add safety proof card if authorized."],
  ["UNKNOWN", "The failure is not yet classified.", "Collect non-mutating evidence only.", "Propose classification eval after review."],
].map(([failureType, description, safeDefault, proposedEvalUse]) => ({
  failureType: failureType as FailureType,
  description,
  safeDefault,
  proposedEvalUse,
}))

export const EVIDENCE_GAP_CLASSIFICATIONS: EvidenceGapClassification[] = [
  [
    "MISSING_BASE_PROOF",
    "The trace names a base or result without current origin/main proof.",
    "Mark the trace stale until current base evidence is cited.",
    "confidence-blocked",
  ],
  [
    "MISSING_PR_CHECKS",
    "The trace claims PR readiness or mergeability without check evidence.",
    "Lower confidence and require PR check proof before completion claims.",
    "confidence-lowered",
  ],
  [
    "MISSING_PRODUCTION_ROUTE_PROOF",
    "The trace claims production health without route status evidence.",
    "Block production-readiness claims until route proof is recorded.",
    "confidence-blocked",
  ],
  [
    "MISSING_OWNER_DECISION",
    "The trace depends on Primary authority but no owner decision is identified.",
    "Stop at owner decision required.",
    "confidence-blocked",
  ],
  [
    "MISSING_AUTHORITY_GATE",
    "The trace recommends a protected next move without naming the gate.",
    "Default deny and add the authority gate before recommending action.",
    "confidence-blocked",
  ],
  [
    "MISSING_SAFETY_FLAGS",
    "The trace omits blocked runtime, execution, data, production, autonomy, or secret flags.",
    "Lower confidence and require a safety sweep.",
    "confidence-lowered",
  ],
  [
    "CONTRADICTED_EVIDENCE",
    "Current evidence conflicts with the trace conclusion.",
    "Classify as blocked and require reconciliation before recommendation.",
    "confidence-blocked",
  ],
  [
    "STALE_CONTEXT",
    "The trace uses older packet state where live repo, PR, or production state has moved.",
    "Reconcile to current state before treating the trace as evidence.",
    "confidence-lowered",
  ],
].map(([gapType, description, safeDefault, confidenceEffect]) => ({
  gapType: gapType as EvidenceGapType,
  description,
  safeDefault,
  confidenceEffect: confidenceEffect as ConfidenceMovement,
}))

export const CONFIDENCE_MOVEMENT_MODEL: ConfidenceMovementRule[] = [
  {
    movement: "confidence-raised",
    trigger: "Current base, tests, build, PR checks, review threads, and production route proof are all cited.",
    traceRequirement: "Record the exact evidence and the route/check result that raised confidence.",
    authorityBoundary: "Higher confidence still does not grant authority.",
  },
  {
    movement: "confidence-lowered",
    trigger: "Evidence is partial, stale, indirect, or missing a non-critical proof point.",
    traceRequirement: "Name the missing evidence gap and keep the recommendation advisory.",
    authorityBoundary: "Lower confidence cannot be hidden by stronger wording.",
  },
  {
    movement: "confidence-blocked",
    trigger: "Owner authority, production proof, safety flags, or contradiction reconciliation is missing.",
    traceRequirement: "Record the blocker and stop at the next safe gate.",
    authorityBoundary: "Blocked confidence cannot become a Work Order without owner authority.",
  },
  {
    movement: "confidence-unchanged",
    trigger: "New evidence confirms the current conclusion but adds no new authority or proof depth.",
    traceRequirement: "Append the corroborating evidence as static context only.",
    authorityBoundary: "No state changes are implied.",
  },
]

export const FAILURE_TO_EVAL_CANDIDATE_PACKET: FailureToEvalCandidatePacket = {
  title: "Failure-to-Eval candidate packet",
  rule:
    "A failure can become an eval candidate only as a static proposal until a future Work Order authorizes implementation.",
  requiredFields: [
    {
      label: "Candidate ID",
      required: true,
      description: "Stable identifier for the proposed eval candidate.",
    },
    {
      label: "Source trace",
      required: true,
      description: "Trace record that captured the failure, blocker, or evidence gap.",
    },
    {
      label: "Failure classification",
      required: true,
      description: "Failure type that explains why this could become an eval.",
    },
    {
      label: "Evidence gap",
      required: true,
      description: "Missing or contradicted proof the future eval should guard.",
    },
    {
      label: "Expected assertion",
      required: true,
      description: "Plain-language assertion a future eval might check.",
    },
    {
      label: "Risk level",
      required: true,
      description: "Risk level if the failure repeats without coverage.",
    },
    {
      label: "Authority required",
      required: true,
      description: "Future owner authority needed before writing or running any eval.",
    },
    {
      label: "Blocked actions",
      required: true,
      description: "Runtime, command, worker, production, memory, or data actions still blocked.",
    },
  ],
  blockedUntilAuthorized: [
    "create eval file",
    "run eval",
    "runtime trace collection",
    "telemetry service activation",
    "write memory",
    "dispatch worker",
    "invoke command runner",
  ],
}

export const TRACE_RECORDS: TraceRecord[] = [
  {
    traceId: "trace-brain-council-advisory-complete",
    title: "Brain Council advisory layer completed without activation",
    category: "COUNCIL_TRACE",
    relatedGoal: "GOAL-WOS-003",
    relatedLoop: "WILLIAMOS-BRAIN-COUNCIL-ADVISORY-BATCH-001",
    relatedBatch: "WILLIAMOS-BRAIN-COUNCIL-ADVISORY-BATCH-001",
    relatedWorkOrder: "WO-COUNCIL-001 through WO-COUNCIL-011",
    relatedPr: "#324 and #325",
    originMain: "aa824c3aee6d59a155f38572a62288f2e31e8330",
    inputSummary: "Brain Council advisory doctrine, state, decision packet, evidence, confidence, and WOE recommendation model landed.",
    reasoningSummary: "The Council can advise, cite evidence, rate confidence and risk, and recommend WOs, but it remains static/read-only and cannot activate tools, workers, Hermes, MCP, memory writes, or production behavior.",
    evidenceUsed: ["PR #324 merged", "PR #325 merged", "production /brain-council 200", "Council safety tests"],
    memoryReferenced: ["Brain Council Advisory Layer completion"],
    councilPacket: "Council is available as advisory context for Trace/Eval, not as a runtime actor.",
    ownerDecision: "Trace Ledger + Failure-to-Eval selected as the next read-only proof-history lane.",
    authorityGate: "COUNCIL_RUNTIME_GATE",
    result: "pass",
    failureType: "NONE",
    proposedEval: "Future eval candidates should assert Council recommendations never imply execution authority.",
    whatItProves: "Council advisory state can feed Trace/Eval evidence without adding Council runtime power.",
    whatItDoesNotAuthorize: "Does not authorize Council runtime, autonomous reasoning loop, tool calls, Hermes/MCP activation, worker activation, memory writes, or production writes.",
  },
  {
    traceId: "trace-authority-refresh-pass",
    title: "Authority refresh closed the governance gate",
    category: "AUTHORITY_TRACE",
    relatedGoal: "GOAL-WOS-007",
    relatedLoop: "WILLIAMOS-AUTHORITY-GOVERNANCE-REGISTRY-REFRESH-BATCH-001",
    relatedBatch: "WILLIAMOS-AUTHORITY-GOVERNANCE-REGISTRY-REFRESH-BATCH-001",
    relatedWorkOrder: "WO-AUTHORITY-001 through WO-AUTHORITY-017",
    relatedPr: "#291",
    originMain: "0f1ebf24c5da8533add476a413326dfd82e81a39",
    inputSummary: "Owner authorized a read-only authority refresh after Brain Council advisory stabilization.",
    reasoningSummary: "Authority gates were refreshed across runtime, memory, Council, metadata, production, DB/schema, and autonomy without granting execution.",
    evidenceUsed: ["WO-AUTHORITY-016 rollup", "WO-AUTHORITY-017 next lane decision", "authority-registry focused tests"],
    memoryReferenced: ["Memory Governance Registry remains read-only"],
    councilPacket: "Brain Council Advisory Layer complete; Council remains advisory.",
    ownerDecision: "No authority expansion granted.",
    authorityGate: "AUTHORITY_TRACE_LEDGER_GATE",
    result: "pass",
    failureType: "NONE",
    proposedEval: "Trace Ledger should preserve authority boundaries without runtime tracing.",
    whatItProves: "Authority refresh reached Phase Pass and selected Trace Ledger as the next read-only lane.",
    whatItDoesNotAuthorize: "Does not authorize runtime tracing, Council runtime, Hermes/MCP, memory writes, metadata, or production action.",
  },
  {
    traceId: "trace-docker-runtime-timeout",
    title: "Docker timeout became a repair decision instead of destructive cleanup",
    category: "FAILURE_TRACE",
    relatedGoal: "GOAL-LOCAL-OMEN",
    relatedLoop: "LOCAL-OMEN-STALE-IMAGE-AND-POSTGRES-PROOF-GATE-BATCH-001",
    relatedBatch: "LOCAL-OMEN-STALE-IMAGE-AND-POSTGRES-PROOF-GATE-BATCH-001",
    relatedWorkOrder: "WO-LOCAL-093 through WO-LOCAL-094D",
    relatedPr: "#270 through #274",
    originMain: "historical local runtime lane",
    inputSummary: "Manual proof was blocked by Docker Desktop / WSL backend responsiveness.",
    reasoningSummary: "The blocker was classified as runtime backend health, not app-image failure, so destructive repair was not improvised.",
    evidenceUsed: ["Docker inspect/log evidence", "Docker UI health check", "repair gate reports"],
    memoryReferenced: ["Local OMEN runtime authority freeze"],
    councilPacket: "None.",
    ownerDecision: "Destructive Docker repair stayed blocked.",
    authorityGate: "LOCAL_RUNTIME_CONTROL_GATE",
    result: "blocked",
    failureType: "DOCKER_RUNTIME_FAILURE",
    proposedEval: "A future eval could assert Docker backend failures route to decision packets before destructive repair.",
    whatItProves: "Runtime blockers should become evidence and decision packets, not unscoped cleanup.",
    whatItDoesNotAuthorize: "Does not authorize Docker reset, prune, volume mutation, or container recreation.",
  },
  {
    traceId: "trace-owner-not-courier-contract",
    title: "Owner is not the courier",
    category: "LOOP_TRACE",
    relatedGoal: "GOAL-WOS-005",
    relatedLoop: "WILLIAMOS-TRACE-EVAL-BATCH-001",
    relatedBatch: "WILLIAMOS-TRACE-EVAL-BATCH-001",
    relatedWorkOrder: "WO-TRACE-001 through WO-TRACE-009",
    relatedPr: "current batch",
    originMain: "aa824c3aee6d59a155f38572a62288f2e31e8330",
    inputSummary: "The packet requires Codex to operate the loop instead of returning partial WO handoffs.",
    reasoningSummary: "The trace lane records the operator contract as a static trace so future batches can preserve the same continuation rule.",
    evidenceUsed: ["Trace doctrine", "Owner decision queue", "Authority refresh"],
    memoryReferenced: ["Bounded batch execution preference"],
    councilPacket: "Trace Ledger recommended by authority refresh next-lane decision.",
    ownerDecision: "Goal and loop authorized by owner packet.",
    authorityGate: "READ_ONLY_TRACE_GATE",
    result: "pass",
    failureType: "NONE",
    proposedEval: "Assert future operator packets do not ask for continuation between listed WOs.",
    whatItProves: "The batch should self-advance inside authorized scope.",
    whatItDoesNotAuthorize: "Does not authorize autonomous app runtime loops or UI/Codex automation.",
  },
  {
    traceId: "trace-memory-governance-boundary",
    title: "Memory supports trace context but does not become runtime memory",
    category: "MEMORY_TRACE",
    relatedGoal: "GOAL-WOS-005",
    relatedLoop: "WILLIAMOS-MEMORY-GOVERNANCE-REGISTRY-BATCH-001",
    relatedBatch: "WILLIAMOS-MEMORY-GOVERNANCE-REGISTRY-BATCH-001",
    relatedWorkOrder: "WO-MEMORY-001 through WO-MEMORY-015",
    relatedPr: "#289",
    originMain: "d9234fc5e5dc5dffe7b627541e4cbc51ac84101a",
    inputSummary: "Memory governance became static/read-only before trace work began.",
    reasoningSummary: "Trace records can reference governed memory labels but cannot read runtime memory, write memory, or promote canon.",
    evidenceUsed: ["Memory Governance rollup", "Memory safety sweep"],
    memoryReferenced: ["memory-local-omen-authority-freeze", "memory-stale-contradiction-review"],
    councilPacket: "None.",
    ownerDecision: "Memory write/canon remains blocked.",
    authorityGate: "MEMORY_WRITE_GATE",
    result: "pass",
    failureType: "NONE",
    proposedEval: "Assert trace records may link memory records without runtime memory reads.",
    whatItProves: "Memory can inform trace context as static provenance.",
    whatItDoesNotAuthorize: "Does not authorize memory ingestion, writes, runtime reads, embeddings, or vector store.",
  },
]

export const FAILURE_TO_EVAL_PROPOSALS: FailureToEvalProposal[] = [
  {
    proposalId: "eval-proposal-council-no-execution",
    sourceTrace: "trace-brain-council-advisory-complete",
    failureType: "SCOPE_CONFLICT",
    proposedEvalTitle: "Council advice never implies execution authority",
    proposedEvalScope: "Council, WOE, and Trace safety language",
    evidenceNeeded: ["Council decision packet schema", "Trace safety proof cards", "WOE recommendation model"],
    expectedAssertion: "Council recommendations can cite evidence and recommend WOs, but cannot execute, create WOs automatically, or invoke Codex.",
    riskLevel: "medium",
    authorityRequired: "Future eval implementation authority",
    status: "proposal-only",
    whatThisDoesNotDo: "Does not create, write, or run an eval; does not activate Council runtime.",
  },
  {
    proposalId: "eval-proposal-owner-not-courier",
    sourceTrace: "trace-owner-not-courier-contract",
    failureType: "SCOPE_CONFLICT",
    proposedEvalTitle: "Operator batches self-advance through authorized WOs",
    proposedEvalScope: "Static packet/return-format behavior",
    evidenceNeeded: ["batch packet", "completion report", "no mid-WO owner prompt"],
    expectedAssertion: "If the next WO is authorized and no stop condition exists, Codex continues without asking the Owner.",
    riskLevel: "low",
    authorityRequired: "Future eval implementation authority",
    status: "proposal-only",
    whatThisDoesNotDo: "Does not create a test file, run an eval, or automate Codex.",
  },
  {
    proposalId: "eval-proposal-runtime-repair-gate",
    sourceTrace: "trace-docker-runtime-timeout",
    failureType: "DOCKER_RUNTIME_FAILURE",
    proposedEvalTitle: "Docker backend failures route to repair gates",
    proposedEvalScope: "Failure classification and stop-condition language",
    evidenceNeeded: ["Docker timeout finding", "repair decision packet", "safety return"],
    expectedAssertion: "Docker runtime failures must not trigger prune/reset/recreate without explicit authority.",
    riskLevel: "medium",
    authorityRequired: "Future eval implementation authority",
    status: "blocked",
    whatThisDoesNotDo: "Does not inspect Docker, run containers, or mutate runtime.",
  },
  {
    proposalId: "eval-proposal-trace-boundary",
    sourceTrace: "trace-authority-refresh-pass",
    failureType: "AUTHORITY_BLOCKER",
    proposedEvalTitle: "Trace records do not grant authority",
    proposedEvalScope: "Trace Ledger safety model",
    evidenceNeeded: ["trace safety flags", "authority gate links"],
    expectedAssertion: "Trace records show authority gates and what they do not authorize.",
    riskLevel: "low",
    authorityRequired: "Future eval implementation authority",
    status: "proposal-only",
    whatThisDoesNotDo: "Does not execute evals or update authority state.",
  },
]

function link(traceId: string, relatedItem: string, relationship: string, boundary: string): TraceLink {
  return { traceId, relatedItem, relationship, boundary }
}

export const TRACE_WORK_ORDER_LINKS = [
  link("trace-brain-council-advisory-complete", "WO-COUNCIL-001 through WO-COUNCIL-011", "Council advisory source", "Read-only trace linkage only."),
  link("trace-authority-refresh-pass", "WO-AUTHORITY-001 through WO-AUTHORITY-017", "Authority refresh source", "Read-only report linkage only."),
  link("trace-owner-not-courier-contract", "WO-TRACE-001 through WO-TRACE-009", "Current trace batch", "No work-order execution controls."),
]

export const TRACE_EVIDENCE_LINKS = [
  link("trace-brain-council-advisory-complete", "docs/reports/WO-COUNCIL-011-focused-tests-final-rollup.md", "Council final evidence", "Evidence does not activate Council."),
  link("trace-authority-refresh-pass", "docs/reports/WO-AUTHORITY-016-authority-registry-rollup.md", "Rollup evidence", "Evidence proves completion but grants no authority."),
  link("trace-docker-runtime-timeout", "Docker runtime repair reports", "Failure evidence", "Historical evidence only; no runtime inspection."),
]

export const TRACE_MEMORY_LINKS = [
  link("trace-memory-governance-boundary", "memory-local-omen-authority-freeze", "Memory context", "Static link; no runtime memory read."),
  link("trace-memory-governance-boundary", "memory-stale-contradiction-review", "Review posture", "No memory write or canon promotion."),
]

export const TRACE_OWNER_DECISION_LINKS = [
  link("trace-docker-runtime-timeout", "decision-runtime-control", "Runtime control remains blocked", "No decision mutation or approval control."),
  link("trace-authority-refresh-pass", "decision-autonomy", "Autonomy remains blocked", "No state transition."),
]

export const TRACE_AUTHORITY_LINKS = [
  link("trace-authority-refresh-pass", "AUTHORITY_TRACE_LEDGER_GATE", "Authority gate context", "Trace does not grant authority."),
  link("trace-docker-runtime-timeout", "LOCAL_RUNTIME_CONTROL_GATE", "Runtime repair gate", "No local runtime control."),
  link("trace-memory-governance-boundary", "MEMORY_WRITE_GATE", "Memory gate", "No memory write."),
]

export const TRACE_COUNCIL_LINKS = [
  link("trace-brain-council-advisory-complete", "Council advisory surface", "Council feeds trace confidence", "Advisory only; no Council runtime."),
  link("trace-authority-refresh-pass", "Brain Council Advisory Layer", "Council-advised next lane", "Council recommends but does not execute."),
  link("trace-owner-not-courier-contract", "Council packet authority boundary", "Advisory context", "No Council runtime or worker activation."),
]

export const TRACE_SAFETY_PROOF_CARDS: TraceSafetyProofCard[] = [
  ["No runtime tracing", "blocked", "Trace records are static/read-only and do not collect runtime events."],
  ["No background collection", "blocked", "No worker, scheduler, poller, or background collector was added."],
  ["No persistence", "blocked", "No database, schema, trace table, or storage mutation was added."],
  ["No eval execution", "blocked", "Failure-to-eval entries are proposals only; no evals or tests are generated or run by the app."],
  ["No command execution", "blocked", "Trace Ledger has no command runner, shell bridge, or action endpoint."],
  ["No memory writes", "blocked", "Trace links to memory are static and do not read or write runtime memory."],
  ["No autonomy", "blocked", "No Council runtime, Hermes, MCP, worker activation, or autonomous loop was added."],
].map(([label, value, description]) => ({ label, value, description }))

export function getTraceLedgerSurface(): TraceLedgerSurface {
  return {
    currentBatch: {
      goal: "GOAL-WOS-005 - Trace Ledger + Failure-to-Eval",
      batch: "WILLIAMOS-TRACE-EVAL-BATCH-001",
      base: "origin/main = aa824c3aee6d59a155f38572a62288f2e31e8330",
      mode: "static/read-only proof history and eval candidate modeling",
      workOrders: [
        "WO-TRACE-001 - Trace Ledger Doctrine + Static Model",
        "WO-TRACE-002 - Trace Ledger Surface / Registry Placement",
        "WO-TRACE-003 - Failure Taxonomy Model",
        "WO-TRACE-004 - Evidence Gap + Confidence Movement Model",
        "WO-TRACE-005 - Failure-to-Eval Candidate Packet Model",
        "WO-TRACE-006 - Council / WOE / Evidence Cross-Link Pass",
        "WO-TRACE-007 - Academy / Wiki Trace + Eval Learning Pass",
        "WO-TRACE-008 - Safety Sweep: No Runtime Trace Collection / No Eval Runner",
        "WO-TRACE-009 - Focused Tests + Final Evidence Rollup",
      ],
    },
    doctrine: TRACE_DOCTRINE,
    categories: TRACE_CATEGORIES,
    records: TRACE_RECORDS,
    failureClassifications: FAILURE_CLASSIFICATIONS,
    evidenceGapClassifications: EVIDENCE_GAP_CLASSIFICATIONS,
    confidenceMovementModel: CONFIDENCE_MOVEMENT_MODEL,
    evalCandidatePacket: FAILURE_TO_EVAL_CANDIDATE_PACKET,
    evalProposals: FAILURE_TO_EVAL_PROPOSALS,
    workOrderLinks: TRACE_WORK_ORDER_LINKS,
    evidenceLinks: TRACE_EVIDENCE_LINKS,
    memoryLinks: TRACE_MEMORY_LINKS,
    ownerDecisionLinks: TRACE_OWNER_DECISION_LINKS,
    authorityLinks: TRACE_AUTHORITY_LINKS,
    councilLinks: TRACE_COUNCIL_LINKS,
    safetyProofCards: TRACE_SAFETY_PROOF_CARDS,
    navigation: [
      { label: "Work Orders", href: "/work-orders", description: "Inspect the Work Orders related to each trace." },
      { label: "Evidence", href: "/audit", description: "Inspect proof used by the trace without granting authority." },
      { label: "Memory", href: "/memory", description: "Inspect governed memory context without runtime memory reads." },
      { label: "Decisions", href: "/decisions", description: "Inspect owner decisions related to blockers." },
      { label: "Governance", href: "/governance", description: "Inspect authority gates tied to the trace." },
      { label: "Brain Council", href: "/brain-council", description: "Inspect advisory context without Council runtime." },
    ],
    nextLaneDecision: {
      recommendedBatch: "WILLIAMOS-TRACE-EVAL-EVIDENCE-POLISH-BATCH-001",
      recommendedOption: "A - Trace/Eval evidence clarity polish",
      blockedLanes: [
        "runtime trace collection",
        "telemetry service",
        "eval execution",
        "command runner",
        "autonomy",
        "memory write",
        "dynamic ingestion",
      ],
      reason:
        "Trace/Eval now has the static proof-history model. The next safe lane should polish evidence clarity or pause for owner direction, not open runtime telemetry or eval execution.",
    },
    safety: {
      staticReadOnly: true,
      runtimeTracingAdded: false,
      backgroundCollectionAdded: false,
      evalExecutionAdded: false,
      testGenerationAdded: false,
      evalFileCreationAdded: false,
      filesystemScanAdded: false,
      githubApiIntegrationAdded: false,
      dynamicIngestionAdded: false,
      persistenceImplemented: false,
      databaseAdded: false,
      dbSchemaChanged: false,
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
      vectorStoreAdded: false,
      embeddingsAdded: false,
      dockerMetadataAdded: false,
      backupScanAdded: false,
      portChecksAdded: false,
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
