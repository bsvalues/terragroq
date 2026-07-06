import { describe, expect, it } from "vitest"

import {
  HERMES_ACTIVATION_REQUIREMENTS,
  HERMES_AUTHORITY_BOUNDARIES,
  HERMES_STATUSES,
  HERMES_WORKER_PACKET_PROPOSALS,
  getHermesBoundarySurface,
} from "@/components/hermes/hermes-boundary-registry"

describe("Hermes boundary registry", () => {
  it("defines Hermes doctrine without activating Hermes", () => {
    const surface = getHermesBoundarySurface()
    const doctrine = surface.doctrine.statements.join(" ")

    expect(doctrine).toContain("Hermes is a governed worker-sidecar concept")
    expect(doctrine).toContain("Hermes is not active")
    expect(doctrine).toContain("Hermes is not autonomous")
    expect(doctrine).toContain("cannot execute commands or call tools")
    expect(doctrine).toContain("activation review")
  })

  it("adds the required static status model", () => {
    expect(HERMES_STATUSES.map((record) => record.status)).toEqual([
      "NOT_INSTALLED",
      "NOT_ACTIVE",
      "BLOCKED_BY_AUTHORITY",
      "PROPOSED",
      "ACTIVATION_REVIEW_REQUIRED",
      "DENIED",
      "PARKED",
      "FUTURE_GATE",
    ])
    expect(getHermesBoundarySurface().currentStatus).toBe("BLOCKED_BY_AUTHORITY")
  })

  it("models authority boundaries and activation requirements", () => {
    expect(HERMES_AUTHORITY_BOUNDARIES.map((boundary) => boundary.label)).toEqual([
      "Owner Decision required",
      "Authority gate required",
      "Work Order required",
      "Evidence required",
      "Safety proof required",
      "Scope restriction required",
      "Rollback/disable plan required",
    ])
    expect(HERMES_ACTIVATION_REQUIREMENTS.map((requirement) => requirement.label)).toEqual([
      "Explicit owner authorization",
      "Approved activation Work Order",
      "Authority registry gate",
      "Evidence packet",
      "Scope limit",
      "Allowed tools list",
      "Blocked tools list",
      "Runtime boundary",
      "Rollback plan",
      "Monitoring/reporting boundary",
      "Stop conditions",
    ])
  })

  it("adds static worker packet proposals without execution authority", () => {
    const proposal = HERMES_WORKER_PACKET_PROPOSALS[0]

    expect(proposal.packetId).toBe("HERMES-PACKET-PROPOSAL-001")
    expect(proposal.allowedActions).toContain("read static governance models")
    expect(proposal.blockedActions).toEqual(
      expect.arrayContaining(["execute commands", "call tools", "write files", "start workers"]),
    )
    expect(proposal.whatThisDoesNotAuthorize).toEqual(
      expect.arrayContaining(["Hermes activation", "worker execution", "tool calls", "autonomy"]),
    )
  })

  it("links Hermes to authority, decisions, evidence, trace, memory, council, and Academy/Wiki", () => {
    const surface = getHermesBoundarySurface()

    expect(surface.links.authority.map((link) => link.href)).toEqual(["/governance", "/agent-forge"])
    expect(surface.links.ownerDecisions.map((link) => link.href)).toEqual(["/decisions"])
    expect(surface.links.evidenceTrace.map((link) => link.href)).toEqual(["/audit", "/trace"])
    expect(surface.links.memoryCouncil.map((link) => link.href)).toEqual(["/memory", "/brain-council"])
    expect(surface.links.academyWiki.map((link) => link.href)).toEqual(["/academy"])
  })

  it("shows blocked and denied states with no activation available", () => {
    const surface = getHermesBoundarySurface()

    expect(surface.blockedStates.map((state) => state.label)).toEqual([
      "Activation blocked",
      "Tool calls denied",
      "Runtime control denied",
    ])
    expect(surface.blockedStates.every((state) => state.activationAvailable === false)).toBe(true)
    expect(surface.blockedStates.every((state) => state.prohibitedActions.length > 0)).toBe(true)
  })

  it("adds Hermes safety proof cards", () => {
    const surface = getHermesBoundarySurface()

    expect(surface.safetyProofCards.map((card) => card.label)).toEqual([
      "Hermes inactive",
      "No worker activation",
      "No tool calls",
      "No command execution",
      "No runtime control",
      "No memory write/read",
      "No autonomy",
      "Future authority required",
    ])
  })

  it("creates the next lane decision packet", () => {
    const surface = getHermesBoundarySurface()

    expect(surface.nextLaneDecision.recommendedOption).toBe("D - Agent Forge skill governance")
    expect(surface.nextLaneDecision.nextRecommendedBatch).toBe(
      "WILLIAMOS-AGENT-FORGE-SKILL-GOVERNANCE-BATCH-001",
    )
    expect(surface.nextLaneDecision.options).toHaveLength(7)
  })

  it("does not add Hermes runtime, activation, workers, tools, command execution, persistence, secrets, or autonomy", () => {
    expect(getHermesBoundarySurface().safety).toEqual({
      staticReadOnly: true,
      hermesRuntimeAdded: false,
      hermesActivationAdded: false,
      workerActivationAdded: false,
      toolCallsAdded: false,
      commandExecutionAdded: false,
      commandRunnerAdded: false,
      mcpActivationAdded: false,
      councilRuntimeAdded: false,
      memoryWriteAdded: false,
      runtimeMemoryReadAdded: false,
      dynamicRetrievalAdded: false,
      filesystemScanAdded: false,
      dynamicIngestionAdded: false,
      githubWriteAdded: false,
      codexAutomationAdded: false,
      vectorStoreAdded: false,
      embeddingsAdded: false,
      dockerMetadataAdded: false,
      backupScanAdded: false,
      portChecksAdded: false,
      runtimeControlAdded: false,
      persistenceImplemented: false,
      dbSchemaChanged: false,
      backgroundWorkerAdded: false,
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
  })
})
