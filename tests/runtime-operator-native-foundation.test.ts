import fs from "node:fs"
import { describe, expect, it } from "vitest"

describe("native supervisor foundation", () => {
  const module = fs.readFileSync("runtime-operator/native/WilliamOS.RuntimeOperator.psm1", "utf8")
  const supervisor = fs.readFileSync("scripts/local/williamos-native-supervisor.ps1", "utf8")

  it("enforces the directory, ACL, and reparse boundary", () => {
    for (const child of ["control", "state", "audit", "workspace", "locks"]) expect(module).toContain(`"${child}"`)
    expect(module).toContain("RUNTIME_ROOT_REPARSE_WALL")
    expect(module).toContain("RUNTIME_ROOT_PERMISSIVE_ACL_WALL")
    expect(module).not.toContain('"secrets"')
  })

  it("is disabled-first with bounded retry and a single-instance lock", () => {
    expect(supervisor.indexOf("Get-WilliamOSActivation")).toBeLessThan(supervisor.indexOf("williamos-auth-readiness"))
    expect(supervisor).toContain("NATIVE_RUNTIME_STATUS=DISABLED")
    expect(supervisor).toContain("MaxRetrySeconds")
    expect(module).toContain("FileMode]::CreateNew")
    expect(module).toContain("ACTIVE_SUPERVISOR_LOCK")
  })

  it("uses atomic schema-bound secret-free checkpoints", () => {
    expect(module).toContain("schemaVersion = 1")
    expect(module).toContain("Move-Item -LiteralPath $temp")
    expect(module).toContain("CORRUPT_CHECKPOINT_WALL")
    expect(module).toContain("CHECKPOINT_FIELD_WALL")
  })
})
