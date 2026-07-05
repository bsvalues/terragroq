export type EvidenceCategoryId =
  | "VALIDATION_PROOF"
  | "LOCAL_PROOF"
  | "PRODUCTION_PROOF"
  | "SAFETY_PROOF"
  | "PR_PROOF"
  | "BLOCKED_DECISION_PROOF"
  | "ROLLUP_PROOF"
  | "NEXT_LANE_DECISION"
  | "AUTHORITY_PROOF"
  | "WORK_ORDER_PROOF"

export type EvidenceStatus = "confirmed" | "recorded" | "blocked" | "recommended"

export type EvidenceCategoryRecord = {
  id: EvidenceCategoryId
  label: string
  description: string
}

export type EvidenceRecord = {
  evidenceId: string
  title: string
  type: EvidenceCategoryId
  scope: string
  relatedGoal: string
  relatedBatch: string
  relatedWorkOrder: string
  relatedPr: string
  originMain: string
  validationSummary: string
  proofSummary: string
  safetySummary: string
  sourcePath: string
  status: EvidenceStatus
  createdAtLabel: string
  proves: string
  doesNotProve: string
  nextRelatedItem: string
}

export type EvidenceProofCard = {
  label: string
  value: string
  description: string
  category: EvidenceCategoryId
}

export type BlockedDecisionEvidenceLink = {
  blocker: string
  evidenceId: string
  whyBlocked: string
  safeNextAction: string
}

export type EvidenceSpineSurface = {
  doctrine: {
    title: string
    statements: readonly string[]
  }
  categories: EvidenceCategoryRecord[]
  records: EvidenceRecord[]
  recentEvidence: EvidenceRecord[]
  detailRecord: EvidenceRecord
  validationProofCards: EvidenceProofCard[]
  localProofCards: EvidenceProofCard[]
  productionProofCards: EvidenceProofCard[]
  safetyProofCards: EvidenceProofCard[]
  blockedDecisionEvidenceLinks: BlockedDecisionEvidenceLink[]
  woeNavigation: {
    label: string
    href: string
    description: string
  }[]
  nextLaneDecision: {
    recommendedBatch: string
    recommendedOption: string
    reason: string
  }
  safety: {
    readOnly: true
    ingestionAdded: false
    filesystemScanAdded: false
    githubApiIntegrationAdded: false
    githubWriteAdded: false
    codexAutomationAdded: false
    reportGenerationAutomationAdded: false
    databaseAdded: false
    commandExecutionAdded: false
    commandRunnerAdded: false
    dockerMetadataAdded: false
    backupScanAdded: false
    portChecksAdded: false
    localRuntimeControlAdded: false
    backgroundWorkerAdded: false
    persistenceImplemented: false
    schedulerAdded: false
    lanExposureEnabled: false
    secretsDisclosed: false
    autonomyAuthorized: false
    runtimeControlAuthorized: false
    metadataExpansionAuthorized: false
  }
}

export const EVIDENCE_DOCTRINE = {
  title: "Evidence Doctrine",
  statements: [
    "Evidence proves reality inside WilliamOS.",
    "Evidence is read-only unless a separate Work Order authorizes mutation.",
    "Evidence may support goals, batches, Work Orders, blocked decisions, safety posture, local proof, and production proof.",
    "Evidence does not execute work.",
    "Evidence does not authorize mutation by itself.",
    "Evidence does not replace owner authority.",
  ],
} as const

