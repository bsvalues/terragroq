import { execFileSync } from "node:child_process"
import fs from "node:fs"
import path from "node:path"

import { describe, expect, it } from "vitest"

const launcherPath = path.join(process.cwd(), "scripts/execution-fabric/bounded-dispatch/invoke-bounded-hermes-embedding.ps1")
const source = fs.readFileSync(launcherPath, "utf8")

describe("bounded resident HERMES embedding launcher", () => {
  it("has a fixed zero-argument Python evaluator command", () => {
    expect(source).toContain('$PythonExecutable = "C:\\Python313\\python.exe"')
    expect(source).toContain('"scripts\\embedding-bakeoff\\fabric_measure.py"')
    expect(source).toContain('if ($args.Count -ne 0)')
    expect(source).not.toMatch(/Invoke-Expression|Start-Process|cmd\.exe|powershell\.exe|pwsh\.exe|shell:\s*true/i)
    expect(source).not.toMatch(/HERMES_EMBEDDING_(?:COMMAND|EXECUTABLE|EVALUATOR|ENDPOINT|URL|HOST)/)
  })

  it("creates the evaluator suspended and assigns it before resuming", () => {
    const create = source.indexOf("CreateProcessW(")
    const suspended = source.indexOf("CREATE_SUSPENDED")
    const assign = source.indexOf("AssignProcessToJobObject(job, processInfo.hProcess)")
    const resume = source.indexOf("ResumeThread(processInfo.hThread)")

    expect(create).toBeGreaterThanOrEqual(0)
    expect(suspended).toBeGreaterThanOrEqual(0)
    expect(assign).toBeGreaterThan(create)
    expect(resume).toBeGreaterThan(assign)
    expect(source).toContain("PROC_THREAD_ATTRIBUTE_HANDLE_LIST")
    expect(source).toContain("EXTENDED_STARTUPINFO_PRESENT")
  })

  it("enforces the complete Job Object resource contract", () => {
    for (const token of [
      "JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE",
      "JOB_OBJECT_LIMIT_PROCESS_MEMORY",
      "JOB_OBJECT_LIMIT_JOB_MEMORY",
      "JOB_OBJECT_LIMIT_ACTIVE_PROCESS",
      "JOB_OBJECT_LIMIT_AFFINITY",
      "JOB_OBJECT_CPU_RATE_CONTROL_ENABLE",
      "JOB_OBJECT_CPU_RATE_CONTROL_HARD_CAP",
      "SetInformationJobObject",
      "TerminateJobObject",
      "WaitForSingleObject",
      "GetFileSizeEx",
    ]) expect(source).toContain(token)

    expect(source).toContain("ActiveProcessLimit = 1")
    expect(source).toContain("cpuRatePercent * 100")
    expect(source).toContain("WAIT_TIMEOUT")
    expect(source).toContain("OutputLimitExceeded = true")
  })

  it("restricts paths, filenames, numeric limits, and the child environment", () => {
    expect(source).toContain('$HermesRoot = "C:\\HermesLab"')
    expect(source).toContain('$LedgerRoot = "C:\\HermesLab\\embedding-bakeoff-ledger"')
    expect(source).toContain('^sealed-([a-f0-9]{64})\\.json$')
    expect(source).toContain('^result-([a-f0-9]{64})\\.json$')
    expect(source).toContain("REPARSE_POINT")
    expect(source).toContain("HERMES_EMBEDDING_TIMEOUT_MS")
    expect(source).toContain("HERMES_EMBEDDING_PROCESS_MEMORY_BYTES")
    expect(source).toContain("HERMES_EMBEDDING_JOB_MEMORY_BYTES")
    expect(source).toContain("HERMES_EMBEDDING_CPU_RATE_PERCENT")
    expect(source).toContain("HERMES_EMBEDDING_CPU_AFFINITY_MASK")
    expect(source).toContain("HERMES_EMBEDDING_ACTIVE_PROCESS_LIMIT")
    expect(source).toContain('"NO_PROXY=127.0.0.1,localhost"')
    expect(source).not.toContain("GetEnvironmentVariables")
  })

  it("emits a secret-free bounded receipt", () => {
    expect(source).toContain('schema_version = "1.0-hermes-embedding-job-receipt"')
    expect(source).toContain('job_assigned_before_resume = $true')
    expect(source).toContain('external_provider_used = $false')
    expect(source).toContain('fallback_used = $false')
    expect(source).not.toMatch(/receipt[^\n]*(?:path|input|output|environment)/i)
  })

  it.runIf(process.platform === "win32")("fails closed before native launch on arguments or absent environment", () => {
    const powerShell = process.env.SystemRoot
      ? path.join(process.env.SystemRoot, "System32", "WindowsPowerShell", "v1.0", "powershell.exe")
      : "powershell.exe"
    const cleanEnvironment = { SystemRoot: process.env.SystemRoot ?? "C:\\Windows", WINDIR: process.env.WINDIR ?? "C:\\Windows" }

    for (const extraArguments of [[], ["unexpected"]]) {
      let output = ""
      try {
        output = execFileSync(powerShell, ["-NoLogo", "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", launcherPath, ...extraArguments], {
          encoding: "utf8",
          env: cleanEnvironment,
          stdio: ["ignore", "pipe", "ignore"],
        })
      } catch (error: any) {
        output = String(error.stdout ?? "")
      }
      const receipt = JSON.parse(output.trim())
      expect(receipt).toMatchObject({ status: "FAILED_CLOSED", external_provider_used: false, fallback_used: false })
      expect(["ARGUMENTS_FORBIDDEN", "ENVIRONMENT_INVALID"]).toContain(receipt.reason_code)
      expect(output).not.toMatch(/C:\\Users|sealed-|result-/i)
    }
  })
})
