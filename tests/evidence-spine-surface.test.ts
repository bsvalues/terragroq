import { describe, expect, it } from "vitest"

import {
  EVIDENCE_CATEGORIES,
  getEvidenceSpineSurface,
  type EvidenceCategoryId,
} from "@/components/evidence/evidence-spine-surface"

describe("Evidence Spine surface", () => {
  it("defines the evidence doctrine without execution or owner-authority drift", () => {
    const surface = getEvidenceSpineSurface()
    const doctrine = surface.doctrine.statements.join(" ")

    expect(doctrine).toContain("Evidence proves reality")
    expect(doctrine).toContain("read-only")
    expect(doctrine).toContain("does not execute work")
    expect(doctrine).toContain("does not authorize mutation")
    expect(doctrine).toContain("does not replace owner authority")
  })

  it("defines the required evidence categories", () => {
    const categoryIds = EVIDENCE_CATEGORIES.map((category) => category.id)

    expect(categoryIds).toEqual([
      "VALIDATION_PROOF",
      "LOCAL_PROOF",
      "PRODUCTION_PROOF",
      "SAFETY_PROOF",
      "PR_PROOF",
      "BLOCKED_DECISION_PROOF",
      "ROLLUP_PROOF",
      "NEXT_LANE_DECISION",
    ])
  })

  it("provides static evidence records with the required read-model fields", () => {
    const surface = getEvidenceSpineSurface()
    const record = surface.records.find(
      (candidate) => candidate.evidenceId === "evidence-woe-detail-surfaces",
    )

    expect(record).toMatchObject({
      evidenceId: "evidence-woe-detail-surfaces",
      title: expect.any(String),
      type: "PR_PROOF",
      scope: expect.any(String),
      relatedGoal: expect.any(String),
      relatedBatch: "WILLIAMOS-WOE-DETAIL-SURFACES-BATCH-001",
      relatedWorkOrder: "WO-WOE-022 through WO-WOE-032",
      relatedPr: "#281",
      originMain: "658426f8424225c58ad1ac9beaac26bed6ffa08c",
      validationSummary: expect.stringContaining("468 full-suite tests"),
      proofSummary: expect.any(String),
      safetySummary: expect.any(String),
      sourcePath: "docs/reports/WO-WOE-031-woe-detail-evidence-rollup.md",
      status: "confirmed",
      createdAtLabel: expect.any(String),
      proves: expect.stringContaining("inspect WOE detail"),
      doesNotProve: expect.stringContaining("execution engine"),
      nextRelatedItem: "WILLIAMOS-EVIDENCE-SPINE-BATCH-001",
    })
  })

  it("groups evidence across validation, local, production, safety, blocked decision, rollup, and next-lane proof", () => {
    const surface = getEvidenceSpineSurface()
    const recordTypes = new Set(surface.records.map((record) => record.type))
    const expectedTypes: EvidenceCategoryId[] = [
      "VALIDATION_PROOF",
      "LOCAL_PROOF",
      "PRODUCTION_PROOF",
      "SAFETY_PROOF",
      "PR_PROOF",
      "BLOCKED_DECISION_PROOF",
      "ROLLUP_PROOF",
      "NEXT_LANE_DECISION",
    ]

    for (const type of expectedTypes) {
      expect(recordTypes.has(type)).toBe(true)
    }
  })

  it("shows validation proof cards without live CI integration", () => {
    const surface = getEvidenceSpineSurface()
    const labels = surface.validationProofCards.map((card) => card.label)

    expect(labels).toEqual([
      "git diff --check",
      "Focused tests",
      "Full suite",
      "npm run build",
      "Vercel",
      "CodeRabbit",
    ])
    expect(JSON.stringify(surface.validationProofCards).toLowerCase()).not.toContain("github api")
  })

  it("shows local OMEN proof cards without Docker metadata, backup scan, or port checks", () => {
    const surface = getEvidenceSpineSurface()
    const text = surface.localProofCards
      .flatMap((card) => [card.label, card.value, card.description])
      .join(" ")

    expect(text).toContain("HP OMEN")
    expect(text).toContain("/api/local/runtime/status")
    expect(text).toContain("Postgres proof")
    expect(text).toContain("Ports 3100/3101")
    expect(text).toContain("read-only")
    expect(surface.safety.dockerMetadataAdded).toBe(false)
    expect(surface.safety.backupScanAdded).toBe(false)
    expect(surface.safety.portChecksAdded).toBe(false)
  })

  it("shows production proof cards without production mutation or live polling", () => {
    const surface = getEvidenceSpineSurface()
    const text = surface.productionProofCards
      .flatMap((card) => [card.label, card.value, card.description])
      .join(" ")

    expect(text).toContain("/api/health")
    expect(text).toContain("/api/auth/readiness")
    expect(text).toContain("Vercel")
    expect(text).toContain("x-powered-by absent")
    expect(text).toContain("No deploy")
    expect(text.toLowerCase()).not.toContain("live polling enabled")
  })

  it("shows safety proof cards for the required blocked capabilities", () => {
    const surface = getEvidenceSpineSurface()
    const text = surface.safetyProofCards
      .flatMap((card) => [card.label, card.value, card.description])
      .join(" ")

    expect(text).toContain("No command execution")
    expect(text).toContain("No command runner")
    expect(text).toContain("No Docker metadata")
    expect(text).toContain("No backup scan")
    expect(text).toContain("No port checks")
    expect(text).toContain("No persistence")
    expect(text).toContain("No LAN exposure")
    expect(text).toContain("No secrets")
    expect(text).toContain("No TerraFusion/PACS touch")
    expect(text).toContain("No autonomy")
  })

  it("links blocked decisions to supporting evidence without approval controls", () => {
    const surface = getEvidenceSpineSurface()
    const blockers = surface.blockedDecisionEvidenceLinks.map((link) => link.blocker)

    expect(blockers).toEqual([
      "Local metadata not authorized",
      "Docker metadata not authorized",
      "Port checks not authorized",
      "Backup metadata not authorized",
      "Runtime control not authorized",
      "Autonomy not authorized",
    ])
    expect(surface.blockedDecisionEvidenceLinks.every((link) => link.evidenceId.length > 0)).toBe(true)
  })

  it("integrates WOE evidence navigation without dynamic graph or background indexer behavior", () => {
    const surface = getEvidenceSpineSurface()
    const hrefs = surface.woeNavigation.map((item) => item.href)
    const serialized = JSON.stringify(surface).toLowerCase()

    expect(hrefs).toEqual(["/work-orders", "/governance", "/runtime"])
    expect(serialized).not.toContain("dynamic graph")
    expect(serialized).not.toContain("background indexer")
  })

  it("recommends Authority / Governance Registry as the next lane without authorizing it", () => {
    const surface = getEvidenceSpineSurface()

    expect(surface.nextLaneDecision).toMatchObject({
      recommendedBatch: "WILLIAMOS-AUTHORITY-GOVERNANCE-REGISTRY-BATCH-001",
      recommendedOption: "B - Authority / Governance Registry",
    })
    expect(surface.safety.autonomyAuthorized).toBe(false)
    expect(surface.safety.runtimeControlAuthorized).toBe(false)
    expect(surface.safety.metadataExpansionAuthorized).toBe(false)
  })

  it("does not add ingestion, mutation, execution, metadata, persistence, scheduler, LAN, or secrets", () => {
    const surface = getEvidenceSpineSurface()
    const serialized = JSON.stringify(surface).toLowerCase()

    expect(surface.safety).toEqual({
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
    })
    expect(serialized).not.toContain("database_url")
    expect(serialized).not.toContain("better_auth_secret")
    expect(serialized).not.toContain("docker inspect")
    expect(serialized).not.toContain("github api enabled")
    expect(serialized).not.toContain("run command")
    expect(serialized).not.toContain("start container")
  })
})
