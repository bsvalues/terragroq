import { describe, expect, it } from "vitest"

import {
  isExecutionLive,
  projectWorldExecution,
  projectWorldWorkerSession,
  type CanonicalExecution,
} from "@/lib/environment/world-execution"

/**
 * The mapping from governed reality to what the owner watches.
 *
 * This is the part that can be wrong in a way nobody notices. A screen confidently showing
 * "implementing" for work that is actually blocked is worse than a screen showing nothing, because it
 * spends the owner's trust rather than their attention. So every canonical state is pinned.
 */
function canonical(overrides: Partial<CanonicalExecution> = {}): CanonicalExecution {
  return {
    lifecycleState: "suggested",
    activeWorkOrderId: null,
    workOrderStatus: null,
    lane: null,
    evidence: [],
    observedAt: "2026-08-22T09:00:00Z",
    ...overrides,
  }
}

describe("canonical lifecycle projects honestly", () => {
  it.each([
    ["suggested", "idle"],
    ["approved", "authorized"],
    ["active", "acquired"],
    ["blocked", "blocked"],
    ["completed", "complete"],
  ] as const)("%s -> %s", (lifecycleState, expected) => {
    expect(projectWorldExecution(canonical({ lifecycleState })).execution).toBe(expected)
  })

  it("never reads a queued outcome as work in flight", () => {
    // An outcome sitting in the queue is not progress. Painting it as active is how a dashboard
    // starts lying about how much is happening.
    expect(projectWorldExecution(canonical({ lifecycleState: "suggested" })).execution).toBe("idle")
  })

  it.each(["declined", "superseded"])("treats %s as blocked, never as complete", (lifecycleState) => {
    // Terminal, but nothing was delivered. The one thing the owner must never read as done is work
    // that stopped.
    expect(projectWorldExecution(canonical({ lifecycleState })).execution).toBe("blocked")
  })

  it("falls to blocked, not to a cheerful default, on an unknown lifecycle", () => {
    expect(projectWorldExecution(canonical({ lifecycleState: "who-knows" })).execution).toBe("blocked")
  })
})

describe("a bound work order refines what the worker is doing", () => {
  it.each([
    ["active", "implementing"],
    ["implementing", "implementing"],
    ["validating", "validating"],
    ["reviewing", "reviewing"],
    ["remediating", "remediating"],
    ["blocked", "blocked"],
    ["merged", "complete"],
  ] as const)("work order %s -> %s", (workOrderStatus, expected) => {
    const projected = projectWorldExecution(
      canonical({ lifecycleState: "active", activeWorkOrderId: 54, workOrderStatus }),
    )
    expect(projected.execution).toBe(expected)
  })

  it("leaves the lifecycle's answer standing for an unrecognised work-order status", () => {
    // Inventing a more specific-sounding state from a status nobody writes is how the screen drifts.
    const projected = projectWorldExecution(
      canonical({ lifecycleState: "active", activeWorkOrderId: 54, workOrderStatus: "sideways" }),
    )
    expect(projected.execution).toBe("acquired")
  })

  it("lets a settled outcome stay settled despite a stale work order", () => {
    // A stale work-order row must not drag a completed outcome back into "implementing".
    const done = projectWorldExecution(
      canonical({ lifecycleState: "completed", activeWorkOrderId: 54, workOrderStatus: "active" }),
    )
    expect(done.execution).toBe("complete")

    const stopped = projectWorldExecution(
      canonical({ lifecycleState: "blocked", activeWorkOrderId: 54, workOrderStatus: "active" }),
    )
    expect(stopped.execution).toBe("blocked")
  })
})

describe("attribution is never inferred", () => {
  it("records the lane the runtime actually recorded", () => {
    const projected = projectWorldExecution(
      canonical({ lifecycleState: "active", workOrderStatus: "implementing", lane: "claude" }),
    )
    expect(projected.worker).toEqual({ lane: "claude", state: "implementing", since: "2026-08-22T09:00:00Z" })
  })

  it("leaves the worker absent when no lane was recorded", () => {
    // Attribution the system cannot prove is exactly the confident wrongness this environment exists
    // to stop rendering. No lane recorded means no worker shown - not a guess at the usual one.
    const projected = projectWorldExecution(
      canonical({ lifecycleState: "active", workOrderStatus: "implementing" }),
    )
    expect(projected.worker).toBeNull()
  })

  it("passes evidence through without inventing any", () => {
    const evidence = [{ kind: "tests", detail: "43 passed", result: "PASS", at: "2026-08-22T09:05:00Z" }]
    expect(projectWorldExecution(canonical({ evidence })).evidence).toEqual(evidence)
    expect(projectWorldExecution(canonical()).evidence).toEqual([])
  })
})

describe("exact persisted executor projects as a Space-bound session", () => {
  const input = {
    worldId: "world-terrafusion",
    outcome: { key: "WILLIAMOS_EXPERIENCE_V2", title: "Finish Experience V2" },
    workOrder: {
      id: 1121,
      ref: "WO-1121",
      title: "Project canonical checkout binding",
      assignee: "hermes-codex-bridge",
      agent: "codex",
      lane: "ui",
    },
    status: "implementing" as const,
    evidence: [{
      kind: "validation",
      detail: "Focused session tests",
      result: "84 passed",
      at: "2026-08-31T20:00:00.000Z",
    }],
    observedAt: "2026-08-31T20:01:00.000Z",
  }

  it("keeps identity stable across observation time while projecting bounded assignment and evidence", () => {
    const first = projectWorldWorkerSession(input)
    const later = projectWorldWorkerSession({ ...input, observedAt: "2026-08-31T20:05:00.000Z" })

    expect(first).toMatchObject({
      id: "world-worker:world-terrafusion:1121:hermes-codex-bridge",
      worldId: "world-terrafusion",
      workOrderId: 1121,
      assignee: "hermes-codex-bridge",
      agent: "codex",
      role: "HERMES",
      providerLabel: "Local execution",
      assignment: "Finish Experience V2 · WO-1121: Project canonical checkout binding",
      evidence: "validation: Focused session tests · 84 passed",
      status: "implementing",
    })
    expect(later?.id).toBe(first?.id)
    expect(later?.observedAt).not.toBe(first?.observedAt)
  })

  it("never calls a lane HERMES when the exact persisted executor is not HERMES", () => {
    expect(projectWorldWorkerSession({
      ...input,
      workOrder: { ...input.workOrder, assignee: "builder-a", lane: "hermes" },
    })).toMatchObject({
      role: "Executor",
      providerLabel: "builder-a · codex",
      assignee: "builder-a",
    })
  })

  it("does not project a session without a persisted assignee identity", () => {
    expect(projectWorldWorkerSession({
      ...input,
      workOrder: { ...input.workOrder, assignee: null, lane: "hermes" },
    })).toBeNull()
  })
})

describe("the world knows when to keep watching", () => {
  it.each(["authorized", "acquired", "implementing", "validating", "reviewing", "remediating"] as const)(
    "keeps watching while %s",
    (state) => expect(isExecutionLive(state)).toBe(true),
  )

  it.each(["idle", "complete", "blocked"] as const)("stops watching at %s", (state) => {
    // Polling a settled world forever is how an "operator surface" becomes a battery drain that
    // learns nothing.
    expect(isExecutionLive(state)).toBe(false)
  })
})
