import { describe, expect, it } from "vitest"

import {
  EMPTY_SPINE,
  createWorkingWorld,
  validateWorkingWorld,
  withBoundOutcome,
  withExecution,
  type RetainedStartWork,
  type WorkingWorldSnapshot,
} from "@/lib/environment/working-world"

/**
 * Phase 2 of the primary experience replacement: ONE store owns the governed spine, and real
 * execution changes mutate the MOUNTED world.
 *
 * The owner's complaint — "why is it a stale static page, nothing moves, adjusts, anything" — was
 * accurate and structural: the environment held a conversation and some surfaces while project,
 * outcome, execution and workers lived somewhere else entirely. Nothing on screen was bound to
 * execution, so nothing could move while work happened, and "what is happening?" had no authoritative
 * source to answer from. These tests pin the seam that fixes that.
 */
const SELECTION: RetainedStartWork = {
  projectId: 7,
  projectName: "TerraFusion OS",
  threadId: "thread-37",
  outcomeKey: "goal:GOAL-0037",
  outcomeTitle: "Make the sign-in page speak to the owner",
  activeWorkOrderId: 54,
}

function world(): WorkingWorldSnapshot {
  return createWorkingWorld({ intent: "continue the highest-priority TerraFusion work" })
}

describe("a mounted world carries the governed spine", () => {
  it("starts honestly empty rather than pretending to hold work", () => {
    // An empty spine is a world with no work in it — not "unknown yet". A workspace that shows work
    // the governed queue does not have is the exact failure this replacement exists to end.
    expect(world().spine).toEqual(EMPTY_SPINE)
    expect(world().spine.execution).toBe("idle")
    expect(world().spine.outcomeKey).toBeNull()
    expect(world().spine.worker).toBeNull()
  })

  it("binds to the exact retained selection, never a re-resolved one", () => {
    const bound = withBoundOutcome(world(), SELECTION)
    expect(bound.spine).toMatchObject({
      projectId: 7,
      projectName: "TerraFusion OS",
      threadId: "thread-37",
      outcomeKey: "goal:GOAL-0037",
      workOrderId: 54,
    })
  })

  it("survives validation, and migrates a pre-spine world forward instead of losing it", () => {
    const bound = withBoundOutcome(world(), SELECTION)
    expect(validateWorkingWorld(JSON.parse(JSON.stringify(bound))).spine.outcomeKey).toBe("goal:GOAL-0037")

    // A world persisted before the spine existed must not be rejected — an owner should never lose a
    // world to a schema addition.
    const legacy = JSON.parse(JSON.stringify(world())) as Record<string, unknown>
    delete legacy.spine
    expect(validateWorkingWorld(legacy).spine).toEqual(EMPTY_SPINE)
  })

  it("refuses a malformed or unknown execution state", () => {
    const broken = JSON.parse(JSON.stringify(world())) as Record<string, unknown>
    broken.spine = { ...EMPTY_SPINE, execution: "vibing" }
    expect(() => validateWorkingWorld(broken)).toThrow(/WORLD_SPINE_EXECUTION_UNKNOWN/)

    const noEvidence = JSON.parse(JSON.stringify(world())) as Record<string, unknown>
    noEvidence.spine = { ...EMPTY_SPINE, evidence: "none" }
    expect(() => validateWorkingWorld(noEvidence)).toThrow(/WORLD_SPINE_EVIDENCE_MALFORMED/)
  })

  it("still refuses chrome, so the spine did not smuggle layout into the world", () => {
    const chrome = JSON.parse(JSON.stringify(world())) as Record<string, unknown>
    chrome.spine = { ...EMPTY_SPINE, paneWidth: 320 }
    expect(() => validateWorkingWorld(chrome)).toThrow()
  })
})

describe("execution mutates the mounted world", () => {
  it("moves the world through the lifecycle without the owner navigating", () => {
    let current = withBoundOutcome(world(), SELECTION)
    const walked: string[] = []
    for (const state of ["authorized", "acquired", "implementing", "validating", "reviewing", "complete"] as const) {
      current = withExecution(current, { execution: state, at: "2026-08-22T09:00:00Z" })
      walked.push(current.spine.execution)
    }
    expect(walked).toEqual(["authorized", "acquired", "implementing", "validating", "reviewing", "complete"])
  })

  it("records the worker as DATA and carries the lane across states", () => {
    const bound = withBoundOutcome(world(), SELECTION)
    const started = withExecution(bound, { execution: "implementing", lane: "claude", at: "2026-08-22T09:00:00Z" })
    expect(started.spine.worker).toEqual({ lane: "claude", state: "implementing", since: "2026-08-22T09:00:00Z" })

    // The lane keeps executing across states; only its state moves with the world. A worker is a lane
    // fact, like which disk a file is on — never a persona the surface can adopt.
    const validating = withExecution(started, { execution: "validating", at: "2026-08-22T09:05:00Z" })
    expect(validating.spine.worker).toEqual({ lane: "claude", state: "validating", since: "2026-08-22T09:00:00Z" })
  })

  it("accumulates evidence the world actually has, never a claim", () => {
    const bound = withBoundOutcome(world(), SELECTION)
    const tested = withExecution(bound, {
      execution: "validating",
      at: "2026-08-22T09:05:00Z",
      evidence: { kind: "tests", detail: "43 passed", result: "PASS", at: "2026-08-22T09:05:00Z" },
    })
    expect(tested.spine.evidence).toHaveLength(1)
    expect(tested.spine.evidence[0]).toMatchObject({ kind: "tests", result: "PASS" })
    // A state change with no evidence adds none — the world never invents a record.
    expect(withExecution(tested, { execution: "reviewing", at: "x" }).spine.evidence).toHaveLength(1)
  })

  it("refuses to advance execution with no outcome bound", () => {
    // Without this, any stray event mints a workspace around nothing and the environment starts
    // displaying work the governed queue never authorized.
    expect(() => withExecution(world(), { execution: "implementing", at: "x" }))
      .toThrow(/WORLD_EXECUTION_WITHOUT_OUTCOME/)
    expect(() => withExecution(world(), { execution: "unknown-state" as never, at: "x" }))
      .toThrow(/WORLD_SPINE_EXECUTION_UNKNOWN/)
  })

  it("never mutates the world it was given", () => {
    const bound = withBoundOutcome(world(), SELECTION)
    const before = JSON.parse(JSON.stringify(bound))
    withExecution(bound, { execution: "implementing", lane: "codex", at: "x" })
    expect(JSON.parse(JSON.stringify(bound))).toEqual(before)
  })
})
