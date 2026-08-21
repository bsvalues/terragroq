import { describe, expect, it } from "vitest"

import {
  aggregateCurrentWork,
  resolveProject,
  type ProjectIdentity,
  type ThreadExecution,
} from "@/lib/environment/canonical-current-work"

/**
 * The canonical current-work reader replaces closed #940 (which string-matched titles). These lock
 * every non-negotiable from the owner: alias-only resolution, honest unknown, no cross-contamination,
 * deterministic multi-thread aggregation, queue-order priority, proposed excluded from "doing",
 * structured evidence only, partial-load never silently omitted, and a top item carrying the exact
 * START_WORK tuple.
 */
const PROJECTS: ProjectIdentity[] = [
  { id: 1, key: "terrafusion", name: "TerraFusion OS" },
  { id: 2, key: "williamos", name: "WilliamOS" },
  { id: 3, key: "localops", name: "LocalOps" },
]

describe("resolveProject — registered key/name/alias only, never fuzzy", () => {
  it("resolves the bare alias 'TerraFusion' to the registered TerraFusion OS via its key", () => {
    const r = resolveProject("what are we doing right now on TerraFusion?", PROJECTS)
    expect(r).toEqual({ kind: "resolved", project: PROJECTS[0] })
  })

  it("resolves the full canonical name", () => {
    expect(resolveProject("status of TerraFusion OS", PROJECTS)).toMatchObject({ kind: "resolved", project: { id: 1 } })
  })

  it("does not cross-contaminate similar names", () => {
    const projects: ProjectIdentity[] = [
      { id: 10, key: "terrafusion", name: "TerraFusion OS" },
      { id: 11, key: "terrafusion-lab", name: "TerraFusion Lab" },
    ]
    // 'TerraFusion Lab' must resolve to Lab, not OS (longest match wins, no bleed).
    expect(resolveProject("what's happening on TerraFusion Lab", projects)).toMatchObject({ kind: "resolved", project: { id: 11 } })
  })

  it("returns honest unknown for a named-but-unregistered project", () => {
    expect(resolveProject("what are we doing on Foobar?", PROJECTS)).toEqual({ kind: "unknown-named", named: "Foobar" })
  })

  it("returns none when no project is named", () => {
    expect(resolveProject("what are we working on right now", PROJECTS)).toEqual({ kind: "none" })
  })
})

const thread = (over: Partial<ThreadExecution> & Pick<ThreadExecution, "threadId">): ThreadExecution => ({
  threadTitle: null, loaded: true, outcomes: [], workOrders: [], evidence: [], ...over,
})

