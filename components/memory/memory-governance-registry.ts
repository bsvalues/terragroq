export type MemoryGovernanceCategory =
  | "FACT"
  | "DECISION"
  | "PROCEDURE"
  | "PATTERN"
  | "POLICY"
  | "PREFERENCE"
  | "PROJECT_STATE"
  | "LOCAL_RUNTIME_STATE"
  | "EVIDENCE_SUMMARY"
  | "AUTHORITY_SUMMARY"
  | "OWNER_DECISION_SUMMARY"
  | "REVIEW_QUEUE_ITEM"
  | "AUTHORITY_MEMORY"
  | "EVIDENCE_LINKED_MEMORY"
  | "TRACE_LINKED_MEMORY"
  | "COUNCIL_REFERENCED_MEMORY"
  | "FUTURE_SKILL_FORGE_REFERENCED_MEMORY"
  | "CONTRADICTION"
  | "STALE_ITEM"
  | "SENSITIVE_ITEM"

export type MemoryGovernanceState =
  | "DRAFT"
  | "REVIEW_REQUIRED"
  | "EVIDENCE_BACKED"
  | "CANON_ELIGIBLE"
  | "CANON_APPROVED_OUT_OF_BAND"
  | "STALE"
  | "CONTRADICTED"
  | "PARKED"
  | "BLOCKED"

export type MemorySensitivityLevel =
  | "PUBLIC_SAFE"
  | "INTERNAL"
  | "PRIVATE_OPERATOR"
  | "SENSITIVE_LOCAL"
  | "SECRET_ADJACENT"
  | "BLOCKED_FROM_MEMORY"

export type MemoryRiskLevel = "low" | "medium" | "high" | "critical"

export type MemoryGovernanceRecord = {
  memoryId: string
  title: string
  category: MemoryGovernanceCategory
  state: MemoryGovernanceState
  sensitivity: MemorySensitivityLevel
  confidence: "low" | "medium" | "high"
  summary: string
  sourceType: string
  evidenceLinks: string[]
  authorityLinks: string[]
  ownerDecisionLinks: string[]
  workOrderLinks: string[]
  traceLinks: string[]
  councilLinks: string[]
  forgeLinks: string[]
  relatedPrOrCommit: string
  nextSafeGate: string
  staleness: string
  contradictionStatus: string
  reviewRequirement: string
  canonEligibility: string
  safeDefault: string
}

export type MemoryReviewQueueItem = {
  reviewItemId: string
  memoryCandidate: string
  reasonForReview: string
  evidenceRequired: string[]
  authorityRequired: string[]
  ownerDecisionRequired: string
  riskLevel: MemoryRiskLevel
  safeDefault: string
  nextValidAction: string
}

export type MemoryLinkRecord = {
  label: string
  memoryId: string
  relatedItem: string
  description: string
}

export type MemorySchemaField = {
  field: string
  purpose: string
  required: boolean
  blockedRuntimeBehavior: string
}

export type MemoryModelRecord = {
  modelId: string
  title: string
  purpose: string
  requiredFields: string[]
  examples: string[]
  blockedBehavior: string[]
  nextSafeGate: string
}

export type MemorySafetyProofCard = {
  label: string
  value: string
  description: string
}

export type MemoryGovernanceSurface = {
  doctrine: {
    title: string
    statements: readonly string[]
  }
  categories: {
    category: MemoryGovernanceCategory
    description: string
  }[]
  states: {
    state: MemoryGovernanceState
    description: string
  }[]
  sensitivityRegistry: {
    level: MemorySensitivityLevel
    description: string
    examples: string[]
    safeDefault: string
  }[]
  recordSchema: MemorySchemaField[]
  decisionMemoryModel: MemoryModelRecord
  procedureMemoryModel: MemoryModelRecord
  patternMemoryModel: MemoryModelRecord
  contradictionStaleMemoryModel: MemoryModelRecord
  records: MemoryGovernanceRecord[]
  detailRecord: MemoryGovernanceRecord
  reviewQueue: MemoryReviewQueueItem[]
  staleContradictionUx: {
    title: string
    statements: string[]
  }
  evidenceMemoryLinks: MemoryLinkRecord[]
  workOrderMemoryLinks: MemoryLinkRecord[]
  councilMemoryLinks: MemoryLinkRecord[]
  traceMemoryLinks: MemoryLinkRecord[]
  forgeMemoryLinks: MemoryLinkRecord[]
  academyWikiMemoryLinks: MemoryLinkRecord[]
  authorityMemoryLinks: MemoryLinkRecord[]
  ownerDecisionMemoryLinks: MemoryLinkRecord[]
  safetyProofCards: MemorySafetyProofCard[]
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
    memoryIngestionAdded: false
    memoryExtractionAdded: false
    memoryWriteAdded: false
    memoryPersistenceAdded: false
    canonPromotionAdded: false
    deletionArchiveMutationAdded: false
    runtimeMemoryReadAdded: false
    brainCouncilRuntimeMemoryReadAdded: false
    hermesMemoryReadAdded: false
    mcpMemoryReadAdded: false
    vectorStoreAdded: false
    embeddingsAdded: false
    ragRuntimeAdded: false
    databaseSchemaChanged: false
    dataMutationAdded: false
    filesystemScanAdded: false
    dynamicIngestionAdded: false
    commandExecutionAdded: false
    commandRunnerAdded: false
    githubWriteAdded: false
    codexAutomationAdded: false
    dockerMetadataAdded: false
    backupScanAdded: false
    portChecksAdded: false
    serviceRegistered: false
    scheduleCreated: false
    lanExposureEnabled: false
    cloudChanged: false
    productionDeployAdded: false
    productionWriteBehaviorAdded: false
    authBehaviorChanged: false
    authPolicyChanged: false
    publicSignupReintroduced: false
    envChanged: false
    packageChanged: false
    vercelSettingsChanged: false
    brainCouncilRuntimeActivated: false
    telemetryServiceAdded: false
    evalRunnerAdded: false
    secretsDisclosed: false
    hermesMcpAutonomyChanged: false
    terraFusionPacsTouched: false
    unrelatedContainersTouched: false
  }
}

