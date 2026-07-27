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
    expect(viewSource).toContain("const [decisionPending, setDecisionPending] = useState(false)")
    expect(viewSource).toContain("setDecisionPending(true)")
    expect(viewSource).toContain("finally {")
    expect(viewSource).toContain("setDecisionPending(false)")
    expect(viewSource).toContain("decisionPending={decisionPending}")
    expect(viewSource).not.toContain("decisionPending={pending}")
    expect(viewSource).toContain("Authority decision persisted; timeline refresh failed")
    expect(viewSource).toContain("Authority decision was not accepted; timeline refresh failed")
    expect(viewSource).not.toContain("Authority decision recorded; persisted timeline refresh failed")
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

  it("tracks selected projection connection truth across every refresh path", () => {
    expect(viewSource).toContain('state: "current"')
    expect(viewSource).toContain('state: "refreshing"')
    expect(viewSource).toContain('state: "stale"')
    expect(viewSource).toContain("lastSuccessfulObservation: timeline.truth.observedAt")
    expect(viewSource).toContain("timelineConnections(timelines)")
    expect(viewSource).toContain("await refreshGoalTimeline(goalId)")
    expect(viewSource).toContain("window.setInterval")
    expect(viewSource).toContain("handleTimelineRefresh(g.id)")
    expect(viewSource).toContain("onRefresh={() => handleTimelineRefresh(latest.id)}")
    expect(viewSource).toContain("throw new Error(\"No persisted Goal projection was returned\")")
    expect(viewSource).toContain("lastSuccessfulObservation: current.get(goalId)?.lastSuccessfulObservation ?? null")
  })

  it("prevents older overlapping refreshes from replacing newer per-goal truth", () => {
    expect(viewSource).toContain("const goalTimelineRefreshSequences = useRef(new Map<number, number>())")
    expect(viewSource).toContain("const goalTimelineLatestObservations = useRef(")
    expect(viewSource).toContain("goalTimelineRefreshSequences.current.set(")
    expect(viewSource).toContain("if (latestObservedAt !== undefined && observedAt < latestObservedAt) return")
    expect(viewSource).toContain("confirmedTimelines.push(timeline)")
    expect(viewSource).toContain("if (latestObservedAt !== undefined && observedAt === latestObservedAt) return")
    expect(viewSource).toContain("if (latestObservedAt !== undefined && observedAt <= latestObservedAt) {")
    expect(viewSource).toContain("acceptedTimelines.forEach((timeline)")
    expect(viewSource).toContain("timelineConnections(confirmedTimelines)")
    expect(viewSource).toContain("const refreshSequence =")
    expect(viewSource).toContain("const isLatestRefresh = () =>")
    expect(viewSource).toContain("goalTimelineRefreshSequences.current.get(goalId) === refreshSequence")
    expect(viewSource).toContain("if (!isLatestRefresh()) return timeline")
    expect(viewSource).toContain("if (!isLatestRefresh()) return null")

    const staleSuccessGuard = viewSource.indexOf("if (!isLatestRefresh()) return timeline")
    const timelineWrite = viewSource.indexOf("setGoalTimelines((current)", staleSuccessGuard)
    const staleFailureGuard = viewSource.indexOf("if (!isLatestRefresh()) return null")
    const staleConnectionWrite = viewSource.indexOf(
      "setGoalTimelineConnections((current)",
      staleFailureGuard,
    )

    expect(staleSuccessGuard).toBeGreaterThan(-1)
    expect(timelineWrite).toBeGreaterThan(staleSuccessGuard)
    expect(staleFailureGuard).toBeGreaterThan(timelineWrite)
    expect(staleConnectionWrite).toBeGreaterThan(staleFailureGuard)
  })

  it("bounds reconnect attempts and marks timed-out projections stale", () => {
    expect(viewSource).toContain("const GOAL_TIMELINE_REFRESH_TIMEOUT_MS = 15_000")
    expect(viewSource).toContain("await Promise.race([")
    expect(viewSource).toContain('reject(new Error("Goal timeline refresh timed out"))')
    expect(viewSource).toContain("GOAL_TIMELINE_REFRESH_TIMEOUT_MS")
    expect(viewSource).toContain("window.clearTimeout(timeoutId)")
  })

  it("labels stale projection data without implying resident host liveness", () => {
    expect(panelSource).toContain('role="status"')
    expect(panelSource).toContain('aria-live="polite"')
    expect(panelSource).toContain('aria-atomic="true"')
    expect(panelSource).toContain('aria-busy={connection.state === "refreshing"}')
    expect(panelSource).toContain("Projection stale and disconnected.")
    expect(panelSource).toContain("The last persisted projection remains visible.")
    expect(panelSource).toContain("Last successful observation")
    expect(panelSource).toContain("Resident host liveness is not inferred.")
    expect(panelSource).toContain('aria-label="Refresh persisted Goal projection"')
    expect(panelSource).toContain('className="size-9"')
  })

  it("removes hosted-session handoff language from the Goal Console", () => {
    const operatorCopy = `${viewSource}\n${panelSource}\n${pageSource}`.toLowerCase()

    expect(operatorCopy).not.toContain("hosted codex session")
    expect(operatorCopy).not.toContain("operating codex session")
    expect(operatorCopy).not.toContain("session handoff")
  })
})
