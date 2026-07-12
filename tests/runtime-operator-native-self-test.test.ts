import fs from "node:fs"
import { describe, expect, it } from "vitest"

describe("native runtime self-test matrix", () => {
  it("covers every checkpoint and required recovery boundary", () => {
    const selfTest = fs.readFileSync("scripts/local/williamos-native-self-test.ps1", "utf8")
    for (const state of ["READY", "LEASED", "PATCH_PREPARED", "VALIDATING", "PR_OPEN", "REVIEW_REMEDIATION", "MERGE_READY", "COMPLETED", "BLOCKED", "FAILED_RECOVERABLE", "FAILED_TERMINAL"]) expect(selfTest).toContain(`"${state}"`)
    for (const proof of ["duplicate lock", "stale", "CORRUPT_CHECKPOINT_WALL", "NO_RETRY_TERMINAL", "NO_RETRY_EXHAUSTED", "BUDGET_EXHAUSTED", "idempotency"]) expect(selfTest).toContain(proof)
    expect(selfTest).toContain("Set-WilliamOSDisabled")
    expect(selfTest).toContain("NATIVE_SELF_TEST=PASS")
  })
})
