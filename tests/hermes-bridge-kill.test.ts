import { spawn, spawnSync } from "node:child_process"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { afterEach, describe, expect, it } from "vitest"

const repoRoot = process.cwd()
const killScript = path.join(repoRoot, "scripts", "hermes-bridge", "kill.ps1")
const spawnedPids = new Set<number>()

function isAlive(pid: number) {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

async function waitFor(predicate: () => boolean, timeoutMs = 5_000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (predicate()) return
    await new Promise((resolve) => setTimeout(resolve, 50))
  }
  throw new Error("timed out waiting for process state")
}

function spawnOwnedHolder(tempRoot: string, childDelayMs?: number) {
  const fixturePath = path.join(tempRoot, "owned-holder.cjs")
  const childPidPath = path.join(tempRoot, "child.pid")
  fs.writeFileSync(fixturePath, [
    'const { spawn } = require("node:child_process")',
    'const fs = require("node:fs")',
    'const delay = Number(process.env.HERMES_TEST_CHILD_DELAY_MS ?? "-1")',
    'if (delay >= 0) setTimeout(() => {',
    '  const child = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], { stdio: "ignore" })',
    '  fs.writeFileSync(process.env.HERMES_TEST_CHILD_PID_PATH, String(child.pid))',
    '}, delay)',
    'setInterval(() => {}, 1000)',
  ].join("\n"))
  const holder = spawn(process.execPath, [fixturePath, "cycle"], {
    stdio: "ignore",
    env: {
      ...process.env,
      HERMES_TEST_CHILD_DELAY_MS: childDelayMs === undefined ? "-1" : String(childDelayMs),
      HERMES_TEST_CHILD_PID_PATH: childPidPath,
    },
  })
  if (!holder.pid) throw new Error("failed to spawn holder")
  spawnedPids.add(holder.pid)
  return { holder, fixturePath, childPidPath }
}

afterEach(() => {
  for (const pid of spawnedPids) {
    if (isAlive(pid)) process.kill(pid)
  }
  spawnedPids.clear()
})

