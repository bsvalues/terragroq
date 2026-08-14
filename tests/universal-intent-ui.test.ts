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

  it("routes through the authenticated deterministic endpoint", () => {
    expect(component).toContain('fetch("/api/intent"')
    expect(component).toContain("body: JSON.stringify({ intent })")
    expect(component).toContain("routeResult.destination")
    expect(component).toContain("startWorkbenchOutcome(attempt)")
    expect(component).toContain("storeIntentHandoff")
    expect(component).not.toContain("?intent=")
  })

  it("makes authority and clarification states visible without auto-execution", () => {
    expect(component).toContain('routeResult.state === "authority_required"')
    expect(component).toContain('routeResult.state === "clarification_required"')
    expect(component).toContain("Needs a decision")
    expect(component).not.toContain("router.push")
  })
})
