import { describe, expect, it } from "vitest"

import {
  activateEnvironmentPreview,
  buildRegistryRecords,
  linkGrant,
  parseProjectionIssue,
  projectionCompletionOwned,
  projectionIssueDirective,
  queueStateFor,
  recordStartingEnvironmentPreview,
} from "../scripts/runtime-operator/williamos-adapters.mjs"
import { selectEligibleWorkOrder } from "../scripts/runtime-operator/operational-kernel.mjs"

const workOrder = (over: Record<string, unknown> = {}) => ({
  id: 26,
  userId: "owner-1",
  authorityGrantId: 12,
  ref: "WO-0026",
  title: "Make a work_order-rooted Workbench Thread load its existing content.",
  description:
    "Make a work_order-rooted Workbench Thread load its existing content. Authorized under GRANT-0012, Codex lane, frozen acceptance projected at GitHub issue 890.",
  status: "draft",
  lane: "operator-objective",
  agent: "codex",
  allowedFiles: ["lib/workbench/load-threads.ts", "tests/**"],
  validators: ["test", "build"],
  createdAt: new Date("2026-08-19T00:00:00Z"),
  ...over,
})

const grant = (over: Record<string, unknown> = {}) => ({
  id: 12,
  workOrderId: 26,
  ref: "GRANT-0012",
  scope: "#890",
  allowedActions: ["implement"],
  ...over,
})

describe("projection parsing", () => {
  it("reads the projected GitHub issue out of the objective text", () => {
    expect(parseProjectionIssue(workOrder().description as string)).toBe(890)
    // This case used to expect 891, which codified the defect: a bare issue reference in prose counted
    // as a projection, so WO-0029 -- which cited #871 as prior art before naming its own #891 -- was
    // delivered against #871 and left #891 open. A mention is not a projection.
    expect(parseProjectionIssue("see #891 for the composer")).toBeNull()
  })

  it("returns null rather than inventing a projection", () => {
    expect(parseProjectionIssue("no projection named here")).toBeNull()
    expect(parseProjectionIssue(undefined as never)).toBeNull()
  })
})

describe("linking an owner grant", () => {
  it("links only through the exact Work Order foreign keys", () => {
    expect(linkGrant(workOrder(), [grant()])?.ref).toBe("GRANT-0012")
  })

  it("does not treat description or scope text as authority linkage", () => {
    const scoped = grant({ id: 99, ref: "GRANT-0099", scope: "WO-0026" })
    expect(linkGrant(workOrder({ description: "GRANT-0099" }), [scoped])).toBeNull()
  })

  it("requires the implement action, not merely any grant", () => {
    expect(linkGrant(workOrder(), [grant({ allowedActions: ["relocate-source"] })])).toBeNull()
  })

  it("marks derived projections as parent-owned and never emits an auto-close directive", () => {
    const description = "Projection: #911. Projection completion: parent-owned."
    expect(projectionCompletionOwned(description)).toBe(false)
    expect(projectionIssueDirective(911, false)).toBe("Tracks #911; completion remains owned by the parent outcome.")
    expect(projectionIssueDirective(912, true)).toBe("Closes #912.")
  })

  it("prefers the stored grant id over grant-like text in the work description", () => {
    const linked = linkGrant(
      workOrder({ authorityGrantId: 18, description: "Authorized under GRANT-ATTACK. Projected at GitHub issue 912." }),
      [
        grant({ id: 17, ref: "GRANT-ATTACK" }),
        grant({ id: 18, ref: "GRANT-0018", scope: "WO-0031" }),
      ],
    )
    expect(linked?.ref).toBe("GRANT-0018")
  })
})

