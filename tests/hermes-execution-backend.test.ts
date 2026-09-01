import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { spawn, spawnSync } from "node:child_process"
import { createHash } from "node:crypto"

import { describe, expect, it } from "vitest"

import {
  AegisExecutionBackend,
  ExecutionBackend,
  LocalExecutionBackend,
  ResidentModelExecutionBackend,
  selectExecutionBackend,
} from "../scripts/hermes-bridge/execution-backend.mjs"
import { DESCRIPTOR_BOUND_VALIDATION_SCRIPT } from "../scripts/hermes-bridge/repository-lifecycle.mjs"

type Call = { command: string; args: string[]; cwd?: string; timeoutMs?: number; env?: Record<string, string> }

describe("execution backends", () => {
  it("selects AEGIS only for a non-empty execution node", () => {
    expect(selectExecutionBackend({})).toBeInstanceOf(LocalExecutionBackend)
    expect(selectExecutionBackend({ WILLIAMOS_CODEX_EXEC_NODE: "  " })).toBeInstanceOf(LocalExecutionBackend)
    expect(selectExecutionBackend({ WILLIAMOS_CODEX_EXEC_NODE: "aegis" })).toBeInstanceOf(AegisExecutionBackend)
    expect(selectExecutionBackend({})).toBeInstanceOf(ExecutionBackend)
  })

  it("selects the resident model backend only on an exact opt-in", () => {
    expect(selectExecutionBackend({ WILLIAMOS_EXECUTOR: "resident-model" })).toBeInstanceOf(ResidentModelExecutionBackend)
    for (const value of ["resident", "resident-model ", "RESIDENT-MODEL", "", " "]) {
      expect(selectExecutionBackend({ WILLIAMOS_EXECUTOR: value })).not.toBeInstanceOf(ResidentModelExecutionBackend)
    }
    // A governed AEGIS node owns file/worktree mechanics even when a resident
    // model is configured; this prevents Windows local snapshot bypass.
    expect(selectExecutionBackend({ WILLIAMOS_EXECUTOR: "resident-model", WILLIAMOS_CODEX_EXEC_NODE: "aegis" }))
      .toBeInstanceOf(AegisExecutionBackend)
    const governed = selectExecutionBackend({
      WILLIAMOS_EXECUTOR: "resident-model",
      WILLIAMOS_CODEX_EXEC_NODE: "aegis",
      WILLIAMOS_HERMES_RUNTIME_ROOT: "C:\\Users\\operator\\.williamos\\hermes-bridge",
    }) as AegisExecutionBackend
    expect(governed.runtimeRoot).toBe("/srv/william/hermes")
    const governedWithRemoteRoot = selectExecutionBackend({
      WILLIAMOS_CODEX_EXEC_NODE: "aegis",
      WILLIAMOS_HERMES_RUNTIME_ROOT: "C:\\local-only",
      WILLIAMOS_AEGIS_RUNTIME_ROOT: "/srv/aegis/hermes",
    }) as AegisExecutionBackend
    expect(governedWithRemoteRoot.runtimeRoot).toBe("/srv/aegis/hermes")
    // Absent the opt-in, existing selection is untouched.
    expect(selectExecutionBackend({ WILLIAMOS_CODEX_EXEC_NODE: "aegis" })).toBeInstanceOf(AegisExecutionBackend)
    expect(selectExecutionBackend({})).toBeInstanceOf(LocalExecutionBackend)
  })

  it("inherits every model-agnostic mechanic and routes the Codex seam through the Hermes-kernel client", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "hermes-resident-"))
    const repositoryRoot = path.join(root, "repository")
    fs.mkdirSync(repositoryRoot)
    const calls: Call[] = []
    const backend = new ResidentModelExecutionBackend({
      runtimeRoot: path.join(root, "runtime"), repositoryRoot,
      commandRunner: async (call: Call) => { calls.push(call); return { code: 0, stdout: "ok", stderr: "" } },
    })
    expect(backend).toBeInstanceOf(LocalExecutionBackend)

    const { workspacePath } = await backend.prepareWorkspace({ branch: "codex/resident-1", baseSha: "b".repeat(40), repository: "bsvalues/terragroq" })
    fs.mkdirSync(workspacePath, { recursive: true })
    fs.writeFileSync(path.join(workspacePath, "present.txt"), "yes")
    expect(await backend.stat({ workspacePath, relPath: "present.txt" })).toEqual({ exists: true, isFile: true })
    if (process.platform === "win32") {
      await expect(backend.snapshotFile({ workspacePath, relPath: "present.txt" }))
        .rejects.toMatchObject({ code: "HERMES_REPOSITORY_SNAPSHOT_WALL" })
    } else {
      expect(await backend.snapshotFile({ workspacePath, relPath: "present.txt" })).toEqual({
        sha256: createHash("sha256").update("yes").digest("hex"),
      })
    }
    expect(await backend.validate({ workspacePath, commands: [{ command: "npm", args: ["test"], timeoutMs: 1000 }] }))
      .toEqual([{ exitCode: 0, stdout: "ok", stderr: "" }])
    expect(await backend.git({ workspacePath, args: ["status"] })).toEqual({ exitCode: 0, stdout: "ok" })
    await backend.cleanup({ workspacePath })
    expect(calls.at(-1)?.args).toEqual(["-C", repositoryRoot, "worktree", "remove", workspacePath])

    // S2: the seam returns the Hermes-kernel adapter, never a Codex client.
    const client = await backend.runCodexClient({ workspacePath, timeoutMs: 1234 })
    expect(Object.keys(client).sort()).toEqual(["close", "connect", "resumeThread", "runTurn", "startThread"])
    // Lane checks are enforced by the client, not the backend: no policy here → wall on connect.
    await expect(client.connect()).rejects.toMatchObject({ code: "RESIDENT_MODEL_LANE_POLICY_UNREADABLE" })
    // Argument discipline still matches the parent contract.
    await expect(backend.runCodexClient({})).rejects.toBeInstanceOf(TypeError)
    fs.rmSync(root, { recursive: true, force: true })
  })

  it("keeps local execution, filesystem checks, validation, git, and Codex cwd local", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "hermes-backend-"))
    const repositoryRoot = path.join(root, "repository")
    fs.mkdirSync(repositoryRoot)
    const calls: Call[] = []
    const clientOptions: unknown[] = []
    const backend = new LocalExecutionBackend({
      runtimeRoot: path.join(root, "runtime"), repositoryRoot,
      commandRunner: async (call: Call) => { calls.push(call); return { code: 0, stdout: "ok", stderr: "" } },
      clientFactory: (options: unknown) => { clientOptions.push(options); return { kind: "client" } },
    })

    const { workspacePath } = await backend.prepareWorkspace({ branch: "codex/hermes-goal-7", baseSha: "a".repeat(40), repository: "bsvalues/terragroq" })
    fs.mkdirSync(workspacePath, { recursive: true })
    fs.writeFileSync(path.join(workspacePath, "present.txt"), "yes")
    expect(await backend.stat({ workspacePath, relPath: "present.txt" })).toEqual({ exists: true, isFile: true })
    expect(await backend.stat({ workspacePath, relPath: "missing.txt" })).toEqual({ exists: false, isFile: false })
    expect(await backend.runCodexClient({ workspacePath, timeoutMs: 42 })).toEqual({ kind: "client" })
    expect(clientOptions).toEqual([{ cwd: workspacePath, timeoutMs: 42 }])
    expect(await backend.validate({ workspacePath, commands: [{ command: "npm", args: ["test"], timeoutMs: 1000 }] }))
      .toEqual([{ exitCode: 0, stdout: "ok", stderr: "" }])
    expect(await backend.git({ workspacePath, args: ["status"] })).toEqual({ exitCode: 0, stdout: "ok" })
    await backend.cleanup({ workspacePath })
    expect(calls[1]).toMatchObject({ command: "git", cwd: repositoryRoot,
      args: ["-C", repositoryRoot, "worktree", "add", "-b", "codex/hermes-goal-7", workspacePath, "a".repeat(40)] })
    expect(calls.some((call) => call.command === "npm" && call.cwd === workspacePath)).toBe(true)
    expect(calls.at(-1)?.args).toEqual(["-C", repositoryRoot, "worktree", "remove", workspacePath])
    fs.rmSync(root, { recursive: true, force: true })
  })

  it("rejects a validation working-directory symlink that resolves outside the local workspace", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "hermes-validation-link-"))
    const workspacePath = path.join(root, "workspace")
    const outside = path.join(root, "outside")
    fs.mkdirSync(workspacePath)
    fs.mkdirSync(outside)
    fs.symlinkSync(outside, path.join(workspacePath, "linked"), process.platform === "win32" ? "junction" : "dir")
    const calls: Call[] = []
    const backend = new LocalExecutionBackend({
      repositoryRoot: workspacePath,
      commandRunner: async (call: Call) => { calls.push(call); return { code: 0, stdout: "", stderr: "" } },
    })
    await expect(backend.validate({
      workspacePath,
      commands: [{ command: "npm", args: ["test"], workingDirectory: "linked" }],
    })).rejects.toThrow("resolves outside workspace")
    expect(calls.some((call) => call.command === "npm")).toBe(false)
    fs.rmSync(root, { recursive: true, force: true })
  })

  it("constructs bounded SSH commands for every AEGIS operation", async () => {
    const calls: Call[] = []
    const backend = new AegisExecutionBackend({
      host: "aegis-worker", runtimeRoot: "/worker/runtime", repositoryRoot: "/worker/repo",
      commandRunner: async (call: Call) => {
        calls.push(call)
        if (call.args.at(-1)?.includes("'test' '-e' '/worker/runtime/worktrees/goal-8/file.txt' '-a' '-f'")) return { code: 0 }
        if (call.args.at(-1)?.includes("os.fchdir(current_fd)")) {
          return { code: 0, stdout: "remote", stderr: "" }
        }
        if (call.args.at(-1)?.includes("exec 'python3' '-c'")) return { code: 0, stdout: `${"c".repeat(64)}\n` }
        return { code: 0, stdout: "remote", stderr: "" }
      },
    })
    const { workspacePath } = await backend.prepareWorkspace({ branch: "codex/goal-8", baseSha: "b".repeat(40), repository: "bsvalues/terragroq" })
    expect(workspacePath).toBe("/worker/runtime/worktrees/goal-8")
    await backend.runCommand({ workspacePath, command: "npm", args: ["test", "it's-safe"], timeoutMs: 9000,
      env: { NEXT_TELEMETRY_DISABLED: "1" } })
    expect(await backend.stat({ workspacePath, relPath: "file.txt" })).toEqual({ exists: true, isFile: true })
    expect(await backend.snapshotFile({ workspacePath, relPath: "file.txt" })).toEqual({ sha256: "c".repeat(64) })
    await expect(backend.validate({ workspacePath, commands: [{
      command: "npm", args: ["run", "build"], workingDirectory: "frontend",
    }] })).resolves.toEqual([{ exitCode: 0, stdout: "remote", stderr: "" }])
    await backend.git({ workspacePath, args: ["status", "--short"] })
    await backend.cleanup({ workspacePath })

    for (const call of calls) expect(call).toMatchObject({ command: "ssh", args: ["-o", "BatchMode=yes", "aegis-worker", expect.any(String)] })
    expect(calls[2].args.at(-1)).toContain("'git' '-C' '/worker/repo' 'worktree' 'add'")
    expect(calls[3].args.at(-1)).toContain("cd -- '/worker/runtime/worktrees/goal-8' && NEXT_TELEMETRY_DISABLED='1' exec 'npm' 'test' 'it'\"'\"'s-safe'")
    const validationCall = calls.find((call) => call.args.at(-1)?.includes("os.fchdir(current_fd)"))
    expect(validationCall?.args.at(-1)).toContain("os.O_NOFOLLOW")
    expect(validationCall?.args.at(-1)).toContain("'/worker/runtime/worktrees/goal-8' 'frontend' '1' 'npm' 'run' 'build'")
    expect(calls.some((call) => call.args.at(-1)?.includes("exec 'rm' '-rf' '--' '.next'"))).toBe(false)
    expect(calls.some((call) => call.args.at(-1)?.includes("cd -- '/worker/runtime/worktrees/goal-8/frontend'"))).toBe(false)
    expect(calls.at(-1)?.args.at(-1)).toContain("'git' '-C' '/worker/repo' 'worktree' 'remove'")
  })

  it("fails a descriptor-bound AEGIS validation before the requested command when a component escapes", async () => {
    const calls: Call[] = []
    const backend = new AegisExecutionBackend({
      host: "aegis",
      commandRunner: async (call: Call) => {
        calls.push(call)
        return call.args.at(-1)?.includes("os.fchdir(current_fd)")
          ? { code: 73, stdout: "", stderr: "" }
          : { code: 0, stdout: "", stderr: "" }
      },
    })
    await expect(backend.validate({
      workspacePath: "/srv/william/hermes/worktrees/outcome-44",
      commands: [{ command: "npm", args: ["test"], workingDirectory: "linked" }],
    })).resolves.toEqual([{ exitCode: 73, stdout: "", stderr: "" }])
    expect(calls).toHaveLength(1)
    expect(calls[0].args.at(-1)).toContain("os.O_NOFOLLOW")
    expect(calls[0].args.at(-1)).toContain("os.fchdir(current_fd)")
  })

  it.runIf(process.platform !== "win32")(
    "executes the production descriptor helper, cleans build output, rejects links, and holds the opened directory across a swap",
    async () => {
      const root = fs.mkdtempSync(path.join(os.tmpdir(), "hermes-descriptor-validation-"))
      const external = fs.mkdtempSync(path.join(os.tmpdir(), "hermes-descriptor-external-"))
      const nested = path.join(root, "nested")
      const preserved = path.join(root, "preserved")
      try {
        fs.mkdirSync(path.join(nested, ".next"), { recursive: true })
        fs.writeFileSync(path.join(nested, ".next", "stale"), "stale")
        fs.writeFileSync(path.join(nested, "marker"), "trusted")
        fs.writeFileSync(path.join(external, "marker"), "untrusted")

        const direct = spawnSync("python3", [
          "-c", DESCRIPTOR_BOUND_VALIDATION_SCRIPT,
          root, "nested", "1", process.execPath, "-e", "process.stdout.write(process.cwd())",
        ], { encoding: "utf8" })
        expect(direct.status).toBe(0)
        expect(direct.stdout).toBe(nested)
        expect(fs.existsSync(path.join(nested, ".next"))).toBe(false)

        fs.symlinkSync(external, path.join(root, "linked"), "dir")
        const linked = spawnSync("python3", [
          "-c", DESCRIPTOR_BOUND_VALIDATION_SCRIPT,
          root, "linked", "0", process.execPath, "-e", "process.exit(0)",
        ], { encoding: "utf8" })
        expect(linked.status).not.toBe(0)

        const child = spawn("python3", [
          "-c", DESCRIPTOR_BOUND_VALIDATION_SCRIPT,
          root, "nested", "0", process.execPath, "-e",
          "const fs=require('node:fs');fs.writeFileSync('ready','1');const end=Date.now()+5000;while(!fs.existsSync('go')&&Date.now()<end){};process.stdout.write(fs.readFileSync('marker','utf8'))",
        ], { stdio: ["ignore", "pipe", "pipe"] })
        let stdout = ""
        let stderr = ""
        child.stdout.setEncoding("utf8").on("data", (chunk) => { stdout += chunk })
        child.stderr.setEncoding("utf8").on("data", (chunk) => { stderr += chunk })
        const closed = new Promise<number | null>((resolve) => child.once("close", resolve))
        const deadline = Date.now() + 5_000
        while (!fs.existsSync(path.join(nested, "ready")) && Date.now() < deadline) {
          await new Promise((resolve) => setTimeout(resolve, 10))
        }
        expect(fs.existsSync(path.join(nested, "ready"))).toBe(true)
        fs.renameSync(nested, preserved)
        fs.symlinkSync(external, nested, "dir")
        fs.writeFileSync(path.join(preserved, "go"), "1")
        const exitCode = await closed
        expect(stderr).toBe("")
        expect(exitCode).toBe(0)
        expect(stdout).toBe("trusted")
      } finally {
        fs.rmSync(root, { recursive: true, force: true })
        fs.rmSync(external, { recursive: true, force: true })
      }
    },
    20_000,
  )

  it("rejects workspace traversal before filesystem or SSH access", async () => {
    const local = new LocalExecutionBackend({ commandRunner: async () => ({ code: 0 }) })
    await expect(local.stat({ workspacePath: "/safe/work", relPath: "../secret" })).rejects.toThrow("escapes")
    const remote = new AegisExecutionBackend({ host: "aegis", commandRunner: async () => ({ code: 0 }) })
    await expect(remote.stat({ workspacePath: "/safe/work", relPath: "../secret" })).rejects.toThrow("escapes")
    await expect(remote.snapshotFile({ workspacePath: "/safe/work", relPath: "../secret" })).rejects.toThrow("escapes")
    await expect(remote.cleanup({ workspacePath: "/unowned/work" })).rejects.toThrow("owned worktree root")
    expect(() => new AegisExecutionBackend({ host: "-oProxyCommand=bad" })).toThrow("safe SSH destination")
  })
})