export const MEMORY_GOVERNANCE_DOCTRINE = {
  title: "Brain Memory Spine Doctrine",
  statements: [
    "Brain Memory is governed continuity, not uncontrolled recall.",
    "Memory is governed continuity, not authority.",
    "Memory may represent facts, decisions, procedures, patterns, contradictions, stale items, review queues, sensitivity metadata, and authority states.",
    "Memory may not promote itself to canon.",
    "Memory may not delete, archive, ingest, extract, or mutate itself in this batch.",
    "Memory may not retrieve runtime context, create embeddings, store vectors, or add RAG behavior in this batch.",
    "Memory may not authorize commands, runtime control, metadata expansion, production changes, or autonomy.",
    "Every trusted memory record needs evidence, authority context, sensitivity classification, and review state.",
    "Contradicted or stale memory remains visible but untrusted until reviewed.",
    "Sensitive and secret-adjacent material defaults to blocked from memory.",
    "Brain Council may reference memory as static context only; it cannot read memory at runtime.",
    "Trace/Eval may link memory as proof history only; it cannot collect or write memory.",
    "Hermes, MCP, Agent Forge, and workers remain future-authority layers and cannot consume memory here.",
    "The Primary remains the approving authority.",
    "WilliamOS may display memory governance state but must not grant itself memory authority.",
  ],
} as const

export const MEMORY_GOVERNANCE_CATEGORIES = [
  ["FACT", "A specific claim that needs source, evidence, confidence, sensitivity, and review state."],
  ["DECISION", "A consequential choice with rationale, owner authority, and supporting proof."],
  ["PROCEDURE", "A repeatable pattern that may guide work only after evidence and Work Order context."],
  ["PATTERN", "A repeated operating lesson with observed examples, confidence, limits, and review triggers."],
  ["POLICY", "A governing rule or boundary that requires authority linkage before use."],
  ["PREFERENCE", "Operator preference that remains subordinate to safety, evidence, and authority."],
  ["PROJECT_STATE", "Repository, goal, batch, PR, or lane state that can become stale quickly."],
  ["LOCAL_RUNTIME_STATE", "Local runtime posture such as read-only, manual-only, and localhost-only."],
  ["EVIDENCE_SUMMARY", "A compact summary of proof already represented in the Evidence Spine."],
  ["AUTHORITY_SUMMARY", "A compact summary of authority records and blocked gates."],
  ["OWNER_DECISION_SUMMARY", "A compact summary of owner decisions and unresolved blockers."],
  ["REVIEW_QUEUE_ITEM", "A memory candidate that needs evidence or owner review before trust."],
  ["AUTHORITY_MEMORY", "Memory about what is allowed, blocked, future-gated, or owner-decision-required."],
  ["EVIDENCE_LINKED_MEMORY", "Memory whose trust depends on explicit proof links."],
  ["TRACE_LINKED_MEMORY", "Memory connected to proof-history and failure-to-eval traces."],
  ["COUNCIL_REFERENCED_MEMORY", "Memory referenced by Brain Council advice as static context only."],
  ["FUTURE_SKILL_FORGE_REFERENCED_MEMORY", "Memory that may inform future skill governance without activating skills."],
  ["CONTRADICTION", "A conflict between memories, evidence, authority, or operator direction."],
  ["STALE_ITEM", "A memory that may no longer be current and must not silently guide work."],
  ["SENSITIVE_ITEM", "A memory candidate that may contain private, local, or secret-adjacent material."],
].map(([category, description]) => ({
  category: category as MemoryGovernanceCategory,
  description,
}))

export const MEMORY_GOVERNANCE_STATES = [
  ["DRAFT", "Prepared but not reviewed or trusted."],
  ["REVIEW_REQUIRED", "Needs owner or evidence review before use."],
  ["EVIDENCE_BACKED", "Supported by cited evidence and current authority context."],
  ["CANON_ELIGIBLE", "May be proposed for canon only through a separate authorized process."],
  ["CANON_APPROVED_OUT_OF_BAND", "Canon approval exists elsewhere and must remain separately evidenced."],
  ["STALE", "Potentially outdated and not safe to rely on without refresh."],
  ["CONTRADICTED", "Conflicts with another record and requires resolution."],
  ["PARKED", "Intentionally deferred without becoming permission."],
  ["BLOCKED", "Blocked by safety, sensitivity, or missing authority."],
].map(([state, description]) => ({
  state: state as MemoryGovernanceState,
  description,
}))

