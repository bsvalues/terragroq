import fs from "node:fs"
import path from "node:path"
import { describe, expect, it } from "vitest"

const root = process.cwd()
const launcher = fs.readFileSync(path.join(root, "deploy", "hermes", "williamos-https", "start-williamos-https.ps1"), "utf8")
const installer = fs.readFileSync(path.join(root, "scripts", "install-hermes-https-supervisor.ps1"), "utf8")

function executableOnly(text: string) {
  return text
    .replace(/<#[\s\S]*?#>/g, "")
    .split(/\r?\n/)
    .map((line) => line.replace(/(^|\s)#.*$/, "$1"))
    .join("\n")
}

describe("the HERMES HTTPS supervisor", () => {
  it("invokes Node directly instead of detaching it with Start-Process", () => {
    const code = executableOnly(launcher)
    expect(code).toMatch(/&\s*\$node\s+\$proxy/)
    expect(code).not.toContain("Start-Process")
    expect(code).toMatch(/exit\s+\$proxyExit/)
  })

  it("keeps logs without leaking them through task output", () => {
    const code = executableOnly(launcher)
    expect(code).toMatch(/1>>\s*\$stdoutLog\s+2>>\s*\$stderrLog/)
  })

  it("captures both the outgoing task and launcher before mutation", () => {
    const code = executableOnly(installer)
    const capture = code.indexOf("Export-ScheduledTask")
    const register = code.indexOf("Register-ScheduledTask")
    expect(capture).toBeGreaterThan(-1)
    expect(register).toBeGreaterThan(capture)
    expect(code).toContain("task.xml")
  })

  it("does not broaden privileges or network policy", () => {
    const code = executableOnly(installer)
    expect(code).toMatch(/-LogonType\s+Interactive\s+-RunLevel\s+Limited/)
    expect(code).not.toMatch(/New-NetFirewallRule|Set-NetFirewallRule|netsh|RunLevel\s+Highest/)
  })

  it("starts when available, restarts on failure, and verifies task plus product health", () => {
    const code = executableOnly(installer)
    expect(code).toMatch(/-RestartCount\s+10/)
    expect(code).toContain("-StartWhenAvailable")
    expect(code).toContain('task.State -ne "Running"')
    expect(code).toContain("Wait-HttpsHealthy")
  })

  it("proves the task owns the listener by stopping and restarting it", () => {
    const code = executableOnly(installer)
    expect(code).toContain("Assert-SupervisedLifecycle")
    expect(code).toContain("port $HttpsPort remained open")
    expect(code).toContain("restarting restores health")
  })

  it("refuses to kill an unrelated owner of the HTTPS port", () => {
    const code = executableOnly(installer)
    expect(code).toContain("Port $HttpsPort is owned by an unrelated process")
    expect(code.indexOf("CommandLine -notlike")).toBeLessThan(code.indexOf("Stop-Process -Id $process.ProcessId"))
  })
})
