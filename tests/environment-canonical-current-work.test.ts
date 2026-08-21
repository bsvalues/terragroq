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
    // in-progress (active) reads first; then suggested by queueOrder (0 before 1).
    expect(work.items.map((i) => i.outcomeKey)).toEqual(["o-active", "o-mid", "o-low"])
    // topStartable is the top SUGGESTED item (active is continuation, not START_WORK).
    expect(work.topStartable?.outcomeKey).toBe("o-mid")
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
    expect(work.topStartable?.outcomeKey).toBe("q1")
    expect(work.topStartable?.lifecycleState).toBe("suggested")
  })

  it("empty project has no items and no fabricated top", () => {
    const work = aggregateCurrentWork(project, [thread({ threadId: "t1" })])
    expect(work.items).toHaveLength(0)
    expect(work.topStartable).toBeNull()
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
    expect(work.items[0].latestEvidence[0].notes).toBe("latest")
    expect(work.items[0].latestEvidence.some((e) => e.notes === "other WO")).toBe(false)
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
      thread({ threadId: "t-xyz", outcomes: [{ outcomeKey: "outcome-42", outcomeTitle: "X", lifecycleState: "suggested", queueOrder: 0, activeWorkOrderId: 7, dependencyKeys: [] }], workOrders: [{ id: 7, ref: "WO-7", status: "active" }] }),
    ])
    expect(work.topStartable).toMatchObject({ projectId: 1, projectKey: "terrafusion", threadId: "t-xyz", outcomeKey: "outcome-42", activeWorkOrderId: 7 })
  })
})

import { composeCurrentWorkAnswer, startWorkSelection } from "@/lib/environment/canonical-current-work"

