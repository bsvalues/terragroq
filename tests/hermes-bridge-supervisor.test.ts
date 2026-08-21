import { spawn, spawnSync } from "node:child_process"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { afterEach, describe, expect, it } from "vitest"

const repoRoot = process.cwd()
const supervisorScript = path.join(repoRoot, "scripts", "hermes-bridge", "supervisor.ps1")
const installScript = path.join(repoRoot, "scripts", "hermes-bridge", "install-supervisor.ps1")
const windowsPowerShell = path.join(
  process.env.SystemRoot ?? "C:\\Windows",
  "System32",
  "WindowsPowerShell",
  "v1.0",
  "powershell.exe",
)
const isolatedRoots: string[] = []

afterEach(() => {
  isolatedRoots.splice(0).forEach((root) => fs.rmSync(root, { recursive: true, force: true }))
})

function isolatedSupervisor() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "hermes-isolated-supervisor-"))
  isolatedRoots.push(root)
  const script = path.join(root, "supervisor.ps1")
  const mutex = `Global\\WilliamOSHermesSupervisorTest${Date.now()}${Math.random()}`
  fs.writeFileSync(
    script,
    fs.readFileSync(supervisorScript, "utf8")
      .replace("Global\\WilliamOSHermesCodexBridgeSupervisor", mutex),
  )
  return { root, script }
}

function isGlobalSupervisorMutexHeld() {
  if (process.platform !== "win32") return false
  const command = [
    "$createdNew = $false",
    '$mutex = [Threading.Mutex]::new($false, "Global\\WilliamOSHermesCodexBridgeSupervisor", [ref]$createdNew)',
    "$acquired = $false",
    'try { try { $acquired = $mutex.WaitOne(0) } catch [Threading.AbandonedMutexException] { $acquired = $true }; if ($acquired) { $mutex.ReleaseMutex(); [Console]::Write("free") } else { [Console]::Write("held") } } finally { $mutex.Dispose() }',
  ].join("; ")
  const probe = spawnSync("pwsh", ["-NoLogo", "-NoProfile", "-NonInteractive", "-Command", command], {
    encoding: "utf8",
  })
  if (probe.error || probe.status !== 0) throw new Error("HERMES_SUPERVISOR_MUTEX_PROBE_FAILED")
  const result = probe.stdout.trim()
  if (result !== "free" && result !== "held") throw new Error("HERMES_SUPERVISOR_MUTEX_PROBE_INVALID")
  return result === "held"
}

