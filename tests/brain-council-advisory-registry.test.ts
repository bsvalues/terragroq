import { describe, expect, it } from "vitest"

import {
  COUNCIL_ADVISORY_STATES,
  COUNCIL_ROLES,
  getBrainCouncilAdvisoryRegistry,
} from "@/components/brain-council/brain-council-advisory-registry"

describe("Brain Council advisory registry", () => {
  it("defines Council doctrine as advisory only", () => {
    const registry = getBrainCouncilAdvisoryRegistry()
    const doctrine = registry.doctrine.statements.join(" ")

    expect(doctrine).toContain("Brain Council may advise")
    expect(doctrine).toContain("must not execute")
    expect(doctrine).toContain("must not activate Hermes")
    expect(doctrine).toContain("must not write memory")
    expect(doctrine).toContain("The Primary remains the approving authority")
  })

  it("defines roles as advisory labels, not agents", () => {
    expect(COUNCIL_ROLES.map((role) => role.label)).toEqual([
      "Strategist",
      "Evidence Reviewer",
      "Safety Reviewer",
      "Product Reviewer",
      "Governance Reviewer",
      "Local Runtime Reviewer",
      "Memory Reviewer",
      "Work Order Reviewer",
    ])
    expect(COUNCIL_ROLES.every((role) => role.advisoryBoundary.includes("Cannot"))).toBe(true)
  })

  it("defines the authorized advisory state model", () => {
    expect(COUNCIL_ADVISORY_STATES.map((state) => state.state)).toEqual([
      "NOT_REQUESTED",
      "CONTEXT_NEEDED",
      "EVIDENCE_REVIEW",
      "OPTIONS_REVIEW",
      "RISK_REVIEW",
      "DECISION_PACKET_READY",
      "OWNER_DECISION_NEEDED",
      "WORK_ORDER_RECOMMENDED",
      "BLOCKED_BY_AUTHORITY",
      "ADVISORY_COMPLETE",
    ])
  })

  it("creates static decision packets with evidence, memory, owner decision, risk, and blocked-action fields", () => {
    const registry = getBrainCouncilAdvisoryRegistry()
    const packet = registry.detailPacket

    expect(packet).toMatchObject({
      packetId: "council-packet-advisory-next-lane",
      advisoryState: "WORK_ORDER_RECOMMENDED",
      confidence: "high",
      recommendedWorkOrder: "WO-COUNCIL-001 through WO-COUNCIL-015",
    })
    expect(packet.evidenceUsed).toContain("evidence-owner-decision-queue")
    expect(packet.memoryUsed).toContain("memory-authority-registry-current")
    expect(packet.ownerDecisionLinks).toContain("decision-autonomy")
    expect(packet.options.map((option) => option.label)).toContain("Continue advisory UX and evidence")
    expect(packet.blockedActions).toContain("call tools")
    expect(packet.whatThisDoesNotAuthorize).toContain("agent orchestration")
  })

  it("shows risk, confidence, evidence sufficiency, authority, uncertainty, and stop conditions", () => {
    const packet = getBrainCouncilAdvisoryRegistry().detailPacket

    expect(packet.confidence).toBe("high")
    expect(packet.options.some((option) => option.risk === "critical")).toBe(true)
    expect(packet.evidenceSufficiency).toContain("Sufficient for static advisory display")
    expect(packet.authorityRequired).toContain("Owner authority required")
    expect(packet.uncertaintyNote).toContain("Future Council polish")
    expect(packet.stopCondition).toContain("Stop if implementation adds execution")
  })

  it("links Council packets to Evidence, Memory, and Owner Decisions statically", () => {
    const registry = getBrainCouncilAdvisoryRegistry()
    const packetIds = new Set(registry.packets.map((packet) => packet.packetId))

    for (const link of [
      ...registry.evidenceLinks,
      ...registry.memoryLinks,
      ...registry.ownerDecisionLinks,
    ]) {
      expect(packetIds.has(link.packetId)).toBe(true)
      expect(link.relatedItem.length).toBeGreaterThan(0)
      expect(link.description.length).toBeGreaterThan(0)
    }
  })

  it("displays Work Order recommendations as recommendations only", () => {
    const registry = getBrainCouncilAdvisoryRegistry()
    const recommendation = registry.recommendations[0]

    expect(recommendation.recommendedWorkOrder).toBe("WO-COUNCIL-001 through WO-COUNCIL-015")
    expect(recommendation.authorityRequired).toBe("Read-only UI/model authority only.")
    expect(recommendation.blockedActions).toContain("execute recommendation")
    expect(recommendation.nextSafeOwnerAction).toContain("do not open runtime authority")
  })

  it("adds safety proof cards for all Council advisory boundaries", () => {
    const registry = getBrainCouncilAdvisoryRegistry()

    expect(registry.safetyProofCards.map((card) => card.label)).toEqual([
      "No command execution",
      "No command runner",
      "No tool calls",
      "No worker activation",
      "No memory write",
      "No persistence",
      "No autonomy",
      "Owner remains authority",
    ])
  })

  it("recommends an authority registry refresh and keeps risky lanes blocked", () => {
    const registry = getBrainCouncilAdvisoryRegistry()

    expect(registry.nextLaneDecision).toMatchObject({
      recommendedBatch: "WILLIAMOS-AUTHORITY-GOVERNANCE-REGISTRY-REFRESH-BATCH-001",
      recommendedOption: "B - Authority / Governance Registry",
    })
    expect(registry.nextLaneDecision.blockedLanes).toContain("Hermes/MCP/autonomy activation")
    expect(registry.nextLaneDecision.blockedLanes).toContain("command execution")
    expect(registry.nextLaneDecision.blockedLanes).toContain("metadata expansion")
  })

  it("does not add runtime, execution, tools, workers, memory writes, retrieval, persistence, GitHub writes, metadata, secrets, or autonomy", () => {
    const registry = getBrainCouncilAdvisoryRegistry()
    const serialized = JSON.stringify(registry).toLowerCase()

    expect(registry.safety).toEqual({
      staticReadOnly: true,
      councilRuntimeAdded: false,
      commandExecutionAdded: false,
      commandRunnerAdded: false,
      toolCallsAdded: false,
      workerActivationAdded: false,
      hermesActivationAdded: false,
      mcpActivationAdded: false,
      memoryWriteAdded: false,
      runtimeMemoryReadAdded: false,
      dynamicRetrievalAdded: false,
      vectorStoreAdded: false,
      embeddingsAdded: false,
      persistenceImplemented: false,
      backgroundWorkerAdded: false,
      schedulerAdded: false,
      githubWriteAdded: false,
      codexAutomationAdded: false,
      dockerMetadataAdded: false,
      backupScanAdded: false,
      portChecksAdded: false,
      serviceRegistered: false,
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
    expect(serialized).not.toContain("execute button")
    expect(serialized).not.toContain("run council button")
    expect(serialized).not.toContain("ask council button")
  })
})