export const EVIDENCE_CATEGORIES: EvidenceCategoryRecord[] = [
  {
    id: "VALIDATION_PROOF",
    label: "Validation Proof",
    description: "Tests, builds, diff checks, Vercel, CodeRabbit, and focused validation evidence.",
  },
  {
    id: "LOCAL_PROOF",
    label: "Local Proof",
    description: "OMEN host, local status route, proof image, Postgres posture, and local cleanup evidence.",
  },
  {
    id: "PRODUCTION_PROOF",
    label: "Production Proof",
    description: "Production health, readiness, deployment, and header proof when recorded.",
  },
  {
    id: "SAFETY_PROOF",
    label: "Safety Proof",
    description: "Evidence that execution, metadata, persistence, LAN exposure, secrets, and autonomy remained blocked.",
  },
  {
    id: "PR_PROOF",
    label: "PR Proof",
    description: "Merged PRs, checks, and review evidence that support completed lanes.",
  },
  {
    id: "BLOCKED_DECISION_PROOF",
    label: "Blocked Decision Proof",
    description: "Evidence explaining why owner authority is required before a lane can continue.",
  },
  {
    id: "ROLLUP_PROOF",
    label: "Rollup Proof",
    description: "Batch and phase closure summaries tying work, validation, safety, and next lanes together.",
  },
  {
    id: "NEXT_LANE_DECISION",
    label: "Next Lane Decision",
    description: "Decision packets that recommend the next bounded lane without authorizing execution.",
  },
  {
    id: "AUTHORITY_PROOF",
    label: "Authority Proof",
    description: "Authority gates, blocker registries, owner decisions, and escalation boundaries.",
  },
  {
    id: "WORK_ORDER_PROOF",
    label: "Work Order Proof",
    description: "Goal, batch, Work Order, completion, and WOE navigation evidence.",
  },
]

