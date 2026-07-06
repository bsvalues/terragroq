import { describe, expect, it } from "vitest"

import {
  AUTHORITY_CATEGORIES,
  AUTHORITY_GATES,
  getAuthorityRegistrySurface,
  type AuthorityCategory,
} from "@/components/governance/authority-registry"

describe("Authority Registry", () => {
  it("refreshes authority doctrine across Evidence, Owner Decisions, Memory, Council, and Local OMEN", () => {
    const registry = getAuthorityRegistrySurface()
    const doctrine = registry.doctrine.statements.join(" ")

    expect(doctrine).toContain("Authority belongs to the Primary")
    expect(doctrine).toContain("Evidence informs authority but does not grant it")
    expect(doctrine).toContain("Owner decisions record needed gates but do not mutate state")
    expect(doctrine).toContain("Memory preserves context but does not authorize action")
    expect(doctrine).toContain("Brain Council recommends but does not authorize execution")
    expect(doctrine).toContain("Local OMEN remains read-only, manual-only, and localhost-only")
    expect(doctrine).toContain("Hermes, MCP, workers, and autonomy remain blocked")
    expect(doctrine).toContain("WilliamOS must not grant itself authority")
  })

  it("defines refreshed authority categories and levels", () => {
    const categories = AUTHORITY_CATEGORIES.map((entry) => entry.category)

    expect(categories).toEqual([
      "READ_ONLY",
      "DOCS_ONLY",
      "UI_COPY_TESTS",
      "LOCAL_MANUAL_PROOF",
      "LOCAL_RUNTIME_READ",
      "LOCAL_RUNTIME_MUTATION",
      "CONTAINER_CONTROL",
      "MEMORY_GOVERNANCE",
      "COUNCIL_ADVISORY",
      "DB_SCHEMA",
      "PRODUCTION_VERIFY",
      "PRODUCTION_DEPLOY",
      "CLOUD_CONFIG",
      "GITHUB_WRITE",
      "AUTONOMY",
      "LAN_EXPOSURE",
      "SECRET_HANDLING",
      "TERRAFUSION_PACS",
    ])
    expect(AUTHORITY_CATEGORIES.map((entry) => entry.level)).toContain("allowed-by-current-lane")
    expect(AUTHORITY_CATEGORIES.map((entry) => entry.level)).toContain("blocked-by-default")
    expect(AUTHORITY_CATEGORIES.map((entry) => entry.level)).toContain("owner-decision-required")
    expect(AUTHORITY_CATEGORIES.map((entry) => entry.level)).toContain("future-explicit-gate-only")
  })

  it("refreshes authority gates for runtime, memory, Council, Hermes/MCP, production, DB, secrets, and TerraFusion", () => {
    const gateIds = AUTHORITY_GATES.map((gate) => gate.gateId)

    expect(gateIds).toEqual([
      "LOCAL_RUNTIME_METADATA_GATE",
      "LOCAL_RUNTIME_CONTROL_GATE",
      "MEMORY_WRITE_GATE",
      "MEMORY_PROMOTION_GATE",
      "COUNCIL_RUNTIME_GATE",
      "HERMES_ACTIVATION_GATE",
      "MCP_ACTIVATION_GATE",
      "WORKER_ACTIVATION_GATE",
      "DB_SCHEMA_CHANGE_GATE",
      "PRODUCTION_DEPLOY_GATE",
      "CLOUD_SETTING_CHANGE_GATE",
      "SECRET_ACCESS_GATE",
      "TERRAFUSION_TOUCH_GATE",
      "DOCKER_METADATA_GATE",
      "BACKUP_METADATA_GATE",
      "PORT_STATUS_GATE",
      "FILESYSTEM_METADATA_GATE",
      "GITHUB_METADATA_GATE",
      "START_STOP_GATE",
      "SERVICE_REGISTRATION_GATE",
      "SCHEDULER_GATE",
      "LAN_EXPOSURE_GATE",
      "COMMAND_RUNNER_GATE",
      "DATA_MUTATION_GATE",
      "BACKUP_RESTORE_GATE",
      "TOOL_CALL_GATE",
      "AUTONOMOUS_LOOP_GATE",
    ])
    expect(AUTHORITY_GATES.every((gate) => gate.requiredOwnerDecision.length > 0)).toBe(true)
    expect(AUTHORITY_GATES.every((gate) => gate.safeNextAction.length > 0)).toBe(true)
  })

  it("creates static authority records for memory, Council, metadata, runtime, production, DB, autonomy, and secrets", () => {
    const registry = getAuthorityRegistrySurface()
    const ids = registry.records.map((record) => record.authorityId)

    expect(ids).toEqual([
      "authority-read-only-registry",
      "authority-local-runtime-mutation",
      "authority-metadata-expansion",
      "authority-memory-governance",
      "authority-council-runtime",
      "authority-production-change",
      "authority-db-schema",
      "authority-autonomy",
      "authority-secret-handling",
      "authority-terrafusion-pacs",
    ])

    expect(registry.records.find((record) => record.authorityId === "authority-memory-governance")).toMatchObject({
      category: "MEMORY_GOVERNANCE",
      ownerDecisionRequired: true,
      status: "blocked",
    })
    expect(registry.records.find((record) => record.authorityId === "authority-council-runtime")).toMatchObject({
      category: "COUNCIL_ADVISORY",
      level: "owner-decision-required",
      riskLevel: "critical",
    })
  })

  it("covers all required blocked actions and maps them to gates", () => {
    const registry = getAuthorityRegistrySurface()
    const actions = registry.blockedActions.map((entry) => entry.action)
    const gates = new Set(AUTHORITY_GATES.map((gate) => gate.gateId))

    expect(actions).toEqual([
      "command execution",
      "command runner",
      "GitHub write",
      "Codex automation",
      "Docker metadata",
      "backup scan",
      "port checks",
      "runtime control",
      "service/scheduler",
      "LAN exposure",
      "memory write",
      "canon promotion",
      "Council runtime",
      "Hermes/MCP activation",
      "worker activation",
      "DB/schema migration",
      "cloud setting change",
      "production deploy",
      "TerraFusion/PACS mutation",
    ])
    expect(registry.blockedActions.every((entry) => entry.safeDefault === "blocked until owner-approved gate")).toBe(true)
    expect(registry.blockedActions.every((entry) => gates.has(entry.gateId))).toBe(true)
  })

  it("links owner decisions to gates with default-deny posture", () => {
    const registry = getAuthorityRegistrySurface()
    const decisions = registry.ownerDecisions.map((entry) => entry.decision)

    expect(decisions).toContain("authorize memory write/canon")
    expect(decisions).toContain("authorize Council runtime")
    expect(decisions).toContain("authorize autonomy/Hermes/MCP")
    expect(registry.ownerDecisions.every((entry) => entry.status === "not-granted")).toBe(true)
    expect(registry.ownerDecisions.every((entry) => entry.safeDefault === "deny by default")).toBe(true)
  })

  it("links Work Orders, Evidence, Owner Decisions, Memory, Council, and local runtime to authority gates", () => {
    const registry = getAuthorityRegistrySurface()
    const authorityIds = new Set(registry.records.map((record) => record.authorityId))
    const gateIds = new Set(registry.gates.map((gate) => gate.gateId))

    for (const link of [
      ...registry.workOrderAuthorityLinks,
      ...registry.evidenceAuthorityLinks,
      ...registry.ownerDecisionAuthorityLinks,
      ...registry.memoryAuthorityLinks,
      ...registry.councilAuthorityLinks,
      ...registry.localRuntimeAuthorityLinks,
    ]) {
      expect(authorityIds.has(link.authorityId)).toBe(true)
      expect(gateIds.has(link.gateId)).toBe(true)
      expect(link.description.length).toBeGreaterThan(0)
    }
  })

  it("groups metadata, runtime control, production, DB/schema, and autonomy gates", () => {
    const registry = getAuthorityRegistrySurface()

    expect(registry.metadataExpansionGates.map((gate) => gate.gateId)).toEqual([
      "LOCAL_RUNTIME_METADATA_GATE",
      "DOCKER_METADATA_GATE",
      "BACKUP_METADATA_GATE",
      "PORT_STATUS_GATE",
      "FILESYSTEM_METADATA_GATE",
      "GITHUB_METADATA_GATE",
    ])
    expect(registry.runtimeControlGates.map((gate) => gate.gateId)).toContain("COMMAND_RUNNER_GATE")
    expect(registry.productionDeployGates.map((gate) => gate.gateId)).toEqual([
      "PRODUCTION_DEPLOY_GATE",
      "CLOUD_SETTING_CHANGE_GATE",
      "SECRET_ACCESS_GATE",
    ])
    expect(registry.dbSchemaGates.map((gate) => gate.gateId)).toContain("TERRAFUSION_TOUCH_GATE")
    expect(registry.autonomyWorkerGates.map((gate) => gate.gateId)).toContain("TOOL_CALL_GATE")
  })

  it("adds safety proof cards for authority boundaries", () => {
    const registry = getAuthorityRegistrySurface()
    const labels = registry.safetyProofCards.map((card) => card.label)

    expect(labels).toEqual([
      "No approval controls",
      "No state mutation",
      "No command execution",
      "No runtime control",
      "No metadata expansion",
      "No memory write",
      "No Council runtime",
      "No production deploy",
      "No DB/schema mutation",
      "No autonomy",
      "No TerraFusion/PACS touch",
    ])
  })

  it("integrates read-only navigation across authority-linked surfaces", () => {
    const registry = getAuthorityRegistrySurface()
    const links = new Map(registry.navigation.map((item) => [item.label, item.href]))

    expect(links.get("Work Orders")).toBe("/work-orders")
    expect(links.get("Evidence")).toBe("/audit")
    expect(links.get("Decisions")).toBe("/decisions")
    expect(links.get("Memory")).toBe("/memory")
    expect(links.get("Brain Council")).toBe("/brain-council")
    expect(links.get("Runtime")).toBe("/runtime")
  })

  it("recommends Memory Placement for the Primary shell and keeps runtime lanes blocked", () => {
    const registry = getAuthorityRegistrySurface()

    expect(registry.nextLaneDecision).toMatchObject({
      recommendedBatch: "WO-SHELL-009 - Memory Placement",
      recommendedOption: "A - Primary shell memory placement",
    })
    expect(registry.nextLaneDecision.blockedLanes).toContain("runtime tracing")
    expect(registry.nextLaneDecision.blockedLanes).toContain("background collection")
    expect(registry.nextLaneDecision.blockedLanes).toContain("metadata expansion")
    expect(registry.nextLaneDecision.blockedLanes).toContain("memory write")
    expect(registry.nextLaneDecision.blockedLanes).toContain("dynamic memory retrieval")
    expect(registry.nextLaneDecision.reason).toContain("static governance-aware context surface")
  })

  it("does not add approval, mutation, execution, runtime control, metadata, memory write, autonomy, production, DB/schema, secrets, or TerraFusion touch", () => {
    const registry = getAuthorityRegistrySurface()
    const serialized = JSON.stringify(registry).toLowerCase()

    expect(registry.safety).toEqual({
      staticReadOnly: true,
      approvalControlsAdded: false,
      authorityStateMutationAdded: false,
      permissionModelChanged: false,
      accessGrantsImplemented: false,
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
      dynamicRetrievalAdded: false,
      vectorStoreAdded: false,
      embeddingsAdded: false,
      dynamicAuthorityIngestionAdded: false,
      dynamicEvidenceIngestionAdded: false,
      filesystemScanAdded: false,
      dockerMetadataAdded: false,
      backupScanAdded: false,
      portChecksAdded: false,
      runtimeControlAdded: false,
      runtimeEnforcementEngineAdded: false,
      authPolicyChanged: false,
      dbSchemaChanged: false,
      dataMutationAdded: false,
      backupRestoreAdded: false,
      packageChanged: false,
      persistenceImplemented: false,
      serviceRegistered: false,
      scheduleCreated: false,
      lanExposureEnabled: false,
      cloudChanged: false,
      productionDeployAdded: false,
      secretsDisclosed: false,
      hermesMcpAutonomyChanged: false,
      autonomyAdded: false,
      terraFusionPacsTouched: false,
      unrelatedContainersTouched: false,
    })
    expect(serialized).not.toContain("database_url")
    expect(serialized).not.toContain("better_auth_secret")
    expect(serialized).not.toContain("approval button")
    expect(serialized).not.toContain("execute button")
  })

  it("keeps blocked actions mapped to known authority categories", () => {
    const registry = getAuthorityRegistrySurface()
    const categories = new Set(AUTHORITY_CATEGORIES.map((entry) => entry.category))

    for (const action of registry.blockedActions) {
      expect(categories.has(action.requiredAuthority as AuthorityCategory)).toBe(true)
    }
  })
})
