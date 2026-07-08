import { describe, expect, it } from "vitest"

import {
  EVIDENCE_GAP_CLASSIFICATIONS,
  FAILURE_CLASSIFICATIONS,
  TRACE_CATEGORIES,
  getTraceLedgerSurface,
} from "@/components/trace/trace-ledger-registry"

describe("Trace Ledger Registry", () => {
  it("defines trace doctrine as read-only reasoning evidence", () => {
    const surface = getTraceLedgerSurface()
    const doctrine = surface.doctrine.statements.join(" ")

    expect(doctrine).toContain("Traces explain how work was reasoned through")
    expect(doctrine).toContain("Trace records in this batch are static and read-only")
    expect(doctrine).toContain("Traces do not collect runtime data")
    expect(doctrine).toContain("Traces do not create, generate, or execute evals automatically")
    expect(doctrine).toContain("The Primary remains the approving authority")
  })

  it("defines trace categories for goals through safety traces", () => {
    expect(TRACE_CATEGORIES.map((entry) => entry.category)).toEqual([
      "GOAL_TRACE",
      "LOOP_TRACE",
      "WORK_ORDER_TRACE",
      "EVIDENCE_TRACE",
      "MEMORY_TRACE",
      "COUNCIL_TRACE",
      "AUTHORITY_TRACE",
      "OWNER_DECISION_TRACE",
      "BLOCKED_TRACE",
      "FAILURE_TRACE",
      "EVAL_PROPOSAL_TRACE",
      "SAFETY_TRACE",
    ])
  })

  it("classifies failure types without automatic detection or monitoring", () => {
    expect(FAILURE_CLASSIFICATIONS.map((entry) => entry.failureType)).toEqual([
      "VALIDATION_FAILURE",
      "BUILD_FAILURE",
      "ROUTE_PROOF_FAILURE",
      "DOCKER_RUNTIME_FAILURE",
      "AUTHORITY_BLOCKER",
      "SCOPE_CONFLICT",
      "STALE_IMAGE_LIMITATION",
      "ENVIRONMENT_DEPENDENCY",
      "OWNER_DECISION_REQUIRED",
      "SAFETY_STOP",
      "UNKNOWN",
    ])

    expect(
      FAILURE_CLASSIFICATIONS.find((entry) => entry.failureType === "OWNER_DECISION_REQUIRED")?.safeDefault,
    ).toBe("Stop and queue owner decision.")
  })

  it("classifies evidence gaps and confidence movement without runtime collection", () => {
    expect(EVIDENCE_GAP_CLASSIFICATIONS.map((entry) => entry.gapType)).toEqual([
      "MISSING_BASE_PROOF",
      "MISSING_PR_CHECKS",
      "MISSING_PRODUCTION_ROUTE_PROOF",
      "MISSING_OWNER_DECISION",
      "MISSING_AUTHORITY_GATE",
      "MISSING_SAFETY_FLAGS",
      "CONTRADICTED_EVIDENCE",
      "STALE_CONTEXT",
    ])

    const surface = getTraceLedgerSurface()

    expect(surface.confidenceMovementModel.map((entry) => entry.movement)).toEqual([
      "confidence-raised",
      "confidence-lowered",
      "confidence-blocked",
      "confidence-unchanged",
    ])
    expect(surface.confidenceMovementModel[0]?.authorityBoundary).toContain(
      "does not grant authority",
    )
  })

  it("defines a Failure-to-Eval candidate packet without creating evals", () => {
    const surface = getTraceLedgerSurface()

    expect(surface.evalCandidatePacket.requiredFields.map((field) => field.label)).toEqual([
      "Candidate ID",
      "Source trace",
      "Failure classification",
      "Evidence gap",
      "Expected assertion",
      "Risk level",
      "Authority required",
      "Blocked actions",
    ])
    expect(surface.evalCandidatePacket.blockedUntilAuthorized).toEqual(
      expect.arrayContaining([
        "create eval file",
        "run eval",
        "runtime trace collection",
        "telemetry service activation",
        "write memory",
        "dispatch worker",
        "invoke command runner",
      ]),
    )
  })

  it("polishes trace proof readability for Primary inspection", () => {
    const surface = getTraceLedgerSurface()

    expect(surface.proofReadability.map((item) => item.label)).toEqual([
      "Trace identity",
      "Evidence used",
      "Confidence impact",
      "Safety posture",
      "Next safe gate",
    ])
    expect(surface.proofReadability[3]?.description).toContain("runtime")
    expect(surface.proofReadability[3]?.description).toContain("telemetry")
    expect(surface.proofReadability[3]?.description).toContain("eval runner")
  })

  it("clarifies failure classification severity, evidence, eval candidacy, and owner decision impact", () => {
    const surface = getTraceLedgerSurface()
    const labels = surface.failureClassificationPolish.map((entry) => entry.plainLabel)

    expect(labels).toEqual([
      "Validation failed",
      "Build failed",
      "Production route proof failed",
      "Safety boundary stopped work",
      "Base proof missing",
      "Evidence is stale",
      "Owner decision is required",
      "Environment/tooling blocked proof",
    ])
    expect(
      surface.failureClassificationPolish.find((entry) => entry.failureType === "SAFETY_STOP"),
    ).toMatchObject({
      severity: "critical",
      blocksAction: true,
      mayProduceEvalCandidate: true,
    })
  })

  it("makes eval candidates readable without implying a runner exists", () => {
    const surface = getTraceLedgerSurface()

    expect(surface.evalCandidateReadability.map((entry) => entry.label)).toEqual([
      "Purpose",
      "Expected input",
      "Expected output",
      "Safety boundary tested",
      "Authority required",
    ])
    expect(surface.evalCandidateReadability[4]?.description).toContain("owner-authorized WO")
  })

  it("defines calm missing, stale, insufficient, and blocked proof states", () => {
    const surface = getTraceLedgerSurface()

    expect(surface.missingProofStates.map((state) => state.state)).toEqual([
      "missing proof",
      "stale proof",
      "insufficient proof",
      "blocked proof",
    ])
    expect(surface.missingProofStates.find((state) => state.state === "blocked proof")?.nextGate).toBe(
      "Owner authority required.",
    )
  })

  it("clarifies Council, WOE, Evidence, Trace, and eval candidate relationships", () => {
    const surface = getTraceLedgerSurface()

    expect(surface.relationshipClarity.map((item) => item.label)).toEqual([
      "Council to Trace",
      "WOE to Trace",
      "Evidence to Trace",
      "Trace to Eval Candidate",
    ])
    expect(surface.relationshipClarity[3]?.boundary).toContain("No eval file")
    expect(surface.relationshipClarity[3]?.boundary).toContain("runner")
  })

  it("groups safety flags for runtime, eval, command, authority, and external-system boundaries", () => {
    const surface = getTraceLedgerSurface()

    expect(surface.safetyFlagGroups.map((group) => group.label)).toEqual([
      "Runtime and telemetry",
      "Eval execution",
      "Command and production",
      "Authority and memory",
      "External systems",
    ])
    expect(surface.safetyFlagGroups[0]?.blockedMeaning).toContain("No runtime trace collection")
    expect(surface.safetyFlagGroups[4]?.blockedMeaning).toContain("No ingestion")
  })

  it("creates static trace records linked to WOs, evidence, memory, decisions, authority, and Council", () => {
    const surface = getTraceLedgerSurface()
    const councilTrace = surface.records.find(
      (record) => record.traceId === "trace-brain-council-advisory-complete",
    )
    const authorityTrace = surface.records.find((record) => record.traceId === "trace-authority-refresh-pass")
    const memoryTrace = surface.records.find((record) => record.traceId === "trace-memory-governance-boundary")

    expect(councilTrace).toMatchObject({
      category: "COUNCIL_TRACE",
      relatedGoal: "GOAL-WOS-003",
      result: "pass",
      failureType: "NONE",
    })
    expect(councilTrace?.whatItDoesNotAuthorize).toContain("Council runtime")
    expect(authorityTrace).toMatchObject({
      category: "AUTHORITY_TRACE",
      relatedGoal: "GOAL-WOS-007",
      relatedPr: "#291",
      result: "pass",
      failureType: "NONE",
    })
    expect(authorityTrace?.evidenceUsed).toContain("WO-AUTHORITY-016 rollup")
    expect(memoryTrace?.authorityGate).toBe("MEMORY_WRITE_GATE")
    expect(memoryTrace?.whatItDoesNotAuthorize).toContain("memory ingestion")
  })

  it("models failure-to-eval proposals without generating or running evals", () => {
    const surface = getTraceLedgerSurface()
    const proposals = surface.evalProposals.map((proposal) => proposal.proposalId)

    expect(proposals).toEqual([
      "eval-proposal-council-no-execution",
      "eval-proposal-owner-not-courier",
      "eval-proposal-runtime-repair-gate",
      "eval-proposal-trace-boundary",
    ])
    expect(surface.evalProposals.every((proposal) => proposal.whatThisDoesNotDo.length > 0)).toBe(true)
    expect(surface.evalProposals.every((proposal) => proposal.authorityRequired === "Future eval implementation authority")).toBe(true)
  })

  it("links traces to read-only WOE, evidence, memory, decisions, authority, and Council records", () => {
    const surface = getTraceLedgerSurface()
    const traceIds = new Set(surface.records.map((record) => record.traceId))

    for (const link of [
      ...surface.workOrderLinks,
      ...surface.evidenceLinks,
      ...surface.memoryLinks,
      ...surface.ownerDecisionLinks,
      ...surface.authorityLinks,
      ...surface.councilLinks,
    ]) {
      expect(traceIds.has(link.traceId)).toBe(true)
      expect(link.relatedItem.length).toBeGreaterThan(0)
      expect(link.boundary.length).toBeGreaterThan(0)
    }
  })

  it("adds safety proof cards for blocked trace authority lanes", () => {
    const surface = getTraceLedgerSurface()

    expect(surface.safetyProofCards.map((card) => card.label)).toEqual([
      "No runtime tracing",
      "No background collection",
      "No persistence",
      "No eval execution",
      "No command execution",
      "No memory writes",
      "No autonomy",
    ])
  })

  it("recommends Trace/Eval polish while keeping runtime lanes blocked", () => {
    const surface = getTraceLedgerSurface()

    expect(surface.nextLaneDecision).toMatchObject({
      recommendedBatch: "WILLIAMOS-TRACE-EVAL-EVIDENCE-POLISH-BATCH-001",
      recommendedOption: "A - Trace/Eval evidence clarity polish",
    })
    expect(surface.nextLaneDecision.blockedLanes).toContain("runtime trace collection")
    expect(surface.nextLaneDecision.blockedLanes).toContain("telemetry service")
    expect(surface.nextLaneDecision.blockedLanes).toContain("eval execution")
    expect(surface.nextLaneDecision.blockedLanes).toContain("command runner")
    expect(surface.nextLaneDecision.blockedLanes).toContain("autonomy")
  })

  it("does not add runtime tracing, ingestion, eval execution, persistence, command execution, memory writes, metadata, secrets, or autonomy", () => {
    const surface = getTraceLedgerSurface()
    const serialized = JSON.stringify(surface).toLowerCase()

    expect(surface.safety).toEqual({
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
    })
    expect(serialized).not.toContain("database_url")
    expect(serialized).not.toContain("better_auth_secret")
    expect(serialized).not.toContain("run eval button")
    expect(serialized).not.toContain("execute button")
    expect(serialized).not.toContain("create eval button")
  })
})
