import { spawnSync } from "node:child_process"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { describe, expect, it } from "vitest"

const repoRoot = process.cwd()
const supervisorScript = path.join(repoRoot, "scripts", "hermes-bridge", "supervisor.ps1")
const installScript = path.join(repoRoot, "scripts", "hermes-bridge", "install-supervisor.ps1")

describe("Hermes interactive-user supervisor", () => {
  it.skipIf(process.platform !== "win32")("runs one enabled cycle and removes its owned process record", () => {
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
      `-CycleAction { param([string]$OwnedWorkspace, [string]$OwnedRunner, [string]$OwnedRuntimeRoot) [IO.File]::WriteAllText(${quote(markerPath)}, "$OwnedWorkspace|$OwnedRuntimeRoot"); return 0 }`,
    ].join(" ")
    const result = spawnSync("pwsh", ["-NoLogo", "-NoProfile", "-NonInteractive", "-Command", command], { encoding: "utf8" })

    expect(result.status, result.stderr).toBe(0)
    expect(fs.readFileSync(markerPath, "utf8")).toBe(`${repoRoot}|${runtimeRoot}`)
    expect(fs.existsSync(path.join(runtimeRoot, "state", "supervisor.json"))).toBe(false)
    expect(result.stdout).toContain("INTERACTIVE_USER_RESIDENT")
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
    const runner = fs.readFileSync(path.join(repoRoot, "scripts", "hermes-bridge", "run-cycle.ps1"), "utf8")
    expect(supervisor).toContain("-RuntimeRoot $OwnedRuntimeRoot")
    expect(runner).toContain("$env:WILLIAMOS_HERMES_RUNTIME_ROOT = $root")
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
})
