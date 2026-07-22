import { spawnSync } from "node:child_process"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { describe, expect, it } from "vitest"

const repoRoot = process.cwd()
const supervisorScript = path.join(repoRoot, "scripts", "hermes-bridge", "supervisor.ps1")
const installScript = path.join(repoRoot, "scripts", "hermes-bridge", "install-supervisor.ps1")

describe("Hermes interactive-user supervisor", () => {
  const hostOnly = process.platform !== "win32" || process.env.WILLIAMOS_HERMES_VALIDATION_ISOLATED === "1"

  it.skipIf(hostOnly)("runs one enabled cycle and removes its owned process record", () => {
    const runtimeRoot = fs.mkdtempSync(path.join(os.tmpdir(), "hermes-supervisor-"))
    const activationPath = path.join(runtimeRoot, "control", "activation")
    const markerPath = path.join(runtimeRoot, "cycle.marker")
    fs.mkdirSync(path.dirname(activationPath), { recursive: true })
    fs.writeFileSync(activationPath, "enabled\n")

    const quote = (value: string) => `'${value.replaceAll("'", "''")}'`
    const command = [
      `& ${quote(supervisorScript)}`,
      `-Workspace ${quote(repoRoot)}`,
      `-RuntimeRoot ${quote(runtimeRoot)}`,
      "-RunOnce",
      `-CycleAction { param([string]$OwnedWorkspace, [string]$OwnedCliPath, [string]$OwnedRuntimeRoot) [IO.File]::WriteAllText(${quote(markerPath)}, "$OwnedWorkspace|$OwnedRuntimeRoot"); return 0 }`,
    ].join(" ")
    const result = spawnSync("pwsh", ["-NoLogo", "-NoProfile", "-NonInteractive", "-Command", command], { encoding: "utf8" })

    expect(result.status, result.stderr).toBe(0)
    expect(fs.readFileSync(markerPath, "utf8")).toBe(`${repoRoot}|${runtimeRoot}`)
    expect(fs.existsSync(path.join(runtimeRoot, "state", "supervisor.json"))).toBe(false)
    expect(result.stdout).toContain("INTERACTIVE_USER_RESIDENT")
  })

  it.skipIf(hostOnly)("returns from a direct one-shot Node cycle without a nested shell", () => {
    const workspace = fs.mkdtempSync(path.join(os.tmpdir(), "hermes-direct-cycle-"))
    const launchRoot = fs.mkdtempSync(path.join(os.tmpdir(), "hermes-direct-launch-"))
    const runtimeRoot = path.join(launchRoot, "runtime")
    const activationPath = path.join(runtimeRoot, "control", "activation")
    const cliDirectory = path.join(workspace, "scripts", "hermes-bridge")
    fs.mkdirSync(path.dirname(activationPath), { recursive: true })
    fs.mkdirSync(cliDirectory, { recursive: true })
    fs.writeFileSync(activationPath, "enabled\n")
    fs.writeFileSync(path.join(workspace, ".env.local"), "")
    fs.writeFileSync(path.join(cliDirectory, "cli.mjs"), 'process.stdout.write("{\\"result\\":\\"PASS\\"}\\n")\n')

    const quote = (value: string) => `'${value.replaceAll("'", "''")}'`
    const command = [
      `& ${quote(supervisorScript)}`,
      `-Workspace ${quote(workspace)}`,
      `-RuntimeRoot ${quote("runtime")}`,
      "-RunOnce",
    ].join(" ")
    const result = spawnSync("pwsh", ["-NoLogo", "-NoProfile", "-NonInteractive", "-Command", command], {
      cwd: launchRoot,
      encoding: "utf8",
      timeout: 15_000,
    })

    expect(result.status, result.stderr).toBe(0)
    expect(result.error).toBeUndefined()
    const cycleLog = fs.readdirSync(path.join(runtimeRoot, "logs")).find((name) => /^cycle-\d{8}\.log$/.test(name))
    expect(cycleLog).toBeDefined()
    expect(fs.readFileSync(path.join(runtimeRoot, "logs", cycleLog!), "utf8")).toContain('{"result":"PASS"}')
    expect(fs.existsSync(path.join(runtimeRoot, "state", "supervisor.json"))).toBe(false)
  })

  it("installs a hidden Startup shortcut instead of a scheduled execution host", () => {
    const source = fs.readFileSync(installScript, "utf8")
    expect(source).toContain('[Environment]::GetFolderPath("Startup")')
    expect(source).toContain("CreateShortcut")
    expect(source).toContain("-WindowStyle Hidden")
    expect(source).toContain("Start-Process")
    expect(source).toContain("-WorkingDirectory")
    expect(source).toContain("INTERACTIVE_USER_RESIDENT")
    expect(source).not.toContain("Register-ScheduledTask")
    expect(source).not.toContain("Start-ScheduledTask")
  })

  it("passes the selected runtime root through the resident cycle path", () => {
    const supervisor = fs.readFileSync(supervisorScript, "utf8")
    expect(supervisor).toContain("$env:WILLIAMOS_HERMES_RUNTIME_ROOT = $OwnedRuntimeRoot")
    expect(supervisor).toContain("$runtimeRootPath = [IO.Path]::GetFullPath($RuntimeRoot)")
    expect(supervisor).toContain("$OwnedCliPath cycle")
    expect(supervisor.indexOf('$cycleLogPath = Join-Path $logDir')).toBeGreaterThan(supervisor.indexOf("$CycleAction ="))
    expect(supervisor).not.toContain("& pwsh.exe")
    expect(supervisor).toContain("Global\\WilliamOSHermesCodexBridgeSupervisor")
    expect(supervisor).toContain("HERMES_SUPERVISOR_CYCLE_FAILED")
    expect(supervisor).toContain("HERMES_SUPERVISOR_STATE_CLEANUP_FAILED")
  })

  it("does not reuse the rejected nested Codex execution adapter", () => {
    const sources = [supervisorScript, installScript]
      .map((file) => fs.readFileSync(file, "utf8"))
      .join("\n")
    expect(sources).not.toMatch(/codex\s+exec|scripts[\\/]runtime-operator/i)
  })

  it("does not put a nested PowerShell process between the resident supervisor and one-shot CLI", () => {
    const source = fs.readFileSync(supervisorScript, "utf8")
    expect(source).toContain("& node")
    expect(source).not.toContain("run-cycle.ps1")
    expect(source).not.toContain("& pwsh.exe")
  })
})