export const MEMORY_SENSITIVITY_REGISTRY = [
  {
    level: "PUBLIC_SAFE",
    description: "Non-sensitive project facts that can be displayed in governed surfaces.",
    examples: ["merged PR number", "public Work Order title", "non-secret validation status"],
    safeDefault: "may be displayed when evidence-backed",
  },
  {
    level: "INTERNAL",
    description: "WilliamOS internal context that is useful but should stay scoped to the workspace.",
    examples: ["batch posture", "authority summary", "local lane status"],
    safeDefault: "display only as static scoped context",
  },
  {
    level: "PRIVATE_OPERATOR",
    description: "Operator-specific preferences or decisions that need review before durable use.",
    examples: ["workflow preference", "manual approval posture", "decision rationale"],
    safeDefault: "review before canon or reuse",
  },
  {
    level: "SENSITIVE_LOCAL",
    description: "Local host, filesystem, runtime, or environment details that may expose the operator setup.",
    examples: ["absolute local paths", "host inventory", "local runtime metadata"],
    safeDefault: "default deny unless explicitly evidenced and approved",
  },
  {
    level: "SECRET_ADJACENT",
    description: "Material near credentials, tokens, env files, private URLs, or protected data.",
    examples: ["env variable names with values nearby", "connection-string context", "token handling notes"],
    safeDefault: "block from memory unless a secret-handling gate authorizes representation",
  },
  {
    level: "BLOCKED_FROM_MEMORY",
    description: "Secrets, credentials, production tokens, PACS/private data, or content that should not persist.",
    examples: ["API keys", "passwords", "PACS records", "raw backup contents"],
    safeDefault: "do not capture; represent only as redacted blocker evidence",
  },
] satisfies MemoryGovernanceSurface["sensitivityRegistry"]

const MEMORY_RECORD_SCHEMA_ROWS: [string, string, boolean, string][] = [
  ["memory id", "Stable identifier for the static record.", true, "does not create a database row"],
  ["memory type", "Taxonomy label such as Fact, Decision, Procedure, Pattern, Contradiction, Stale, or Review Queue.", true, "does not run a classifier"],
  ["title", "Short operator-readable label.", true, "does not generate content dynamically"],
  ["summary", "Concise source-aware memory statement.", true, "does not write memory"],
  ["source", "Human-readable provenance or report reference.", true, "does not scan filesystems"],
  ["source type", "Evidence, Work Order, PR, trace, owner decision, or doctrine source class.", true, "does not ingest source data"],
  ["evidence links", "Static proof references that support or constrain trust.", true, "does not call Evidence APIs"],
  ["related goal id", "Optional goal relationship.", false, "does not mutate goals"],
  ["related work order id", "Optional Work Order relationship.", false, "does not run Work Orders"],
  ["related PR/commit", "Optional merge or commit provenance.", false, "does not write GitHub"],
  ["related trace id", "Optional Trace/Eval proof-history relationship.", false, "does not collect traces"],
  ["confidence", "Low, medium, or high trust label.", true, "does not compute confidence automatically"],
  ["sensitivity", "Sensitivity posture and safe default.", true, "does not implement access control"],
  ["authority state", "Allowed, review-required, runtime-blocked, or prohibited use posture.", true, "does not grant authority"],
  ["review state", "Proposed, needs evidence, accepted static, stale, contradicted, blocked, denied, or retired.", true, "does not transition state"],
  ["stale/review date", "Static review trigger when available.", false, "does not schedule review"],
  ["contradiction links", "Static references to conflicting records.", false, "does not detect contradictions"],
  ["replacement/supersession links", "Static references to newer records.", false, "does not overwrite memory"],
  ["blocked actions", "Actions this memory must not authorize.", true, "does not enforce policy"],
  ["next safe gate", "Future owner-authorized gate if action is needed.", true, "does not open the gate"],
]

export const MEMORY_RECORD_SCHEMA: MemorySchemaField[] = MEMORY_RECORD_SCHEMA_ROWS.map(([field, purpose, required, blockedRuntimeBehavior]) => ({
  field,
  purpose,
  required: required === true,
  blockedRuntimeBehavior,
}))

export const DECISION_MEMORY_MODEL: MemoryModelRecord = {
  modelId: "decision-memory-model",
  title: "Decision Memory Model",
  purpose: "Represent owner and system decisions with authority source, options, outcome, evidence, safety flags, and review conditions.",
  requiredFields: [
    "decision id",
    "decision summary",
    "owner authority source",
    "context",
    "options considered",
    "decision outcome",
    "evidence used",
    "related WO/goal/PR",
    "safety flags",
    "expiration or review condition",
    "supersession or reversal handling",
    "next lane implication",
  ],
  examples: [
    "auth policy decision",
    "DB/schema authority decision",
    "Hermes activation denial",
    "runtime authority pause",
    "static/read-only posture decision",
    "merge/deploy authority decision",
  ],
  blockedBehavior: ["decision capture runtime", "approval system", "access grant implementation", "decision state mutation"],
  nextSafeGate: "Owner Decision Queue authority packet",
}