export const EVIDENCE_RECORDS: EvidenceRecord[] = [
  {
    evidenceId: "evidence-local-omen-status",
    title: "Local OMEN Runtime Authority Freeze Proof",
    type: "LOCAL_PROOF",
    scope: "HP OMEN manual-only local runtime status",
    relatedGoal: "Phase 1 local host posture",
    relatedBatch: "LOCAL-OMEN-RUNTIME-AUTHORITY-FREEZE-BATCH-001",
    relatedWorkOrder: "WO-LOCAL-120 through WO-LOCAL-124",
    relatedPr: "#287",
    originMain: "dcebc87c13a1194cfadc13ce2079c35fb5e4739d",
    validationSummary: "git diff --check, 114-file full suite, production build, Vercel, Sourcery, and CodeRabbit passed.",
    proofSummary:
      "The local status API, runtime surface, Home copy, and authority-freeze packet now hold Local OMEN at read-only, manual-only, localhost-only.",
    safetySummary:
      "No command execution, metadata expansion, persistence, service/schedule, LAN exposure, secrets, TerraFusion/PACS touch, container touch, or autonomy was added.",
    sourcePath: "docs/reports/WO-LOCAL-123-local-runtime-freeze-evidence-rollup.md",
    status: "confirmed",
    createdAtLabel: "Local OMEN runtime authority freeze",
    proves: "WilliamOS can display local OMEN runtime status while keeping local authority frozen.",
    doesNotProve: "It does not prove Docker metadata, backup metadata, port status, or runtime control authority.",
    nextRelatedItem: "WILLIAMOS-EVIDENCE-SPINE-BATCH-001",
  },
  {
    evidenceId: "evidence-shell-woe-resume",
    title: "Shell / WOE Resume Proof",
    type: "ROLLUP_PROOF",
    scope: "Primary Home and WOE resume",
    relatedGoal: "Primary command environment",
    relatedBatch: "WILLIAMOS-SHELL-WOE-RESUME-BATCH-001",
    relatedWorkOrder: "WO-SHELL-021 through WO-SHELL-028 and WO-WOE-019 through WO-WOE-021",
    relatedPr: "#280",
    originMain: "9818f323be95f48fe32e015f6fd9f6eef81980d1",
    validationSummary: "Shell/WOE focused tests, full suite, build, Vercel, and CodeRabbit passed.",
    proofSummary:
      "Primary Home, Work Orders, Evidence, Authority, active queue, next batch, and phase rollup surfaces were connected.",
    safetySummary:
      "The lane remained read-only and did not add execution, runtime control, metadata expansion, or autonomy.",
    sourcePath: "docs/reports/WO-SHELL-027-shell-woe-resume-evidence-rollup.md",
    status: "confirmed",
    createdAtLabel: "Shell / WOE resume closure",
    proves: "Local status is integrated into the broader Primary Operator experience.",
    doesNotProve: "It does not authorize Work Order execution, GitHub writes, Codex automation, or runtime mutation.",
    nextRelatedItem: "WILLIAMOS-WOE-DETAIL-SURFACES-BATCH-001",
  },
  {
    evidenceId: "evidence-woe-detail-surfaces",
    title: "WOE Detail Surfaces Proof",
    type: "WORK_ORDER_PROOF",
    scope: "Goal, batch, Work Order, evidence, blocker, safety, and report detail surfaces",
    relatedGoal: "Work Order Engine detail visibility",
    relatedBatch: "WILLIAMOS-WOE-DETAIL-SURFACES-BATCH-001",
    relatedWorkOrder: "WO-WOE-022 through WO-WOE-032",
    relatedPr: "#281",
    originMain: "658426f8424225c58ad1ac9beaac26bed6ffa08c",
    validationSummary: "34 focused tests, 468 full-suite tests, build, Vercel, and CodeRabbit passed.",
    proofSummary:
      "Goal, batch, Work Order, evidence, blocked decision, safety badge, completion renderer, and navigation surfaces are present.",
    safetySummary:
      "No run buttons, execute buttons, GitHub writes, Codex automation, scheduler, persistence, metadata, LAN exposure, or secrets were added.",
    sourcePath: "docs/reports/WO-WOE-031-woe-detail-evidence-rollup.md",
    status: "confirmed",
    createdAtLabel: "WOE detail surface closure",
    proves: "The Primary can inspect WOE detail without triggering execution.",
    doesNotProve: "It does not implement an execution engine, approval engine, or dynamic evidence ingestion.",
    nextRelatedItem: "WILLIAMOS-EVIDENCE-SPINE-BATCH-001",
  },
  {
    evidenceId: "evidence-validation-woe-detail",
    title: "WOE Detail Validation Proof",
    type: "VALIDATION_PROOF",
    scope: "Validation result chain",
    relatedGoal: "Evidence-backed Work Order closure",
    relatedBatch: "WILLIAMOS-WOE-DETAIL-SURFACES-BATCH-001",
    relatedWorkOrder: "WO-WOE-030",
    relatedPr: "#281",
    originMain: "658426f8424225c58ad1ac9beaac26bed6ffa08c",
    validationSummary: "git diff --check, focused tests, full suite, npm run build, Vercel, and CodeRabbit passed.",
    proofSummary: "Validation remained green for the completed WOE detail lane.",
    safetySummary:
      "The safety sweep found no command runner, Docker metadata, backup scan, port checks, scheduler, persistence, LAN exposure, or secrets.",
    sourcePath: "docs/reports/WO-WOE-030-woe-detail-safety-regression-sweep.md",
    status: "confirmed",
    createdAtLabel: "WOE detail validation closure",
    proves: "The code and UI changes passed the required validation chain.",
    doesNotProve: "It does not provide live CI polling or GitHub API integration.",
    nextRelatedItem: "WO-EVIDENCE-006",
  },
  {
    evidenceId: "evidence-pr-local-freeze",
    title: "PR #287 Local Runtime Authority Freeze Proof",
    type: "PR_PROOF",
    scope: "Merged PR and hosted checks",
    relatedGoal: "Local OMEN runtime authority freeze",
    relatedBatch: "LOCAL-OMEN-RUNTIME-AUTHORITY-FREEZE-BATCH-001",
    relatedWorkOrder: "WO-LOCAL-120 through WO-LOCAL-124",
    relatedPr: "#287",
    originMain: "dcebc87c13a1194cfadc13ce2079c35fb5e4739d",
    validationSummary: "CodeRabbit, Sourcery, Vercel, Vercel Preview Comments, full suite, diff check, and build passed.",
    proofSummary:
      "PR #287 merged the local runtime authority freeze packet and blocker registry as docs/report evidence.",
    safetySummary:
      "The PR added no command execution, metadata expansion, runtime control, persistence, LAN exposure, secrets, or autonomy.",
    sourcePath: "docs/reports/WO-LOCAL-124-return-to-williamos-lane-decision-packet.md",
    status: "confirmed",
    createdAtLabel: "PR #287 merge proof",
    proves: "The local runtime authority freeze was merged and checked.",
    doesNotProve: "It does not authorize a new runtime lane.",
    nextRelatedItem: "WILLIAMOS-EVIDENCE-SPINE-BATCH-001",
  },
  {
    evidenceId: "evidence-production-proof",
    title: "Production Proof Boundary",
    type: "PRODUCTION_PROOF",
    scope: "Recorded production checks",
    relatedGoal: "Canonical production remains independently verified",
    relatedBatch: "WILLIAMOS-WOE-DETAIL-SURFACES-BATCH-001",
    relatedWorkOrder: "WO-WOE-031",
    relatedPr: "#281",
    originMain: "658426f8424225c58ad1ac9beaac26bed6ffa08c",
    validationSummary: "Production-relevant proof is displayed only as recorded evidence, not live polling.",
    proofSummary: "Health, auth readiness, Vercel, and security-header proof can be represented as evidence cards.",
    safetySummary: "No production deploy, Vercel setting change, DNS/cutover, or live polling was added.",
    sourcePath: "docs/reports/WO-WOE-031-woe-detail-evidence-rollup.md",
    status: "recorded",
    createdAtLabel: "Recorded production proof boundary",
    proves: "Production proof has a first-class evidence category and display slot.",
    doesNotProve: "It does not perform live production verification or mutate production.",
    nextRelatedItem: "WO-EVIDENCE-008",
  },
  {
    evidenceId: "evidence-safety-boundary",
    title: "Safety Boundary Proof",
    type: "SAFETY_PROOF",
    scope: "Evidence Spine boundary preservation",
    relatedGoal: "Owner-controlled command environment",
    relatedBatch: "WILLIAMOS-EVIDENCE-SPINE-BATCH-001",
    relatedWorkOrder: "WO-EVIDENCE-012",
    relatedPr: "pending",
    originMain: "658426f8424225c58ad1ac9beaac26bed6ffa08c",
    validationSummary: "Safety regression coverage asserts blocked controls remain absent.",
    proofSummary:
      "The Evidence Spine classifies and links proof without import, edit, delete, scan, command, metadata, persistence, scheduler, LAN, or autonomy paths.",
    safetySummary: "Evidence remains read-only and owner authority remains outside the evidence record itself.",
    sourcePath: "docs/reports/WO-EVIDENCE-012-evidence-spine-safety-regression-sweep.md",
    status: "recorded",
    createdAtLabel: "Evidence Spine safety sweep",
    proves: "The evidence surface can show safety posture explicitly.",
    doesNotProve: "It does not enforce runtime permissions or implement an authority engine.",
    nextRelatedItem: "WO-EVIDENCE-013",
  },
  {
    evidenceId: "evidence-blocked-runtime-metadata",
    title: "Blocked Runtime Metadata Decision Proof",
    type: "BLOCKED_DECISION_PROOF",
    scope: "Runtime and metadata expansion gates",
    relatedGoal: "Keep local status bounded",
    relatedBatch: "LOCAL-OMEN-RUNTIME-AUTHORITY-FREEZE-BATCH-001",
    relatedWorkOrder: "WO-LOCAL-121",
    relatedPr: "#287",
    originMain: "dcebc87c13a1194cfadc13ce2079c35fb5e4739d",
    validationSummary: "The metadata gate remained closed after local runtime authority was frozen.",
    proofSummary:
      "Docker metadata, backup metadata, port checks, runtime control, persistence, LAN exposure, and autonomy remain blocked until owner authority opens a specific gate.",
    safetySummary: "No metadata expansion or runtime control was authorized.",
    sourcePath: "docs/reports/WO-LOCAL-121-metadata-expansion-blocker-registry.md",
    status: "blocked",
    createdAtLabel: "Local runtime blocker registry",
    proves: "Blocked local metadata decisions have supporting evidence.",
    doesNotProve: "It does not authorize metadata expansion.",
    nextRelatedItem: "Future metadata gate only if explicitly authorized",
  },
  {
    evidenceId: "evidence-authority-governance-registry",
    title: "Authority Governance Registry Proof",
    type: "AUTHORITY_PROOF",
    scope: "Authority gates, blockers, and owner decision boundaries",
    relatedGoal: "Authority / Governance Registry",
    relatedBatch: "WILLIAMOS-AUTHORITY-GOVERNANCE-REGISTRY-BATCH-001",
    relatedWorkOrder: "WO-AUTHORITY-001 through WO-AUTHORITY-014",
    relatedPr: "#285",
    originMain: "f4b40f893ea2f2815ffe31fc45e7d7c62c612058",
    validationSummary: "Authority registry tests, full suite, production build, Vercel, and CodeRabbit passed.",
    proofSummary:
      "Authority doctrine, gate registry, blocked actions, metadata gates, runtime gates, production gates, DB/schema gates, autonomy gates, badges, links, safety sweep, and rollup are represented as read-only authority evidence.",
    safetySummary:
      "No approval controls, enforcement engine, runtime mutation, metadata expansion, cloud change, DB/schema change, secrets, or autonomy were added.",
    sourcePath: "docs/reports/WO-AUTHORITY-014-authority-registry-evidence-rollup.md",
    status: "confirmed",
    createdAtLabel: "Authority registry closure",
    proves: "Authority gates are visible as evidence and governance records.",
    doesNotProve: "It does not implement an approval engine or grant authority.",
    nextRelatedItem: "Owner decision queue evidence",
  },
  {
    evidenceId: "evidence-owner-decision-queue",
    title: "Owner Decision Queue Proof",
    type: "BLOCKED_DECISION_PROOF",
    scope: "Owner decisions, blocked actions, and escalation boundaries",
    relatedGoal: "Authority / owner decision visibility",
    relatedBatch: "WILLIAMOS-OWNER-DECISION-QUEUE-BATCH-001",
    relatedWorkOrder: "WO-DECISION-001 through WO-DECISION-015",
    relatedPr: "#286",
    originMain: "6d1145bf5e7461c481a4c550201fc66d72504f23",
    validationSummary: "Owner decision queue tests, full suite, production build, Vercel, and CodeRabbit passed.",
    proofSummary:
      "Blocked decisions are visible with owner actions, supporting evidence, safety cards, and next-lane decision records.",
    safetySummary:
      "No approval mutation, command execution, dynamic ingestion, runtime mutation, production action, or autonomy was added.",
    sourcePath: "docs/reports/WO-DECISION-014-owner-decision-evidence-rollup.md",
    status: "confirmed",
    createdAtLabel: "Owner decision queue closure",
    proves: "Blocked decisions can be inspected without granting authority.",
    doesNotProve: "It does not approve, deny, execute, or mutate decision state.",
    nextRelatedItem: "WILLIAMOS-MEMORY-SPINE-BATCH-001",
  },
  {
    evidenceId: "evidence-next-lane-authority-registry",
    title: "Next Lane Decision: Authority Registry",
    type: "NEXT_LANE_DECISION",
    scope: "Post-Evidence Spine lane selection",
    relatedGoal: "Governed WilliamOS authority model",
    relatedBatch: "WILLIAMOS-EVIDENCE-SPINE-BATCH-001",
    relatedWorkOrder: "WO-EVIDENCE-014",
    relatedPr: "pending",
    originMain: "658426f8424225c58ad1ac9beaac26bed6ffa08c",
    validationSummary: "Decision packet only; no implementation outside the packet.",
    proofSummary:
      "After WOE details and the Evidence Spine, the next high-value lane is an Authority / Governance Registry.",
    safetySummary:
      "No authority engine, approval controls, autonomy, metadata expansion, or runtime control is authorized by this evidence.",
    sourcePath: "docs/reports/WO-EVIDENCE-014-next-lane-decision-packet.md",
    status: "recommended",
    createdAtLabel: "Evidence Spine next lane decision",
    proves: "The next recommended batch is documented.",
    doesNotProve: "It does not implement or authorize the Authority Registry.",
    nextRelatedItem: "WILLIAMOS-AUTHORITY-GOVERNANCE-REGISTRY-BATCH-001",
  },
]

