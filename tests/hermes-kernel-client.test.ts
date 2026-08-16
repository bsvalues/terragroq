import fs from "node:fs"
import os from "node:os"
import path from "node:path"

import { afterEach, describe, expect, it, vi } from "vitest"

import { AppServerWallError } from "../scripts/hermes-bridge/app-server-client.mjs"
import {
  createHermesKernelClient,
  HERMES_KERNEL_QUARANTINE_MARKER,
  kernelThreadsRoot,
} from "../scripts/hermes-bridge/hermes-kernel-client.mjs"

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