export const PROCEDURE_MEMORY_MODEL: MemoryModelRecord = {
  modelId: "procedure-memory-model",
  title: "Procedure Memory Model",
  purpose: "Represent repeatable procedures as static guidance with authority, validation, evidence, and stop conditions.",
  requiredFields: [
    "procedure id",
    "procedure title",
    "purpose",
    "when to use",
    "required authority",
    "allowed steps",
    "blocked steps",
    "validation required",
    "evidence required",
    "stop conditions",
    "related WOs",
    "related Academy lessons",
    "related Wiki concepts",
    "stale/review trigger",
  ],
  examples: [
    "Codex operator packet procedure",
    "PR validation procedure",
    "production verification procedure",
    "evidence rollup procedure",
    "blocked owner decision procedure",
    "stale .next cleanup proof procedure",
  ],
  blockedBehavior: ["runnable procedure engine", "command runner", "automation executor", "scheduler"],
  nextSafeGate: "Work Order procedure lane only if owner-authorized",
}

export const PATTERN_MEMORY_MODEL: MemoryModelRecord = {
  modelId: "pattern-memory-model",
  title: "Pattern Memory Model",
  purpose: "Represent repeated operating lessons with observed examples, confidence, supporting evidence, limits, and possible future eval links.",
  requiredFields: [
    "pattern id",
    "pattern summary",
    "observed examples",
    "confidence",
    "supporting evidence",
    "related WOs/goals",
    "risk implications",
    "when pattern applies",
    "when pattern does not apply",
    "review/stale trigger",
    "possible future eval candidate link",
  ],
  examples: [
    "stale local .next artifact cleanup before build",
    "static/read-only lane before runtime lane",
    "Codex should not courier normal git work back to owner",
    "evidence clarity before runtime authority",
    "review-thread remediation before merge",
  ],
  blockedBehavior: ["automatic pattern mining", "dynamic ingestion", "ML classifier", "background categorizer"],
  nextSafeGate: "Trace/Eval proposal only; no eval execution here",
}

export const CONTRADICTION_STALE_MEMORY_MODEL: MemoryModelRecord = {
  modelId: "contradiction-stale-memory-model",
  title: "Contradiction and Stale Memory Model",
  purpose: "Represent stale, superseded, contradicted, and unresolved memory as visible but untrusted until reviewed.",
  requiredFields: [
    "contradiction definition",
    "stale memory definition",
    "superseded memory definition",
    "unresolved conflict definition",
    "evidence requirements",
    "confidence behavior",
    "owner decision implications",
    "recommendation blocker",
    "next safe gate",
  ],
  examples: [
    "prior next-lane pointer superseded by merged lane",
    "old base commit superseded by new origin/main",
    "old Hermes pointer after Hermes completion",
    "stale production verification after route changes",
    "conflicting safety posture reports",
  ],
  blockedBehavior: ["contradiction detector runtime", "automatic stale scanner", "memory mutation behavior", "canon update"],
  nextSafeGate: "Memory review Work Order if the conflict affects current work",
}

