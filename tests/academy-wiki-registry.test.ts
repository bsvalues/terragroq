import { describe, expect, it } from "vitest"

import {
  ACADEMY_LESSONS,
  WIKI_PAGES,
  WILLIAMOS_GLOSSARY,
  getAcademyWikiSurface,
} from "@/components/academy/academy-wiki-registry"
import { TRACE_RECORDS } from "@/components/trace/trace-ledger-registry"

describe("Academy Wiki Registry", () => {
  it("defines Academy as a read-only learning layer", () => {
    const surface = getAcademyWikiSurface()
    const doctrine = surface.academyDoctrine.statements.join(" ")

    expect(doctrine).toContain("Academy teaches WilliamOS operation")
    expect(doctrine).toContain("Academy is static and read-only")
    expect(doctrine).toContain("Owner the courier")
    expect(doctrine).toContain("does not execute commands")
    expect(doctrine).toContain("does not track progress in persistence")
  })

  it("defines Wiki as a read-only reference layer", () => {
    const surface = getAcademyWikiSurface()
    const doctrine = surface.wikiDoctrine.statements.join(" ")

    expect(doctrine).toContain("Wiki records what WilliamOS concepts mean")
    expect(doctrine).toContain("Wiki links concepts to evidence")
    expect(doctrine).toContain("does not ingest dynamically")
    expect(doctrine).toContain("or authorize action")
  })

  it("creates static lessons for onboarding, goal loop, WOs, evidence authority decisions, memory council trace, and Local OMEN", () => {
    expect(ACADEMY_LESSONS.map((lesson) => lesson.lessonId)).toEqual([
      "lesson-operator-onboarding",
      "lesson-goal-loop",
      "lesson-work-order-governance",
      "lesson-evidence-authority-decision",
      "lesson-memory-council-trace",
      "lesson-local-omen-runtime",
    ])

    expect(ACADEMY_LESSONS.every((lesson) => lesson.relatedWorkOrders.length > 0)).toBe(true)
    expect(ACADEMY_LESSONS.every((lesson) => lesson.whatThisDoesNotEnable.length > 0)).toBe(true)
  })

  it("creates wiki pages for core concepts and major surfaces", () => {
    expect(WIKI_PAGES.map((page) => page.pageId)).toEqual([
      "wiki-primary",
      "wiki-goal-loop",
      "wiki-authority",
      "wiki-memory",
      "wiki-brain-council",
      "wiki-hermes",
      "wiki-agent-forge",
      "wiki-trace-ledger",
      "wiki-county-ops",
      "wiki-local-omen",
    ])
    expect(WIKI_PAGES.every((page) => page.whatItIs.length > 0)).toBe(true)
    expect(WIKI_PAGES.every((page) => page.whatItIsNot.length > 0)).toBe(true)
  })

  it("links wiki concepts only to existing trace records", () => {
    const traceIds = new Set(TRACE_RECORDS.map((record) => record.traceId))
    const linkedTraceIds = WIKI_PAGES.flatMap((page) => page.relatedTrace)

    expect(linkedTraceIds.length).toBeGreaterThan(0)
    expect(linkedTraceIds.every((traceId) => traceIds.has(traceId))).toBe(true)
  })

  it("teaches the mandatory operator lessons", () => {
    const onboarding = ACADEMY_LESSONS.find((lesson) => lesson.lessonId === "lesson-operator-onboarding")
    const goalLoop = ACADEMY_LESSONS.find((lesson) => lesson.lessonId === "lesson-goal-loop")
    const local = ACADEMY_LESSONS.find((lesson) => lesson.lessonId === "lesson-local-omen-runtime")

    expect(onboarding?.whatThisTeaches.join(" ")).toContain("Codex operates authorized loops")
    expect(goalLoop?.whatThisTeaches.join(" ")).toContain("Codex continues through listed WOs")
    expect(local?.whatThisTeaches.join(" ")).toContain("Local runtime status is read-only")
    expect(local?.whatThisDoesNotEnable).toContain("Docker metadata")
    expect(local?.whatThisDoesNotEnable).toContain("runtime control")
  })

  it("defines the WilliamOS glossary terms", () => {
    expect(WILLIAMOS_GLOSSARY.map((term) => term.term)).toEqual([
      "Primary",
      "Owner",
      "Operator",
      "Codex Operator",
      "Courier",
      "/goal",
      "/loop",
      "Work Order",
      "Evidence",
      "Authority",
      "Owner Decision",
      "Memory",
      "Brain Council",
      "Trace Ledger",
      "Failure-to-Eval",
      "Eval",
      "Hermes",
      "MCP",
      "Agent Forge",
      "Skill",
      "Quarantine",
      "Local OMEN",
      "Read-only subsystem",
      "County Ops",
      "Production Write",
      "Autonomy",
      "Stop condition",
      "Safety posture",
    ])
  })

  it("places Agent Forge, Hermes, Trace/Eval, and County Ops as static concepts only", () => {
    const pages = new Map(WIKI_PAGES.map((page) => [page.pageId, page]))

    expect(pages.get("wiki-agent-forge")?.whatItIsNot).toContain("executable skill loader")
    expect(pages.get("wiki-hermes")?.whatItIsNot).toContain("active worker")
    expect(pages.get("wiki-trace-ledger")?.whatItIsNot).toContain("eval execution")
    expect(pages.get("wiki-county-ops")?.whatItIs).toContain("PACS rules")
    expect(pages.get("wiki-county-ops")?.whatItIsNot).toContain("PACS connection")
    expect(pages.get("wiki-county-ops")?.relatedAuthority).toContain("TERRAFUSION_TOUCH_GATE")
  })

  it("links Academy and Wiki to existing read-only surfaces", () => {
    const surface = getAcademyWikiSurface()
    const links = new Map(surface.navigation.map((item) => [item.label, item.href]))

    expect(links.get("Work Orders")).toBe("/work-orders")
    expect(links.get("Evidence")).toBe("/audit")
    expect(links.get("Authority")).toBe("/governance")
    expect(links.get("Memory")).toBe("/memory")
    expect(links.get("Brain Council")).toBe("/brain-council")
    expect(links.get("Trace Ledger")).toBe("/trace")
    expect(links.get("Local Status")).toBe("/runtime")
  })

  it("adds safety proof cards for Academy and Wiki boundaries", () => {
    const surface = getAcademyWikiSurface()

    expect(surface.safetyProofCards.map((card) => card.label)).toEqual([
      "No runtime training engine",
      "No progress persistence",
      "No command execution",
      "No automation",
      "No dynamic ingestion",
      "No authority mutation",
      "No local/runtime expansion",
    ])
  })

  it("recommends Work Order Engine integration after Hermes boundary doctrine while keeping runtime lanes blocked", () => {
    const surface = getAcademyWikiSurface()

    expect(surface.nextLaneDecision).toMatchObject({
      recommendedBatch: "WILLIAMOS-WORK-ORDER-ENGINE-INTEGRATION-BATCH-001",
      recommendedOption: "A - Work Order Engine Integration",
    })
    expect(surface.nextLaneDecision.blockedLanes).toContain("Hermes activation")
    expect(surface.nextLaneDecision.blockedLanes).toContain("worker activation")
    expect(surface.nextLaneDecision.blockedLanes).toContain("runtime training system")
  })

  it("does not add runtime training, progress persistence, command execution, dynamic ingestion, runtime control, secrets, or autonomy", () => {
    const surface = getAcademyWikiSurface()
    const serialized = JSON.stringify(surface).toLowerCase()

    expect(surface.safety).toEqual({
      staticReadOnly: true,
      runtimeTrainingAdded: false,
      progressPersistenceAdded: false,
      quizStateMutationAdded: false,
      certificationEngineAdded: false,
      databaseAdded: false,
      dbSchemaChanged: false,
      filesystemScanAdded: false,
      dynamicIngestionAdded: false,
      githubApiIntegrationAdded: false,
      commandExecutionAdded: false,
      commandRunnerAdded: false,
      codexAutomationAdded: false,
      councilRuntimeAdded: false,
      hermesActivationAdded: false,
      mcpActivationAdded: false,
      workerActivationAdded: false,
      memoryWriteAdded: false,
      runtimeMemoryReadAdded: false,
      vectorStoreAdded: false,
      embeddingsAdded: false,
      evalExecutionAdded: false,
      testGenerationAutomationAdded: false,
      dockerMetadataAdded: false,
      backupScanAdded: false,
      portChecksAdded: false,
      runtimeControlAdded: false,
      persistenceImplemented: false,
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
    expect(serialized).not.toContain("quiz submit")
  })
})