describe.skipIf(process.platform !== "win32" || process.env.WILLIAMOS_HERMES_VALIDATION_ISOLATED === "1")(
  "Hermes bridge kill switch",
  () => {
  it("stops only the verified durable holder process tree", async () => {
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "hermes-kill-"))
    const childPidPath = path.join(tempRoot, "child.pid")
    const activationPath = path.join(tempRoot, "activation")
    const statePath = path.join(tempRoot, "state.json")
    const { holder, fixturePath } = spawnOwnedHolder(tempRoot, 0)
    const unrelated = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], { stdio: "ignore" })
    if (!unrelated.pid) throw new Error("failed to spawn unrelated process")
    spawnedPids.add(unrelated.pid)

    await waitFor(() => fs.existsSync(childPidPath))
    const childPid = Number(fs.readFileSync(childPidPath, "utf8"))
    spawnedPids.add(childPid)
    fs.writeFileSync(statePath, JSON.stringify({
      executions: {
        test: {
          lease: {
            status: "ACTIVE",
            holderId: `${os.hostname()}:${holder.pid}:00000000-0000-0000-0000-000000000001`,
          },
        },
      },
    }))

    const result = spawnSync("pwsh", [
      "-NoLogo", "-NoProfile", "-NonInteractive", "-File", killScript,
      "-Workspace", repoRoot,
      "-StatePath", statePath,
      "-ActivationPath", activationPath,
      "-OwnedCliPath", fixturePath,
      "-SkipScheduledTask",
      "-SkipSupervisor",
    ], { encoding: "utf8" })

    expect(result.status, result.stderr).toBe(0)
    await waitFor(() => !isAlive(holder.pid!) && !isAlive(childPid))
    expect(isAlive(unrelated.pid)).toBe(true)
    expect(fs.readFileSync(activationPath, "utf8").trim()).toBe("disabled")
  }, 30_000)

  it("fails closed when the durable PID does not belong to the absolute bridge command", () => {
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "hermes-kill-wall-"))
    const mentionedCliPath = path.join(tempRoot, "mentioned-cli.mjs")
    const unrelated = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)", mentionedCliPath, "cycle"], { stdio: "ignore" })
    if (!unrelated.pid) throw new Error("failed to spawn unrelated process")
    spawnedPids.add(unrelated.pid)
    const statePath = path.join(tempRoot, "state.json")
    const activationPath = path.join(tempRoot, "activation")
    fs.writeFileSync(statePath, JSON.stringify({
      executions: {
        test: {
          lease: {
            status: "ACTIVE",
            holderId: `${os.hostname()}:${unrelated.pid}:00000000-0000-0000-0000-000000000002`,
          },
        },
      },
    }))

    const result = spawnSync("pwsh", [
      "-NoLogo", "-NoProfile", "-NonInteractive", "-File", killScript,
      "-Workspace", repoRoot,
      "-StatePath", statePath,
      "-ActivationPath", activationPath,
      "-OwnedCliPath", mentionedCliPath,
      "-SkipScheduledTask",
      "-SkipSupervisor",
    ], { encoding: "utf8" })

    expect(result.status).not.toBe(0)
    expect(`${result.stdout}\n${result.stderr}`).toContain("HERMES_KILL_OWNERSHIP_WALL")
    expect(isAlive(unrelated.pid)).toBe(true)
    expect(fs.readFileSync(activationPath, "utf8").trim()).toBe("disabled")
  }, 30_000)

  it("raises the survivor wall before touching unrelated processes", async () => {
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "hermes-kill-survivor-"))
    const activationPath = path.join(tempRoot, "activation")
    const statePath = path.join(tempRoot, "state.json")
    const { holder, fixturePath } = spawnOwnedHolder(tempRoot)
    const unrelated = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], { stdio: "ignore" })
    if (!unrelated.pid) throw new Error("failed to spawn unrelated process")
    spawnedPids.add(unrelated.pid)
    fs.writeFileSync(statePath, JSON.stringify({
      executions: {
        test: {
          lease: {
            status: "ACTIVE",
            holderId: `${os.hostname()}:${holder.pid}:00000000-0000-0000-0000-000000000003`,
          },
        },
      },
    }))

    const quote = (value: string) => `'${value.replaceAll("'", "''")}'`
    const command = [
      `& ${quote(killScript)}`,
      `-Workspace ${quote(repoRoot)}`,
      `-StatePath ${quote(statePath)}`,
      `-ActivationPath ${quote(activationPath)}`,
      `-OwnedCliPath ${quote(fixturePath)}`,
      "-SkipScheduledTask",
      "-SkipSupervisor",
      "-StopProcessAction { param([int]$ProcessId) }",
    ].join(" ")
    const result = spawnSync("pwsh", ["-NoLogo", "-NoProfile", "-NonInteractive", "-Command", command], { encoding: "utf8" })

    expect(result.status).not.toBe(0)
    expect(`${result.stdout}\n${result.stderr}`).toContain("HERMES_KILL_PROCESS_SURVIVED_WALL")
    expect(isAlive(holder.pid)).toBe(true)
    expect(isAlive(unrelated.pid)).toBe(true)
    expect(fs.readFileSync(activationPath, "utf8").trim()).toBe("disabled")
  }, 45_000)

  it("rescans and stops a descendant created after the first tree snapshot", async () => {
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "hermes-kill-rescan-"))
    const activationPath = path.join(tempRoot, "activation")
    const statePath = path.join(tempRoot, "state.json")
    const { holder, fixturePath, childPidPath } = spawnOwnedHolder(tempRoot, 150)
    fs.writeFileSync(statePath, JSON.stringify({
      executions: {
        test: {
          lease: {
            status: "ACTIVE",
            holderId: `${os.hostname()}:${holder.pid}:00000000-0000-0000-0000-000000000004`,
          },
        },
      },
    }))

    const quote = (value: string) => `'${value.replaceAll("'", "''")}'`
    const command = [
      `& ${quote(killScript)}`,
      `-Workspace ${quote(repoRoot)}`,
      `-StatePath ${quote(statePath)}`,
      `-ActivationPath ${quote(activationPath)}`,
      `-OwnedCliPath ${quote(fixturePath)}`,
      "-SkipScheduledTask",
      "-SkipSupervisor",
      `-StopProcessAction { param([int]$ProcessId) if ($ProcessId -eq ${holder.pid}) { Start-Sleep -Milliseconds 400 }; Stop-Process -Id $ProcessId -Force -ErrorAction SilentlyContinue }`,
    ].join(" ")
    const result = spawnSync("pwsh", ["-NoLogo", "-NoProfile", "-NonInteractive", "-Command", command], { encoding: "utf8" })

    expect(result.status, result.stderr).toBe(0)
    expect(fs.existsSync(childPidPath)).toBe(true)
    const childPid = Number(fs.readFileSync(childPidPath, "utf8"))
    spawnedPids.add(childPid)
    await waitFor(() => !isAlive(holder.pid!) && !isAlive(childPid))
  }, 20_000)

  it("stops only the supervisor named by the exact durable supervisor record", async () => {
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "hermes-supervisor-kill-"))
    const supervisorPath = path.join(tempRoot, "supervisor.ps1")
    const supervisorStatePath = path.join(tempRoot, "supervisor.json")
    const activationPath = path.join(tempRoot, "activation")
    const statePath = path.join(tempRoot, "missing-state.json")
    fs.writeFileSync(supervisorPath, "while ($true) { Start-Sleep -Seconds 1 }\n")
    const supervisor = spawn("pwsh", [
      "-NoLogo", "-NoProfile", "-NonInteractive", "-File", supervisorPath,
    ], { stdio: "ignore" })
    if (!supervisor.pid) throw new Error("failed to spawn supervisor")
    spawnedPids.add(supervisor.pid)
    fs.writeFileSync(supervisorStatePath, JSON.stringify({
      schemaVersion: 1,
      hostName: os.hostname(),
      processId: supervisor.pid,
      nonce: "00000000-0000-0000-0000-000000000005",
      supervisorPath,
    }))

    const result = spawnSync("pwsh", [
      "-NoLogo", "-NoProfile", "-NonInteractive", "-File", killScript,
      "-Workspace", repoRoot,
      "-StatePath", statePath,
      "-SupervisorStatePath", supervisorStatePath,
      "-ActivationPath", activationPath,
      "-OwnedSupervisorPath", supervisorPath,
      "-SkipScheduledTask",
    ], { encoding: "utf8" })

    expect(result.status, result.stderr).toBe(0)
    await waitFor(() => !isAlive(supervisor.pid!))
    expect(fs.existsSync(supervisorStatePath)).toBe(false)
    expect(fs.readFileSync(activationPath, "utf8").trim()).toBe("disabled")
  }, 20_000)

  it("rescans and stops a supervisor descendant created during shutdown", async () => {
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "hermes-supervisor-rescan-"))
    const supervisorPath = path.join(tempRoot, "supervisor.ps1")
    const childPath = path.join(tempRoot, "child.cjs")
    const childPidPath = path.join(tempRoot, "child.pid")
    const supervisorStatePath = path.join(tempRoot, "supervisor.json")
    const activationPath = path.join(tempRoot, "activation")
    fs.writeFileSync(childPath, "setInterval(() => {}, 1000)\n")
    fs.writeFileSync(supervisorPath, [
      "Start-Sleep -Milliseconds 150",
      `$child = Start-Process -FilePath ${JSON.stringify(process.execPath)} -ArgumentList ${JSON.stringify(childPath)} -PassThru`,
      `[IO.File]::WriteAllText(${JSON.stringify(childPidPath)}, [string]$child.Id)`,
      "while ($true) { Start-Sleep -Seconds 1 }",
    ].join("\n"))
    const supervisor = spawn("pwsh", ["-NoLogo", "-NoProfile", "-NonInteractive", "-File", supervisorPath], { stdio: "ignore" })
    if (!supervisor.pid) throw new Error("failed to spawn supervisor")
    spawnedPids.add(supervisor.pid)
    fs.writeFileSync(supervisorStatePath, JSON.stringify({
      schemaVersion: 1,
      hostName: os.hostname(),
      processId: supervisor.pid,
      nonce: "00000000-0000-0000-0000-000000000006",
      supervisorPath,
    }))

    const quote = (value: string) => `'${value.replaceAll("'", "''")}'`
    const command = [
      `& ${quote(killScript)}`,
      `-Workspace ${quote(repoRoot)}`,
      `-StatePath ${quote(path.join(tempRoot, "missing-state.json"))}`,
      `-SupervisorStatePath ${quote(supervisorStatePath)}`,
      `-ActivationPath ${quote(activationPath)}`,
      `-OwnedSupervisorPath ${quote(supervisorPath)}`,
      "-SkipScheduledTask",
      `-StopProcessAction { param([int]$ProcessId) if ($ProcessId -eq ${supervisor.pid}) { Start-Sleep -Milliseconds 400 }; Stop-Process -Id $ProcessId -Force -ErrorAction SilentlyContinue }`,
    ].join(" ")
    const result = spawnSync("pwsh", ["-NoLogo", "-NoProfile", "-NonInteractive", "-Command", command], { encoding: "utf8" })

    expect(result.status, result.stderr).toBe(0)
    expect(fs.existsSync(childPidPath)).toBe(true)
    const childPid = Number(fs.readFileSync(childPidPath, "utf8"))
    spawnedPids.add(childPid)
    await waitFor(() => !isAlive(supervisor.pid!) && !isAlive(childPid))
  }, 20_000)
  },
)