export const MEMORY_GOVERNANCE_RECORDS: MemoryGovernanceRecord[] = [
  {
    memoryId: "memory-evidence-spine-current",
    title: "Evidence Spine is current",
    category: "EVIDENCE_SUMMARY",
    state: "EVIDENCE_BACKED",
    sensitivity: "INTERNAL",
    confidence: "high",
    summary:
      "Evidence Spine reflects current authority, owner decision, and local OMEN authority-freeze evidence after PR #288.",
    sourceType: "merged PR evidence",
    evidenceLinks: ["evidence-authority-governance-registry", "evidence-owner-decision-queue", "evidence-pr-local-freeze"],
    authorityLinks: ["authority-read-only-registry"],
    ownerDecisionLinks: ["decision-command-execution", "decision-autonomy"],
    workOrderLinks: ["WO-EVIDENCE-001 through WO-EVIDENCE-014"],
    traceLinks: ["trace-authority-refresh-pass", "trace-operator-contract-static"],
    councilLinks: ["council-packet-advisory-next-lane"],
    forgeLinks: ["future-skill-governance-only"],
    relatedPrOrCommit: "PR #288",
    nextSafeGate: "GOAL-WOS-007 — Agent Forge Skill Governance",
    staleness: "Review after any new evidence or authority PR merges.",
    contradictionStatus: "No known contradiction in this static registry.",
    reviewRequirement: "Evidence refresh required if origin/main advances with new authority facts.",
    canonEligibility: "Eligible only through a separate memory canon approval lane.",
    safeDefault: "Use as read-only context; do not ingest dynamically.",
  },
  {
    memoryId: "memory-local-omen-authority-freeze",
    title: "Local OMEN authority remains frozen",
    category: "LOCAL_RUNTIME_STATE",
    state: "EVIDENCE_BACKED",
    sensitivity: "SENSITIVE_LOCAL",
    confidence: "high",
    summary:
      "Local OMEN runtime authority is read-only, manual-only, and localhost-only after PR #287.",
    sourceType: "local authority freeze evidence",
    evidenceLinks: ["evidence-local-omen-status", "evidence-pr-local-freeze", "evidence-blocked-runtime-metadata"],
    authorityLinks: ["authority-local-runtime-mutation", "authority-metadata-expansion"],
    ownerDecisionLinks: ["decision-docker-metadata", "decision-backup-metadata", "decision-port-checks"],
    workOrderLinks: ["WO-LOCAL-120 through WO-LOCAL-124"],
    traceLinks: ["trace-local-docker-runtime-blocker"],
    councilLinks: ["council-packet-authority-needed"],
    forgeLinks: ["not-applicable"],
    relatedPrOrCommit: "PR #287",
    nextSafeGate: "Local metadata gate only if owner-authorized",
    staleness: "Review after any local runtime, Docker metadata, backup metadata, or port-status gate.",
    contradictionStatus: "No current contradiction; metadata expansion remains blocked.",
    reviewRequirement: "Owner authority required before expanding runtime observation or control.",
    canonEligibility: "Not canon by this registry; evidence-backed status only.",
    safeDefault: "Keep local runtime read-only, manual-only, and localhost-only.",
  },
  {
    memoryId: "memory-authority-registry-current",
    title: "Authority Registry is represented",
    category: "AUTHORITY_SUMMARY",
    state: "EVIDENCE_BACKED",
    sensitivity: "INTERNAL",
    confidence: "high",
    summary:
      "Authority records, blocked actions, owner-required gates, and safety flags are represented as read-only registry evidence from PR #285.",
    sourceType: "authority proof",
    evidenceLinks: ["evidence-authority-governance-registry"],
    authorityLinks: ["authority-read-only-registry", "authority-autonomy", "authority-secret-handling"],
    ownerDecisionLinks: ["decision-command-execution", "decision-secrets-handling", "decision-autonomy"],
    workOrderLinks: ["WO-AUTHORITY-001 through WO-AUTHORITY-014"],
    traceLinks: ["trace-authority-refresh-pass"],
    councilLinks: ["council-packet-authority-needed"],
    forgeLinks: ["future-skill-governance-only"],
    relatedPrOrCommit: "PR #285",
    nextSafeGate: "Owner authority packet before any authority expansion",
    staleness: "Review when a new authority registry PR merges.",
    contradictionStatus: "No known contradiction.",
    reviewRequirement: "Compare against Owner Decision Queue before treating any lane as open.",
    canonEligibility: "Eligible for canon proposal only after separate owner review.",
    safeDefault: "Display authority; do not grant authority.",
  },
  {
    memoryId: "memory-owner-decision-queue-current",
    title: "Owner Decision Queue is represented",
    category: "OWNER_DECISION_SUMMARY",
    state: "EVIDENCE_BACKED",
    sensitivity: "INTERNAL",
    confidence: "high",
    summary:
      "Owner decisions and blocked lanes are visible without approval, denial, authorization, execution, or mutation controls.",
    sourceType: "owner decision proof",
    evidenceLinks: ["evidence-owner-decision-queue"],
    authorityLinks: ["authority-github-write", "authority-autonomy", "authority-production-change"],
    ownerDecisionLinks: ["decision-github-write", "decision-production-deploy", "decision-codex-automation"],
    workOrderLinks: ["WO-DECISION-001 through WO-DECISION-015"],
    traceLinks: ["trace-operator-contract-static"],
    councilLinks: ["council-packet-authority-needed"],
    forgeLinks: ["future-skill-governance-only"],
    relatedPrOrCommit: "PR #286",
    nextSafeGate: "Owner decision packet before any blocked lane changes",
    staleness: "Review after any owner decision is explicitly approved, declined, or parked by new evidence.",
    contradictionStatus: "No known contradiction.",
    reviewRequirement: "Owner decision remains required before blocked lanes proceed.",
    canonEligibility: "Not self-promoted; may be proposed later.",
    safeDefault: "Blocked decisions remain blocked.",
  },
  {
    memoryId: "memory-stale-contradiction-review",
    title: "Stale and contradicted memory requires review",
    category: "CONTRADICTION",
    state: "REVIEW_REQUIRED",
    sensitivity: "PRIVATE_OPERATOR",
    confidence: "medium",
    summary:
      "A stale or contradicted memory may be displayed as a review item, but it must not silently guide implementation.",
    sourceType: "governance rule",
    evidenceLinks: ["evidence-safety-boundary"],
    authorityLinks: ["authority-read-only-registry"],
    ownerDecisionLinks: ["decision-command-execution"],
    workOrderLinks: ["WO-MEMORY-007", "WO-MEMORY-008"],
    traceLinks: ["trace-memory-links-static"],
    councilLinks: ["council-packet-advisory-next-lane"],
    forgeLinks: ["future-skill-governance-only"],
    relatedPrOrCommit: "Memory Governance Registry",
    nextSafeGate: "Memory review Work Order before trust",
    staleness: "Assume stale until refreshed by current evidence.",
    contradictionStatus: "Contradiction must be resolved before canon eligibility.",
    reviewRequirement: "Compare evidence, authority, and newest operator instruction.",
    canonEligibility: "Not eligible while stale or contradicted.",
    safeDefault: "Route to review; do not rely on it.",
  },
  {
    memoryId: "memory-sensitive-blocked-example",
    title: "Secrets and protected data are blocked from memory",
    category: "SENSITIVE_ITEM",
    state: "BLOCKED",
    sensitivity: "BLOCKED_FROM_MEMORY",
    confidence: "high",
    summary:
      "Secrets, credentials, protected data, raw backup contents, and PACS/private material must not become memory records.",
    sourceType: "safety rule",
    evidenceLinks: ["evidence-safety-boundary"],
    authorityLinks: ["authority-secret-handling"],
    ownerDecisionLinks: ["decision-secrets-handling", "decision-terrafusion-pacs-touch"],
    workOrderLinks: ["WO-MEMORY-004", "WO-MEMORY-012"],
    traceLinks: ["trace-secret-access-blocked"],
    councilLinks: ["council-packet-authority-needed"],
    forgeLinks: ["blocked-from-skill-context"],
    relatedPrOrCommit: "Memory Governance Registry",
    nextSafeGate: "Secret-handling authority gate only",
    staleness: "Always blocked unless a future secret-handling gate says otherwise.",
    contradictionStatus: "No exception granted by this batch.",
    reviewRequirement: "Represent as redacted blocker evidence only.",
    canonEligibility: "Never eligible in this registry.",
    safeDefault: "Do not capture.",
  },
]