export const VALIDATION_PROOF_CARDS: EvidenceProofCard[] = [
  {
    label: "git diff --check",
    value: "Required",
    description: "Whitespace and patch safety check remains part of Work Order closure.",
    category: "VALIDATION_PROOF",
  },
  {
    label: "Focused tests",
    value: "Required",
    description: "Evidence-specific and WOE-focused tests prove the affected read models.",
    category: "VALIDATION_PROOF",
  },
  {
    label: "Full suite",
    value: "Required",
    description: "The full test suite remains the broad regression check before merge.",
    category: "VALIDATION_PROOF",
  },
  {
    label: "npm run build",
    value: "Required",
    description: "Production build validates the Next.js surface without deploying.",
    category: "VALIDATION_PROOF",
  },
  {
    label: "Vercel",
    value: "Recorded",
    description: "Vercel proof is displayed when recorded; this surface does not call Vercel.",
    category: "VALIDATION_PROOF",
  },
  {
    label: "CodeRabbit",
    value: "Recorded",
    description: "CodeRabbit proof is displayed when recorded; this surface does not call CodeRabbit.",
    category: "VALIDATION_PROOF",
  },
]

export const LOCAL_PROOF_CARDS: EvidenceProofCard[] = [
  {
    label: "HP OMEN host",
    value: "Phase 1",
    description: "Local proof remains tied to the HP OMEN Gaming Laptop 16-ap0xxx.",
    category: "LOCAL_PROOF",
  },
  {
    label: "/api/local/runtime/status",
    value: "Proven",
    description: "The local runtime status route is read-only and localhost-oriented.",
    category: "LOCAL_PROOF",
  },
  {
    label: "App proof image",
    value: "Proven",
    description: "The refreshed app proof image served the local status route in the proof lane.",
    category: "LOCAL_PROOF",
  },
  {
    label: "Postgres proof posture",
    value: "Healthy",
    description: "WilliamOS Postgres proof remained separate from TerraFusion/PACS resources.",
    category: "LOCAL_PROOF",
  },
  {
    label: "Ports 3100/3101",
    value: "Clear after cleanup",
    description: "The local proof leaves app proof ports clear after cleanup.",
    category: "LOCAL_PROOF",
  },
  {
    label: "Read-only boundary",
    value: "Preserved",
    description: "The local status subsystem displays status but does not control runtime.",
    category: "LOCAL_PROOF",
  },
]