describe("Hermes interactive-user supervisor", () => {
  const hostOnly =
    process.platform !== "win32" ||
    process.env.WILLIAMOS_HERMES_VALIDATION_ISOLATED === "1" ||
    isGlobalSupervisorMutexHeld()

  it.skipIf(hostOnly)("runs one enabled cycle and removes its owned process record", () => {
    const runtimeRoot = fs.mkdtempSync(path.join(os.tmpdir(), "hermes-supervisor-"))
    const activationPath = path.join(runtimeRoot, "control", "activation")
    const markerPath = path.join(runtimeRoot, "cycle.marker")
    const inFlightPath = path.join(runtimeRoot, "in-flight.json")
    const completedPath = path.join(runtimeRoot, "completed.json")
    fs.mkdirSync(path.dirname(activationPath), { recursive: true })
    fs.writeFileSync(activationPath, "enabled\n")

    const quote = (value: string) => `'${value.replaceAll("'", "''")}'`
    const command = [
      `& ${quote(supervisorScript)}`,
      `-Workspace ${quote(repoRoot)}`,
      `-RuntimeRoot ${quote(runtimeRoot)}`,
      "-CycleIntervalSeconds 1",
      `-CycleAction { param([string]$OwnedWorkspace, [string]$OwnedCliPath, [string]$OwnedRuntimeRoot) [IO.File]::WriteAllText(${quote(markerPath)}, "$OwnedWorkspace|$OwnedRuntimeRoot"); Copy-Item -LiteralPath (Join-Path $OwnedRuntimeRoot "state\\supervisor.json") -Destination ${quote(inFlightPath)}; return [PSCustomObject]@{ ExitCode = 0; Result = "QUEUE_DRAINED"; StopReason = "NO_OUTCOME" } }`,
      `-SleepAction { param([int]$Seconds) Copy-Item -LiteralPath (Join-Path ${quote(runtimeRoot)} 'state\\supervisor.json') -Destination ${quote(completedPath)}; Set-Content -LiteralPath ${quote(activationPath)} -Value disabled }`,
    ].join(" ")
    const result = spawnSync("pwsh", ["-NoLogo", "-NoProfile", "-NonInteractive", "-Command", command], { encoding: "utf8" })

    expect(result.status, result.stderr).toBe(0)
    expect(fs.readFileSync(markerPath, "utf8")).toBe(`${repoRoot}|${runtimeRoot}`)
    expect(JSON.parse(fs.readFileSync(inFlightPath, "utf8"))).toMatchObject({
      schemaVersion: 2,
      campaignWindowId: expect.stringMatching(/^campaign:[0-9a-f]{32}$/),
      cycle: {
        sequence: 1,
        status: "IN_FLIGHT",
        completedAt: null,
        result: null,
        stopReason: null,
        exitCode: null,
        consecutiveFailures: 0,
      },
    })
    expect(JSON.parse(fs.readFileSync(completedPath, "utf8"))).toMatchObject({
      schemaVersion: 2,
      cycle: {
        sequence: 1,
        status: "IDLE",
        result: "QUEUE_DRAINED",
        stopReason: "NO_OUTCOME",
        exitCode: 0,
        consecutiveFailures: 0,
      },
    })
    expect(fs.existsSync(path.join(runtimeRoot, "state", "supervisor.json"))).toBe(false)
    expect(result.stdout).toContain("INTERACTIVE_USER_RESIDENT")
  })

  it.skipIf(hostOnly)("returns from a direct one-shot Node cycle without a nested shell", () => {
    const workspace = fs.mkdtempSync(path.join(os.tmpdir(), "hermes-direct-cycle-"))
    const launchRoot = fs.mkdtempSync(path.join(os.tmpdir(), "hermes-direct-launch-"))
    const firstNodeRoot = path.join(launchRoot, "node-first")
    const secondNodeRoot = path.join(launchRoot, "node-second")
    const runtimeRoot = path.join(launchRoot, "runtime")
    const activationPath = path.join(runtimeRoot, "control", "activation")
    const cliDirectory = path.join(workspace, "scripts", "hermes-bridge")
    fs.mkdirSync(path.dirname(activationPath), { recursive: true })
    fs.mkdirSync(cliDirectory, { recursive: true })
    fs.mkdirSync(firstNodeRoot)
    fs.mkdirSync(secondNodeRoot)
    fs.writeFileSync(path.join(firstNodeRoot, "node.exe"), "shim without Node.js identity")
    fs.copyFileSync(process.execPath, path.join(secondNodeRoot, "node.exe"))
    fs.writeFileSync(activationPath, "enabled\n")
    fs.writeFileSync(path.join(workspace, ".env.local"), "")
    fs.writeFileSync(
      path.join(cliDirectory, "cli.mjs"),
      'process.stdout.write(JSON.stringify({result:"PASS",campaign:process.env.HERMES_CAMPAIGN_WINDOW_ID,processIdentity:process.env.HERMES_PROCESS_IDENTITY})+"\\n")\n',
    )

    const quote = (value: string) => `'${value.replaceAll("'", "''")}'`
    const command = [
      `& ${quote(supervisorScript)}`,
      `-Workspace ${quote(workspace)}`,
      `-RuntimeRoot ${quote("runtime")}`,
      "-RunOnce",
    ].join(" ")
    const inheritedPath = process.env.PATH ?? process.env.Path ?? ""
    const nodeSearchPath = [firstNodeRoot, secondNodeRoot, inheritedPath]
      .filter(Boolean)
      .join(path.delimiter)
    const result = spawnSync("pwsh", ["-NoLogo", "-NoProfile", "-NonInteractive", "-Command", command], {
      cwd: launchRoot,
      encoding: "utf8",
      env: {
        ...process.env,
        PATH: nodeSearchPath,
        Path: nodeSearchPath,
      },
      timeout: 15_000,
    })

    expect(result.status, result.stderr).toBe(0)
    expect(result.error).toBeUndefined()
    const cycleLog = fs.readdirSync(path.join(runtimeRoot, "logs")).find((name) => /^cycle-\d{8}\.log$/.test(name))
    expect(cycleLog).toBeDefined()
    const cycleEvidence = JSON.parse(
      fs.readFileSync(path.join(runtimeRoot, "logs", cycleLog!), "utf8").trim(),
    )
    expect(cycleEvidence).toMatchObject({
      result: "PASS",
      campaign: expect.stringMatching(/^campaign:[0-9a-f]{32}$/),
      processIdentity: expect.stringMatching(/^[0-9a-f-]{36}$/),
    })
    expect(fs.readFileSync(
      path.join(runtimeRoot, "state", "campaign-window"),
      "utf8",
    )).toBe(cycleEvidence.campaign)
    fs.writeFileSync(
      path.join(runtimeRoot, "state", "campaign-window"),
      `${cycleEvidence.campaign}\r\n`,
    )
    fs.writeFileSync(activationPath, "enabled\n")
    const second = spawnSync(
      "pwsh",
      ["-NoLogo", "-NoProfile", "-NonInteractive", "-Command", command],
      {
        cwd: launchRoot,
        encoding: "utf8",
        env: {
          ...process.env,
          PATH: nodeSearchPath,
          Path: nodeSearchPath,
        },
        timeout: 15_000,
      },
    )
    expect(second.status, second.stderr).toBe(0)
    const cycles = fs.readFileSync(
      path.join(runtimeRoot, "logs", cycleLog!),
      "utf8",
    ).trim().split(/\r?\n/).map((line) => JSON.parse(line))
    expect(cycles).toHaveLength(2)
    expect(cycles[1].campaign).toBe(cycles[0].campaign)
    expect(cycles[1].processIdentity).not.toBe(cycles[0].processIdentity)
    expect(fs.existsSync(path.join(runtimeRoot, "state", "supervisor.json"))).toBe(false)
  })

  it.skipIf(hostOnly || !fs.existsSync(windowsPowerShell))(
    "launches the exact resident cycle argv and identity from Windows PowerShell 5.1",
    () => {
      const launchRoot = fs.mkdtempSync(path.join(os.tmpdir(), "hermes ps51 launch "))
      isolatedRoots.push(launchRoot)
      const workspace = path.join(launchRoot, "workspace with spaces", "nested")
      const runtimeRoot = path.join(launchRoot, "runtime with spaces", "nested")
      const activationPath = path.join(runtimeRoot, "control", "activation")
      const cliPath = path.join(workspace, "scripts", "hermes-bridge", "cli.mjs")
      fs.mkdirSync(path.dirname(activationPath), { recursive: true })
      fs.mkdirSync(path.dirname(cliPath), { recursive: true })
      fs.writeFileSync(activationPath, "enabled\n")
      fs.writeFileSync(path.join(workspace, ".env.local"), "HERMES_PS51_FIXTURE=fixture-ok\n")
      fs.writeFileSync(
        cliPath,
        [
          "process.stdout.write(JSON.stringify({",
          "  result: 'PASS',",
          "  argv: process.argv.slice(1),",
          "  fixture: process.env.HERMES_PS51_FIXTURE,",
          "  runtimeRoot: process.env.WILLIAMOS_HERMES_RUNTIME_ROOT,",
          "  campaign: process.env.HERMES_CAMPAIGN_WINDOW_ID,",
          "  processIdentity: process.env.HERMES_PROCESS_IDENTITY,",
          "}) + '\\n')",
        ].join("\n"),
      )

      const quote = (value: string) => `'${value.replaceAll("'", "''")}'`
      const command = [
        `& ${quote(supervisorScript)}`,
        `-Workspace ${quote(workspace)}`,
        `-RuntimeRoot ${quote(runtimeRoot)}`,
        "-RunOnce",
      ].join(" ")
      const result = spawnSync(
        windowsPowerShell,
        ["-NoLogo", "-NoProfile", "-NonInteractive", "-Command", command],
        { encoding: "utf8", timeout: 15_000 },
      )

      expect(result.status, result.stderr).toBe(0)
      const cycleLog = fs.readdirSync(path.join(runtimeRoot, "logs"))
        .find((name) => /^cycle-\d{8}\.log$/.test(name))
      expect(cycleLog).toBeDefined()
      const evidence = JSON.parse(
        fs.readFileSync(path.join(runtimeRoot, "logs", cycleLog!), "utf8").trim(),
      )
      expect(evidence).toEqual({
        result: "PASS",
        argv: [cliPath, "cycle"],
        fixture: "fixture-ok",
        runtimeRoot,
        campaign: expect.stringMatching(/^campaign:[0-9a-f]{32}$/),
        processIdentity: expect.stringMatching(/^[0-9a-f-]{36}$/),
      })
    },
  )

  it.skipIf(hostOnly || !fs.existsSync(windowsPowerShell))(
    "round-trips spaces quotes and backslashes through the PS5.1 command line encoder",
    () => {
      const root = fs.mkdtempSync(path.join(os.tmpdir(), "hermes argv encoder "))
      isolatedRoots.push(root)
      const fixture = path.join(root, "fixture with spaces.mjs")
      const harness = path.join(root, "encoder-harness.ps1")
      const values = [
        "",
        "plain",
        "with spaces",
        'quote"inside',
        "backslash\\plain",
        'slashes\\\\before"quote',
        "trailing\\",
        "two-trailing\\\\",
        "space trailing\\",
      ]
      fs.writeFileSync(fixture, "process.stdout.write(JSON.stringify(process.argv.slice(2)))\n")
      const psQuote = (value: string) => `'${value.replaceAll("'", "''")}'`
      fs.writeFileSync(
        harness,
        [
          "$ErrorActionPreference = 'Stop'",
          "$tokens = $null",
          "$errors = $null",
          `$ast = [Management.Automation.Language.Parser]::ParseFile(${psQuote(supervisorScript)}, [ref]$tokens, [ref]$errors)`,
          "if ($errors.Count -ne 0) { throw 'SUPERVISOR_PARSE_FAILED' }",
          "$wanted = @('ConvertTo-WindowsCommandLineArgument', 'Join-WindowsCommandLineArguments')",
          "$functions = @($ast.FindAll({ param($node) $node -is [Management.Automation.Language.FunctionDefinitionAst] -and $wanted -ccontains $node.Name }, $true))",
          "if ($functions.Count -ne 2) { throw 'SUPERVISOR_ENCODER_MISSING' }",
          "foreach ($function in $functions) { . ([ScriptBlock]::Create($function.Extent.Text)) }",
          `$values = @(${values.map(psQuote).join(", ")})`,
          "$startInfo = [Diagnostics.ProcessStartInfo]::new()",
          `$startInfo.FileName = ${psQuote(process.execPath)}`,
          `$startInfo.WorkingDirectory = ${psQuote(root)}`,
          "$startInfo.UseShellExecute = $false",
          "$startInfo.RedirectStandardOutput = $true",
          "$startInfo.RedirectStandardError = $true",
          `$allValues = @(${psQuote(fixture)}) + $values`,
          "$startInfo.Arguments = Join-WindowsCommandLineArguments -Values $allValues",
          "$process = [Diagnostics.Process]::Start($startInfo)",
          "$stdout = $process.StandardOutput.ReadToEnd()",
          "$stderr = $process.StandardError.ReadToEnd()",
          "$process.WaitForExit()",
          "if ($process.ExitCode -ne 0) { throw $stderr }",
          "[PSCustomObject]@{ Arguments = $startInfo.Arguments; ExitCode = $process.ExitCode; Stdout = $stdout; Stderr = $stderr } | ConvertTo-Json -Compress",
        ].join("\r\n"),
      )

      const result = spawnSync(
        windowsPowerShell,
        ["-NoLogo", "-NoProfile", "-NonInteractive", "-File", harness],
        { encoding: "utf8", timeout: 15_000 },
      )

      expect(result.status, result.stderr).toBe(0)
      const execution = JSON.parse(result.stdout)
      expect(execution.ExitCode, execution.Stderr).toBe(0)
      expect(execution.Stdout, JSON.stringify(execution)).not.toBe("")
      expect(JSON.parse(execution.Stdout)).toEqual(values)
    },
  )

  it.skipIf(hostOnly || !fs.existsSync(windowsPowerShell))(
    "rejects NUL and control characters before building a Windows command line",
    () => {
      const root = fs.mkdtempSync(path.join(os.tmpdir(), "hermes argv controls "))
      isolatedRoots.push(root)
      const harness = path.join(root, "control-harness.ps1")
      const psQuote = (value: string) => `'${value.replaceAll("'", "''")}'`
      fs.writeFileSync(
        harness,
        [
          "$ErrorActionPreference = 'Stop'",
          "$tokens = $null",
          "$errors = $null",
          `$ast = [Management.Automation.Language.Parser]::ParseFile(${psQuote(supervisorScript)}, [ref]$tokens, [ref]$errors)`,
          "if ($errors.Count -ne 0) { throw 'SUPERVISOR_PARSE_FAILED' }",
          "$wanted = @('ConvertTo-WindowsCommandLineArgument', 'Join-WindowsCommandLineArguments')",
          "$functions = @($ast.FindAll({ param($node) $node -is [Management.Automation.Language.FunctionDefinitionAst] -and $wanted -ccontains $node.Name }, $true))",
          "foreach ($function in $functions) { . ([ScriptBlock]::Create($function.Extent.Text)) }",
          "$controls = @(0, 9, 10, 13, 31, 127, 133, 159)",
          "$walls = foreach ($code in $controls) {",
          "  try {",
          "    $null = Join-WindowsCommandLineArguments -Values @('safe', ('unsafe' + [char]$code))",
          "    'ACCEPTED'",
          "  } catch {",
          "    $_.Exception.Message",
          "  }",
          "}",
          "$walls | ConvertTo-Json -Compress",
        ].join("\r\n"),
      )

      const result = spawnSync(
        windowsPowerShell,
        ["-NoLogo", "-NoProfile", "-NonInteractive", "-File", harness],
        { encoding: "utf8", timeout: 15_000 },
      )

      expect(result.status, result.stderr).toBe(0)
      expect(JSON.parse(result.stdout)).toEqual(
        Array.from({ length: 8 }, () => "HERMES_SUPERVISOR_ARGUMENT_CONTROL_CHARACTER_WALL"),
      )
    },
  )

  it.skipIf(hostOnly)(
    "does not require Node for a custom resident cycle",
    () => {
      const { root, script } = isolatedSupervisor()
      const runtimeRoot = path.join(root, "runtime")
      const activationPath = path.join(runtimeRoot, "control", "activation")
      const emptyPath = path.join(root, "empty-path")
      fs.mkdirSync(path.dirname(activationPath), { recursive: true })
      fs.mkdirSync(emptyPath)
      fs.writeFileSync(activationPath, "enabled\n")
      const pwshProbe = spawnSync(
        "pwsh",
        ["-NoLogo", "-NoProfile", "-NonInteractive", "-Command", "[Environment]::ProcessPath"],
        { encoding: "utf8" },
      )
      expect(pwshProbe.status, pwshProbe.stderr).toBe(0)
      const quote = (value: string) => `'${value.replaceAll("'", "''")}'`
      const result = spawnSync(
        pwshProbe.stdout.trim(),
        ["-NoLogo", "-NoProfile", "-NonInteractive", "-Command",
          `& ${quote(script)} -Workspace ${quote(root)} -RuntimeRoot ${quote(runtimeRoot)} -RunOnce -CycleAction { [PSCustomObject]@{ ExitCode = 0; Result = 'QUEUE_DRAINED'; StopReason = 'NO_OUTCOME' } }`],
        {
          encoding: "utf8",
          env: { ...process.env, PATH: emptyPath, Path: emptyPath },
          timeout: 15_000,
        },
      )

      expect(result.status, result.stderr).toBe(0)
      expect(result.stdout).toContain("INTERACTIVE_USER_RESIDENT")
      expect(result.stderr).not.toContain("HERMES_SUPERVISOR_NODE_EXECUTABLE_WALL")
    },
  )

  it.skipIf(hostOnly)(
    "fails with the typed executable wall when Node is absent",
    () => {
      const { root, script } = isolatedSupervisor()
      const emptyPath = path.join(root, "empty-path")
      const activationPath = path.join(root, "control", "activation")
      fs.mkdirSync(emptyPath)
      fs.mkdirSync(path.dirname(activationPath), { recursive: true })
      fs.writeFileSync(activationPath, "enabled\n")
      const pwshProbe = spawnSync(
        "pwsh",
        ["-NoLogo", "-NoProfile", "-NonInteractive", "-Command", "[Environment]::ProcessPath"],
        { encoding: "utf8" },
      )
      expect(pwshProbe.status, pwshProbe.stderr).toBe(0)
      const pwshPath = pwshProbe.stdout.trim()
      const quote = (value: string) => `'${value.replaceAll("'", "''")}'`
      const result = spawnSync(
        pwshPath,
        ["-NoLogo", "-NoProfile", "-NonInteractive", "-Command",
          `& ${quote(script)} -Workspace ${quote(root)} -RuntimeRoot ${quote(root)} -RunOnce`],
        {
          encoding: "utf8",
          env: { ...process.env, PATH: emptyPath, Path: emptyPath },
          timeout: 15_000,
        },
      )

      expect(result.status, result.stderr).toBe(0)
      const supervisorLog = fs.readdirSync(path.join(root, "logs"))
        .find((name) => /^supervisor-\d{8}\.log$/.test(name))
      expect(supervisorLog).toBeDefined()
      expect(fs.readFileSync(path.join(root, "logs", supervisorLog!), "utf8"))
        .toContain("stopReason=HERMES_SUPERVISOR_NODE_EXECUTABLE_WALL")
      expect(result.stderr).not.toContain("CommandNotFoundException")
    },
  )

  it.skipIf(process.platform !== "win32" || process.env.WILLIAMOS_HERMES_VALIDATION_ISOLATED === "1")(
    "fails closed on a malformed persisted campaign window",
    () => {
      const { root, script } = isolatedSupervisor()
      const workspace = path.join(root, "workspace")
      const runtimeRoot = path.join(root, "runtime")
      const activationPath = path.join(runtimeRoot, "control", "activation")
      const campaignPath = path.join(runtimeRoot, "state", "campaign-window")
      const cliPath = path.join(workspace, "scripts", "hermes-bridge", "cli.mjs")
      fs.mkdirSync(path.dirname(activationPath), { recursive: true })
      fs.mkdirSync(path.dirname(campaignPath), { recursive: true })
      fs.mkdirSync(path.dirname(cliPath), { recursive: true })
      fs.writeFileSync(activationPath, "enabled\n")
      fs.writeFileSync(campaignPath, `campaign:${"a".repeat(16)} ${"b".repeat(16)}\n`)
      fs.writeFileSync(cliPath, 'process.stdout.write("should-not-run")')
      fs.writeFileSync(path.join(workspace, ".env.local"), "")
      const quote = (value: string) => `'${value.replaceAll("'", "''")}'`
      const result = spawnSync(
        "pwsh",
        ["-NoLogo", "-NoProfile", "-NonInteractive", "-Command",
          `& ${quote(script)} -Workspace ${quote(workspace)} -RuntimeRoot ${quote(runtimeRoot)} -RunOnce`],
        { encoding: "utf8", timeout: 15_000 },
      )
      expect(result.status).not.toBe(0)
      expect(result.stderr).toContain("HERMES_CAMPAIGN_WINDOW_INVALID")
      expect(result.stdout).not.toContain("should-not-run")
    },
  )

  it.skipIf(process.platform !== "win32" || process.env.WILLIAMOS_HERMES_VALIDATION_ISOLATED === "1")(
    "keeps a long owned cycle fresh with independent heartbeat pulses",
    async () => {
      const { root, script } = isolatedSupervisor()
      const runtimeRoot = path.join(root, "runtime")
      const activationPath = path.join(runtimeRoot, "control", "activation")
      const completedPath = path.join(root, "completed.json")
      fs.mkdirSync(path.dirname(activationPath), { recursive: true })
      fs.writeFileSync(activationPath, "enabled\n")
      const quote = (value: string) => `'${value.replaceAll("'", "''")}'`
      const action = [
        "param([string]$OwnedWorkspace,[string]$OwnedCliPath,[string]$OwnedRuntimeRoot)",
        "Start-Sleep -Milliseconds 3200",
        '[PSCustomObject]@{ ExitCode=0; Result="QUEUE_DRAINED"; StopReason="NO_OUTCOME" }',
      ].join("; ")
      const sleep = [
        "param([int]$Seconds)",
        `Copy-Item -LiteralPath (Join-Path ${quote(runtimeRoot)} 'state\\supervisor.json') -Destination ${quote(completedPath)}`,
        `Set-Content -LiteralPath ${quote(activationPath)} -Value disabled`,
      ].join("; ")
      const child = spawn("pwsh", [
        "-NoLogo", "-NoProfile", "-NonInteractive", "-Command",
        `& ${quote(script)} -Workspace ${quote(repoRoot)} -RuntimeRoot ${quote(runtimeRoot)} -CycleIntervalSeconds 1 -CycleBudgetSeconds 6 -HeartbeatIntervalSeconds 1 -CycleAction { ${action} } -SleepAction { ${sleep} }`,
      ])
      let stderr = ""
      child.stderr.on("data", (chunk) => { stderr += String(chunk) })
      const statePath = path.join(runtimeRoot, "state", "supervisor.json")
      let before: { heartbeatAt: string; cycle: { status: string } } | null = null
      for (let attempt = 0; attempt < 40 && before === null; attempt += 1) {
        await new Promise((resolve) => setTimeout(resolve, 100))
        try {
          const candidate = JSON.parse(fs.readFileSync(statePath, "utf8"))
          if (candidate.cycle.status === "IN_FLIGHT") before = candidate
        } catch {
          // Atomic replacement can race the open; retry the observer only.
        }
      }
      expect(before?.cycle.status).toBe("IN_FLIGHT")
      await new Promise((resolve) => setTimeout(resolve, 2200))
      const pulsed = JSON.parse(fs.readFileSync(statePath, "utf8"))
      expect(Date.parse(pulsed.heartbeatAt)).toBeGreaterThan(Date.parse(before!.heartbeatAt))
      const exitCode = await new Promise<number | null>((resolve) => child.on("close", resolve))
      expect(exitCode, stderr).toBe(0)
      const logs = fs.readdirSync(path.join(runtimeRoot, "logs"))
        .map((file) => fs.readFileSync(path.join(runtimeRoot, "logs", file), "utf8"))
        .join("\n")
      expect(JSON.parse(fs.readFileSync(completedPath, "utf8")), logs).toMatchObject({
        cycle: {
          status: "IDLE",
          result: "QUEUE_DRAINED",
          stopReason: "NO_OUTCOME",
          exitCode: 0,
          consecutiveFailures: 0,
        },
      })
    },
    15_000,
  )

  it.skipIf(process.platform !== "win32" || process.env.WILLIAMOS_HERMES_VALIDATION_ISOLATED === "1")(
    "terminates only an over-budget owned cycle and records the wall before stopping",
    () => {
      const { root, script } = isolatedSupervisor()
      const runtimeRoot = path.join(root, "runtime")
      const activationPath = path.join(runtimeRoot, "control", "activation")
      const forbiddenMarker = path.join(root, "cycle-finished.txt")
      const completedPath = path.join(root, "completed.json")
      fs.mkdirSync(path.dirname(activationPath), { recursive: true })
      fs.writeFileSync(activationPath, "enabled\n")
      const quote = (value: string) => `'${value.replaceAll("'", "''")}'`
      const action = [
        "param([string]$OwnedWorkspace,[string]$OwnedCliPath,[string]$OwnedRuntimeRoot)",
        "Start-Sleep -Seconds 10",
        `[IO.File]::WriteAllText(${quote(forbiddenMarker)}, "unsafe")`,
        "return 0",
      ].join("; ")
      const sleep = [
        "param([int]$Seconds)",
        `Copy-Item -LiteralPath (Join-Path ${quote(runtimeRoot)} 'state\\supervisor.json') -Destination ${quote(completedPath)}`,
        `Set-Content -LiteralPath ${quote(activationPath)} -Value disabled`,
      ].join("; ")
      const result = spawnSync("pwsh", [
        "-NoLogo", "-NoProfile", "-NonInteractive", "-Command",
        `& ${quote(script)} -Workspace ${quote(repoRoot)} -RuntimeRoot ${quote(runtimeRoot)} -CycleIntervalSeconds 1 -CycleBudgetSeconds 1 -HeartbeatIntervalSeconds 1 -CycleAction { ${action} } -SleepAction { ${sleep} }`,
      ], { encoding: "utf8", timeout: 10_000 })

      expect(result.status, result.stderr).toBe(0)
      expect(fs.existsSync(forbiddenMarker)).toBe(false)
      const completed = JSON.parse(fs.readFileSync(completedPath, "utf8"))
      expect(completed.processId).toBeGreaterThan(0)
      expect(completed.cycle).toMatchObject({
        status: "IDLE",
        result: "WALL",
        stopReason: "CYCLE_BUDGET_EXCEEDED",
        exitCode: 124,
        consecutiveFailures: 1,
      })
    },
  )

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
    expect(supervisor).toContain('$startInfo.Environment["WILLIAMOS_HERMES_RUNTIME_ROOT"]')
    expect(supervisor).toContain('$startInfo.Environment["HERMES_CAMPAIGN_WINDOW_ID"]')
    expect(supervisor).toContain('$startInfo.Environment["HERMES_PROCESS_IDENTITY"]')
    expect(supervisor).toContain('Join-Path $stateDir "campaign-window"')
    expect(supervisor).toContain("::ReadAllText($Path, [Text.UTF8Encoding]::new($false)).Trim()")
    expect(supervisor).toContain("'\\Acampaign:[0-9a-f]{32}\\z'")
    expect(supervisor).toContain("[IO.File]::Move($temporary, $Path)")
    expect(supervisor).toContain("HERMES_CAMPAIGN_WINDOW_INVALID")
    expect(supervisor).toContain("$runtimeRootPath = [IO.Path]::GetFullPath($RuntimeRoot)")
    expect(supervisor).toContain("Get-Command node -CommandType Application -All -ErrorAction Stop")
    expect(supervisor).toContain("[Diagnostics.FileVersionInfo]::GetVersionInfo($candidatePath)")
    expect(supervisor).toContain('$versionInfo.ProductName -ceq "Node.js"')
    expect(supervisor).toContain('$versionInfo.OriginalFilename -ceq "node.exe"')
    expect(supervisor.indexOf("$nodePath = Resolve-OwnedNodePath")).toBeGreaterThan(
      supervisor.indexOf('if ($null -ne $customCycleAction)'),
    )
    expect(supervisor).toContain("HERMES_SUPERVISOR_NODE_EXECUTABLE_WALL")
    expect(supervisor).toContain("$startInfo.FileName = $OwnedNodePath")
    expect(supervisor).not.toContain('$startInfo.FileName = "node"')
    expect(supervisor).toContain("$startInfo.Arguments = Join-WindowsCommandLineArguments")
    expect(supervisor).not.toContain("$startInfo.ArgumentList")
    expect(supervisor).not.toContain("& pwsh.exe")
    expect(supervisor).toContain("Global\\WilliamOSHermesCodexBridgeSupervisor")
    expect(supervisor).not.toContain("[string]$MutexName")
    expect(supervisor).toContain("HERMES_SUPERVISOR_CYCLE_FAILED")
    expect(supervisor).toContain("HERMES_SUPERVISOR_STATE_CLEANUP_FAILED")
    expect(supervisor).toContain("Write-SupervisorState")
    expect(supervisor).toContain('$record.cycle.status = "IN_FLIGHT"')
    expect(supervisor).toContain('$record.cycle.status = "IDLE"')
    expect(supervisor).toContain("ConvertTo-SupervisorToken")
  })

  it("does not reuse the rejected nested Codex execution adapter", () => {
    const sources = [supervisorScript, installScript]
      .map((file) => fs.readFileSync(file, "utf8"))
      .join("\n")
    expect(sources).not.toMatch(/codex\s+exec|scripts[\\/]runtime-operator/i)
  })

  it("does not put a nested PowerShell process between the resident supervisor and one-shot CLI", () => {
    const source = fs.readFileSync(supervisorScript, "utf8")
    expect(source).toContain("[Diagnostics.ProcessStartInfo]::new()")
    expect(source).toContain("$process.Kill($true)")
    expect(source).not.toContain("Start-Job")
    expect(source).not.toContain("run-cycle.ps1")
    expect(source).not.toContain("& pwsh.exe")
    const cliSource = fs.readFileSync(
      path.join(repoRoot, "scripts", "hermes-bridge", "cli.mjs"),
      "utf8",
    )
    // Assert the injection seam, not the factory's name: the default factory was renamed while
    // the injectable-with-default contract this guards stayed exactly the same.
    expect(cliSource).toMatch(/const queueRuntime = options\.queueRuntime \?\? create\w*QueueRuntime\(\)/)
  })
})
