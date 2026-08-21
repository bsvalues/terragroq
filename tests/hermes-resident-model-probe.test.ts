import { describe, expect, it } from "vitest"

import { validateAgainstTurnSchema } from "../scripts/hermes-bridge/hermes-kernel-output.mjs"
import { HERMES_TURN_OUTPUT_SCHEMA } from "../scripts/hermes-bridge/prompt.mjs"
import { buildProbePrompt, PROBE_BRANCH, PROBE_MARKER, PROBE_WORK_ORDER, runResidentModelProbe } from "../scripts/hermes-bridge/resident-model-probe.mjs"

describe("resident-model P2 probe driver", () => {
  it("asks for one reserved-path change and a schema-complete report", () => {
    const prompt = buildProbePrompt()
    expect(prompt).toContain(PROBE_WORK_ORDER)
    expect(prompt).toContain(PROBE_BRANCH)
    expect(prompt).toContain(PROBE_MARKER)
    expect(prompt).toContain("lib/workbench/thread-trust.ts")
    expect(prompt).toContain("Do not commit")
    // The report the prompt asks for is itself schema-complete.
    const expected = {
      result: "READY_FOR_VALIDATION", workOrder: PROBE_WORK_ORDER, branch: PROBE_BRANCH, commit: null, prUrl: null,
      merged: false, mergeCommit: null, validation: [], reviewThreads: 0, ownerTouchCount: 0, blockedScopeCrossed: false,
      nextState: "READY_FOR_VALIDATION", blockedAction: null, authorityBoundary: null, minimumChoice: null,
      approveConsequence: null, denyConsequence: null,
      findings: [],
    }
    expect(validateAgainstTurnSchema(expected, HERMES_TURN_OUTPUT_SCHEMA)).toEqual({ ok: true })
  })
  it("reports a lane wall as fatal instead of throwing", async () => {
    const summary = await runResidentModelProbe({
      workspacePath: process.cwd(), policyPath: "/definitely/missing/policy.json", runtimeRoot: process.cwd(),
      commandRunner: async () => ({ code: 0, stdout: "", stderr: "" }),
    })
    expect(summary.fatal).toMatchObject({ code: "RESIDENT_MODEL_LANE_POLICY_UNREADABLE" })
    expect(summary.finishedAt).toBeTypeOf("string")
  })
})
