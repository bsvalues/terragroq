import { describe, expect, it } from "vitest"

import * as laneMeasurement from "../scripts/runtime-operator/lane-measurement.mjs"

const {
  buildStaleBaselineInvalidation,
  classifyDispatchFailure,
  runMeasuredAttempt,
} = laneMeasurement
const observeSameRunAccelerator = (laneMeasurement as Record<string, unknown>).observeSameRunAccelerator as
  | ((options: Record<string, unknown>) => Promise<{ value: unknown; acceleratorEvidence: unknown }>)
  | undefined

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
  it("never blames the model for an orphaned provider worktree", () => {
    expect(classifyDispatchFailure("PROVIDER_WORKSPACE_RECONCILIATION_WALL")).toEqual({
      verdict: "BLOCKED_WORKSPACE_RECONCILIATION",
      aboutTheModel: false,
    })
  })

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

  const inspectedPatch = {
    changedPaths: ["scripts/runtime-operator/worker-lanes.mjs", "tests/runtime-operator-lane-verdict.test.ts"],
    patchBytes: 1_024,
  }
  const sameRunP40 = {
    runId: "measurement-run-1",
    startedAt: "2026-08-25T20:00:00.000Z",
    sampleStartedAt: "2026-08-25T20:00:09.000Z",
    sampleCompletedAt: "2026-08-25T20:00:10.000Z",
    completedAt: "2026-08-25T20:00:30.000Z",
    node: "HERMES",
    uuid: "GPU-P40-1",
    model: "Tesla P40",
    vramUsedMiB: 3_200,
    utilizationPercent: 67,
    processName: "D:\\HermesServices\\ollama\\v0.9.2\\ollama.exe",
    processVramMiB: 3_100,
  }
  const targetP40 = {
    node: "HERMES",
    uuid: "GPU-P40-1",
    processName: "D:\\HermesServices\\ollama\\v0.9.2\\ollama.exe",
  }

  it("cannot promote an admissible patch without running the requested validation", async () => {
    const recorded: Array<{ verdict: string; aboutTheModel: boolean; message: string }> = []
    const result = await runMeasuredAttempt({
      attempt: async () => ({
        inspected: inspectedPatch,
        patchWorkspace: "D:\\HermesWorkspaces\\owned",
        acceleratorEvidence: sameRunP40,
      }),
      measurementRunId: "measurement-run-1",
      targetAccelerator: targetP40,
      requiredValidation: ["diff-check", "test"],
      recordFailure: (failure) => { recorded.push(failure) },
    })

    expect(result).toEqual({ ok: false })
    expect(recorded).toEqual([{
      verdict: "BLOCKED_VALIDATION_REQUIRED",
      aboutTheModel: false,
      message: "VALIDATION_REQUIRED_WALL",
    }])
  })

  it("cannot promote a validated patch without same-run P40 residency and utilisation", async () => {
    const recorded: Array<{ verdict: string; aboutTheModel: boolean; message: string }> = []
    const result = await runMeasuredAttempt({
      attempt: async () => ({ inspected: inspectedPatch, patchWorkspace: "D:\\HermesWorkspaces\\owned" }),
      measurementRunId: "measurement-run-1",
      targetAccelerator: targetP40,
      requiredValidation: ["diff-check", "test"],
      validate: async () => undefined,
      recordFailure: (failure) => { recorded.push(failure) },
    })

    expect(result).toEqual({ ok: false })
    expect(recorded).toEqual([{
      verdict: "BLOCKED_ACCELERATOR_EVIDENCE",
      aboutTheModel: false,
      message: "ACCELERATOR_SAME_RUN_EVIDENCE_WALL",
    }])
  })

  it("refuses P40 evidence from another run or outside this run's observation window", async () => {
    for (const acceleratorEvidence of [
      { ...sameRunP40, runId: "prior-run" },
      { ...sameRunP40, sampleStartedAt: "2026-08-25T19:59:59.999Z" },
      { ...sameRunP40, sampleCompletedAt: "2026-08-25T20:00:30.001Z" },
      { ...sameRunP40, vramUsedMiB: 0 },
      { ...sameRunP40, utilizationPercent: 0 },
      { ...sameRunP40, uuid: "GPU-UNRELATED-P40" },
      { ...sameRunP40, processName: "C:\\unrelated-workload.exe" },
      { ...sameRunP40, processVramMiB: 0 },
    ]) {
      const result = await runMeasuredAttempt({
        attempt: async () => ({
          inspected: inspectedPatch,
          patchWorkspace: "D:\\HermesWorkspaces\\owned",
          acceleratorEvidence,
        }),
        measurementRunId: "measurement-run-1",
        targetAccelerator: targetP40,
        requiredValidation: ["diff-check", "test"],
        validate: async () => undefined,
        recordFailure: () => undefined,
      })
      expect(result).toEqual({ ok: false })
    }
  })

  it("promotes only after same-run P40 evidence and requested validation both pass", async () => {
    const calls: string[] = []
    const result = await runMeasuredAttempt({
      attempt: async () => {
        calls.push("collect")
        return {
          inspected: inspectedPatch,
          patchWorkspace: "D:\\HermesWorkspaces\\owned",
          acceleratorEvidence: sameRunP40,
        }
      },
      measurementRunId: "measurement-run-1",
      targetAccelerator: targetP40,
      requiredValidation: ["diff-check", "test"],
      validate: async ({ workspace, requiredValidation }) => {
        calls.push(`validate:${workspace}:${requiredValidation.join(",")}`)
      },
      recordFailure: () => undefined,
    })

    expect(calls).toEqual([
      "collect",
      "validate:D:\\HermesWorkspaces\\owned:diff-check,test",
    ])
    expect(result).toMatchObject({
      ok: true,
      value: {
        promotion: {
          verdict: "PROVEN",
          requiredValidation: ["diff-check", "test"],
          acceleratorEvidence: sameRunP40,
        },
      },
    })
  })

  it("requires both diff-check and test before promotion", async () => {
    for (const requiredValidation of [["test"], ["diff-check"]]) {
      const result = await runMeasuredAttempt({
        attempt: async () => ({
          inspected: inspectedPatch,
          patchWorkspace: "D:\\HermesWorkspaces\\owned",
          acceleratorEvidence: sameRunP40,
        }),
        measurementRunId: "measurement-run-1",
        targetAccelerator: targetP40,
        requiredValidation,
        validate: async () => undefined,
        recordFailure: () => undefined,
      })
      expect(result).toEqual({ ok: false })
    }
  })
})