export const MEMORY_REVIEW_QUEUE: MemoryReviewQueueItem[] = [
  {
    reviewItemId: "review-memory-ingestion",
    memoryCandidate: "Dynamic memory ingestion",
    reasonForReview: "Ingestion would turn a static registry into a runtime data intake path.",
    evidenceRequired: ["Owner authority packet", "source allowlist", "redaction plan", "rollback plan"],
    authorityRequired: ["authority-read-only-registry", "authority-secret-handling"],
    ownerDecisionRequired: "Explicit owner approval required; not granted.",
    riskLevel: "high",
    safeDefault: "blocked",
    nextValidAction: "Create a future memory ingestion gate only if explicitly authorized.",
  },
  {
    reviewItemId: "review-canon-promotion",
    memoryCandidate: "Canon promotion workflow",
    reasonForReview: "Canon promotion changes trusted context and cannot be automatic.",
    evidenceRequired: ["evidence links", "authority context", "owner review", "contradiction sweep"],
    authorityRequired: ["authority-read-only-registry"],
    ownerDecisionRequired: "Required before implementation.",
    riskLevel: "medium",
    safeDefault: "review required",
    nextValidAction: "Keep canon promotion out of this batch.",
  },
  {
    reviewItemId: "review-sensitive-memory",
    memoryCandidate: "Sensitive or secret-adjacent memory",
    reasonForReview: "Sensitive material may expose local, private, credential, or protected data.",
    evidenceRequired: ["redaction proof", "secret-handling authority", "owner approval"],
    authorityRequired: ["authority-secret-handling"],
    ownerDecisionRequired: "Required before any representation beyond blocker evidence.",
    riskLevel: "critical",
    safeDefault: "blocked from memory",
    nextValidAction: "Represent only as redacted blocked-category guidance.",
  },
  {
    reviewItemId: "review-stale-contradicted-memory",
    memoryCandidate: "Stale or contradicted records",
    reasonForReview: "Old or conflicting context can steer the operator into a wrong lane.",
    evidenceRequired: ["newest operator instruction", "current origin/main", "current Evidence Spine"],
    authorityRequired: ["authority-read-only-registry"],
    ownerDecisionRequired: "Required if contradiction affects authority or safety.",
    riskLevel: "medium",
    safeDefault: "do not trust until refreshed",
    nextValidAction: "Open a review Work Order if the conflict affects current work.",
  },
]

export const MEMORY_STALE_CONTRADICTION_UX = {
  title: "Stale or contradicted means untrusted",
  statements: [
    "Newest explicit operator instruction wins over stale memory.",
    "Current evidence wins over remembered evidence.",
    "A contradiction is a review state, not a failure state.",
    "Stale memory remains visible so it can be corrected.",
    "Contradicted memory cannot become canon until resolved.",
    "Blocked-sensitive memory is represented only as redacted safety guidance.",
  ],
}

export const EVIDENCE_MEMORY_LINKS: MemoryLinkRecord[] = [
  {
    label: "Evidence Spine current",
    memoryId: "memory-evidence-spine-current",
    relatedItem: "evidence-authority-governance-registry",
    description: "Evidence records support current memory context without creating dynamic ingestion.",
  },
  {
    label: "Local OMEN freeze",
    memoryId: "memory-local-omen-authority-freeze",
    relatedItem: "evidence-pr-local-freeze",
    description: "Local runtime memory stays bounded to read-only authority-freeze proof.",
  },
  {
    label: "Owner decisions represented",
    memoryId: "memory-owner-decision-queue-current",
    relatedItem: "evidence-owner-decision-queue",
    description: "Owner decision evidence prevents memory from becoming permission.",
  },
]

