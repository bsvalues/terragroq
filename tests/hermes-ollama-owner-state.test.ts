import fs from "node:fs"
import { spawnSync } from "node:child_process"
import { describe, expect, it } from "vitest"

const source = fs.readFileSync("scripts/lab-control/hermes/ollama-service/hermes-ollama-service.ps1", "utf8")

describe("canonical owner receipt failure", () => {
  it.skipIf(process.platform !== "win32")("returns only false when receipt publication fails, even when lifecycle logging emits output", () => {
    const start = source.indexOf("function Write-OwnerState(")
    const end = source.indexOf('\nWrite-Log INFO "startup', start)
    expect(start).toBeGreaterThan(0)
    expect(end).toBeGreaterThan(start)
    const script = `
      $ErrorActionPreference = 'Stop'
      function Write-Log($Level, $Message) { Write-Output "$Level $Message" }
      function Test-Path { return $false }
      $OwnerStateRoot = 'unused-test-root'
      ${source.slice(start, end)}
      $result = @(Write-OwnerState -State 'SERVING' -ServePid 123)
      if ($result.Count -ne 1 -or $result[0] -isnot [bool] -or $result[0] -ne $false) {
        throw 'Receipt failure leaked success output and would bypass the owner stop guard'
      }
      'FAIL_CLOSED'
    `
    const result = spawnSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-EncodedCommand", Buffer.from(script, "utf16le").toString("base64")], { encoding: "utf8", timeout: 15000 })
    expect(result.status, result.stderr).toBe(0)
    expect(result.stdout.trim()).toBe("FAIL_CLOSED")
  })
})