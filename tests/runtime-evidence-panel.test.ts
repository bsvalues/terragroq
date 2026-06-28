import { describe, expect, it } from "vitest"
import {
  summarizeRuntimeEvidence,
  type RuntimeEvidence,
} from "@/components/runtime/runtime-evidence"

function record(overrides: Partial<RuntimeEvidence>): RuntimeEvidence {
  return {
    ref: "EV-0001",
    result: "PASS",
    branch: "codex/example",
    head: "1234567890abcdef",
    filesChanged: ["app/example.tsx"],
    validators: ["npm test -- --run"],
    nextValidMove: "merge when checks pass",
    createdAt: new Date("2026-06-28T00:00:00.000Z"),
    ...overrides,
  }
}

describe("runtime evidence panel summary", () => {
  it("summarizes recent evidence without mutating runtime state", () => {
    const summary = summarizeRuntimeEvidence([
      record({ ref: "EV-0003", result: "PASS", validators: ["vitest", "next build"] }),
      record({ ref: "EV-0002", result: "PARTIAL", filesChanged: ["a.ts", "b.ts"] }),
      record({ ref: "EV-0001", result: "FAIL", validators: [] }),
    ])

    expect(summary.total).toBe(3)
    expect(summary.latest?.ref).toBe("EV-0003")
    expect(summary.passCount).toBe(1)
    expect(summary.partialCount).toBe(1)
    expect(summary.failCount).toBe(1)
    expect(summary.validatorCount).toBe(3)
    expect(summary.changedFileCount).toBe(4)
  })

  it("keeps empty evidence history explicit", () => {
    const summary = summarizeRuntimeEvidence([])

    expect(summary.total).toBe(0)
    expect(summary.latest).toBeUndefined()
    expect(summary.passCount).toBe(0)
    expect(summary.validatorCount).toBe(0)
    expect(summary.changedFileCount).toBe(0)
  })
})
