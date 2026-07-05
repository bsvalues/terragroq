import { describe, expect, it } from "vitest"

import {
  MEMORY_GOVERNANCE_CATEGORIES,
  MEMORY_GOVERNANCE_STATES,
  getMemoryGovernanceSurface,
} from "@/components/memory/memory-governance-registry"

describe("Memory Governance Registry", () => {
  it("defines doctrine that keeps memory subordinate to evidence, authority, and the Primary", () => {
    const surface = getMemoryGovernanceSurface()
    const doctrine = surface.doctrine.statements.join(" ")

    expect(doctrine).toContain("Memory is governed continuity, not authority")
    expect(doctrine).toContain("Memory may not promote itself to canon")
    expect(doctrine).toContain("Memory may not delete, archive, ingest, extract, or mutate itself")
    expect(doctrine).toContain("The Primary remains the approving authority")
    expect(doctrine).toContain("WilliamOS may display memory governance state")
  })

  it("defines the required memory categories and states", () => {
    expect(MEMORY_GOVERNANCE_CATEGORIES.map((entry) => entry.category)).toEqual([
      "FACT",
      "DECISION",
      "PROCEDURE",
      "POLICY",
      "PREFERENCE",
      "PROJECT_STATE",
      "LOCAL_RUNTIME_STATE",
      "EVIDENCE_SUMMARY",
      "AUTHORITY_SUMMARY",
      "OWNER_DECISION_SUMMARY",
      "CONTRADICTION",
      "STALE_ITEM",
      "SENSITIVE_ITEM",
    ])

    expect(MEMORY_GOVERNANCE_STATES.map((entry) => entry.state)).toEqual([
      "DRAFT",
      "REVIEW_REQUIRED",
      "EVIDENCE_BACKED",
      "CANON_ELIGIBLE",
      "CANON_APPROVED_OUT_OF_BAND",
      "STALE",
      "CONTRADICTED",
      "PARKED",
      "BLOCKED",
    ])
  })

  it("classifies sensitivity with secret and protected data blocked from memory", () => {
    const surface = getMemoryGovernanceSurface()
    const levels = surface.sensitivityRegistry.map((entry) => entry.level)
    const blocked = surface.sensitivityRegistry.find((entry) => entry.level === "BLOCKED_FROM_MEMORY")

    expect(levels).toEqual([
      "PUBLIC_SAFE",
      "INTERNAL",
      "PRIVATE_OPERATOR",
      "SENSITIVE_LOCAL",
      "SECRET_ADJACENT",
      "BLOCKED_FROM_MEMORY",
    ])
    expect(blocked?.examples).toContain("API keys")
    expect(blocked?.examples).toContain("PACS records")
    expect(blocked?.safeDefault).toBe("do not capture; represent only as redacted blocker evidence")
  })

  it("creates static records linked to Evidence, Authority, Owner Decisions, and Work Orders", () => {
    const surface = getMemoryGovernanceSurface()
    const localFreeze = surface.records.find(
      (record) => record.memoryId === "memory-local-omen-authority-freeze",
    )

    expect(localFreeze).toMatchObject({
      category: "LOCAL_RUNTIME_STATE",
      state: "EVIDENCE_BACKED",
      sensitivity: "SENSITIVE_LOCAL",
      confidence: "high",
      safeDefault: "Keep local runtime read-only, manual-only, and localhost-only.",
    })
    expect(localFreeze?.evidenceLinks).toContain("evidence-pr-local-freeze")
    expect(localFreeze?.authorityLinks).toContain("authority-metadata-expansion")
    expect(localFreeze?.ownerDecisionLinks).toContain("decision-docker-metadata")
    expect(localFreeze?.workOrderLinks).toContain("WO-LOCAL-120 through WO-LOCAL-124")
  })

  it("keeps stale and contradicted memory visible but untrusted", () => {
    const surface = getMemoryGovernanceSurface()
    const copy = surface.staleContradictionUx.statements.join(" ")
    const reviewRecord = surface.records.find(
      (record) => record.memoryId === "memory-stale-contradiction-review",
    )

    expect(copy).toContain("Newest explicit operator instruction wins over stale memory")
    expect(copy).toContain("Current evidence wins over remembered evidence")
    expect(copy).toContain("Contradicted memory cannot become canon until resolved")
    expect(reviewRecord?.state).toBe("REVIEW_REQUIRED")
    expect(reviewRecord?.canonEligibility).toBe("Not eligible while stale or contradicted.")
  })

  it("models review queue blockers without adding controls", () => {
    const surface = getMemoryGovernanceSurface()
    const candidates = surface.reviewQueue.map((item) => item.memoryCandidate)

    expect(candidates).toEqual([
      "Dynamic memory ingestion",
      "Canon promotion workflow",
      "Sensitive or secret-adjacent memory",
      "Stale or contradicted records",
    ])
    expect(surface.reviewQueue.find((item) => item.reviewItemId === "review-memory-ingestion")?.safeDefault).toBe("blocked")
    expect(surface.reviewQueue.find((item) => item.reviewItemId === "review-sensitive-memory")?.riskLevel).toBe("critical")
  })

  it("connects memory to evidence, authority, and owner decision records", () => {
    const surface = getMemoryGovernanceSurface()
    const memoryIds = new Set(surface.records.map((record) => record.memoryId))

    for (const link of [
      ...surface.evidenceMemoryLinks,
      ...surface.authorityMemoryLinks,
      ...surface.ownerDecisionMemoryLinks,
    ]) {
      expect(memoryIds.has(link.memoryId)).toBe(true)
      expect(link.relatedItem.length).toBeGreaterThan(0)
      expect(link.description.length).toBeGreaterThan(0)
    }
  })

  it("adds safety proof cards for the blocked memory authority lanes", () => {
    const surface = getMemoryGovernanceSurface()
    const labels = surface.safetyProofCards.map((card) => card.label)

    expect(labels).toEqual([
      "No memory ingestion",
      "No memory writes",
      "No runtime memory reads",
      "No embeddings",
      "No command execution",
      "No metadata expansion",
      "No persistence or LAN",
      "No secrets",
      "Owner remains authority",
    ])
  })

  it("integrates navigation without action endpoints", () => {
    const surface = getMemoryGovernanceSurface()
    const links = new Map(surface.navigation.map((item) => [item.label, item.href]))

    expect(links.get("Evidence")).toBe("/audit")
    expect(links.get("Authority")).toBe("/governance")
    expect(links.get("Decisions")).toBe("/decisions")
    expect(links.get("Work Orders")).toBe("/work-orders")
  })

  it("recommends an advisory evidence and UX lane while keeping new authority blocked", () => {
    const surface = getMemoryGovernanceSurface()

    expect(surface.nextLaneDecision).toMatchObject({
      recommendedBatch: "WILLIAMOS-BRAIN-COUNCIL-ADVISORY-BATCH-001",
      recommendedOption: "B - advisory evidence and UX lane",
    })
    expect(surface.nextLaneDecision.blockedLanes).toContain("Memory ingestion")
    expect(surface.nextLaneDecision.blockedLanes).toContain("Hermes/MCP/autonomy activation")
    expect(surface.nextLaneDecision.blockedLanes).toContain("Docker/backup/port metadata")
  })

  it("does not add ingestion, writes, runtime reads, embeddings, execution, metadata, persistence, LAN, secrets, or autonomy", () => {
    const surface = getMemoryGovernanceSurface()
    const serialized = JSON.stringify(surface).toLowerCase()

    expect(surface.safety).toEqual({
      staticReadOnly: true,
      memoryIngestionAdded: false,
      memoryExtractionAdded: false,
      memoryWriteAdded: false,
      canonPromotionAdded: false,
      deletionArchiveMutationAdded: false,
      runtimeMemoryReadAdded: false,
      brainCouncilRuntimeMemoryReadAdded: false,
      hermesMemoryReadAdded: false,
      mcpMemoryReadAdded: false,
      vectorStoreAdded: false,
      embeddingsAdded: false,
      databaseSchemaChanged: false,
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
      secretsDisclosed: false,
      hermesMcpAutonomyChanged: false,
      terraFusionPacsTouched: false,
      unrelatedContainersTouched: false,
    })
    expect(serialized).not.toContain("database_url")
    expect(serialized).not.toContain("better_auth_secret")
    expect(serialized).not.toContain("api key:")
    expect(serialized).not.toContain("add memory button")
    expect(serialized).not.toContain("promote button")
    expect(serialized).not.toContain("execute button")
  })
})
