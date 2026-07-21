import { spawn, spawnSync } from "node:child_process"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { afterEach, describe, expect, it } from "vitest"

const repoRoot = process.cwd()
const killScript = path.join(repoRoot, "scripts", "hermes-bridge", "kill.ps1")
const cliPath = path.join(repoRoot, "scripts", "hermes-bridge", "cli.mjs")
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

afterEach(() => {
  for (const pid of spawnedPids) {
    if (isAlive(pid)) process.kill(pid)
  }
  spawnedPids.clear()
})

describe.skipIf(process.platform !== "win32")("Hermes bridge kill switch", () => {
  it("stops only the verified durable holder process tree", async () => {
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "hermes-kill-"))
    const childPidPath = path.join(tempRoot, "child.pid")
    const activationPath = path.join(tempRoot, "activation")
    const statePath = path.join(tempRoot, "state.json")
    const holderCode = [
      'const { spawn } = require("node:child_process")',
      'const fs = require("node:fs")',
      'const child = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], { stdio: "ignore" })',
      'fs.writeFileSync(process.argv[1], String(child.pid))',
      'setInterval(() => {}, 1000)',
    ].join(";")
    const holder = spawn(process.execPath, ["-e", holderCode, childPidPath, cliPath, "cycle"], { stdio: "ignore" })
    const unrelated = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], { stdio: "ignore" })
    if (!holder.pid || !unrelated.pid) throw new Error("failed to spawn test processes")
    spawnedPids.add(holder.pid)
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
      "-SkipScheduledTask",
    ], { encoding: "utf8" })

    expect(result.status, result.stderr).toBe(0)
    await waitFor(() => !isAlive(holder.pid!) && !isAlive(childPid))
    expect(isAlive(unrelated.pid)).toBe(true)
    expect(fs.readFileSync(activationPath, "utf8").trim()).toBe("disabled")
  })

  it("fails closed when the durable PID does not belong to the absolute bridge command", () => {
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "hermes-kill-wall-"))
    const unrelated = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], { stdio: "ignore" })
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
      "-SkipScheduledTask",
    ], { encoding: "utf8" })

    expect(result.status).not.toBe(0)
    expect(`${result.stdout}\n${result.stderr}`).toContain("HERMES_KILL_OWNERSHIP_WALL")
    expect(isAlive(unrelated.pid)).toBe(true)
    expect(fs.readFileSync(activationPath, "utf8").trim()).toBe("disabled")
  })

  it("raises the survivor wall before touching unrelated processes", async () => {
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "hermes-kill-survivor-"))
    const activationPath = path.join(tempRoot, "activation")
    const statePath = path.join(tempRoot, "state.json")
    const holder = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)", cliPath, "cycle"], { stdio: "ignore" })
    const unrelated = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], { stdio: "ignore" })
    if (!holder.pid || !unrelated.pid) throw new Error("failed to spawn test processes")
    spawnedPids.add(holder.pid)
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
      "-SkipScheduledTask",
      "-StopProcessAction { param([int]$ProcessId) }",
    ].join(" ")
    const result = spawnSync("pwsh", ["-NoLogo", "-NoProfile", "-NonInteractive", "-Command", command], { encoding: "utf8" })

    expect(result.status).not.toBe(0)
    expect(`${result.stdout}\n${result.stderr}`).toContain("HERMES_KILL_PROCESS_SURVIVED_WALL")
    expect(isAlive(holder.pid)).toBe(true)
    expect(isAlive(unrelated.pid)).toBe(true)
    expect(fs.readFileSync(activationPath, "utf8").trim()).toBe("disabled")
  })
})