export const PRODUCTION_PROOF_CARDS: EvidenceProofCard[] = [
  {
    label: "/api/health",
    value: "Recorded",
    description: "Production health proof belongs in evidence when recorded.",
    category: "PRODUCTION_PROOF",
  },
  {
    label: "/api/auth/readiness",
    value: "Recorded",
    description: "Auth readiness proof belongs in evidence when recorded.",
    category: "PRODUCTION_PROOF",
  },
  {
    label: "Vercel check",
    value: "Recorded",
    description: "Vercel result is evidence only; this spine does not change Vercel settings.",
    category: "PRODUCTION_PROOF",
  },
  {
    label: "x-powered-by absent",
    value: "Recorded",
    description: "Security-header proof can be displayed when captured in a completed lane.",
    category: "PRODUCTION_PROOF",
  },
  {
    label: "Production boundary",
    value: "No deploy",
    description: "The Evidence Spine does not deploy, cut over DNS, or mutate production.",
    category: "PRODUCTION_PROOF",
  },
]

export const SAFETY_PROOF_CARDS: EvidenceProofCard[] = [
  {
    label: "No command execution",
    value: "Visible",
    description: "Evidence surfaces must not execute commands or expose a command bridge.",
    category: "SAFETY_PROOF",
  },
  {
    label: "No command runner",
    value: "Visible",
    description: "WilliamOS remains display-only in this lane.",
    category: "SAFETY_PROOF",
  },
  {
    label: "No Docker metadata",
    value: "Visible",
    description: "Docker metadata is not collected or displayed by this Evidence Spine.",
    category: "SAFETY_PROOF",
  },
  {
    label: "No backup scan",
    value: "Visible",
    description: "Backup contents and metadata are not scanned.",
    category: "SAFETY_PROOF",
  },
  {
    label: "No port checks",
    value: "Visible",
    description: "Port status remains outside this batch.",
    category: "SAFETY_PROOF",
  },
  {
    label: "No persistence or service/schedule",
    value: "Visible",
    description: "No persistent service, scheduled task, or background worker is added.",
    category: "SAFETY_PROOF",
  },
  {
    label: "No LAN exposure",
    value: "Visible",
    description: "No firewall, router, DNS, or LAN exposure changes occur.",
    category: "SAFETY_PROOF",
  },
  {
    label: "No secrets",
    value: "Visible",
    description: "No secrets are committed, printed, imported, or scanned.",
    category: "SAFETY_PROOF",
  },
  {
    label: "No TerraFusion/PACS touch",
    value: "Visible",
    description: "TerraFusion, PACS, and unrelated containers remain out of scope.",
    category: "SAFETY_PROOF",
  },
  {
    label: "No autonomy",
    value: "Visible",
    description: "Hermes, MCP, Brain Council action, and autonomy remain blocked.",
    category: "SAFETY_PROOF",
  },
]

