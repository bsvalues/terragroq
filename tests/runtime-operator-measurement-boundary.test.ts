import { describe, expect, it } from "vitest"

import {
  buildStaleBaselineInvalidation,
  classifyDispatchFailure,
  runMeasuredAttempt,
} from "../scripts/runtime-operator/lane-measurement.mjs"

/**
 * The first capability measurement of `hermes-local` nearly recorded two false verdicts, and each was
 * the same mistake: blaming the model for a failure outside the model boundary.
 *
 *   PROCESS_WALL:pwsh   the invoker crashed because the `ollama` container sat on the default bridge
 *                       network instead of `hermes_default`, so the inference proxy could not resolve
 *                       its upstream. The model was never asked a question.
 *   PATCH_EMPTY_WALL    the model had written a correct function, and collection looked for it with
 *                       `git diff --cached` in a tree where the change was unstaged.
 *
 * Both are first-class regression cases now. A contaminated verdict is worse than no verdict, because
 * the next model comparison inherits it and starts from a lie.
 */
describe("what a failed dispatch is allowed to mean", () => {
  it("never blames the model for a crashed invoker", () => {
    const result = classifyDispatchFailure("PROCESS_WALL:pwsh")
    expect(result.verdict).toBe("BLOCKED_INVOKER_PROCESS_FAILED")
    expect(result.aboutTheModel).toBe(false)
  })

  it("never blames the model for a provider boundary, and names which one", () => {
    for (const [wall, expected] of [
      ["PROVIDER_LANE_VOLUME_WALL:D:", "BLOCKED_VOLUME_WALL"],
      ["PROVIDER_LANE_INVOKER_WALL", "BLOCKED_INVOKER_WALL"],
      ["PROVIDER_LANE_COMPLETION_WALL", "BLOCKED_COMPLETION_WALL"],
      ["PROVIDER_LANE_POLICY_WALL", "BLOCKED_POLICY_WALL"],
    ] as const) {
      const result = classifyDispatchFailure(wall)
      expect(result.verdict).toBe(expected)
      expect(result.aboutTheModel).toBe(false)
    }
  })

  it("never blames the model for our own empty collection", () => {
    // The measurement read an unstaged worktree and called the lane incapable. That is a defect in the
    // instrument, and it must not be spendable as evidence about a model.
    const result = classifyDispatchFailure("PATCH_EMPTY_WALL")
    expect(result.verdict).toBe("BLOCKED_PATCH_COLLECTION")
    expect(result.aboutTheModel).toBe(false)
  })

  it("never blames the model when the collection process itself fails", () => {
    const result = classifyDispatchFailure("PATCH_COLLECTION_WALL")
    expect(result.verdict).toBe("BLOCKED_PATCH_COLLECTION")
    expect(result.aboutTheModel).toBe(false)
  })

  it("names a task target absent from the requested base as baseline drift", () => {
    const result = classifyDispatchFailure(
      "TASK_BASELINE_DRIFT_WALL:scripts/runtime-operator/worker-lanes.mjs",
    )
    expect(result.verdict).toBe("BLOCKED_TASK_BASELINE_DRIFT")
    expect(result.aboutTheModel).toBe(false)
  })

  it("does call it incapable when the provider ran and returned nothing usable", () => {
    const result = classifyDispatchFailure("CODEX_PATCH_REQUIRED_WALL")
    expect(result.verdict).toBe("MEASURED_INCAPABLE")
    expect(result.aboutTheModel).toBe(true)
  })

  it("treats an unrecognised failure as a claim about the model only when nothing else explains it", () => {
    expect(classifyDispatchFailure("SOMETHING_NOBODY_ENUMERATED").aboutTheModel).toBe(true)
    expect(classifyDispatchFailure("").aboutTheModel).toBe(true)
    expect(classifyDispatchFailure(undefined).verdict).toBe("MEASURED_INCAPABLE")
  })

  it("does not mistake a wall that merely mentions a boundary for one", () => {
    // Matching must be anchored: a model that echoes "PROCESS_WALL" inside its own output must not be
    // able to talk its way out of an incapable verdict.
    const result = classifyDispatchFailure("the model wrote about PROCESS_WALL:pwsh in a comment")
    expect(result.verdict).toBe("MEASURED_INCAPABLE")
    expect(result.aboutTheModel).toBe(true)
  })
})

describe("the measurement attempt has one total failure boundary", () => {
  it("records PATCH_EMPTY_WALL when collection fails after a successful dispatch", async () => {
    const recorded: Array<{ verdict: string; aboutTheModel: boolean; message: string }> = []
    const result = await runMeasuredAttempt({
      attempt: async () => {
        const workspace = "D:\\HermesWorkspaces\\owned"
        await Promise.resolve(workspace)
        throw new Error("PATCH_EMPTY_WALL")
      },
      recordFailure: (failure) => { recorded.push(failure) },
    })

    expect(result).toEqual({ ok: false })
    expect(recorded).toEqual([{
      verdict: "BLOCKED_PATCH_COLLECTION",
      aboutTheModel: false,
      message: "PATCH_EMPTY_WALL",
    }])
  })
})

describe("false settled evidence has one governed invalidation", () => {
  it("replaces only an incapable verdict proved to come from a missing baseline target", () => {
    expect(buildStaleBaselineInvalidation({
      currentRecord: { implementation: "MEASURED_INCAPABLE", evidence: "stale run" },
      baselineSha: "45f90fa59fe47e5f1aa505e9ec710ec2deb37a48",
      missingTargetPaths: ["scripts/runtime-operator/worker-lanes.mjs"],
    })).toEqual({
      verdict: "BLOCKED_TASK_BASELINE_DRIFT",
      aboutTheModel: false,
      evidence: "Invalidated false MEASURED_INCAPABLE evidence: task target scripts/runtime-operator/worker-lanes.mjs is absent at pinned baseline 45f90fa59fe47e5f1aa505e9ec710ec2deb37a48. No model was dispatched.",
    })
  })

  it("cannot overwrite another state or invalidate without the proven precondition", () => {
    expect(() => buildStaleBaselineInvalidation({
      currentRecord: { implementation: "PROVEN", evidence: "real proof" },
      baselineSha: "45f90fa59fe47e5f1aa505e9ec710ec2deb37a48",
      missingTargetPaths: ["scripts/runtime-operator/worker-lanes.mjs"],
    })).toThrow("LANE_CAPABILITY_INVALIDATION_STATE_WALL")
    expect(() => buildStaleBaselineInvalidation({
      currentRecord: { implementation: "MEASURED_INCAPABLE", evidence: "stale run" },
      baselineSha: "45f90fa59fe47e5f1aa505e9ec710ec2deb37a48",
      missingTargetPaths: [],
    })).toThrow("LANE_CAPABILITY_INVALIDATION_EVIDENCE_WALL")
  })
})
