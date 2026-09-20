import { spawnSync } from "node:child_process"
import fs from "node:fs"
import path from "node:path"
import { describe, expect, it } from "vitest"

describe("Cerebras Windows Credential Manager bridge", () => {
  it("pins the exact credential and preserves the one-child cleanup boundary on every platform", () => {
    const helper = fs.readFileSync(
      path.join(process.cwd(), "scripts", "execution-fabric", "cerebras-credential-manager.ps1"),
      "utf8",
    )
    const launcher = fs.readFileSync(
      path.join(process.cwd(), "scripts", "execution-fabric", "invoke-cerebras-smoke.ps1"),
      "utf8",
    )

    expect(helper).toContain('$credentialTarget = "WilliamOS/Cerebras/API-Key"')
    expect(helper).toContain('$expectedUserName = "CEREBRAS_API_KEY"')
    expect(helper).toContain('EntryPoint = "CredReadW"')
    expect(helper).toContain("SetLastError = true")
    expect(helper).toContain('EntryPoint = "CredFree"')
    expect(helper).toContain('if ($nativeError -eq 1168) { throw "CEREBRAS_CREDENTIAL_NOT_FOUND" }')
    expect(helper).toContain("[Runtime.InteropServices.Marshal]::WriteByte")
    expect(helper.indexOf("[Runtime.InteropServices.Marshal]::WriteByte")).toBeLessThan(
      helper.indexOf("[WilliamOsCredentialNative]::CredFree"),
    )
    expect(helper).toContain("$credential.Type -ne 1")
    expect(helper).toContain("$credential.UserName -cne $expectedUserName")
    expect(helper).not.toMatch(/function Get-CerebrasCredentialSecureString[\s\S]{0,160}\[string\]\$Target/)

    expect(launcher).toContain('. $credentialHelper')
    expect(launcher).toContain("$secureKey = Get-CerebrasCredentialSecureString")
    expect(launcher).toContain("SecureStringToBSTR")
    expect(launcher).toContain("ZeroFreeBSTR")
    expect(launcher).toContain("$secureKey.Dispose()")
    expect(launcher).toMatch(
      /finally\s*\{[\s\S]*Remove-Item Env:CEREBRAS_API_KEY[\s\S]*Remove-Item Env:WILLIAMOS_CEREBRAS_ENABLED/,
    )
    expect(launcher).toContain('& "C:\\Program Files\\nodejs\\node.exe" $script --model $Model')
    expect(launcher).not.toMatch(/Read-Host|cmdkey|Get-StoredCredential|\.env\.local|Start-Process|Invoke-Command/)
  })

  it.skipIf(process.platform !== "win32")(
    "reads only the fixed credential contract and rejects invalid metadata without exposing its blob",
    () => {
      const harness = path.join(process.cwd(), "tests", "fixtures", "cerebras-credential-harness.ps1")
      const helper = path.join(process.cwd(), "scripts", "execution-fabric", "cerebras-credential-manager.ps1")
      const result = spawnSync(
        "powershell.exe",
        ["-NoLogo", "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", harness, "-HelperPath", helper],
        { encoding: "utf8" },
      )

      expect(result.status, result.stderr).toBe(0)
      expect(result.stderr).toBe("")
      expect(result.stdout).not.toContain("fixture-secret-123")
      const receipt = JSON.parse(result.stdout.trim())
      expect(receipt).toEqual({
        success: {
          status: "SUCCESS",
          length: "fixture-secret-123".length,
          readOnly: true,
          target: "WilliamOS/Cerebras/API-Key",
          type: 1,
          flags: 0,
          freeCalled: true,
          blobZeroed: true,
        },
        wrongUserName: {
          status: "CEREBRAS_CREDENTIAL_INVALID",
          target: "WilliamOS/Cerebras/API-Key",
          type: 1,
          flags: 0,
          freeCalled: true,
          blobZeroed: true,
        },
        invalidPayload: {
          status: "CEREBRAS_CREDENTIAL_INVALID",
          target: "WilliamOS/Cerebras/API-Key",
          type: 1,
          flags: 0,
          freeCalled: true,
          blobZeroed: true,
        },
        missing: {
          status: "CEREBRAS_CREDENTIAL_UNAVAILABLE",
          target: "WilliamOS/Cerebras/API-Key",
          type: 1,
          flags: 0,
          freeCalled: false,
          blobZeroed: false,
        },
      })
    },
  )
})
