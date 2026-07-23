import { readFileSync } from "node:fs"
import { describe, expect, it } from "vitest"

import { projectRuntimeExecutionQuery } from "@/components/runtime/runtime-execution-model"

describe("runtime execution panel contract", () => {
  it("renders persisted attempt, checkpoint, lease, failure, and evidence truth", () => {
    const panel = readFileSync("components/runtime/runtime-execution-panel.tsx", "utf8")
    for (const label of [
      "Runtime Execution",
      "Attempt / fence",
      "Checkpoint",
      "Lease status",
      "Failure eval",
      "Commit evidence",
    ]) {
      expect(panel).toContain(label)
    }
    expect(panel).toContain("persisted truth")
    expect(panel).toContain("separate from the host-live probe")
  })

  it("contains no runtime mutation or control affordance", () => {
    const panel = readFileSync("components/runtime/runtime-execution-panel.tsx", "utf8")
    expect(panel).not.toMatch(/<button|onClick=|startWorker|runCommand|cancelExecution/)
  })

  it("keeps empty runtime truth deterministic", () => {
    expect(projectRuntimeExecutionQuery([])).toEqual({
      executions: [],
      attempts: [],
      activeAttempts: [],
      terminalAttempts: [],
      completedAttempts: [],
      events: [],
    })
  })
})
