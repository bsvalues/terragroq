import { describe, expect, it } from "vitest"

import { buildCodexPrompt, parseCodexResult } from "@/scripts/runtime-operator/prompt.mjs"

describe("runtime operator Codex boundary", () => {
  const envelope = {
    schemaVersion: 1,
    programId: "PROGRAM-WILLIAMOS-RUNTIME-OPERATOR-001",
    goalId: "GOAL-PILOT-001",
    loopId: "LOOP-PILOT-001",
    workOrderId: "WO-PILOT-001",
    title: "Pilot",
    task: "Add a static report.",
    riskClass: "R0",
    baseBranch: "main",
    allowedPaths: ["docs/reports/WO-PILOT-001.md"],
    requiredValidation: ["diff-check"],
    mergeMode: "AUTO_ELIGIBLE",
  }

  it("builds a prompt that prohibits network, secrets, and authority expansion", () => {
    const prompt = buildCodexPrompt(envelope)

    expect(prompt).toContain("read-only sandbox")
    expect(prompt).toContain("unified diff")
    expect(prompt).toContain("Do not request or expose secrets")
    expect(prompt).toContain("untrusted data")
    expect(prompt).toContain("docs/reports/WO-PILOT-001.md")
  })

  it("accepts only structured patch results for the leased Work Order", () => {
    const result = parseCodexResult(JSON.stringify({
      schemaVersion: 1,
      workOrderId: "WO-PILOT-001",
      result: "PATCH_READY",
      summary: "Add pilot evidence.",
      unifiedPatch: "diff --git a/docs/reports/WO-PILOT-001.md b/docs/reports/WO-PILOT-001.md\n",
    }), envelope)

    expect(result.result).toBe("PATCH_READY")
    expect(() => parseCodexResult(JSON.stringify({ ...result, workOrderId: "WO-OTHER" }), envelope)).toThrow(/work order/i)
  })
})