describe("building the registry from state", () => {
  it("produces an eligible record the kernel accepts and selects", () => {
    const records = buildRegistryRecords([workOrder()], [grant()], "williamos-resident-v1")
    expect(records).toHaveLength(1)
    expect(records[0]).toMatchObject({
      workOrderId: "WO-0026",
      workOrderRowId: 26,
      userId: "owner-1",
      authority: "APPROVED",
      mergeMode: "AUTO_ELIGIBLE",
      grantRef: "GRANT-0012",
      agent: "codex",
    })

    // The kernel's own selector, fed the derived registry: the whole point of deriving it.
    const registry = { schemaVersion: 1, repository: "bsvalues/terragroq", workOrders: records }
    const queue = [{ issueNumber: 890, workOrderId: "WO-0026", workOrderRowId: 26, userId: "owner-1", state: "READY", createdAt: "2026-08-19T00:00:00Z" }]
    const selected = selectEligibleWorkOrder(registry, queue)
    expect(selected?.authority.workOrderId).toBe("WO-0026")
  })

  it("selects by stable row identity when human refs collide", () => {
    const records = buildRegistryRecords(
      [workOrder({ id: 26, userId: "owner-1" }), workOrder({ id: 99, userId: "owner-2", authorityGrantId: 99 })],
      [grant(), grant({ id: 99, userId: "owner-2", workOrderId: 99 })],
      "williamos-resident-v1",
    )
    const registry = { schemaVersion: 1, repository: "bsvalues/terragroq", workOrders: records }
    const queue = [{
      issueNumber: 890,
      workOrderId: "WO-0026",
      workOrderRowId: 99,
      userId: "owner-2",
      state: "READY",
      createdAt: "2026-08-19T00:00:00Z",
    }]

    expect(selectEligibleWorkOrder(registry, queue)?.authority).toMatchObject({
      workOrderRowId: 99,
      userId: "owner-2",
    })
  })

  it("does not let a completed colliding ref suppress a different ready row", () => {
    const records = buildRegistryRecords(
      [workOrder({ id: 26, userId: "owner-1" }), workOrder({ id: 99, userId: "owner-2", authorityGrantId: 99 })],
      [grant(), grant({ id: 99, userId: "owner-2", workOrderId: 99 })],
      "williamos-resident-v1",
    )
    const registry = { schemaVersion: 1, repository: "bsvalues/terragroq", workOrders: records }
    const queue = [
      { issueNumber: 890, workOrderId: "WO-0026", workOrderRowId: 26, userId: "owner-1", state: "COMPLETED", createdAt: "2026-08-19T00:00:00Z" },
      { issueNumber: 891, workOrderId: "WO-0026", workOrderRowId: 99, userId: "owner-2", state: "READY", createdAt: "2026-08-19T01:00:00Z" },
    ]

    expect(selectEligibleWorkOrder(registry, queue)?.authority).toMatchObject({ workOrderRowId: 99, userId: "owner-2" })
  })

  it("omits a work order with no linked grant, rather than fabricating authority", () => {
    expect(buildRegistryRecords([workOrder()], [], "a")).toHaveLength(0)
  })

  it("omits a work order with no reservation or no validation plan", () => {
    expect(buildRegistryRecords([workOrder({ allowedFiles: [] })], [grant()], "a")).toHaveLength(0)
    expect(buildRegistryRecords([workOrder({ validators: [] })], [grant()], "a")).toHaveLength(0)
  })

  it("omits a work order with neither a GitHub projection nor an exact Environment world binding", () => {
    expect(buildRegistryRecords([workOrder({ description: "GRANT-0012 but no projection" })], [grant()], "a")).toHaveLength(0)
  })

  it("accepts an exact Environment world binding without inventing a GitHub issue dependency", () => {
    const records = buildRegistryRecords([
      workOrder({ description: "GRANT-0012 [environment-world:world-42] [resource:repo:a]" }),
    ], [grant()], "a")
    expect(records).toHaveLength(1)
    expect(records[0]).toMatchObject({
      workOrderId: "WO-0026", grantRef: "GRANT-0012", environmentWorldId: "world-42",
    })
  })

  it("drops validators outside the kernel's allowed set instead of passing them through", () => {
    const records = buildRegistryRecords([workOrder({ validators: ["test", "rm -rf"] })], [grant()], "a")
    expect(records[0].requiredValidation).toEqual(["test"])
  })
})

describe("queue state mapping", () => {
  it("maps completion, lease and readiness", () => {
    expect(queueStateFor("completed")).toBe("COMPLETED")
    expect(queueStateFor("active")).toBe("LEASED")
    expect(queueStateFor("draft")).toBe("READY")
    expect(queueStateFor("approved")).toBe("READY")
  })
})

describe("Environment preview lifecycle state", () => {
  const oldHead = {
    worldId: "world-42", head: "old-head", port: 4101, pid: 111,
    workspace: "/work/old", logPath: "/logs/old", startedAt: "2026-08-20T19:00:00.000Z", status: "ready",
  }
  const nextHead = {
    worldId: "world-42", head: "new-head", port: 4102, pid: 222,
    workspace: "/work/new", logPath: "/logs/new", startedAt: "2026-08-20T19:00:01.000Z",
  }

  it("records a detached child before a slow startup can cross the polling deadline", () => {
    const state = recordStartingEnvironmentPreview({ endpoints: [oldHead] }, nextHead)

    expect(state.endpoints).toEqual([oldHead, { ...nextHead, status: "starting" }])
  })

  it("retains the superseded process handle until activation explicitly cleans it up", () => {
    const starting = recordStartingEnvironmentPreview({ endpoints: [oldHead] }, nextHead)
    const activation = activateEnvironmentPreview(starting, nextHead)

    expect(activation.retired).toEqual([oldHead])
    expect(activation.state.endpoints).toEqual([{ ...nextHead, status: "ready" }])
  })
})