describe("aggregateCurrentWork — outcome is the authoritative unit", () => {
  const project = PROJECTS[0]

  it("orders by queue position, with the single active outcome always first", () => {
    const work = aggregateCurrentWork(project, [
      thread({
        threadId: "t1",
        outcomes: [
          { outcomeKey: "o-low", outcomeTitle: "Low", lifecycleState: "suggested", queueOrder: 1, activeWorkOrderId: null, dependencyKeys: [] },
          { outcomeKey: "o-active", outcomeTitle: "Active", lifecycleState: "active", queueOrder: 9, activeWorkOrderId: 100, dependencyKeys: [] },
          { outcomeKey: "o-mid", outcomeTitle: "Mid", lifecycleState: "suggested", queueOrder: 0, activeWorkOrderId: null, dependencyKeys: [] },
        ],
        workOrders: [{ id: 100, ref: "WO-100", status: "in progress" }],
      }),
    ])
    // active first despite queueOrder 9; then suggested by queueOrder (0 before 1).
    expect(work.items.map((i) => i.outcomeKey)).toEqual(["o-active", "o-mid", "o-low"])
    expect(work.topItem?.outcomeKey).toBe("o-active")
  })

  it("excludes proposed-equivalent and terminal outcomes from 'currently doing' set correctly", () => {
    const work = aggregateCurrentWork(project, [
      thread({
        threadId: "t1",
        outcomes: [
          { outcomeKey: "done", outcomeTitle: "Done", lifecycleState: "terminal", queueOrder: 0, activeWorkOrderId: null, dependencyKeys: [] },
          { outcomeKey: "queued", outcomeTitle: "Queued", lifecycleState: "suggested", queueOrder: 2, activeWorkOrderId: null, dependencyKeys: [] },
        ],
      }),
    ])
    // terminal excluded entirely; suggested present but is not 'active'.
    expect(work.items.map((i) => i.outcomeKey)).toEqual(["queued"])
    expect(work.items[0].lifecycleState).toBe("suggested")
  })

  it("no active outcome means top item is the top of the queue, not a fabricated one", () => {
    const work = aggregateCurrentWork(project, [
      thread({ threadId: "t1", outcomes: [{ outcomeKey: "q1", outcomeTitle: "Q1", lifecycleState: "suggested", queueOrder: 3, activeWorkOrderId: null, dependencyKeys: [] }] }),
    ])
    expect(work.topItem?.outcomeKey).toBe("q1")
    expect(work.topItem?.lifecycleState).toBe("suggested")
  })

  it("empty project has no items and no fabricated top", () => {
    const work = aggregateCurrentWork(project, [thread({ threadId: "t1" })])
    expect(work.items).toHaveLength(0)
    expect(work.topItem).toBeNull()
    expect(work.complete).toBe(true)
  })

  it("attaches evidence ONLY from structured records, latest first, scoped to the active work order", () => {
    const work = aggregateCurrentWork(project, [
      thread({
        threadId: "t1",
        outcomes: [{ outcomeKey: "o", outcomeTitle: "O", lifecycleState: "active", queueOrder: 0, activeWorkOrderId: 5, dependencyKeys: [] }],
        workOrders: [{ id: 5, ref: "WO-5", status: "in progress" }],
        evidence: [
          { workOrderId: 5, result: "PASS", notes: "first", createdAt: "2026-08-20T10:00:00Z" },
          { workOrderId: 5, result: "PASS", notes: "latest", createdAt: "2026-08-21T10:00:00Z" },
          { workOrderId: 99, result: "PASS", notes: "other WO", createdAt: "2026-08-21T11:00:00Z" },
        ],
      }),
    ])
    expect(work.topItem?.latestEvidence[0].notes).toBe("latest")
    expect(work.topItem?.latestEvidence.some((e) => e.notes === "other WO")).toBe(false)
  })

  it("aggregates multiple threads deterministically and retains provenance", () => {
    const work = aggregateCurrentWork(project, [
      thread({ threadId: "tB", outcomes: [{ outcomeKey: "b", outcomeTitle: "B", lifecycleState: "suggested", queueOrder: 2, activeWorkOrderId: null, dependencyKeys: [] }] }),
      thread({ threadId: "tA", outcomes: [{ outcomeKey: "a", outcomeTitle: "A", lifecycleState: "suggested", queueOrder: 1, activeWorkOrderId: null, dependencyKeys: [] }] }),
    ])
    expect(work.items.map((i) => i.outcomeKey)).toEqual(["a", "b"]) // queueOrder wins across threads
    expect(work.items[0].threadId).toBe("tA") // provenance kept
  })

  it("a thread that failed to load is counted as unread, never silently dropped", () => {
    const work = aggregateCurrentWork(project, [
      thread({ threadId: "t1", outcomes: [{ outcomeKey: "o", outcomeTitle: "O", lifecycleState: "active", queueOrder: 0, activeWorkOrderId: null, dependencyKeys: [] }] }),
      thread({ threadId: "t2", loaded: false }),
    ])
    expect(work.threadsRead).toBe(1)
    expect(work.threadsTotal).toBe(2)
    expect(work.complete).toBe(false)
  })

  it("the top item carries the exact tuple START_WORK needs", () => {
    const work = aggregateCurrentWork(project, [
      thread({ threadId: "t-xyz", outcomes: [{ outcomeKey: "outcome-42", outcomeTitle: "X", lifecycleState: "active", queueOrder: 0, activeWorkOrderId: 7, dependencyKeys: [] }], workOrders: [{ id: 7, ref: "WO-7", status: "active" }] }),
    ])
    expect(work.topItem).toMatchObject({ projectId: 1, projectKey: "terrafusion", threadId: "t-xyz", outcomeKey: "outcome-42", activeWorkOrderId: 7 })
  })
})

import { composeCurrentWorkAnswer, startWorkSelection } from "@/lib/environment/canonical-current-work"

describe("composeCurrentWorkAnswer + startWorkSelection", () => {
  const project = PROJECTS[0]

  it("names the exact top item and the SAME item is what START_WORK selects (the invariant)", () => {
    const work = aggregateCurrentWork(project, [
      thread({ threadId: "t-x", threadTitle: "permit intake", outcomes: [
        { outcomeKey: "top", outcomeTitle: "Ship permit search", lifecycleState: "active", queueOrder: 0, activeWorkOrderId: 7, dependencyKeys: [] },
      ], workOrders: [{ id: 7, ref: "WO-7", status: "in progress" }] }),
    ])
    const said = composeCurrentWorkAnswer({ kind: "resolved", project }, work)
    expect(said).toContain("Ship permit search")
    expect(said).toContain("continue the highest-priority TerraFusion OS work")
    // the answer's named item and the START_WORK selection are the same object's tuple
    expect(startWorkSelection(work)).toEqual({ projectId: 1, threadId: "t-x", outcomeKey: "top", activeWorkOrderId: 7 })
  })

  it("is honest about a partial read and won't claim completeness", () => {
    const work = aggregateCurrentWork(project, [
      thread({ threadId: "ok", outcomes: [{ outcomeKey: "o", outcomeTitle: "O", lifecycleState: "active", queueOrder: 0, activeWorkOrderId: null, dependencyKeys: [] }] }),
      thread({ threadId: "bad", loaded: false }),
    ])
    const said = composeCurrentWorkAnswer({ kind: "resolved", project }, work)
    expect(said).toContain("1 of 2 governed threads")
    expect(said.toLowerCase()).toContain("won't claim this is a complete")
  })

  it("unknown-named project is honest, never fabricated", () => {
    const said = composeCurrentWorkAnswer({ kind: "unknown-named", named: "Foobar" }, null)
    expect(said).toContain("Foobar")
    expect(said.toLowerCase()).toContain("won't guess")
    for (const invented of ["chatbot", "customer support"]) expect(said.toLowerCase()).not.toContain(invented)
  })

  it("empty in-flight set says nothing in flight, never picks a proposed one implicitly", () => {
    const work = aggregateCurrentWork(project, [thread({ threadId: "t1" })])
    const said = composeCurrentWorkAnswer({ kind: "resolved", project }, work)
    expect(said.toLowerCase()).toContain("nothing is in flight")
    expect(startWorkSelection(work)).toBeNull()
  })
})
