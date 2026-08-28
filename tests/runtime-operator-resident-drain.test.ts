import { describe, expect, it, vi } from "vitest"

import { runResidentKernelDrain } from "@/scripts/runtime-operator/resident-kernel-drain.mjs"

describe("WilliamOS resident kernel drain", () => {
  it("continues immediately from a completed child into the next worker dispatch", async () => {
    const buildRegistry = vi.fn()
      .mockResolvedValueOnce({ schemaVersion: 1, workOrders: ["WO-A"] })
      .mockResolvedValueOnce({ schemaVersion: 1, workOrders: ["WO-A", "WO-B"] })
    const runCycle = vi.fn()
      .mockResolvedValueOnce({
        state: "COMPLETED",
        workOrderId: "WO-A",
        nextWorkOrderId: "WO-B",
        ownerDecisionRequired: false,
      })
      .mockResolvedValueOnce({
        state: "PR_OPEN",
        workOrderId: "WO-B",
        pr: 77,
        nextWorkOrderId: null,
        ownerDecisionRequired: false,
      })

    const result = await runResidentKernelDrain({
      root: "runtime-root",
      adapters: { buildRegistry },
      runCycle,
    })

    expect(result).toMatchObject({
      state: "PR_OPEN",
      workOrderId: "WO-B",
      pr: 77,
      residentCycles: 2,
      completedCount: 1,
      lastCompletedWorkOrderId: "WO-A",
    })
    expect(buildRegistry).toHaveBeenCalledTimes(2)
    expect(runCycle).toHaveBeenCalledTimes(2)
  })

  it("takes one final selection pass after completion so newly derived work can appear", async () => {
    const buildRegistry = vi.fn()
      .mockResolvedValueOnce({ schemaVersion: 1, workOrders: ["WO-A"] })
      .mockResolvedValueOnce({ schemaVersion: 1, workOrders: ["WO-A"] })
    const runCycle = vi.fn()
      .mockResolvedValueOnce({
        state: "COMPLETED",
        workOrderId: "WO-A",
        nextWorkOrderId: null,
        ownerDecisionRequired: false,
      })
      .mockResolvedValueOnce({
        state: "READY",
        workOrderId: null,
        nextWorkOrderId: null,
        ownerDecisionRequired: false,
      })

    const result = await runResidentKernelDrain({
      root: "runtime-root",
      adapters: { buildRegistry },
      runCycle,
    })

    expect(result).toMatchObject({
      state: "READY",
      workOrderId: null,
      residentCycles: 2,
      completedCount: 1,
      lastCompletedWorkOrderId: "WO-A",
    })
  })

  it("stops immediately at a real owner boundary", async () => {
    const buildRegistry = vi.fn().mockResolvedValue({ schemaVersion: 1, workOrders: ["WO-A"] })
    const runCycle = vi.fn().mockResolvedValue({
      state: "BLOCKED",
      workOrderId: "WO-A",
      ownerDecisionRequired: true,
    })

    const result = await runResidentKernelDrain({
      root: "runtime-root",
      adapters: { buildRegistry },
      runCycle,
    })

    expect(result).toMatchObject({ state: "BLOCKED", residentCycles: 1, completedCount: 0 })
    expect(runCycle).toHaveBeenCalledTimes(1)
  })

  it("does not spin through external wait states", async () => {
    for (const state of ["PR_OPEN", "WAITING_PROVIDER", "FAILED_RECOVERABLE", "FAILED_TERMINAL", "READY"]) {
      const buildRegistry = vi.fn().mockResolvedValue({ schemaVersion: 1, workOrders: [] })
      const runCycle = vi.fn().mockResolvedValue({ state, workOrderId: state === "READY" ? null : "WO-A" })

      const result = await runResidentKernelDrain({
        root: "runtime-root",
        adapters: { buildRegistry },
        runCycle,
      })

      expect(result.state).toBe(state)
      expect(result.residentCycles).toBe(1)
      expect(runCycle).toHaveBeenCalledTimes(1)
    }
  })

  it("fails closed if completed cycles never converge", async () => {
    const buildRegistry = vi.fn().mockResolvedValue({ schemaVersion: 1, workOrders: ["WO-A"] })
    const runCycle = vi.fn().mockResolvedValue({ state: "COMPLETED", workOrderId: "WO-A" })

    await expect(runResidentKernelDrain({
      root: "runtime-root",
      adapters: { buildRegistry },
      runCycle,
      maxCycles: 3,
    })).rejects.toThrow("RESIDENT_KERNEL_DRAIN_LIMIT_WALL")
    expect(runCycle).toHaveBeenCalledTimes(3)
  })
})
