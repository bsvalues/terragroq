import fs from "node:fs"
import { describe, expect, it } from "vitest"

describe("native identity and Docker boundary", () => {
  it("requires the expected non-elevated Windows user", () => {
    const identity = fs.readFileSync("scripts/local/williamos-identity-context.ps1", "utf8")
    expect(identity).toContain("WindowsIdentity")
    expect(identity).toContain("IsInRole")
    expect(identity).toContain('ExpectedUser = "bsval"')
    expect(identity).toContain("NT SERVICE")
    expect(identity).toContain("EndsWith('$')")
    expect(identity).toContain("UNEXPECTED")
    expect(identity).not.toContain("Write-Output $identity")
  })

  it("keeps Docker credential-free and permanently inert", () => {
    const dockerfile = fs.readFileSync("runtime-operator/Dockerfile", "utf8")
    const compose = fs.readFileSync("runtime-operator/compose.yaml", "utf8")
    const supervisor = fs.readFileSync("runtime-operator/supervisor.sh", "utf8")
    expect(dockerfile).not.toMatch(/codex|github|\bgh\b/i)
    expect(compose).not.toMatch(/token|api[_-]?key|auth\.json|credential/i)
    expect(supervisor).toContain("SUPERSEDED_IDENTITY_HOST / DISABLED")
    expect(supervisor).not.toMatch(/lease|push|pull request|codex|github/i)
  })

  it("emits only the declared fail-closed readiness fields", () => {
    const adapter = fs.readFileSync("scripts/local/williamos-auth-readiness.ps1", "utf8")
    for (const field of ["codexAuth", "githubAuth", "activation", "identityContext", "ready"]) expect(adapter).toContain(field)
    expect(adapter).toContain('else { "unknown" }')
    expect(adapter).toContain("powershell.exe")
    expect(adapter).not.toMatch(/token fragment|auth cache|Write-Output \$status/i)
  })
})
