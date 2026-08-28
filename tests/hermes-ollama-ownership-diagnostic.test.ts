import fs from "node:fs"
import path from "node:path"
import { execFileSync } from "node:child_process"

import { describe, expect, it } from "vitest"

const scriptPath = path.join(process.cwd(), "scripts/lab-control/hermes/ollama-service/diagnose-hermes-ollama-ownership.ps1")

describe("#1046 read-only ownership diagnostic", () => {
  it("is digest-bound, elevated, immutable-output, and mutation-free", () => {
    const source = fs.readFileSync(scriptPath, "utf8")
    expect(source).toContain("HERMES_1046_SCRIPT_DIGEST_MISMATCH")
    expect(source).toContain("HERMES_1046_ELEVATION_REQUIRED")
    expect(source).toContain("[IO.FileMode]::CreateNew")
    expect(source).toContain("mutationAllowed = $false")
    expect(source).toContain("HERMES_1046_OUTPUT_NOT_DEDICATED")
    expect(source).toContain("HERMES_1046_OUTPUT_REPARSE_REFUSED")
    expect(source).toContain("[IO.FileAttributes]::ReadOnly")
    expect(source).toContain("$outputDigestPath")
    expect(source).not.toMatch(/^\s*(?:Set-(?!StrictMode)|New-|Remove-|Clear-|Enable-|Disable-|Start-|Stop-|Restart-|Register-|Unregister-|Mount-|Dismount-|Initialize-|Format-|Resize-|Repair-|Update-)[A-Za-z]/m)
    expect(source).not.toMatch(/\b(?:docker|&\s+\$dockerExe)\s+(?:run|start|stop|restart|rm|rmi|pull|build|compose\s+up)\b/i)
    expect(source).not.toMatch(/\b(?:Set-Content|Out-File|Add-Content|Export-Clixml|schtasks\.exe)\b/i)
  })

  it("covers every required launcher surface without collecting arbitrary environments", () => {
    const source = fs.readFileSync(scriptPath, "utf8")
    for (const marker of [
      "Get-ScheduledTask",
      "Export-ScheduledTask",
      "Win32_Process",
      "Get-NetTCPConnection",
      "Win32_Service",
      "Win32_StartupCommand",
      "docker-ollama-residents",
      "fileLaunchers",
      "logEvidence",
    ]) expect(source).toContain(marker)
    expect(source).not.toMatch(/\.EnvironmentVariables|Config\.Env|GetEnvironmentVariable|commandLine\s*=|arguments\s*=|selectedLines\s*=/)
    expect(source).toContain("Get-CommandProjection")
    expect(source).toContain("messageSha256")
    expect(source).toContain("lineSha256")
    for (const classification of ["CANONICAL_OWNER", "RECOVERY_CALLER", "LEGACY_DISABLED", "UNDECLARED"]) expect(source).toContain(classification)
  })

  it("redacts common credential forms before any selected text is retained", () => {
    const source = fs.readFileSync(scriptPath, "utf8")
    for (const marker of ["REDACTED_PRIVATE_KEY", "bearer|basic", "set-cookie", "api[_-]?key", "[REDACTED]"]) expect(source.toLowerCase()).toContain(marker.toLowerCase())
  })

  it("finds a generic Docker resident through port or model-mount ownership signals", () => {
    const command = [
      `$source = Get-Content -Raw -LiteralPath '${scriptPath.replaceAll("'", "''")}'`,
      "$tokens = $null; $errors = $null",
      "$ast = [Management.Automation.Language.Parser]::ParseInput($source, [ref]$tokens, [ref]$errors)",
      "$fn = $ast.Find({ param($node) $node -is [Management.Automation.Language.FunctionDefinitionAst] -and $node.Name -eq 'Test-DockerOwnershipSignal' }, $true)",
      "Set-StrictMode -Version Latest",
      "Invoke-Expression $fn.Extent.Text",
      "$row = [pscustomobject]@{ Names='worker-7'; Image='generic/runtime:1'; Command='/entrypoint'; Ports='0.0.0.0:11434->11434/tcp' }",
      "$inspect = [pscustomobject]@{ HostConfig=[pscustomobject]@{ PortBindings=$null }; Mounts=@() }",
      "$port = Test-DockerOwnershipSignal $row $inspect",
      "$row.Ports = ''",
      "$none = Test-DockerOwnershipSignal $row $inspect",
      "$inspect.HostConfig.PortBindings = [pscustomobject]@{ '8080/tcp'=$null }",
      "$nullEntry = Test-DockerOwnershipSignal $row $inspect",
      "$inspect.HostConfig.PortBindings = $null",
      "$inspect.Mounts = @([pscustomobject]@{ Source='D:\\HermesData\\ollama\\models'; Destination='/data/models' })",
      "$mount = Test-DockerOwnershipSignal $row $inspect",
      "[pscustomobject]@{ port=$port; none=$none; nullEntry=$nullEntry; mount=$mount } | ConvertTo-Json -Compress",
    ].join("; ")
    const result = JSON.parse(execFileSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", command], { encoding: "utf8" }))
    expect(result).toEqual({ port: true, none: false, nullEntry: false, mount: true })
  })
})