describe("composeCurrentWorkAnswer + startWorkSelection", () => {
  const project = PROJECTS[0]

  it("names the exact top item and the SAME item is what START_WORK selects (the invariant)", () => {
    const work = aggregateCurrentWork(project, [
      thread({ threadId: "t-x", threadTitle: "permit intake", outcomes: [
        { outcomeKey: "top", outcomeTitle: "Ship permit search", lifecycleState: "suggested", queueOrder: 0, activeWorkOrderId: 7, dependencyKeys: [] },
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

import { joinCanonicalWork, type JoinThread, type QueueSurfaceItem } from "@/lib/environment/canonical-current-work"

const surface = (items: QueueSurfaceItem[]) => new Map(items.map((i) => [i.outcomeKey, i]))
const q = (outcomeKey: string, over: Partial<QueueSurfaceItem> = {}): QueueSurfaceItem => ({
  outcomeKey, title: outcomeKey, queueOrder: 0, lifecycleState: "suggested", activeWorkOrderId: null, dependencyKeys: [], ...over,
})

describe("joinCanonicalWork enforces the join invariants", () => {
  it("joins bound outcomes to the queue surface, keeping queue order and lifecycle from the surface", () => {
    const threads: JoinThread[] = [{ threadId: "t1", threadTitle: "T1", loaded: true, boundOutcomeKeys: ["a", "b"] }]
    const r = joinCanonicalWork(
      threads,
      surface([q("a", { queueOrder: 5, lifecycleState: "active", activeWorkOrderId: 9 }), q("b", { queueOrder: 2 })]),
      new Map([[9, { id: 9, ref: "WO-9", status: "in progress" }]]),
      new Map([[9, [{ workOrderId: 9, result: "PASS", notes: "ev", createdAt: "2026-08-21T00:00:00Z" }]]]),
    )
    expect(r.conflicts).toEqual([])
    expect(r.unresolved).toEqual([])
    expect(r.threads[0].outcomes.map((o) => [o.outcomeKey, o.queueOrder, o.lifecycleState])).toEqual([["a", 5, "active"], ["b", 2, "suggested"]])
    expect(r.threads[0].workOrders).toEqual([{ id: 9, ref: "WO-9", status: "in progress" }])
    expect(r.threads[0].evidence[0].notes).toBe("ev")
  })

  it("reports an outcome bound to two threads as a conflict and excludes it — never silently chosen", () => {
    const threads: JoinThread[] = [
      { threadId: "t1", threadTitle: null, loaded: true, boundOutcomeKeys: ["dup"] },
      { threadId: "t2", threadTitle: null, loaded: true, boundOutcomeKeys: ["dup"] },
    ]
    const r = joinCanonicalWork(threads, surface([q("dup")]), new Map(), new Map())
    expect(r.conflicts).toEqual(["dup"])
    expect(r.threads.every((t) => t.outcomes.length === 0)).toBe(true)
  })

  it("reports a bound outcome missing from the surface as unresolved, never guessed", () => {
    const threads: JoinThread[] = [{ threadId: "t1", threadTitle: null, loaded: true, boundOutcomeKeys: ["ghost"] }]
    const r = joinCanonicalWork(threads, surface([]), new Map(), new Map())
    expect(r.unresolved).toEqual(["ghost"])
    expect(r.threads[0].outcomes).toEqual([])
  })

  it("preserves loaded=false for a thread that couldn't be read", () => {
    const threads: JoinThread[] = [{ threadId: "t1", threadTitle: null, loaded: false, boundOutcomeKeys: [] }]
    const r = joinCanonicalWork(threads, surface([]), new Map(), new Map())
    expect(r.threads[0].loaded).toBe(false)
  })

  it("the joined result flows through aggregate + compose, surfacing diagnostics", () => {
    const threads: JoinThread[] = [
      { threadId: "t1", threadTitle: null, loaded: true, boundOutcomeKeys: ["a", "dup"] },
      { threadId: "t2", threadTitle: null, loaded: true, boundOutcomeKeys: ["dup"] },
    ]
    const r = joinCanonicalWork(threads, surface([q("a", { lifecycleState: "active", queueOrder: 0 }), q("dup")]), new Map(), new Map())
    const work = aggregateCurrentWork(PROJECTS[0], r.threads)
    const said = composeCurrentWorkAnswer({ kind: "resolved", project: PROJECTS[0] }, work, { conflicts: r.conflicts, unresolved: r.unresolved })
    expect(said).toContain("bound to more than one thread")
    expect(said).toContain("dup")
  })
})

import { startWorkSelection as sel } from "@/lib/environment/canonical-current-work"

describe("review-hardened invariants (Codex #944)", () => {
  const project = PROJECTS[0]

  it("includes approved and blocked (non-terminal); excludes completed/declined/superseded", () => {
    const work = aggregateCurrentWork(project, [thread({ threadId: "t1", outcomes: [
      { outcomeKey: "ap", outcomeTitle: "Ap", lifecycleState: "approved", queueOrder: 0, activeWorkOrderId: null, dependencyKeys: [] },
      { outcomeKey: "bl", outcomeTitle: "Bl", lifecycleState: "blocked", queueOrder: 1, activeWorkOrderId: null, dependencyKeys: [] },
      { outcomeKey: "co", outcomeTitle: "Co", lifecycleState: "completed", queueOrder: 2, activeWorkOrderId: null, dependencyKeys: [] },
      { outcomeKey: "de", outcomeTitle: "De", lifecycleState: "declined", queueOrder: 3, activeWorkOrderId: null, dependencyKeys: [] },
    ] })])
    expect(work.items.map((i) => i.outcomeKey).sort()).toEqual(["ap", "bl"])
  })

  it("blocks the START_WORK selection when reads are incomplete, even if a startable exists", () => {
    const work = aggregateCurrentWork(project, [
      thread({ threadId: "ok", outcomes: [{ outcomeKey: "s", outcomeTitle: "S", lifecycleState: "suggested", queueOrder: 0, activeWorkOrderId: null, dependencyKeys: [] }] }),
      thread({ threadId: "bad", loaded: false }),
    ])
    expect(work.topStartable?.outcomeKey).toBe("s")   // display still names it
    expect(sel(work)).toBeNull()                       // but selection is blocked (unread thread may hold higher priority)
  })

  it("an active/approved/blocked outcome is not a START_WORK selection (continuation, not fresh start)", () => {
    const work = aggregateCurrentWork(project, [thread({ threadId: "t1", outcomes: [
      { outcomeKey: "a", outcomeTitle: "A", lifecycleState: "active", queueOrder: 0, activeWorkOrderId: 3, dependencyKeys: [] },
    ] })])
    expect(work.topStartable).toBeNull()
    expect(sel(work)).toBeNull()
    expect(composeCurrentWorkAnswer({ kind: "resolved", project }, work).toLowerCase()).toContain("already active")
  })

  it("project resolution is word-boundary, not substring: unregistered 'TerraFusionX' does not resolve", () => {
    expect(resolveProject("what are we doing on TerraFusionX", PROJECTS)).not.toMatchObject({ kind: "resolved" })
  })

  it("equal queue positions break ties deterministically by outcomeKey", () => {
    const work = aggregateCurrentWork(project, [thread({ threadId: "t1", outcomes: [
      { outcomeKey: "zeta", outcomeTitle: "Z", lifecycleState: "suggested", queueOrder: 5, activeWorkOrderId: null, dependencyKeys: [] },
      { outcomeKey: "alpha", outcomeTitle: "A", lifecycleState: "suggested", queueOrder: 5, activeWorkOrderId: null, dependencyKeys: [] },
    ] })])
    expect(work.items.map((i) => i.outcomeKey)).toEqual(["alpha", "zeta"])
  })
})
