import { describe, expect, it } from "vitest"

import {
  getOwnerDecisionQueueSurface,
  OWNER_DECISION_CATEGORIES,
  OWNER_DECISION_STATES,
  type OwnerDecisionCategory,
} from "@/components/decisions/owner-decision-queue"

describe("Owner Decision Queue", () => {
  it("defines the owner decision doctrine as read-only and non-authorizing", () => {
    const queue = getOwnerDecisionQueueSurface()
    const doctrine = queue.doctrine.statements.join(" ")

    expect(doctrine).toContain("Owner decisions are visible")
    expect(doctrine).toContain("Owner decisions are not self-granted")
    expect(doctrine).toContain("The Primary remains the approving authority")
    expect(doctrine).toContain("WilliamOS must not approve itself")
    expect(doctrine).toContain("Codex must not approve itself")
    expect(doctrine).toContain("A queued decision is not permission")
    expect(doctrine).toContain("The queue does not approve")
    expect(doctrine).toContain("The queue does not deny")
    expect(doctrine).toContain("The queue does not authorize")
    expect(doctrine).toContain("The queue does not execute")
    expect(doctrine).toContain("The queue does not mutate")
  })

  it("defines the expected decision categories", () => {
    expect(OWNER_DECISION_CATEGORIES.map((entry) => entry.category)).toEqual([
      "LOCAL_RUNTIME",
      "PERSISTENCE",
      "LAN_EXPOSURE",
      "DOCKER_METADATA",
      "BACKUP_METADATA",
      "PORT_CHECKS",
      "COMMAND_EXECUTION",
      "GITHUB_WRITE",
      "CODEX_AUTOMATION",
      "DB_SCHEMA",
      "PRODUCTION_DEPLOY",
      "CLOUD_CONFIG",
      "SECRET_HANDLING",
      "AUTONOMY",
      "TERRAFUSION_PACS_TOUCH",
    ])
  })

  it("defines visible decision states without state mutation semantics", () => {
    expect(OWNER_DECISION_STATES.map((entry) => entry.state)).toEqual([
      "BLOCKED",
      "READY_FOR_REVIEW",
      "NEEDS_EVIDENCE",
      "EXPLICITLY_DECLINED",
      "PARKED",
      "APPROVED_OUT_OF_BAND",
    ])
    expect(OWNER_DECISION_STATES.map((entry) => entry.description).join(" ")).toContain(
      "does not approve",
    )
  })

  it("covers the required pending decisions with default-deny posture", () => {
    const queue = getOwnerDecisionQueueSurface()
    const categories = new Set(queue.pendingDecisions.map((decision) => decision.category))
    const required: OwnerDecisionCategory[] = [
      "PERSISTENCE",
      "DOCKER_METADATA",
      "BACKUP_METADATA",
      "PORT_CHECKS",
      "LAN_EXPOSURE",
      "COMMAND_EXECUTION",
      "GITHUB_WRITE",
      "CODEX_AUTOMATION",
      "DB_SCHEMA",
      "PRODUCTION_DEPLOY",
      "CLOUD_CONFIG",
      "SECRET_HANDLING",
      "AUTONOMY",
      "TERRAFUSION_PACS_TOUCH",
    ]

    for (const category of required) {
      expect(categories.has(category)).toBe(true)
    }
    expect(queue.pendingDecisions).toHaveLength(15)
    expect(queue.pendingDecisions.every((decision) => decision.safeDefault.length > 0)).toBe(true)
    expect(queue.pendingDecisions.every((decision) => decision.nextValidAction.length > 0)).toBe(true)
  })

  it("provides complete decision detail fields", () => {
    const queue = getOwnerDecisionQueueSurface()
    const command = queue.pendingDecisions.find(
      (decision) => decision.decisionId === "decision-command-execution",
    )

    expect(command).toMatchObject({
      title: "Authorize command execution",
      category: "COMMAND_EXECUTION",
      status: "BLOCKED",
      riskLevel: "critical",
      authorityRequired: "AUTONOMY",
      safeDefault: "Show commands only; operator runs them manually.",
    })
    expect(command?.evidenceRequired).toContain("Command doctrine")
    expect(command?.relatedAuthorityRecords).toContain("authority-autonomy")
    expect(command?.relatedEvidenceRecords).toContain("evidence-safety-boundary")
    expect(command?.blockedActions).toContain("command runner")
  })

  it("links authority, evidence, and work orders to decisions", () => {
    const queue = getOwnerDecisionQueueSurface()
    const decisionIds = new Set(queue.pendingDecisions.map((decision) => decision.decisionId))

    for (const link of [
      ...queue.authorityDecisionLinks,
      ...queue.evidenceDecisionLinks,
      ...queue.workOrderDecisionLinks,
    ]) {
      expect(decisionIds.has(link.decisionId)).toBe(true)
      expect(link.relatedItem.length).toBeGreaterThan(0)
      expect(link.description.length).toBeGreaterThan(0)
    }
  })

  it("refines blocked-decision UX as protected and default-deny", () => {
    const queue = getOwnerDecisionQueueSurface()
    const text = queue.blockedDecisionUx.statements.join(" ")

    expect(queue.blockedDecisionUx.title).toBe("Blocked means protected")
    expect(text).toContain("Blocked is not failure")
    expect(text).toContain("owner decision required")
    expect(text).toContain("safe default remains no action")
    expect(text).toContain("WilliamOS cannot self-approve")
    expect(text).toContain("Codex cannot self-approve")
    expect(text).toContain("Default deny is a safety posture")
  })

  it("adds decision safety proof cards", () => {
    const queue = getOwnerDecisionQueueSurface()

    expect(queue.safetyProofCards.map((card) => card.label)).toEqual([
      "No approval controls",
      "No mutation controls",
      "No command execution",
      "No dynamic ingestion",
      "No authority escalation",
      "Default-deny posture",
      "Owner remains authority",
      "Blocked lanes remain blocked",
    ])
  })

  it("integrates read-only navigation", () => {
    const queue = getOwnerDecisionQueueSurface()
    const links = new Map(queue.navigation.map((item) => [item.label, item.href]))

    expect(links.get("Authority")).toBe("/governance")
    expect(links.get("Evidence")).toBe("/audit")
    expect(links.get("Work Orders")).toBe("/work-orders")
    expect(links.get("Runtime")).toBe("/runtime")
  })

  it("recommends Memory governance while keeping implementation lanes blocked", () => {
    const queue = getOwnerDecisionQueueSurface()

    expect(queue.nextLaneDecision).toMatchObject({
      recommendedBatch: "WILLIAMOS-MEMORY-GOVERNANCE-REGISTRY-BATCH-001",
      recommendedOption: "A - Memory governance registry",
    })
    expect(queue.nextLaneDecision.blockedLanes).toContain("Owner decision implementation")
    expect(queue.nextLaneDecision.blockedLanes).toContain("Hermes/MCP/autonomy activation")
    expect(queue.nextLaneDecision.blockedLanes).toContain("Command execution")
    expect(queue.nextLaneDecision.blockedLanes).toContain("Runtime mutation")
  })

  it("does not add approval, state mutation, command execution, ingestion, metadata, persistence, LAN, cloud, secrets, or autonomy", () => {
    const queue = getOwnerDecisionQueueSurface()
    const serialized = JSON.stringify(queue).toLowerCase()

    expect(queue.safety).toEqual({
      staticReadOnly: true,
      approvalControlsAdded: false,
      denyControlsAdded: false,
      authorizeControlsAdded: false,
      stateMutationAdded: false,
      mutationControlsAdded: false,
      commandExecutionAdded: false,
      commandRunnerAdded: false,
      githubWriteAdded: false,
      codexAutomationAdded: false,
      dynamicIngestionAdded: false,
      filesystemScanAdded: false,
      dockerMetadataAdded: false,
      backupScanAdded: false,
      portChecksAdded: false,
      dbSchemaChanged: false,
      packageChanged: false,
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
    expect(queue.safety.approvalControlsAdded).toBe(false)
    expect(queue.safety.denyControlsAdded).toBe(false)
    expect(queue.safety.authorizeControlsAdded).toBe(false)
    expect(queue.safety.commandExecutionAdded).toBe(false)
  })
})
