import fs from "node:fs"
import os from "node:os"
import path from "node:path"

import { describe, expect, it } from "vitest"

import {
  AegisExecutionBackend,
  ExecutionBackend,
  LocalExecutionBackend,
  ResidentModelExecutionBackend,
  selectExecutionBackend,
} from "../scripts/hermes-bridge/execution-backend.mjs"

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
    // Whether Codex runs outranks where Codex runs.
    expect(selectExecutionBackend({ WILLIAMOS_EXECUTOR: "resident-model", WILLIAMOS_CODEX_EXEC_NODE: "aegis" }))
      .toBeInstanceOf(ResidentModelExecutionBackend)
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

  it("constructs bounded SSH commands for every AEGIS operation", async () => {
    const calls: Call[] = []
    const backend = new AegisExecutionBackend({
      host: "aegis-worker", runtimeRoot: "/worker/runtime", repositoryRoot: "/worker/repo",
      commandRunner: async (call: Call) => {
        calls.push(call)
        if (call.args.at(-1)?.includes("'test' '-e' '/worker/runtime/worktrees/goal-8/file.txt' '-a' '-f'")) return { code: 0 }
        return { code: 0, stdout: "remote", stderr: "" }
      },
    })
    const { workspacePath } = await backend.prepareWorkspace({ branch: "codex/goal-8", baseSha: "b".repeat(40), repository: "bsvalues/terragroq" })
    expect(workspacePath).toBe("/worker/runtime/worktrees/goal-8")
    await backend.runCommand({ workspacePath, command: "npm", args: ["test", "it's-safe"], timeoutMs: 9000,
      env: { NEXT_TELEMETRY_DISABLED: "1" } })
    expect(await backend.stat({ workspacePath, relPath: "file.txt" })).toEqual({ exists: true, isFile: true })
    await backend.git({ workspacePath, args: ["status", "--short"] })
    await backend.cleanup({ workspacePath })

    for (const call of calls) expect(call).toMatchObject({ command: "ssh", args: ["-o", "BatchMode=yes", "aegis-worker", expect.any(String)] })
    expect(calls[2].args.at(-1)).toContain("'git' '-C' '/worker/repo' 'worktree' 'add'")
    expect(calls[3].args.at(-1)).toContain("cd -- '/worker/runtime/worktrees/goal-8' && NEXT_TELEMETRY_DISABLED='1' exec 'npm' 'test' 'it'\"'\"'s-safe'")
    expect(calls.at(-1)?.args.at(-1)).toContain("'git' '-C' '/worker/repo' 'worktree' 'remove'")
  })

  it("rejects workspace traversal before filesystem or SSH access", async () => {
    const local = new LocalExecutionBackend({ commandRunner: async () => ({ code: 0 }) })
    await expect(local.stat({ workspacePath: "/safe/work", relPath: "../secret" })).rejects.toThrow("escapes")
    const remote = new AegisExecutionBackend({ host: "aegis", commandRunner: async () => ({ code: 0 }) })
    await expect(remote.stat({ workspacePath: "/safe/work", relPath: "../secret" })).rejects.toThrow("escapes")
    await expect(remote.cleanup({ workspacePath: "/unowned/work" })).rejects.toThrow("owned worktree root")
    expect(() => new AegisExecutionBackend({ host: "-oProxyCommand=bad" })).toThrow("safe SSH destination")
  })
})
