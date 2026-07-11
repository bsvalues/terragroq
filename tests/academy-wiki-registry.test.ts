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

  it("creates static lessons for onboarding, goal loop, WOs, WOE integration, evidence authority decisions, memory council trace, Trace/Eval, Brain Council advisory, and Local OMEN", () => {
    expect(ACADEMY_LESSONS.map((lesson) => lesson.lessonId)).toEqual([
      "lesson-operator-onboarding",
      "lesson-goal-loop",
      "lesson-work-order-governance",
      "lesson-work-order-engine-integration",
      "lesson-evidence-authority-decision",
      "lesson-memory-council-trace",
      "lesson-trace-ledger-failure-eval",
      "lesson-brain-council-advisory-layer",
      "lesson-local-omen-runtime",
      "lesson-county-ops-knowledge-pack",
      "lesson-codex-operator-goal-loop",
    ])

    expect(ACADEMY_LESSONS.every((lesson) => lesson.relatedWorkOrders.length > 0)).toBe(true)
    expect(ACADEMY_LESSONS.every((lesson) => lesson.whatThisDoesNotEnable.length > 0)).toBe(true)
  })

  it("creates wiki pages for core concepts and major surfaces", () => {
    expect(WIKI_PAGES.map((page) => page.pageId)).toEqual([
      "wiki-codex-operator",
      "wiki-primary",
      "wiki-goal-loop",
      "wiki-work-order-engine",
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
    const woe = ACADEMY_LESSONS.find((lesson) => lesson.lessonId === "lesson-work-order-engine-integration")
    const trace = ACADEMY_LESSONS.find((lesson) => lesson.lessonId === "lesson-trace-ledger-failure-eval")
    const council = ACADEMY_LESSONS.find((lesson) => lesson.lessonId === "lesson-brain-council-advisory-layer")
    const local = ACADEMY_LESSONS.find((lesson) => lesson.lessonId === "lesson-local-omen-runtime")
    const county = ACADEMY_LESSONS.find((lesson) => lesson.lessonId === "lesson-county-ops-knowledge-pack")

    expect(onboarding?.whatThisTeaches.join(" ")).toContain("Codex operates authorized loops")
    expect(goalLoop?.whatThisTeaches.join(" ")).toContain("Codex continues through listed WOs")
    expect(woe?.whatThisTeaches.join(" ")).toContain("WOE state can be native")
    expect(woe?.whatThisDoesNotEnable).toContain("command runner")
    expect(woe?.whatThisDoesNotEnable).toContain("autonomous loop execution")
    expect(trace?.whatThisTeaches.join(" ")).toContain("Evidence gaps lower or block confidence")
    expect(trace?.relatedWorkOrders).toEqual([
      "WO-TRACE-001",
      "WO-TRACE-002",
      "WO-TRACE-003",
      "WO-TRACE-004",
      "WO-TRACE-005",
      "WO-TRACE-006",
      "WO-TRACE-007",
      "WO-TRACE-008",
      "WO-TRACE-009",
    ])
    expect(trace?.relatedAuthorityGates).toEqual([
      "COMMAND_RUNNER_GATE",
      "AUTONOMOUS_LOOP_GATE",
      "MEMORY_WRITE_GATE",
      "TOOL_CALL_GATE",
    ])
    expect(trace?.whatThisDoesNotEnable).toContain("runtime trace collection")
    expect(trace?.whatThisDoesNotEnable).toContain("eval runner")
    expect(council?.whatThisTeaches.join(" ")).toContain("Recommendations become Work Order packets")
    expect(council?.whatThisDoesNotEnable).toContain("Council runtime")
    expect(council?.whatThisDoesNotEnable).toContain("Hermes/MCP activation")
    expect(local?.whatThisTeaches.join(" ")).toContain("Local runtime status is read-only")
    expect(local?.whatThisDoesNotEnable).toContain("Docker metadata")
    expect(local?.whatThisDoesNotEnable).toContain("runtime control")
    expect(county?.relatedGoal).toBe("GOAL-COUNTY-001")
    expect(county?.whatThisTeaches.join(" ")).toContain("Real records and systems remain outside")
    expect(county?.whatThisDoesNotEnable).toContain("PACS connection")
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
      "Work Order Engine",
      "Completion Report",
      "Evidence",
      "Authority",
      "Owner Decision",
      "Memory",
      "Brain Council",
      "Council Decision Packet",
      "Council Confidence",
      "Council Risk",
      "Trace Ledger",
      "Failure-to-Eval",
      "Evidence Gap",
      "Confidence Movement",
      "Eval Candidate",
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

  it("places Work Order Engine, Agent Forge, Hermes, Trace/Eval, and County Ops as static concepts only", () => {
    const pages = new Map(WIKI_PAGES.map((page) => [page.pageId, page]))

    expect(pages.get("wiki-work-order-engine")?.whatItIs).toContain("static-first read model")
    expect(pages.get("wiki-work-order-engine")?.whatItIsNot).toContain("command runner")
    expect(pages.get("wiki-agent-forge")?.whatItIsNot).toContain("executable skill loader")
    expect(pages.get("wiki-brain-council")?.relatedSurfaces).toEqual([
      "/brain-council",
      "/work-orders",
      "/audit",
      "/governance",
      "/hermes",
    ])
    expect(pages.get("wiki-brain-council")?.whatItIs).toContain("evidence-backed recommendations")
    expect(pages.get("wiki-brain-council")?.whatItIsNot).toContain("autonomous reasoning loop")
    expect(pages.get("wiki-hermes")?.whatItIsNot).toContain("active worker")
    expect(pages.get("wiki-trace-ledger")?.whatItIs).toContain("eval-candidate proposal model")
    expect(pages.get("wiki-trace-ledger")?.whatItIsNot).toContain("telemetry service")
    expect(pages.get("wiki-trace-ledger")?.relatedSurfaces).toContain("/brain-council")
    expect(pages.get("wiki-county-ops")?.whatItIs).toContain("PACS rules")
    expect(pages.get("wiki-county-ops")?.whatItIsNot).toContain("PACS connection")
    expect(pages.get("wiki-county-ops")?.relatedAuthority).toContain("DATA_MUTATION_GATE")
    expect(pages.get("wiki-county-ops")?.relatedAuthority).toContain("SECRET_ACCESS_GATE")
    expect(pages.get("wiki-county-ops")?.relatedAuthority).toContain("TERRAFUSION_TOUCH_GATE")
  })

  it("links Academy and Wiki to existing read-only surfaces", () => {
    const surface = getAcademyWikiSurface()
    const links = new Map(surface.navigation.map((item) => [item.label, item.href]))

    expect(links.get("Work Orders")).toBe("/work-orders")
    expect(links.get("Goal Console")).toBe("/goal-console")
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

  it("recommends WOE shell polish after read-only integration while keeping runtime lanes blocked", () => {
    const surface = getAcademyWikiSurface()

    expect(surface.nextLaneDecision).toMatchObject({
      recommendedBatch: "WILLIAMOS-WOE-SHELL-POLISH-BATCH-001",
      recommendedOption: "A - WOE Shell Polish",
    })
    expect(surface.nextLaneDecision.blockedLanes).toContain("Hermes activation")
    expect(surface.nextLaneDecision.blockedLanes).toContain("worker activation")
    expect(surface.nextLaneDecision.blockedLanes).toContain("command runner")
    expect(surface.nextLaneDecision.blockedLanes).toContain("autonomous loop execution")
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