export const WORK_ORDER_MEMORY_LINKS: MemoryLinkRecord[] = [
  {
    label: "Work Order Engine context",
    memoryId: "memory-evidence-spine-current",
    relatedItem: "GOAL-WOS-002",
    description: "Memory may reference completed WOE structure as static context; it cannot run Work Orders.",
  },
  {
    label: "Brain Memory Spine batch",
    memoryId: "memory-stale-contradiction-review",
    relatedItem: "WO-MEMORY-001 through WO-MEMORY-014",
    description: "The current lane reconciles memory doctrine and models without write, retrieval, or promotion behavior.",
  },
]

export const COUNCIL_MEMORY_LINKS: MemoryLinkRecord[] = [
  {
    label: "Council static context",
    memoryId: "memory-evidence-spine-current",
    relatedItem: "council-packet-advisory-next-lane",
    description: "Brain Council may reference memory as static context but cannot read memory at runtime.",
  },
  {
    label: "Council authority blocker",
    memoryId: "memory-authority-registry-current",
    relatedItem: "council-packet-authority-needed",
    description: "Council recommendations do not authorize memory writes, retrieval, tools, or action.",
  },
]

export const TRACE_MEMORY_LINKS: MemoryLinkRecord[] = [
  {
    label: "Trace proof history",
    memoryId: "memory-evidence-spine-current",
    relatedItem: "trace-authority-refresh-pass",
    description: "Trace links show reasoning history without collecting runtime traces or writing memory.",
  },
  {
    label: "Stale pointer correction",
    memoryId: "memory-stale-contradiction-review",
    relatedItem: "trace-memory-links-static",
    description: "Trace/Eval can explain stale or superseded next-lane pointers as review signals.",
  },
]

export const FORGE_MEMORY_LINKS: MemoryLinkRecord[] = [
  {
    label: "Future skill governance",
    memoryId: "memory-sensitive-blocked-example",
    relatedItem: "GOAL-WOS-007 — Agent Forge Skill Governance",
    description: "Forge may define future skill governance, but this lane activates no skills or workers.",
  },
  {
    label: "Skill context blocked",
    memoryId: "memory-authority-registry-current",
    relatedItem: "skill-context-future-authority-only",
    description: "Memory cannot become executable skill context without a separate owner-authorized gate.",
  },
]

export const ACADEMY_WIKI_MEMORY_LINKS: MemoryLinkRecord[] = [
  {
    label: "Academy memory lesson",
    memoryId: "memory-stale-contradiction-review",
    relatedItem: "docs/academy/operator-training/brain-memory-spine.md",
    description: "Academy teaches Brain Memory as governed continuity, not runtime recall.",
  },
  {
    label: "Wiki memory concept",
    memoryId: "memory-evidence-spine-current",
    relatedItem: "docs/wiki/concepts/brain-memory.md",
    description: "Wiki records memory taxonomy, authority states, and blocked runtime behavior.",
  },
]

export const AUTHORITY_MEMORY_LINKS: MemoryLinkRecord[] = [
  {
    label: "Read-only memory authority",
    memoryId: "memory-evidence-spine-current",
    relatedItem: "authority-read-only-registry",
    description: "Memory governance displays state under read-only authority only.",
  },
  {
    label: "Metadata remains blocked",
    memoryId: "memory-local-omen-authority-freeze",
    relatedItem: "authority-metadata-expansion",
    description: "Local memory does not unlock Docker, backup, port, or filesystem metadata.",
  },
  {
    label: "Secrets remain blocked",
    memoryId: "memory-sensitive-blocked-example",
    relatedItem: "authority-secret-handling",
    description: "Secret handling requires a future explicit gate.",
  },
]

export const OWNER_DECISION_MEMORY_LINKS: MemoryLinkRecord[] = [
  {
    label: "Command execution still blocked",
    memoryId: "memory-authority-registry-current",
    relatedItem: "decision-command-execution",
    description: "Memory governance cannot authorize commands or a command runner.",
  },
  {
    label: "Autonomy still blocked",
    memoryId: "memory-owner-decision-queue-current",
    relatedItem: "decision-autonomy",
    description: "Brain Council, Hermes, MCP, and autonomous reads remain blocked.",
  },
  {
    label: "Sensitive memory blocked",
    memoryId: "memory-sensitive-blocked-example",
    relatedItem: "decision-secrets-handling",
    description: "Secret-adjacent or protected material requires owner authority before representation.",
  },
]

export const MEMORY_SAFETY_PROOF_CARDS: MemorySafetyProofCard[] = [
  ["No memory ingestion", "blocked", "No dynamic memory intake, extraction, import, or filesystem scan is added."],
  ["No memory writes", "blocked", "No new add, edit, promote, delete, archive, or canon mutation is added by this registry."],
  ["No runtime memory reads", "blocked", "No Brain Council, Hermes, MCP, vector store, or runtime memory read path is added."],
  ["No embeddings", "blocked", "No vector store, embedding generation, or retrieval expansion is added."],
  ["No command execution", "blocked", "Memory governance cannot execute commands or expose a command bridge."],
  ["No metadata expansion", "blocked", "Docker, backup, port, filesystem, and local metadata gates remain closed."],
  ["No persistence or LAN", "blocked", "No service, scheduler, startup registration, LAN, firewall, router, or DNS change is added."],
  ["No secrets", "blocked", "Secrets and protected data are blocked from memory and represented only as redacted safety posture."],
  ["Owner remains authority", "visible", "Memory cannot approve itself, grant authority, or replace owner decisions."],
].map(([label, value, description]) => ({ label, value, description }))