describe("same-run accelerator observation", () => {
  it("binds residency and utilisation sampled while the actual invocation is pending", async () => {
    expect(observeSameRunAccelerator).toBeTypeOf("function")
    if (!observeSameRunAccelerator) return
    let finish: ((value: string) => void) | undefined
    let samples = 0
    const result = await observeSameRunAccelerator({
      runId: "measurement-run-1",
      node: "HERMES",
      targetAccelerator: {
        uuid: "GPU-P40-1",
        processName: "D:\\HermesServices\\ollama\\v0.9.2\\ollama.exe",
      },
      attempt: () => new Promise<string>((resolve) => { finish = resolve }),
      sampleAccelerators: async () => {
        samples += 1
        return [{
          uuid: "GPU-P40-1",
          model: "Tesla P40",
          vramUsedMiB: 3_200,
          utilizationPercent: samples === 1 ? 0 : 67,
          processName: "D:\\HermesServices\\ollama\\v0.9.2\\ollama.exe",
          processVramMiB: 3_100,
        }]
      },
      wait: async () => {
        if (samples >= 2) finish?.("invocation complete")
      },
      now: (() => {
        const times = [
          "2026-08-25T20:00:00.000Z",
          "2026-08-25T20:00:05.000Z",
          "2026-08-25T20:00:06.000Z",
          "2026-08-25T20:00:10.000Z",
          "2026-08-25T20:00:11.000Z",
          "2026-08-25T20:00:30.000Z",
        ]
        return () => times.shift() ?? "2026-08-25T20:00:30.000Z"
      })(),
    })

    expect(result.value).toBe("invocation complete")
    expect(result.acceleratorEvidence).toEqual({
      runId: "measurement-run-1",
      startedAt: "2026-08-25T20:00:00.000Z",
      sampleStartedAt: "2026-08-25T20:00:10.000Z",
      sampleCompletedAt: "2026-08-25T20:00:11.000Z",
      completedAt: "2026-08-25T20:00:30.000Z",
      node: "HERMES",
      uuid: "GPU-P40-1",
      model: "Tesla P40",
      vramUsedMiB: 3_200,
      utilizationPercent: 67,
      processName: "D:\\HermesServices\\ollama\\v0.9.2\\ollama.exe",
      processVramMiB: 3_100,
    })
  })

  it("starts the provider invocation before the first accelerator sample", async () => {
    expect(observeSameRunAccelerator).toBeTypeOf("function")
    if (!observeSameRunAccelerator) return
    const events: string[] = []
    await observeSameRunAccelerator({
      runId: "measurement-run-1",
      node: "HERMES",
      targetAccelerator: { uuid: "GPU-P40-1", processName: "ollama.exe" },
      attempt: () => { events.push("attempt-start"); return Promise.resolve("done") },
      sampleAccelerators: async () => { events.push("sample"); return [] },
      wait: async () => undefined,
    })
    expect(events[0]).toBe("attempt-start")
  })

  it("rejects a sample that returns after the provider invocation settles", async () => {
    expect(observeSameRunAccelerator).toBeTypeOf("function")
    if (!observeSameRunAccelerator) return
    let finish: ((value: string) => void) | undefined
    const result = await observeSameRunAccelerator({
      runId: "measurement-run-1",
      node: "HERMES",
      targetAccelerator: { uuid: "GPU-P40-1", processName: "ollama.exe" },
      attempt: () => new Promise<string>((resolve) => { finish = resolve }),
      sampleAccelerators: async () => {
        finish?.("done")
        await Promise.resolve()
        return [{
          uuid: "GPU-P40-1", model: "Tesla P40", vramUsedMiB: 3_200, utilizationPercent: 67,
          processName: "ollama.exe", processVramMiB: 3_100,
        }]
      },
      wait: async () => undefined,
    })
    expect(result.value).toBe("done")
    expect(result.acceleratorEvidence).toBeNull()
  })

  it("does not hang cleanup behind a sampler still pending when the invocation settles", async () => {
    expect(observeSameRunAccelerator).toBeTypeOf("function")
    if (!observeSameRunAccelerator) return
    let finish: ((value: string) => void) | undefined
    const result = await observeSameRunAccelerator({
      runId: "measurement-run-1",
      node: "HERMES",
      targetAccelerator: { uuid: "GPU-P40-1", processName: "ollama.exe" },
      attempt: () => new Promise<string>((resolve) => { finish = resolve }),
      sampleAccelerators: ({ signal }: { signal: AbortSignal }) => new Promise((_resolve, reject) => {
        signal.addEventListener("abort", () => reject(new Error("aborted")), { once: true })
        finish?.("done")
      }),
      wait: async () => undefined,
    })
    expect(result.value).toBe("done")
    expect(result.acceleratorEvidence).toBeNull()
  })
})

