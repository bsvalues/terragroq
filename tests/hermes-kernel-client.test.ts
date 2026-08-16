import crypto from "node:crypto"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"

import { afterEach, describe, expect, it, vi } from "vitest"

import { AppServerTimeoutError, AppServerTurnEndedError, AppServerWallError } from "../scripts/hermes-bridge/app-server-client.mjs"
import {
  buildKernelPacket,
  buildKernelPromptEpilogue,
  createHermesKernelClient,
  HERMES_KERNEL_QUARANTINE_MARKER,
  kernelThreadsRoot,
} from "../scripts/hermes-bridge/hermes-kernel-client.mjs"
import { HERMES_TURN_OUTPUT_SCHEMA } from "../scripts/hermes-bridge/prompt.mjs"

const roots: string[] = []
afterEach(() => { for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true }) })

type Call = { command: string; args: string[]; cwd?: string; timeoutMs?: number; credentialAccess?: boolean }

function fixture(overrides: Record<string, unknown> = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "hermes-kernel-")); roots.push(root)
  const runtimeRoot = path.join(root, "runtime")
  const workspacePath = path.join(runtimeRoot, "worktrees", "resident-1")
  fs.mkdirSync(workspacePath, { recursive: true })
  const policyDir = path.join(root, "policy"); fs.mkdirSync(policyDir)
  const policyPath = path.join(policyDir, "hermes-free-dev-agent-v2.policy.json")
  fs.writeFileSync(policyPath, JSON.stringify({
    schemaVersion: 2, packetSchemaVersion: 2, workOrderId: "WO-HERMES-FREE-DEV-AGENT-001",
    model: { id: "williamos-qwen3-4b:64k" },
    placement: { workspaceMode: "OWNED_WORKTREE", allowedWorkspaceRoots: [path.join(runtimeRoot, "worktrees")] },
    execution: { maximumTurns: 20, allowedToolsets: ["file", "terminal"], promptMaxChars: 60000, sessionResumeProven: false, timeoutSeconds: 1800 },
    promotion: { status: "PILOT_AUTHORIZED" },
  }))
  const invokerPath = path.join(root, "invoke.ps1"); fs.writeFileSync(invokerPath, "# fake")
  const calls: Call[] = []
  const commandRunner = vi.fn(async (call: Call) => { calls.push(call); return { code: 0, stdout: "", stderr: "" } })
  const client = createHermesKernelClient({
    workspacePath, runtimeRoot, commandRunner, policyPath, invokerPath, timeoutMs: 1000,
    now: () => new Date("2026-08-16T20:00:00.000Z"), powershellCommand: "powershell",
    randomUUID: (() => { let n = 0; return () => `00000000-0000-4000-8000-00000000000${++n}` })(),
    ...overrides,
  })
  return { root, runtimeRoot, workspacePath, policyDir, policyPath, invokerPath, calls, commandRunner, client }
}

