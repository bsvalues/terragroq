import fs from "node:fs"
import path from "node:path"

import { describe, expect, it } from "vitest"

import { EMPTY_SPINE, withBoundOutcome, withExecution, createWorkingWorld } from "@/lib/environment/working-world"

const ROOT = process.cwd()
const DESK = fs.readFileSync(path.join(ROOT, "components/desk/desk.tsx"), "utf8")
const LINE_ROUTE = fs.readFileSync(path.join(ROOT, "app/api/environment/line/route.ts"), "utf8")

/**
 * Phase 2, the visible half: the environment RENDERS execution from the governed spine.
 *
 * The model existing is not the same as the screen moving — that gap is precisely what produced "a
 * stale static page" while the underlying OS was real. These pin the wiring end to end: the route
 * sends the spine it actually holds, and the Desk paints it.
 */
describe("the Line hands the environment its governed spine", () => {
  it("returns a spine on every reply, never a fabricated one", () => {
    // Four reply sites; each must carry a real spine (the mounted world's, or an honest empty one for
    // the no-world decision path). A hardcoded literal here would be the environment inventing state.
    const replies = [...LINE_ROUTE.matchAll(/satisfies LineReply/g)]
    expect(replies.length).toBeGreaterThanOrEqual(4)
    expect(LINE_ROUTE).toContain("spine: updated.spine")
    expect(LINE_ROUTE).toContain("spine: world.spine")
    expect(LINE_ROUTE).toContain("spine: EMPTY_SPINE")
    expect(LINE_ROUTE).toMatch(/spine: WorldSpine/)
  })
})

describe("the Desk paints execution, and draws nothing when there is no work", () => {
  it("renders the world line only when an outcome is bound", () => {
    // An empty world draws NOTHING: no welcome, no status card, no billboard. A region that needs
    // explanatory text to justify existing gets removed.
    expect(DESK).toMatch(/spine\.outcomeKey === null \? null :/)
  })

  it("paints the execution state, the outcome, and the worker as a LANE", () => {
    expect(DESK).toContain("spine.execution")
    expect(DESK).toContain("spine.outcomeKey")
    // "worker: claude lane" — a lane fact, the way a disk name reads in a file listing. If this ever
    // becomes a persona ("Claude says…"), the Operator has been replaced by its worker.
    expect(DESK).toMatch(/worker: \{spine\.worker\.lane\} lane/)
    expect(DESK).not.toMatch(/I am (Claude|Codex)/i)
  })

  it("takes the spine from the reply rather than deriving it locally", () => {
    // Locally-derived execution state is how a screen drifts from reality. One store, one source.
    expect(DESK).toContain("if (reply.spine) setSpine(reply.spine)")
    expect(DESK).toContain("useState<WorldSpine>(EMPTY_SPINE)")
  })

  it("keeps the legacy frame out of the primary environment", () => {
    for (const legacy of ["ProjectExplorer", "Inspector", "WorkbenchShell", "ThreadTimeline"]) {
      expect(DESK).not.toContain(legacy)
    }
  })
})

describe("what the owner would actually see as work moves", () => {
  it("carries a real lifecycle from bound outcome to complete", () => {
    // The states the world line paints, in the order execution produces them. This is the sequence
    // the owner watches without navigating anywhere.
    let world = withBoundOutcome(createWorkingWorld({ intent: "continue TerraFusion" }), {
      projectId: 7,
      projectName: "TerraFusion OS",
      threadId: "t-37",
      outcomeKey: "goal:GOAL-0037",
      outcomeTitle: "Sign-in speaks to the owner",
      activeWorkOrderId: 54,
    })
    expect(world.spine.execution).toBe("idle")

    world = withExecution(world, { execution: "implementing", lane: "claude", at: "2026-08-22T09:00:00Z" })
    expect(world.spine.worker?.lane).toBe("claude")

    world = withExecution(world, {
      execution: "validating",
      at: "2026-08-22T09:05:00Z",
      evidence: { kind: "tests", detail: "43 passed", result: "PASS", at: "2026-08-22T09:05:00Z" },
    })
    world = withExecution(world, { execution: "complete", at: "2026-08-22T09:09:00Z" })

    expect(world.spine.execution).toBe("complete")
    expect(world.spine.evidence).toHaveLength(1)
    // The lane that did the work is still recorded — attribution survives completion.
    expect(world.spine.worker?.lane).toBe("claude")
  })

  it("shows nothing at all for a world with no work", () => {
    expect(createWorkingWorld({ intent: "just asking" }).spine).toEqual(EMPTY_SPINE)
  })
})
