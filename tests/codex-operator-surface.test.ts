import { describe, expect, it } from "vitest"

import { getCodexOperatorSurface } from "@/components/operator/codex-operator-surface"

describe("Codex operator current-truth surface", () => {
  it("centers the Primary and makes Codex responsible for the routine chain", () => {
    const surface = getCodexOperatorSurface()

    expect(surface.title).toBe("Codex Operator Loop")
    expect(surface.owner.role).toBe("Primary / authority owner")
    expect(surface.operator.role).toBe("Codex Work Order Operator")
    expect(surface.operator.responsibility).toContain("branch")
    expect(surface.operator.responsibility).toContain("merge")
    expect(surface.owner.responsibility).not.toMatch(/relay|courier|monitor checks/i)
  })

  it("shows declared state, progress, and the deterministic next Work Order", () => {
    const surface = getCodexOperatorSurface()

    expect(surface.provenance).toEqual({
      kind: "DECLARED",
      label: "Declared program state",
      caution: "Confirm live Git, PR, checks, and routes before acting.",
    })
    expect(surface.progress).toMatchObject({ completed: 21, total: 24 })
    expect(surface.nextAction).toMatchObject({
      decision: "NEXT_WORK_ORDER",
      workOrderId: "WO-CODEX-OPERATOR-022",
    })
  })

  it("cross-links existing proof layers without creating ingestion", () => {
    const surface = getCodexOperatorSurface()
    const links = new Map(surface.crossLinks.map((link) => [link.label, link.href]))

    expect(links.get("Evidence")).toBe("/audit")
    expect(links.get("Trace")).toBe("/trace")
    expect(links.get("Memory")).toBe("/memory")
    expect(links.get("Work Orders")).toBe("/work-orders")
    expect(surface.safety.dynamicIngestionAdded).toBe(false)
    expect(surface.safety.memoryWriteAdded).toBe(false)
  })

  it("exposes stop walls and no product execution controls", () => {
    const surface = getCodexOperatorSurface()
    const text = JSON.stringify(surface)

    expect(surface.stopWalls).toEqual(
      expect.arrayContaining([
        expect.stringMatching(/auth/i),
        expect.stringMatching(/database|schema/i),
        expect.stringMatching(/Hermes|MCP/i),
        expect.stringMatching(/production write/i),
      ]),
    )
    expect(surface.controls).toEqual([])
    expect(surface.safety.commandRunnerAdded).toBe(false)
    expect(surface.safety.autonomousRuntimeLoopAdded).toBe(false)
    expect(text).not.toMatch(/"controlLabel":"(execute|approve|run|deploy)/i)
  })
})