describe("Hermes kernel client — lane checks and threads", () => {
  it("exposes exactly the client surface the orchestrator consumes", () => {
    const { client } = fixture()
    expect(Object.keys(client).sort()).toEqual(["close", "connect", "resumeThread", "runTurn", "startThread"])
    for (const name of ["connect", "startThread", "resumeThread", "runTurn", "close"]) expect(typeof (client as any)[name]).toBe("function")
  })
  it("connects when the lane is authorised, in owned-worktree mode, unquarantined, and the workspace is owned", async () => {
    const { client, calls } = fixture()
    await expect(client.connect()).resolves.toBeUndefined()
    expect(calls).toEqual([])
  })
  it("fails closed on quarantine, wrong mode, unauthorised policy, foreign workspace, and symlinked workspace", async () => {
    const quarantined = fixture(); fs.writeFileSync(path.join(quarantined.policyDir, HERMES_KERNEL_QUARANTINE_MARKER), "ACTIVE_CONTAINER=x")
    await expect(quarantined.client.connect()).rejects.toMatchObject({ code: "RESIDENT_MODEL_LANE_QUARANTINED" })
    await expect(quarantined.client.connect()).rejects.toBeInstanceOf(AppServerWallError)

    const clone = fixture(); const p = JSON.parse(fs.readFileSync(clone.policyPath, "utf8")); p.placement.workspaceMode = "BASELINE_CLONE"; fs.writeFileSync(clone.policyPath, JSON.stringify(p))
    await expect(clone.client.connect()).rejects.toMatchObject({ code: "RESIDENT_MODEL_LANE_WORKSPACE_MODE" })

    const revoked = fixture(); const q = JSON.parse(fs.readFileSync(revoked.policyPath, "utf8")); q.promotion.status = "REVOKED"; fs.writeFileSync(revoked.policyPath, JSON.stringify(q))
    await expect(revoked.client.connect()).rejects.toMatchObject({ code: "RESIDENT_MODEL_LANE_NOT_AUTHORIZED" })

    const foreign = fixture({ workspacePath: os.tmpdir() })
    await expect(foreign.client.connect()).rejects.toMatchObject({ code: "RESIDENT_MODEL_LANE_WORKSPACE" })

    const linked = fixture(); const target = path.join(linked.root, "elsewhere"); fs.mkdirSync(target)
    const linkPath = path.join(linked.runtimeRoot, "worktrees", "linked"); fs.symlinkSync(target, linkPath, "junction")
    const viaLink = fixture({ runtimeRoot: linked.runtimeRoot, workspacePath: linkPath, policyPath: linked.policyPath })
    await expect(viaLink.client.connect()).rejects.toMatchObject({ code: "RESIDENT_MODEL_LANE_WORKSPACE" })
  })
  it("starts a thread as a session directory and refuses to resume until resume is proven", async () => {
    const { client, runtimeRoot, workspacePath } = fixture()
    await client.connect()
    const threadId = await client.startThread({ cwd: workspacePath, approvalPolicy: "never", sandbox: "workspace-write", ephemeral: false })
    expect(threadId).toBe("00000000-0000-4000-8000-000000000001")
    const sessionPath = path.join(kernelThreadsRoot(runtimeRoot), threadId, "session.json")
    expect(JSON.parse(fs.readFileSync(sessionPath, "utf8"))).toEqual({
      schemaVersion: 1, threadId, workspacePath, createdAt: "2026-08-16T20:00:00.000Z", turns: [],
    })
    await expect(client.resumeThread(threadId, { cwd: workspacePath })).rejects.toMatchObject({ code: "RESIDENT_MODEL_THREAD_RESUME_UNAVAILABLE" })
    await expect(client.resumeThread("unknown-thread", { cwd: workspacePath })).rejects.toMatchObject({ code: "RESIDENT_MODEL_THREAD_UNKNOWN" })
    client.close(); client.close()
  })
  it("resumes only a known thread for the same workspace once resume is proven", async () => {
    const { client, policyPath, workspacePath, runtimeRoot } = fixture()
    const p = JSON.parse(fs.readFileSync(policyPath, "utf8")); p.execution.sessionResumeProven = true; fs.writeFileSync(policyPath, JSON.stringify(p))
    await client.connect()
    const threadId = await client.startThread({ cwd: workspacePath })
    await expect(client.resumeThread(threadId, { cwd: workspacePath })).resolves.toBe(threadId)
    const other = createHermesKernelClient({ workspacePath: path.join(runtimeRoot, "worktrees", "other"), runtimeRoot, commandRunner: async () => ({ code: 0, stdout: "", stderr: "" }), policyPath, invokerPath: path.join(runtimeRoot, "x.ps1") })
    fs.mkdirSync(path.join(runtimeRoot, "worktrees", "other"), { recursive: true })
    await expect(other.resumeThread(threadId, {})).rejects.toMatchObject({ code: "RESIDENT_MODEL_THREAD_WORKSPACE_MISMATCH" })
  })
})

const okResult = (runId: string, json = '{"result":"READY_FOR_VALIDATION"}') => ({
  code: 0, stderr: "", stdout: `agent chatter\n\`\`\`json\n${json}\n\`\`\`\nHERMES_FREE_AGENT_COMPLETE runId=${runId} workspace=D:\\w\n`,
})

