import { readFileSync } from "node:fs"

import { describe, expect, it } from "vitest"

const viewSource = readFileSync("components/goal-console/goal-console-view.tsx", "utf8")
const panelSource = readFileSync("components/goal-console/goal-timeline-panel.tsx", "utf8")
const pageSource = readFileSync("app/(shell)/goal-console/page.tsx", "utf8")

describe("Goal Console persisted timeline surface", () => {
  it("keeps converted goals on the same surface", () => {
    expect(viewSource).toContain("<GoalTimelinePanel")
    expect(viewSource).toContain("timeline={selectedTimeline}")
    expect(viewSource).toContain("onAuthorityDecision={(choice)")
    expect(viewSource).toContain("getGoalTimeline")
    expect(viewSource).toContain("await refreshGoalTimeline(g.id)")
    expect(viewSource).toContain("window.setInterval")
    expect(viewSource).toContain("Goal saved; persisted timeline refresh failed")
    expect(viewSource).toContain("Work order saved; persisted timeline refresh failed")
    expect(viewSource).toContain("Goal dismissed; persisted timeline refresh failed")
    expect(viewSource).toContain("aria-pressed={active}")
    expect(viewSource).toContain('toast.success("Draft work order created")')
    expect(viewSource).not.toContain('router.push("/work-orders")')
  })

  it("consumes the persisted Goal timeline query", () => {
    expect(pageSource).toContain("getGoalTimelines")
    expect(pageSource).toContain("timelines={timelines}")
    expect(panelSource).toContain("Persisted execution, validation, delivery, and evidence")
    expect(panelSource).toContain("WilliamOS is not inferring runtime progress")
    expect(panelSource).toContain("timeline.validationCheckpoints.at(-1)?.result")
  })

  it("removes hosted-session handoff language from the Goal Console", () => {
    const operatorCopy = `${viewSource}\n${panelSource}\n${pageSource}`.toLowerCase()

    expect(operatorCopy).not.toContain("hosted codex session")
    expect(operatorCopy).not.toContain("operating codex session")
    expect(operatorCopy).not.toContain("session handoff")
  })
})
