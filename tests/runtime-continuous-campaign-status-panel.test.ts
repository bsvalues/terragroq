import { readFileSync } from "node:fs"
import { createRequire } from "node:module"
import { createElement } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import ts from "typescript"

import { describe, expect, it } from "vitest"

import type { ContinuousCampaignStatus } from "@/components/runtime/continuous-campaign-status"

function source(path: string): string {
  return readFileSync(path, "utf8")
}

function loadPanel(): (props: { status: ContinuousCampaignStatus }) => ReturnType<typeof createElement> {
  const filename = "components/runtime/continuous-campaign-status-panel.tsx"
  const compiled = ts.transpileModule(source(filename), {
    fileName: filename,
    compilerOptions: {
      esModuleInterop: true,
      jsx: ts.JsxEmit.ReactJSX,
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
    },
  }).outputText
  const module = { exports: {} as Record<string, unknown> }
  const nativeRequire = createRequire(import.meta.url)
  const icon = (props: Record<string, unknown>) => createElement("svg", props)
  const localRequire = (id: string): unknown => {
    if (id === "lucide-react") {
      return new Proxy({}, { get: () => icon })
    }
    if (id === "@/components/status-badge") {
      return {
        StatusBadge: ({ label }: { label: string }) => createElement("span", null, label),
      }
    }
    if (id === "@/components/runtime/continuous-campaign-status") return {}
    return nativeRequire(id)
  }

  new Function("require", "module", "exports", compiled)(
    localRequire,
    module,
    module.exports,
  )
  return module.exports.ContinuousCampaignStatusPanel as (
    props: { status: ContinuousCampaignStatus },
  ) => ReturnType<typeof createElement>
}

describe("continuous campaign status panel contract", () => {
  it("renders recorded, pending, missing, and conflicting campaign states accessibly", () => {
    const ContinuousCampaignStatusPanel = loadPanel()
    const status: ContinuousCampaignStatus = {
      phase: { state: "LIVE", label: "Live" },
      window: {
        status: "MISSING",
        startedAt: "2026-07-28T18:00:00.000Z",
        observedAt: "2026-07-28T18:21:00.000Z",
        settledAt: null,
      },
      steps: [
        { id: "first-acquisition", label: "First outcome · Acquisition", outcomeKey: "first", title: "First", status: "RECORDED", at: "2026-07-28T18:00:00.000Z", detail: "Recorded." },
        { id: "first-settlement", label: "First outcome · Settlement", outcomeKey: "first", title: "First", status: "RECORDED", at: "2026-07-28T18:20:00.000Z", detail: "Settled." },
        { id: "successor-acquisition", label: "Successor · Acquisition", outcomeKey: "second", title: "Second", status: "CONFLICTING", at: null, detail: "Conflicting evidence." },
        { id: "successor-settlement", label: "Successor · Settlement", outcomeKey: "second", title: "Second", status: "PENDING", at: null, detail: "Pending." },
      ],
      handoff: {
        acquisitionStatus: "CONFLICTING",
        automationStatus: "CONFLICTING",
        receiptId: null,
        acquiredAt: null,
        fencingTokenRange: null,
        detail: "Conflicting handoff evidence.",
      },
      evidenceStatus: "CONFLICTING",
      gaps: [{ code: "CROSS_SOURCE_CONFLICT", status: "CONFLICTING", detail: "Conflicting evidence." }],
    }

    const markup = renderToStaticMarkup(createElement(ContinuousCampaignStatusPanel, { status }))

    expect(markup).toContain('aria-labelledby="continuous-campaign-status-title"')
    for (const value of ["RECORDED", "PENDING", "MISSING", "CONFLICTING"]) {
      expect(markup).toContain(value)
    }
    expect(markup).toContain("CROSS_SOURCE_CONFLICT")
    expect(markup).toContain("Conflicting evidence.")
    expect(markup).toContain(
      "Successor handoff evidence conflicts; automation proof cannot be trusted or evaluated from conflicting evidence.",
    )
  })

  it("shows the campaign window, ordered lifecycle, handoff, and evidence gaps", () => {
    const panel = source(
      "components/runtime/continuous-campaign-status-panel.tsx",
    )

    for (const label of [
      "Continuous campaign status",
      "Campaign window",
      "Acquisition",
      "Settlement",
      "Automatic successor handoff",
      "Evidence gaps",
    ]) {
      expect(panel).toContain(label)
    }
  })

  it("states the unproven campaign identity and automation evidence explicitly", () => {
    const panel = source(
      "components/runtime/continuous-campaign-status-panel.tsx",
    )

    expect(panel).toMatch(/campaign identity[^.]*missing/i)
    expect(panel).toMatch(/automatic-trigger[^.]*missing/i)
    expect(panel).toMatch(/zero-owner-contact[^.]*missing/i)
  })

  it("renders the lifecycle as a semantic ordered sequence", () => {
    const panel = source(
      "components/runtime/continuous-campaign-status-panel.tsx",
    )

    expect(panel).toMatch(/<ol\b[\s\S]*status\.steps\.map/)
    expect(panel).toContain("<li key={step.id}")
  })

  it("defers automation evaluation until successor acquisition is recorded", () => {
    const panel = source(
      "components/runtime/continuous-campaign-status-panel.tsx",
    )
    const recordedGate = panel.indexOf(
      'status.handoff.acquisitionStatus === "RECORDED" &&',
    )
    const automaticProofAssertion = panel.indexOf(
      "Automatic-trigger proof is missing, and zero-owner-contact proof is missing",
    )

    expect(recordedGate).toBeGreaterThan(-1)
    expect(automaticProofAssertion).toBeGreaterThan(recordedGate)
    expect(panel).toMatch(
      /Successor handoff evidence remains[\s\S]*automation proof is not evaluated yet\./,
    )
  })

  it("separates conflicting handoff evidence from pre-acquisition deferral", () => {
    const panel = source(
      "components/runtime/continuous-campaign-status-panel.tsx",
    )
    const conflictGate = panel.indexOf(
      'status.handoff.acquisitionStatus === "CONFLICTING"',
    )
    const deferredAutomationCopy = panel.indexOf(
      "automation proof is not evaluated yet.",
    )

    expect(conflictGate).toBeGreaterThan(-1)
    expect(deferredAutomationCopy).toBeGreaterThan(conflictGate)
    expect(panel.slice(conflictGate, deferredAutomationCopy)).toMatch(
      /conflict[\s\S]*cannot[\s\S]*(?:trust|evaluat)/i,
    )
  })

  it("wires persisted queue truth through the Runtime page projection", () => {
    const page = source("app/(shell)/runtime/page.tsx")

    expect(page).toContain("getOutcomeQueueSurface")
    expect(page).toContain("projectContinuousCampaignStatus")
    expect(page).toContain("ContinuousCampaignStatusPanel")
  })

  it("declares no campaign mutation or runtime-control affordance in the panel or page module", () => {
    const page = source("app/(shell)/runtime/page.tsx")
    const panel = source(
      "components/runtime/continuous-campaign-status-panel.tsx",
    )

    expect(`${page}\n${panel}`).not.toMatch(
      /<button|<Button|<form|<Form|<input|<Input|<select|<textarea|on(?:Click|Submit|Change)=|startWorker|runCommand|cancelExecution/,
    )
  })
})