describe("Hermes kernel client — runTurn", () => {
  it("builds a v2 packet with the verbatim prompt plus the output-contract epilogue", () => {
    const policy = { workOrderId: "WO-HERMES-FREE-DEV-AGENT-001", model: { id: "williamos-qwen3-4b:64k" }, execution: { maximumTurns: 20, allowedToolsets: ["file", "terminal"] } }
    const packet = buildKernelPacket({ policy, prompt: "Do the thing.", workspacePath: "D:\\w", runId: "run-1" })
    expect(Object.keys(packet).sort()).toEqual(["maximumTurns", "model", "prompt", "runId", "schemaVersion", "toolsets", "workOrderId", "workspaceMode", "workspacePath"])
    expect(packet).toMatchObject({ schemaVersion: 2, workOrderId: "WO-HERMES-FREE-DEV-AGENT-001", model: "williamos-qwen3-4b:64k", maximumTurns: 20, toolsets: ["file", "terminal"], workspaceMode: "OWNED_WORKTREE", workspacePath: "D:\\w", runId: "run-1" })
    expect(packet.prompt.startsWith("Do the thing.\n\n")).toBe(true)
    expect(packet.prompt.endsWith(buildKernelPromptEpilogue())).toBe(true)
    expect(buildKernelPromptEpilogue()).toContain(JSON.stringify(HERMES_TURN_OUTPUT_SCHEMA))
    expect(buildKernelPromptEpilogue()).toContain("Do not commit, push, open PRs")
  })
  it("invokes the reviewed PowerShell invoker with the packet, policy, workspace and run id, then harvests finalText", async () => {
    const { client, calls, commandRunner, workspacePath, runtimeRoot, policyPath, invokerPath } = fixture()
    commandRunner.mockImplementation(async (call: Call) => { calls.push(call); return okResult(call.args[call.args.indexOf("-RunId") + 1]) })
    await client.connect()
    const threadId = await client.startThread({ cwd: workspacePath })
    const turn = await client.runTurn({ threadId, prompt: "Deliver WO-1", turn: { outputSchema: HERMES_TURN_OUTPUT_SCHEMA }, timeoutMs: 5000 })
    expect(turn).toEqual({ threadId, turnId: expect.stringMatching(/^[0-9a-f-]{36}$/), status: "completed", finalText: '{"result":"READY_FOR_VALIDATION"}' })
    const call = calls.at(-1)!
    expect(call.command).toBe("powershell")
    expect(call.args.slice(0, 5)).toEqual(["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File"])
    expect(call.args[5]).toBe(invokerPath)
    const arg = (flag: string) => call.args[call.args.indexOf(flag) + 1]
    expect(arg("-PolicyPath")).toBe(policyPath)
    expect(arg("-WorkspacePath")).toBe(fs.realpathSync(workspacePath))
    expect(arg("-RunId")).toBe(turn.turnId)
    expect(call.cwd).toBe(fs.realpathSync(workspacePath))
    expect(call.timeoutMs).toBe(5000)
    expect(call.credentialAccess).toBe(false)
    const packet = JSON.parse(fs.readFileSync(arg("-PacketPath"), "utf8"))
    expect(packet).toMatchObject({ schemaVersion: 2, runId: turn.turnId, workspaceMode: "OWNED_WORKTREE", workspacePath: fs.realpathSync(workspacePath) })
    expect(packet.prompt.startsWith("Deliver WO-1\n\n")).toBe(true)
    const session = JSON.parse(fs.readFileSync(path.join(kernelThreadsRoot(runtimeRoot), threadId, "session.json"), "utf8"))
    expect(session.turns).toEqual([expect.objectContaining({ turnId: turn.turnId, exitCode: 0, harvested: true, packetSha256: expect.stringMatching(/^[0-9a-f]{64}$/), stdoutSha256: expect.stringMatching(/^[0-9a-f]{64}$/), at: "2026-08-16T20:00:00.000Z" })])
    const persistedStdout = fs.readFileSync(path.join(kernelThreadsRoot(runtimeRoot), threadId, "turns", "1", "stdout.txt"), "utf8")
    expect(persistedStdout).toContain("HERMES_FREE_AGENT_COMPLETE")
    expect(session.turns[0].stdoutSha256).toBe(crypto.createHash("sha256").update(persistedStdout).digest("hex"))
  })
  it("refuses a turn before connect, for an unknown thread, or when the prompt exceeds the policy budget", async () => {
    const { client, workspacePath, policyPath } = fixture()
    await expect(client.runTurn({ threadId: "x", prompt: "p" })).rejects.toMatchObject({ code: "RESIDENT_MODEL_LANE_NOT_CONNECTED" })
    await client.connect()
    await expect(client.runTurn({ threadId: "00000000-0000-4000-8000-0000000000ff", prompt: "p" })).rejects.toMatchObject({ code: "RESIDENT_MODEL_THREAD_UNKNOWN" })
    const threadId = await client.startThread({ cwd: workspacePath })
    const p = JSON.parse(fs.readFileSync(policyPath, "utf8")); p.execution.promptMaxChars = 40; fs.writeFileSync(policyPath, JSON.stringify(p))
    await expect(client.runTurn({ threadId, prompt: "x".repeat(41) })).rejects.toMatchObject({ code: "RESIDENT_MODEL_PROMPT_TOO_LONG" })
  })
  it("maps invoker outcomes onto the orchestrator's existing error taxonomy", async () => {
    const cases: Array<[Record<string, unknown>, (error: any) => void]> = [
      [{ code: 0, stdout: "chatter without completion", stderr: "" }, (e) => { expect(e).toBeInstanceOf(AppServerTurnEndedError); expect(e.code).toBe("APP_SERVER_TURN_INTERRUPTED") }],
      [{ code: 0, stdout: "HERMES_FREE_AGENT_COMPLETE runId=r workspace=w\n", stderr: "" }, (e) => { expect(e).toBeInstanceOf(AppServerTurnEndedError); expect(e.code).toBe("APP_SERVER_TURN_FAILED"); expect(e.detail).toBe("RESIDENT_MODEL_TURN_OUTPUT_INVALID:NO_JSON_BLOCK") }],
      [{ code: 1, stdout: "", stderr: "HERMES_FREE_AGENT_EXECUTION_WALL" }, (e) => { expect(e).toBeInstanceOf(AppServerTurnEndedError); expect(e.code).toBe("APP_SERVER_TURN_FAILED") }],
      [{ code: 1, stdout: "", stderr: "HERMES_FREE_AGENT_TIMEOUT_WALL" }, (e) => { expect(e).toBeInstanceOf(AppServerTimeoutError) }],
      [{ code: 1, stdout: "", stderr: "", timedOut: true }, (e) => { expect(e).toBeInstanceOf(AppServerTimeoutError) }],
      [{ code: 1, stdout: "", stderr: "HERMES_FREE_AGENT_IMAGE_ID_WALL" }, (e) => { expect(e).toBeInstanceOf(AppServerWallError); expect(e.code).toBe("HERMES_FREE_AGENT_IMAGE_ID_WALL") }],
      [{ code: 3, stdout: "", stderr: "boom" }, (e) => { expect(e).toBeInstanceOf(AppServerTurnEndedError); expect(e.code).toBe("APP_SERVER_TURN_INTERRUPTED") }],
    ]
    for (const [result, assert] of cases) {
      const { client, commandRunner, workspacePath } = fixture()
      commandRunner.mockImplementation(async () => result)
      await client.connect()
      const threadId = await client.startThread({ cwd: workspacePath })
      await expect(client.runTurn({ threadId, prompt: "p" })).rejects.toSatisfy((error: any) => { assert(error); return true })
    }
  })
  it("sanitises secrets out of the recorded stdout evidence", async () => {
    const { client, commandRunner, workspacePath, runtimeRoot } = fixture()
    commandRunner.mockImplementation(async (call: Call) => { const r = okResult(call.args[call.args.indexOf("-RunId") + 1]); r.stdout = `token ghp_${"a".repeat(36)}\n${r.stdout}`; return r })
    await client.connect()
    const threadId = await client.startThread({ cwd: workspacePath })
    await client.runTurn({ threadId, prompt: "p" })
    const recorded = fs.readFileSync(path.join(kernelThreadsRoot(runtimeRoot), threadId, "turns", "1", "stdout.txt"), "utf8")
    expect(recorded).not.toContain("ghp_")
    expect(recorded).toContain("[REDACTED]")
  })
})