export function getMemoryGovernanceSurface(): MemoryGovernanceSurface {
  return {
    doctrine: MEMORY_GOVERNANCE_DOCTRINE,
    categories: MEMORY_GOVERNANCE_CATEGORIES,
    states: MEMORY_GOVERNANCE_STATES,
    sensitivityRegistry: MEMORY_SENSITIVITY_REGISTRY,
    recordSchema: MEMORY_RECORD_SCHEMA,
    decisionMemoryModel: DECISION_MEMORY_MODEL,
    procedureMemoryModel: PROCEDURE_MEMORY_MODEL,
    patternMemoryModel: PATTERN_MEMORY_MODEL,
    contradictionStaleMemoryModel: CONTRADICTION_STALE_MEMORY_MODEL,
    records: MEMORY_GOVERNANCE_RECORDS,
    detailRecord:
      MEMORY_GOVERNANCE_RECORDS.find(
        (record) => record.memoryId === "memory-local-omen-authority-freeze",
      ) ?? MEMORY_GOVERNANCE_RECORDS[0],
    reviewQueue: MEMORY_REVIEW_QUEUE,
    staleContradictionUx: MEMORY_STALE_CONTRADICTION_UX,
    evidenceMemoryLinks: EVIDENCE_MEMORY_LINKS,
    workOrderMemoryLinks: WORK_ORDER_MEMORY_LINKS,
    councilMemoryLinks: COUNCIL_MEMORY_LINKS,
    traceMemoryLinks: TRACE_MEMORY_LINKS,
    forgeMemoryLinks: FORGE_MEMORY_LINKS,
    academyWikiMemoryLinks: ACADEMY_WIKI_MEMORY_LINKS,
    authorityMemoryLinks: AUTHORITY_MEMORY_LINKS,
    ownerDecisionMemoryLinks: OWNER_DECISION_MEMORY_LINKS,
    safetyProofCards: MEMORY_SAFETY_PROOF_CARDS,
    navigation: [
      {
        label: "Evidence",
        href: "/audit",
        description: "Verify proof before memory becomes trusted context.",
      },
      {
        label: "Authority",
        href: "/governance",
        description: "Inspect authority records that keep memory from becoming permission.",
      },
      {
        label: "Decisions",
        href: "/decisions",
        description: "Inspect owner decisions before expanding memory capability.",
      },
      {
        label: "Work Orders",
        href: "/work-orders",
        description: "Turn memory review or cleanup into governed scope.",
      },
    ],
    nextLaneDecision: {
      recommendedBatch: "WO-SHELL-010 - Shell Polish / Primary Experience Rollup",
      recommendedOption: "A - Primary shell polish and evidence rollup",
      blockedLanes: [
        "Memory ingestion",
        "Memory write/canon promotion",
        "Runtime memory reads",
        "Hermes/MCP/autonomy activation",
        "Command execution",
        "Docker/backup/port metadata",
      ],
      reason:
        "After Memory is placed as a Primary shell continuity surface, the safest next lane is a shell polish and evidence rollup that checks navigation coherence without opening ingestion, writes, runtime reads, metadata expansion, or autonomy.",
    },
    safety: {
      staticReadOnly: true,
      memoryIngestionAdded: false,
      memoryExtractionAdded: false,
      memoryWriteAdded: false,
      memoryPersistenceAdded: false,
      canonPromotionAdded: false,
      deletionArchiveMutationAdded: false,
      runtimeMemoryReadAdded: false,
      brainCouncilRuntimeMemoryReadAdded: false,
      hermesMemoryReadAdded: false,
      mcpMemoryReadAdded: false,
      vectorStoreAdded: false,
      embeddingsAdded: false,
      ragRuntimeAdded: false,
      databaseSchemaChanged: false,
      dataMutationAdded: false,
      filesystemScanAdded: false,
      dynamicIngestionAdded: false,
      commandExecutionAdded: false,
      commandRunnerAdded: false,
      githubWriteAdded: false,
      codexAutomationAdded: false,
      dockerMetadataAdded: false,
      backupScanAdded: false,
      portChecksAdded: false,
      serviceRegistered: false,
      scheduleCreated: false,
      lanExposureEnabled: false,
      cloudChanged: false,
      productionDeployAdded: false,
      productionWriteBehaviorAdded: false,
      authBehaviorChanged: false,
      authPolicyChanged: false,
      publicSignupReintroduced: false,
      envChanged: false,
      packageChanged: false,
      vercelSettingsChanged: false,
      brainCouncilRuntimeActivated: false,
      telemetryServiceAdded: false,
      evalRunnerAdded: false,
      secretsDisclosed: false,
      hermesMcpAutonomyChanged: false,
      terraFusionPacsTouched: false,
      unrelatedContainersTouched: false,
    },
  }
}
