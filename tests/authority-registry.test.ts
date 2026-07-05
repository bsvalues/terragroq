import { describe, expect, it } from "vitest"

import {
  AUTHORITY_CATEGORIES,
  getAuthorityRegistrySurface,
  type AuthorityCategory,
} from "@/components/governance/authority-registry"

describe("Authority Registry", () => {
  it("defines authority doctrine without self-authorization", () => {
    const registry = getAuthorityRegistrySurface()
    const doctrine = registry.doctrine.statements.join(" ")

    expect(doctrine).toContain("Authority is explicit")
    expect(doctrine).toContain("Mutation requires authority")
    expect(doctrine).toContain("Evidence proves completion")
    expect(doctrine).toContain("The Primary remains the approving authority")
    expect(doctrine).toContain("WilliamOS must not grant itself authority")
    expect(doctrine).toContain("Codex does not self-authorize")
    expect(doctrine).toContain("Anything outside scope stops")
  })

  it("defines the expected authority categories and levels", () => {
    const categories = AUTHORITY_CATEGORIES.map((entry) => entry.category)

    expect(categories).toEqual([
      "READ_ONLY",
      "DOCS_ONLY",
      "UI_COPY_TESTS",
      "LOCAL_MANUAL_PROOF",
      "LOCAL_RUNTIME_READ",
      "LOCAL_RUNTIME_MUTATION",
      "CONTAINER_CONTROL",
      "DB_SCHEMA",
      "PRODUCTION_VERIFY",
      "PRODUCTION_DEPLOY",
      "CLOUD_CONFIG",
      "GITHUB_WRITE",
      "AUTONOMY",
      "LAN_EXPOSURE",
      "SECRET_HANDLING",
    ])
    expect(AUTHORITY_CATEGORIES.map((entry) => entry.level)).toContain("allowed-by-current-lane")
    expect(AUTHORITY_CATEGORIES.map((entry) => entry.level)).toContain("blocked-by-default")
    expect(AUTHORITY_CATEGORIES.map((entry) => entry.level)).toContain("owner-decision-required")
    expect(AUTHORITY_CATEGORIES.map((entry) => entry.level)).toContain("future-explicit-gate-only")
  })

  it("creates static authority records with required evidence and owner decision posture", () => {
    const registry = getAuthorityRegistrySurface()
    const runtime = registry.records.find(
      (record) => record.authorityId === "authority-local-runtime-mutation",
    )

    expect(runtime).toMatchObject({
      title: "Local Runtime Mutation Authority",
      category: "LOCAL_RUNTIME_MUTATION",
      level: "owner-decision-required",
      ownerDecisionRequired: true,
      status: "blocked",
      riskLevel: "high",
    })
    expect(runtime?.allowedActions).toEqual(["None in this batch"])
    expect(runtime?.blockedActions).toContain("Container control")
    expect(runtime?.requiredEvidence).toContain("Owner approval packet")
  })

  it("covers all required blocked actions", () => {
    const registry = getAuthorityRegistrySurface()
    const actions = registry.blockedActions.map((entry) => entry.action)

    expect(actions).toEqual([
      "command execution",
      "command runner",
      "GitHub write integration",
      "Codex automation",
      "Docker metadata",
      "backup scanning",
      "port checks",
      "filesystem scan",
      "dynamic ingestion",
      "DB/schema mutation",
      "production deploy",
      "cloud setting changes",
      "LAN exposure",
      "service/schedule creation",
      "secrets disclosure",
      "Hermes/MCP/autonomy activation",
      "TerraFusion/PACS touch",
      "unrelated container touch",
    ])
    expect(registry.blockedActions.every((entry) => entry.safeDefault === "blocked until owner-approved gate")).toBe(true)
  })

  it("lists owner decisions as not granted with default-deny posture", () => {
    const registry = getAuthorityRegistrySurface()
    const decisions = registry.ownerDecisions.map((entry) => entry.decision)

    expect(decisions).toEqual([
      "authorize limited persistence",
      "authorize Docker metadata",
      "authorize backup metadata",
      "authorize port checks",
      "authorize LAN exposure",
      "authorize service/startup",
      "authorize GitHub write",
      "authorize production deploy",
      "authorize DB/schema migration",
      "authorize autonomy/Hermes/MCP",
      "authorize secrets handling",
      "authorize TerraFusion/PACS touch",
    ])
    expect(registry.ownerDecisions.every((entry) => entry.status === "not-granted")).toBe(true)
    expect(registry.ownerDecisions.every((entry) => entry.safeDefault === "deny by default")).toBe(true)
  })

  it("links Work Orders, Evidence, and blocked decisions to authority records", () => {
    const registry = getAuthorityRegistrySurface()
    const authorityIds = new Set(registry.records.map((record) => record.authorityId))

    for (const link of [
      ...registry.workOrderAuthorityLinks,
      ...registry.evidenceAuthorityLinks,
      ...registry.blockedDecisionAuthorityLinks,
    ]) {
      expect(authorityIds.has(link.authorityId)).toBe(true)
      expect(link.description.length).toBeGreaterThan(0)
    }
  })

  it("adds safety proof cards for the required boundaries", () => {
    const registry = getAuthorityRegistrySurface()
    const labels = registry.safetyProofCards.map((card) => card.label)

    expect(labels).toEqual([
      "No command execution",
      "No Docker metadata",
      "No backup scan",
      "No port checks",
      "No persistence",
      "No LAN exposure",
      "No GitHub write",
      "No autonomy",
      "No TerraFusion/PACS touch",
    ])
  })

  it("integrates read-only navigation without action controls", () => {
    const registry = getAuthorityRegistrySurface()
    const links = new Map(registry.navigation.map((item) => [item.label, item.href]))

    expect(links.get("Work Orders")).toBe("/work-orders")
    expect(links.get("Evidence")).toBe("/audit")
    expect(links.get("Decisions")).toBe("/decisions")
    expect(links.get("Runtime")).toBe("/runtime")
  })

  it("recommends an owner decision queue and keeps risky lanes blocked", () => {
    const registry = getAuthorityRegistrySurface()

    expect(registry.nextLaneDecision).toMatchObject({
      recommendedBatch: "WILLIAMOS-OWNER-DECISION-QUEUE-BATCH-001",
      recommendedOption: "D - Owner decision queue surface",
    })
    expect(registry.nextLaneDecision.blockedLanes).toContain("Hermes/MCP/autonomy activation")
    expect(registry.nextLaneDecision.blockedLanes).toContain("Command execution")
  })

  it("does not add enforcement, execution, ingestion, metadata, persistence, LAN, cloud, secrets, or autonomy", () => {
    const registry = getAuthorityRegistrySurface()
    const serialized = JSON.stringify(registry).toLowerCase()

    expect(registry.safety).toEqual({
      staticReadOnly: true,
      commandExecutionAdded: false,
      commandRunnerAdded: false,
      githubWriteAdded: false,
      codexAutomationAdded: false,
      dynamicAuthorityIngestionAdded: false,
      dynamicEvidenceIngestionAdded: false,
      filesystemScanAdded: false,
      dockerMetadataAdded: false,
      backupScanAdded: false,
      portChecksAdded: false,
      runtimeEnforcementEngineAdded: false,
      permissionModelChanged: false,
      authPolicyChanged: false,
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
    expect(serialized).not.toContain("docker inspect")
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