export const BLOCKED_DECISION_EVIDENCE_LINKS: BlockedDecisionEvidenceLink[] = [
  {
    blocker: "Local metadata not authorized",
    evidenceId: "evidence-blocked-runtime-metadata",
    whyBlocked: "Docker, backup, and port metadata require separate owner authority.",
    safeNextAction: "Open a metadata gate only when there is a concrete owner-approved need.",
  },
  {
    blocker: "Docker metadata not authorized",
    evidenceId: "evidence-blocked-runtime-metadata",
    whyBlocked: "Docker metadata would expand runtime visibility beyond static and HTTP status.",
    safeNextAction: "Use a Docker metadata gate before any Docker socket or metadata design.",
  },
  {
    blocker: "Port checks not authorized",
    evidenceId: "evidence-blocked-runtime-metadata",
    whyBlocked: "Port checks were deferred from the first live status slice.",
    safeNextAction: "Use a port-status gate before implementing port checks.",
  },
  {
    blocker: "Backup metadata not authorized",
    evidenceId: "evidence-blocked-runtime-metadata",
    whyBlocked: "Backup metadata scanning could drift into filesystem scanning.",
    safeNextAction: "Use a backup metadata gate before reading backup metadata.",
  },
  {
    blocker: "Runtime control not authorized",
    evidenceId: "evidence-safety-boundary",
    whyBlocked: "The API/UI may observe but must not start, stop, restart, repair, schedule, or expose runtime.",
    safeNextAction: "Keep runtime control blocked until a specific authority packet exists.",
  },
  {
    blocker: "Autonomy not authorized",
    evidenceId: "evidence-safety-boundary",
    whyBlocked: "Hermes, MCP, Brain Council action, and autonomy remain advisory or blocked.",
    safeNextAction: "Use an autonomy doctrine gate before considering autonomous execution.",
  },
]

