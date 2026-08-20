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

  it("uses the deterministic router for navigation and registered outcomes while preserving objective fallback", () => {
    expect(component).toContain('fetch("/api/intent"')
    expect(component).toContain("body: JSON.stringify({ intent })")
    expect(component).toContain('routed?.intent === "navigation"')
    expect(component).toContain('routed?.destination?.action === "start_outcome"')
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