describe("false settled evidence has one governed invalidation", () => {
  const contaminatedRecord = {
    implementation: "MEASURED_INCAPABLE",
    measuredAt: "2026-08-25T17:12:33.397Z",
    evidence: "The lane produced no patch. Wall: PROVIDER_WORKSPACE_RECONCILIATION_WALL. The provider ran and returned without a usable change. Task: the bounded pure-helper task with tests. Model: williamos-qwen3-4b:64k (qwen3 4.0B, num_ctx 65536, temperature 0). Elapsed 0s.",
  }

  it("replaces only an incapable verdict proved to come from a missing baseline target", () => {
    expect(buildStaleBaselineInvalidation({
      currentRecord: contaminatedRecord,
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
      currentRecord: contaminatedRecord,
      baselineSha: "45f90fa59fe47e5f1aa505e9ec710ec2deb37a48",
      missingTargetPaths: [],
    })).toThrow("LANE_CAPABILITY_INVALIDATION_EVIDENCE_WALL")
  })

  it("cannot erase a later genuine incapable verdict", () => {
    expect(() => buildStaleBaselineInvalidation({
      currentRecord: { ...contaminatedRecord, measuredAt: "2026-08-25T18:00:00.000Z" },
      baselineSha: "45f90fa59fe47e5f1aa505e9ec710ec2deb37a48",
      missingTargetPaths: ["scripts/runtime-operator/worker-lanes.mjs"],
    })).toThrow("LANE_CAPABILITY_INVALIDATION_RECORD_MISMATCH_WALL")
    expect(() => buildStaleBaselineInvalidation({
      currentRecord: { ...contaminatedRecord, evidence: "A real later model run." },
      baselineSha: "45f90fa59fe47e5f1aa505e9ec710ec2deb37a48",
      missingTargetPaths: ["scripts/runtime-operator/worker-lanes.mjs"],
    })).toThrow("LANE_CAPABILITY_INVALIDATION_RECORD_MISMATCH_WALL")
  })
})