export function getEvidenceSpineSurface(): EvidenceSpineSurface {
  return {
    doctrine: EVIDENCE_DOCTRINE,
    categories: EVIDENCE_CATEGORIES,
    records: EVIDENCE_RECORDS,
    recentEvidence: EVIDENCE_RECORDS.slice(0, 4),
    detailRecord: EVIDENCE_RECORDS.find(
      (record) => record.evidenceId === "evidence-woe-detail-surfaces",
    ) ?? EVIDENCE_RECORDS[0],
    validationProofCards: VALIDATION_PROOF_CARDS,
    localProofCards: LOCAL_PROOF_CARDS,
    productionProofCards: PRODUCTION_PROOF_CARDS,
    safetyProofCards: SAFETY_PROOF_CARDS,
    blockedDecisionEvidenceLinks: BLOCKED_DECISION_EVIDENCE_LINKS,
    woeNavigation: [
      {
        label: "Goal detail evidence",
        href: "/work-orders",
        description: "Goal, batch, and Work Order detail surfaces link back to this proof layer.",
      },
      {
        label: "Blocked decision evidence",
        href: "/governance",
        description: "Blocked decisions show why owner authority is required before expansion.",
      },
      {
        label: "Local runtime proof",
        href: "/runtime",
        description: "Local OMEN proof remains a read-only governed subsystem.",
      },
    ],
    nextLaneDecision: {
      recommendedBatch: "WILLIAMOS-AUTHORITY-GOVERNANCE-REGISTRY-BATCH-001",
      recommendedOption: "B - Authority / Governance Registry",
      reason:
        "After WOE details and the Evidence Spine, WilliamOS needs a formal authority registry before mutation, metadata expansion, runtime control, autonomy, deploy, DB/schema change, or production action.",
    },
    safety: {
      readOnly: true,
      ingestionAdded: false,
      filesystemScanAdded: false,
      githubApiIntegrationAdded: false,
      githubWriteAdded: false,
      codexAutomationAdded: false,
      reportGenerationAutomationAdded: false,
      databaseAdded: false,
      commandExecutionAdded: false,
      commandRunnerAdded: false,
      dockerMetadataAdded: false,
      backupScanAdded: false,
      portChecksAdded: false,
      localRuntimeControlAdded: false,
      backgroundWorkerAdded: false,
      persistenceImplemented: false,
      schedulerAdded: false,
      lanExposureEnabled: false,
      secretsDisclosed: false,
      autonomyAuthorized: false,
      runtimeControlAuthorized: false,
      metadataExpansionAuthorized: false,
    },
  }
}
