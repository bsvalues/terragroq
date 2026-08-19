import { readFileSync } from "node:fs"
import { describe, expect, it } from "vitest"

const component = readFileSync("components/intent/universal-intent.tsx", "utf8")
const shell = readFileSync("components/workbench/workbench-shell.tsx", "utf8")

describe("global universal intent affordance", () => {
  it("uses one global affordance in the persistent Workbench", () => {
    expect(shell.match(/<UniversalIntent/g)).toHaveLength(1)
    expect(component).toContain('event.key.toLowerCase() !== "k"')
    expect(component).toContain("event.ctrlKey")
    expect(component).toContain("Ask or do anything")
    expect(component).toContain('aria-label="Visible universal composer"')
  })

  it("submits an ordinary-language objective to the objective seam", () => {
    expect(component).toContain('fetch("/api/objective"')
    expect(component).toContain("body: JSON.stringify({ objective })")
    expect(component).not.toContain("?intent=")
  })

  it("asks the deterministic router for navigation only, and never waits on recognition", () => {
    expect(component).toContain('fetch("/api/intent"')
    expect(component).toContain("body: JSON.stringify({ intent })")
    expect(component).toContain('routed.intent === "navigation"')
    expect(component).toContain("routeResult.destination")
    // Admission must not depend on the classifier recognising the objective, or on it answering at
    // all -- that dependency is #871's defect. The classifier-gated outcome-start seam is gone with it.
    expect(component).not.toContain("startWorkbenchOutcome")
    expect(component).not.toContain("start_outcome")
  })

  it("states that admission is not authorisation and executes nothing", () => {
    expect(component).toContain("Admission is not authorisation")
    expect(component).toContain("authority?.note")
    expect(component).not.toContain("router.push")
  })
})
