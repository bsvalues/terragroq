import { describe, expect, it } from "vitest"

import {
  SKILL_CATEGORIES,
  SKILL_PERMISSION_MATRIX,
  SKILL_QUARANTINE_STATES,
  SKILL_REGISTRY,
  SKILL_RISK_LEVELS,
  getAgentForgeSurface,
} from "@/components/agent-forge/agent-forge-surface"

describe("Agent Forge surface", () => {
  it("defines Agent Forge as skill governance without execution", () => {
    const forge = getAgentForgeSurface()
    const doctrine = forge.doctrine.statements.join(" ")

    expect(forge.title).toBe("Agent Forge")
    expect(forge.eyebrow).toBe("Skill governance")
    expect(forge.description).toContain("proposing, classifying, risk-rating, quarantining")
    expect(doctrine).toContain("Agent Forge proposes capabilities")
    expect(doctrine).toContain("does not execute skills")
    expect(doctrine).toContain("does not load skills at runtime")
    expect(doctrine).toContain("does not install packages or dependencies")
    expect(doctrine).toContain("does not call tools")
    expect(doctrine).toContain("Proposed skills are records")
  })

  it("adds static skill categories", () => {
    expect(SKILL_CATEGORIES).toEqual([
      "DOCUMENTATION_SKILL",
      "UI_SKILL",
      "TESTING_SKILL",
      "EVIDENCE_SKILL",
      "MEMORY_SKILL",
      "COUNCIL_SKILL",
      "HERMES_SKILL",
      "LOCAL_RUNTIME_SKILL",
      "DEPLOYMENT_SKILL",
      "DB_SCHEMA_SKILL",
      "COUNTY_OPS_SKILL",
      "HIGH_RISK_SKILL",
    ])
  })

  it("adds risk levels and keeps risk descriptive only", () => {
    expect(SKILL_RISK_LEVELS.map((risk) => risk.level)).toEqual([
      "LOW_READ_ONLY",
      "UI_ONLY",
      "DOCS_ONLY",
      "TEST_ONLY",
      "LOCAL_PROOF",
      "METADATA_ACCESS",
      "RUNTIME_CONTROL",
      "DATA_MUTATION",
      "PRODUCTION_IMPACT",
      "AUTONOMY_RISK",
      "BLOCKED",
    ])
    expect(SKILL_RISK_LEVELS.find((risk) => risk.level === "AUTONOMY_RISK")?.description).toContain("blocked")
    expect(SKILL_RISK_LEVELS.find((risk) => risk.level === "BLOCKED")?.description).toContain("no execution")
  })

  it("adds display-only quarantine states", () => {
    expect(SKILL_QUARANTINE_STATES.map((state) => state.state)).toEqual([
      "PROPOSED",
      "QUARANTINED",
      "NEEDS_REVIEW",
      "BLOCKED_BY_AUTHORITY",
      "BLOCKED_BY_RISK",
      "PARKED",
      "DENIED",
      "FUTURE_GATE",
    ])
  })

  it("adds descriptive permission matrix without runtime grants", () => {
    expect(SKILL_PERMISSION_MATRIX.map((permission) => permission.area)).toEqual([
      "READ_ONLY_UI",
      "READ_ONLY_DOCS",
      "READ_ONLY_EVIDENCE",
      "TEST_EXECUTION_BY_OPERATOR",
      "LOCAL_PROOF_BY_OPERATOR",
      "FILESYSTEM_ACCESS",
      "GITHUB_ACCESS",
      "DOCKER_ACCESS",
      "DB_ACCESS",
      "CLOUD_ACCESS",
      "COMMAND_EXECUTION",
      "TOOL_CALLS",
      "WORKER_RUNTIME",
      "AUTONOMY",
    ])
    expect(SKILL_PERMISSION_MATRIX.filter((permission) => permission.posture === "blocked").map((permission) => permission.area)).toEqual(
      expect.arrayContaining(["COMMAND_EXECUTION", "TOOL_CALLS", "WORKER_RUNTIME", "AUTONOMY"]),
    )
  })

  it("adds static skill registry records with authority and blocked actions", () => {
    expect(SKILL_REGISTRY.map((skill) => skill.skillId)).toEqual([
      "skill-docs-boundary-review",
      "skill-hermes-packet-review",
      "skill-local-runtime-proof",
    ])
    expect(SKILL_REGISTRY.every((skill) => skill.relatedAuthorityGate.length > 0)).toBe(true)
    expect(SKILL_REGISTRY.every((skill) => skill.blockedActions.length > 0)).toBe(true)
    expect(SKILL_REGISTRY.find((skill) => skill.skillId === "skill-hermes-packet-review")?.whatThisDoesNotAuthorize).toContain(
      "Hermes activation",
    )
  })

  it("adds proposal packets, review queue, and blocked UX", () => {
    const forge = getAgentForgeSurface()

    expect(forge.proposalPackets).toHaveLength(1)
    expect(forge.proposalPackets[0].whatThisDoesNotAuthorize).toContain("runtime skill loading")
    expect(forge.reviewQueue.map((item) => item.skillId)).toEqual([
      "skill-hermes-packet-review",
      "skill-local-runtime-proof",
    ])
    expect(forge.blockedUx.every((item) => item.missingAuthority.length > 0)).toBe(true)
    expect(forge.blockedUx.every((item) => item.prohibitedActions.length > 0)).toBe(true)
  })

  it("links skills to authority, decisions, evidence, trace, memory, Hermes, Council, and Academy", () => {
    const forge = getAgentForgeSurface()

    expect(forge.links.authorityOwner.map((link) => link.href)).toEqual(["/governance", "/decisions"])
    expect(forge.links.evidenceTraceMemory.map((link) => link.href)).toEqual(["/audit", "/trace", "/memory"])
    expect(forge.links.hermesCouncilAcademy.map((link) => link.href)).toEqual(["/hermes", "/brain-council", "/academy"])
  })

  it("adds safety proof cards and next lane decision", () => {
    const forge = getAgentForgeSurface()

    expect(forge.safetyProofCards.map((card) => card.label)).toEqual([
      "No skill execution",
      "No runtime skill loader",
      "No dependency installation",
      "No command execution",
      "No tool calls",
      "No worker activation",
      "No autonomy",
    ])
    expect(forge.nextLaneDecision.recommendedOption).toBe("B - Phase 2 Ubuntu Server planning")
    expect(forge.nextLaneDecision.nextRecommendedBatch).toBe(
      "WILLIAMOS-PHASE-2-UBUNTU-SERVER-PLANNING-BATCH-001",
    )
  })

  it("does not add execution, loaders, dependencies, tools, workers, persistence, secrets, or autonomy", () => {
    expect(getAgentForgeSurface().safety).toEqual({
      readOnly: true,
      skillExecutionAdded: false,
      runtimeSkillLoaderAdded: false,
      dependencyInstallAdded: false,
      toolCallsAdded: false,
      commandExecutionAdded: false,
      commandRunnerAdded: false,
      hermesActivationAdded: false,
      mcpActivationAdded: false,
      workerActivationAdded: false,
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
