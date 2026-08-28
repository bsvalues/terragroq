export const RESIDENT_KERNEL_DRAIN_MAX_CYCLES = 100

/**
 * Keep the resident WilliamOS operator moving across a completed child boundary in the same
 * invocation. A scheduled wake should not report "resumed" and then exit while the next already-
 * authorized child is still waiting for its worker.
 *
 * runOperationalKernelCycle intentionally remains the authority/state machine. This wrapper only
 * repeats that existing cycle after COMPLETED, rebuilding state-derived registry truth each time.
 * It stops immediately on every other state (PR/review wait, provider wait, recovery backoff,
 * owner wall, idle queue, or failure), so it cannot invent work or spin through an external gate.
 */
export async function runResidentKernelDrain({
  root,
  adapters,
  runCycle,
  maxCycles = RESIDENT_KERNEL_DRAIN_MAX_CYCLES,
} = {}) {
  if (!adapters || typeof adapters.buildRegistry !== "function" || typeof runCycle !== "function") {
    throw new Error("RESIDENT_KERNEL_DRAIN_CONTRACT_WALL")
  }
  if (!Number.isSafeInteger(maxCycles) || maxCycles <= 0) {
    throw new Error("RESIDENT_KERNEL_DRAIN_CONTRACT_WALL")
  }

  let completedCount = 0
  let lastCompletedWorkOrderId = null

  for (let cycle = 1; cycle <= maxCycles; cycle += 1) {
    const registry = await adapters.buildRegistry()
    const result = await runCycle({ root, registry, adapters })
    if (!result || typeof result !== "object" || typeof result.state !== "string") {
      throw new Error("RESIDENT_KERNEL_DRAIN_RESULT_WALL")
    }

    const report = {
      ...result,
      residentCycles: cycle,
      completedCount,
      lastCompletedWorkOrderId,
    }

    if (result.ownerDecisionRequired === true) return report

    if (result.state === "COMPLETED") {
      completedCount += 1
      lastCompletedWorkOrderId = result.workOrderId ?? lastCompletedWorkOrderId
      continue
    }

    return {
      ...result,
      residentCycles: cycle,
      completedCount,
      lastCompletedWorkOrderId,
    }
  }

  throw new Error("RESIDENT_KERNEL_DRAIN_LIMIT_WALL")
}
