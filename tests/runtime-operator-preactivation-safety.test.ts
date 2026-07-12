import fs from "node:fs"
import { describe, expect, it } from "vitest"

describe("pre-activation runtime safety", () => {
  it("gates every consequential stage on repository, risk, dependencies, base, owner gates, and activation", () => {
    const authority = fs.readFileSync("scripts/local/williamos-authority-evaluate.ps1", "utf8")
    for (const wall of ["REPOSITORY", "RISK", "REGISTRATION", "DEPENDENCY", "STALE_BASE", "OWNER_GATE", "ACTIVATION"]) expect(authority).toContain(`AUTHORITY_${wall}_WALL`)
    expect(authority).toContain('ValidateSet("lease", "patch", "push", "pr", "merge")')
  })

  it("blocks environment and user-profile exfiltration paths", () => {
    const defense = fs.readFileSync("scripts/local/williamos-secret-defense.ps1", "utf8")
    expect(defense).toContain("USER_PROFILE_TRAVERSAL_WALL")
    expect(defense).toContain("SECRET_ENVIRONMENT_WALL")
    expect(defense).toContain("PROTECTED_MATERIAL_WALL")
    expect(defense).not.toMatch(/Get-ChildItem\s+Env:|gci\s+env:/i)
  })

  it("defines one deterministic R0 documentation-only pilot", () => {
    const pilot = JSON.parse(fs.readFileSync("runtime-operator/native/pilot-envelope.json", "utf8"))
    expect(pilot).toMatchObject({ schemaVersion: 1, repository: "bsvalues/terragroq", riskClass: "R0", ownerGateRequired: false })
    expect(pilot.allowedPaths).toEqual(["docs/reports/WO-RUNTIME-IDENTITY-030-pilot-proof.md"])
    expect(pilot.blockedPaths).toContain("runtime-operator")
  })
})
