import { describe, expect, it } from "vitest"

import { deriveAndQueueFindings } from "../scripts/runtime-operator/operational-kernel.mjs"

/**
 * The fifth P1: `deriveRemediationWorkOrder` had no production caller. The kernel could reason about a
 * proposed action for an entire release and never invoke that reasoning, so every finding still ended at
 * a message to the owner. **Reasoning nobody invokes is not a control plane.**
 *
 * These cases exercise the reflex itself — findings in, queued work out — with fake adapters, because
 * what has to be proven is that the kernel calls it at all and does the right thing with both outcomes.
 */
const OBJECTIVE = {
  workOrderId: "WO-0031",
  grantRef: "GRANT-0018",
  grantStatus: "active",
  authority: "APPROVED",
  adapterId: "williamos-resident-v1",
  allowedPaths: ["scripts/runtime-operator/**", "config/execution-fabric/**"],
  requiredValidation: ["test", "build"],
  agent: "codex",
}

function adaptersFor(findings: unknown[]) {
  const persisted: { workOrderId: string; grantRef: string }[] = []
  const gates: { gate?: string; finding?: string }[] = []
  return {
    persisted,
    gates,
    adapters: {
      collectFindings: async () => findings,
      persistDerivedWorkOrder: async (order: { workOrderId: string; grantRef: string }) => {
        persisted.push(order)
      },
      recordOwnerGate: async (entry: { gate?: string; finding?: string }) => {
        gates.push(entry)
      },
    },
  }
}

const registry = { workOrders: [OBJECTIVE] }

describe("a finding during an active objective enters derivation automatically", () => {
  it("queues the derived work without anyone being asked", async () => {
    const { adapters, persisted } = adaptersFor([
      {
        objectiveWorkOrderId: "WO-0031",
        sequence: 1,
        summary: "reconcile compose with the running container",
        paths: ["scripts/runtime-operator/williamos-adapters.mjs"],
        effects: { destroys: [] },
      },
    ])
    const result = await deriveAndQueueFindings({ registry, adapters })
    expect(result.queued).toEqual(["WO-0031-R01"])
    // Persisted, not merely returned: the next selection reads the queue, not an in-memory array.
    expect(persisted).toHaveLength(1)
    expect(persisted[0].grantRef).toBe("GRANT-0018")
  })

  it("ignores findings belonging to a different objective", async () => {
    const { adapters, persisted } = adaptersFor([
      { objectiveWorkOrderId: "WO-OTHER", summary: "not mine", paths: ["scripts/runtime-operator/a.mjs"], effects: {} },
    ])
    const result = await deriveAndQueueFindings({ registry, adapters })
    expect(result.queued).toEqual([])
    expect(persisted).toEqual([])
  })
})

describe("a gated finding stops at its gate and stops nothing else", () => {
  it("queues the ungated findings and records the gate separately", async () => {
    // #911's exact shape. Item 3 is the owner's decision; items 1 and 2 are not, and must not wait.
    const { adapters, persisted, gates } = adaptersFor([
      { objectiveWorkOrderId: "WO-0031", sequence: 1, summary: "reconcile compose", paths: ["scripts/runtime-operator/a.mjs"], effects: {} },
      {
        objectiveWorkOrderId: "WO-0031",
        sequence: 2,
        summary: "repin service paths",
        paths: ["config/execution-fabric/p.json"],
        effects: { changesReviewedPolicy: true },
      },
      { objectiveWorkOrderId: "WO-0031", sequence: 3, summary: "investigate williamos-sea", paths: ["scripts/runtime-operator/b.mjs"], effects: {} },
    ])
    const result = await deriveAndQueueFindings({ registry, adapters })
    expect(result.queued).toEqual(["WO-0031-R01", "WO-0031-R03"])
    expect(persisted.map((order) => order.workOrderId)).toEqual(["WO-0031-R01", "WO-0031-R03"])
    expect(gates).toHaveLength(1)
    expect(gates[0]).toMatchObject({ finding: "repin service paths", gate: "POLICY" })
  })

  it("queues nothing from a finding that cannot describe its effects", async () => {
    const { adapters, persisted, gates } = adaptersFor([
      { objectiveWorkOrderId: "WO-0031", summary: "unstated", paths: ["scripts/runtime-operator/a.mjs"] },
    ])
    const result = await deriveAndQueueFindings({ registry, adapters })
    expect(result.queued).toEqual([])
    expect(persisted).toEqual([])
    expect(gates[0]?.unclassifiable).toBe(true)
  })

  it("queues nothing when the parent grant is no longer active", async () => {
    const revoked = { workOrders: [{ ...OBJECTIVE, grantStatus: "revoked" }] }
    const { adapters, persisted } = adaptersFor([
      { objectiveWorkOrderId: "WO-0031", summary: "fix", paths: ["scripts/runtime-operator/a.mjs"], effects: {} },
    ])
    const result = await deriveAndQueueFindings({ registry: revoked, adapters })
    expect(result.queued).toEqual([])
    expect(persisted).toEqual([])
  })
})

describe("an adapter set that cannot collect findings", () => {
  it("does nothing rather than failing the cycle", async () => {
    // Older adapter sets predate this reflex. They must keep working, and must not silently appear to
    // have drained findings they never had.
    const result = await deriveAndQueueFindings({ registry, adapters: {} })
    expect(result).toEqual({ queued: [], gated: [] })
  })

  it("tolerates a collector that returns nothing", async () => {
    const result = await deriveAndQueueFindings({
      registry,
      adapters: { collectFindings: async () => null, persistDerivedWorkOrder: async () => undefined },
    })
    expect(result.queued).toEqual([])
  })
})
