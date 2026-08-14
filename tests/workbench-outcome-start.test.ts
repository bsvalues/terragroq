import { describe, expect, it } from "vitest"

import {
  buildOutcomeStartRequestHash,
  buildOutcomeStartResultDigest,
  normalizeOutcomeStartInput,
} from "@/lib/workbench/outcome-start"

describe("Workbench outcome start contract", () => {
  it("normalizes a bounded explicit Project intent and stable key", () => {
    expect(normalizeOutcomeStartInput({
      projectId: 7,
      intent: "  Deliver a useful cockpit outcome  ",
      idempotencyKey: "workbench-outcome:stable-0001",
    })).toEqual({
      projectId: 7,
      intent: "Deliver a useful cockpit outcome",
      idempotencyKey: "workbench-outcome:stable-0001",
    })
  })

  it.each([
    { projectId: 0, intent: "Deliver", idempotencyKey: "workbench-outcome:stable-0001" },
    { projectId: 7, intent: " ", idempotencyKey: "workbench-outcome:stable-0001" },
    { projectId: 7, intent: "x".repeat(2_001), idempotencyKey: "workbench-outcome:stable-0001" },
    { projectId: 7, intent: "Deliver", idempotencyKey: "short" },
  ])("rejects invalid start input without normalization inference", (value) => {
    expect(() => normalizeOutcomeStartInput(value)).toThrow("WORKBENCH_OUTCOME_START_INPUT_INVALID")
  })

  it("binds request identity to contract version, Project, intent, and key", () => {
    const base = { projectId: 7, intent: "Deliver", idempotencyKey: "workbench-outcome:stable-0001" }
    const digest = buildOutcomeStartRequestHash(base)

    expect(buildOutcomeStartRequestHash(base)).toBe(digest)
    expect(buildOutcomeStartRequestHash({ ...base, projectId: 8 })).not.toBe(digest)
    expect(buildOutcomeStartRequestHash({ ...base, intent: "Different" })).not.toBe(digest)
    expect(buildOutcomeStartRequestHash({ ...base, idempotencyKey: "workbench-outcome:stable-0002" })).not.toBe(digest)
  })

  it("binds accepted results to the exact Thread and canonical outcome root", () => {
    const requestHash = buildOutcomeStartRequestHash({
      projectId: 7,
      intent: "Deliver",
      idempotencyKey: "workbench-outcome:stable-0001",
    })
    const base = {
      requestHash,
      goalId: 41,
      outcomeKey: "goal:GOAL-0041",
      threadId: "thread-opaque",
      rootSourceType: "outcome" as const,
      rootSourceId: "goal:GOAL-0041",
    }

    const digest = buildOutcomeStartResultDigest(base)
    expect(buildOutcomeStartResultDigest(base)).toBe(digest)
    expect(buildOutcomeStartResultDigest({ ...base, threadId: "other" })).not.toBe(digest)
    expect(buildOutcomeStartResultDigest({ ...base, rootSourceId: "forged" })).not.toBe(digest)
  })
})
