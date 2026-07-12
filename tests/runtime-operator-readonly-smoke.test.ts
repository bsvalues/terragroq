import fs from "node:fs"
import { describe, expect, it } from "vitest"

describe("owner-run authenticated read-only smoke", () => {
  it("requires disabled activation and accepts only schema-bound no-change", () => {
    const smoke = fs.readFileSync("scripts/local/williamos-codex-readonly-smoke.ps1", "utf8")
    expect(smoke).toContain("SMOKE_REQUIRES_DISABLED_ACTIVATION")
    expect(smoke).toContain('workOrderId -ne "WO-RUNTIME-IDENTITY-027"')
    expect(smoke).toContain('result -ne "NO_CHANGE"')
    expect(smoke).toContain("SMOKE_RESULT_WALL")
    expect(smoke).toContain("SMOKE_WORKSPACE_ACTIVE_WALL")
    expect(smoke).toContain("FileAttributes]::ReparsePoint")
    expect(smoke).toContain("Select-Object -First 1")
    expect(smoke).toContain("CODEX_READONLY_SMOKE=PASS")
    expect(smoke).not.toMatch(/git |gh |activation.*enabled/i)
  })
})
