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

  it("handles registered outcomes before generic routing while preserving navigation and objective fallback", () => {
    expect(component).toContain('fetch("/api/intent"')
    expect(component).toContain("body: JSON.stringify({ intent })")
    expect(component).toContain('routed?.intent === "navigation"')
    const registered = component.indexOf("if (isIssue911ReliabilityOutcomeIntent(intent))")
    const routed = component.indexOf("const routed = await deterministicRoute(intent)")
    expect(registered).toBeGreaterThan(-1)
    expect(routed).toBeGreaterThan(registered)
    expect(component).toContain("if (!selectedProject)")
    expect(component).toContain("routeResult.destination")
    expect(component).toContain("startWorkbenchOutcome")
    // Unregistered and classifier-unavailable text still reaches /api/objective; the rendered suite
    // proves that behavior rather than allowing recognition to become an admission prerequisite.
    expect(component).toContain("const objective = await admitObjective(intent)")
  })

  it("states that admission is not authorisation and executes nothing", () => {
    expect(component).toContain("Admission is not authorisation")
    expect(component).toContain("authority?.note")
    expect(component).not.toContain("router.push")
  })
})
