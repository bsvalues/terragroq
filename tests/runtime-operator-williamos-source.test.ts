import { describe, expect, it } from "vitest"

import {
  buildRegistryRecords,
  linkGrant,
  parseProjectionIssue,
  queueStateFor,
} from "../scripts/runtime-operator/williamos-adapters.mjs"
import { selectEligibleWorkOrder } from "../scripts/runtime-operator/operational-kernel.mjs"

const workOrder = (over: Record<string, unknown> = {}) => ({
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
  ref: "GRANT-0012",
  scope: "#890",
  allowedActions: ["implement"],
  ...over,
})

describe("projection parsing", () => {
  it("reads the projected GitHub issue out of the objective text", () => {
    expect(parseProjectionIssue(workOrder().description as string)).toBe(890)
    expect(parseProjectionIssue("see #891 for the composer")).toBe(891)
  })

  it("returns null rather than inventing a projection", () => {
    expect(parseProjectionIssue("no projection named here")).toBeNull()
    expect(parseProjectionIssue(undefined as never)).toBeNull()
  })
})

describe("linking an owner grant", () => {
  it("links when the work order names the grant ref", () => {
    expect(linkGrant(workOrder(), [grant()])?.ref).toBe("GRANT-0012")
  })

  it("links when the grant scope names the work order", () => {
    const scoped = grant({ ref: "GRANT-0099", scope: "WO-0026" })
    expect(linkGrant(workOrder({ description: "no refs named" }), [scoped])?.ref).toBe("GRANT-0099")
  })

  it("requires the implement action, not merely any grant", () => {
    expect(linkGrant(workOrder(), [grant({ allowedActions: ["relocate-source"] })])).toBeNull()
  })
})

describe("building the registry from state", () => {
  it("produces an eligible record the kernel accepts and selects", () => {
    const records = buildRegistryRecords([workOrder()], [grant()], "williamos-resident-v1")
    expect(records).toHaveLength(1)
    expect(records[0]).toMatchObject({
      workOrderId: "WO-0026",
      authority: "APPROVED",
      mergeMode: "AUTO_ELIGIBLE",
      grantRef: "GRANT-0012",
      agent: "codex",
    })

    // The kernel's own selector, fed the derived registry: the whole point of deriving it.
    const registry = { schemaVersion: 1, repository: "bsvalues/terragroq", workOrders: records }
    const queue = [{ issueNumber: 890, workOrderId: "WO-0026", state: "READY", createdAt: "2026-08-19T00:00:00Z" }]
    const selected = selectEligibleWorkOrder(registry, queue)
    expect(selected?.authority.workOrderId).toBe("WO-0026")
  })

  it("omits a work order with no linked grant, rather than fabricating authority", () => {
    expect(buildRegistryRecords([workOrder()], [], "a")).toHaveLength(0)
  })

  it("omits a work order with no reservation or no validation plan", () => {
    expect(buildRegistryRecords([workOrder({ allowedFiles: [] })], [grant()], "a")).toHaveLength(0)
    expect(buildRegistryRecords([workOrder({ validators: [] })], [grant()], "a")).toHaveLength(0)
  })

  it("omits a work order with no projection issue, which publish would need", () => {
    expect(buildRegistryRecords([workOrder({ description: "GRANT-0012 but no projection" })], [grant()], "a")).toHaveLength(0)
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
