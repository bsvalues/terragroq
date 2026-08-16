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
  kernelQuarantinePath,
  kernelThreadsRoot,
} from "../scripts/hermes-bridge/hermes-kernel-client.mjs"
import { HERMES_TURN_OUTPUT_SCHEMA } from "../scripts/hermes-bridge/prompt.mjs"

const roots: string[] = []
afterEach(() => { for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true }) })

type Call = { command: string; args: string[]; cwd?: string; timeoutMs?: number; credentialAccess?: boolean }

// Every satisfied-evidence value must be non-null or the lane fails closed (C1).
const SATISFIED_EVIDENCE = {
  IMAGE_BUILD_PROVEN: "sha256:deadbeef",
  OWNED_WORKTREE_CONFINEMENT_PROVEN: "bootstrap-owned-1",
}
const REQUIRED_EVIDENCE = Object.keys(SATISFIED_EVIDENCE)

// A schema-complete turn object: anything less is now rejected structurally (I3).
const fullTurn = (overrides: Record<string, unknown> = {}) => ({
  result: "READY_FOR_VALIDATION", workOrder: "WO-1", branch: "codex/x", commit: null, prUrl: null,
  merged: false, mergeCommit: null, validation: ["pass"], reviewThreads: 0, ownerTouchCount: 0,
  blockedScopeCrossed: false, nextState: "READY_FOR_HERMES_MERGE", blockedAction: null,
  authorityBoundary: null, minimumChoice: null, approveConsequence: null, denyConsequence: null,
  ...overrides,
})
const fullTurnJson = (overrides: Record<string, unknown> = {}) => JSON.stringify(fullTurn(overrides))

function fixture(overrides: Record<string, unknown> = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "hermes-kernel-")); roots.push(root)
  const runtimeRoot = path.join(root, "runtime")
  const workspacePath = path.join(runtimeRoot, "worktrees", "resident-1")
  fs.mkdirSync(workspacePath, { recursive: true })
  const policyDir = path.join(root, "policy"); fs.mkdirSync(policyDir)
  const policyPath = path.join(policyDir, "hermes-free-dev-agent-v2.policy.json")
  fs.writeFileSync(policyPath, JSON.stringify({
    schemaVersion: 2, packetSchemaVersion: 3, workOrderId: "WO-HERMES-FREE-DEV-AGENT-001",
    model: { id: "williamos-qwen3-4b:64k" },
    containment: { agentStatePersistence: "PER_THREAD_STATE_DIR" },
    placement: { workspaceMode: "OWNED_WORKTREE", allowedWorkspaceRoots: [path.join(runtimeRoot, "worktrees")] },
    execution: { maximumTurns: 20, allowedToolsets: ["file", "terminal"], promptMaxChars: 60000, sessionResumeProven: false, timeoutSeconds: 1800 },
    promotion: { status: "PILOT_AUTHORIZED", requiredEvidence: [...REQUIRED_EVIDENCE], satisfiedEvidence: { ...SATISFIED_EVIDENCE } },
  }))
  const invokerPath = path.join(root, "invoke.ps1"); fs.writeFileSync(invokerPath, "# fake")
  const commonDir = path.join(root, "canonical", ".git")
  const calls: Call[] = []
  const commandRunner = vi.fn(async (call: Call) => { calls.push(call); return gitOr(call, commonDir, { code: 0, stdout: "", stderr: "" }) })
  const client = createHermesKernelClient({
    workspacePath, runtimeRoot, commandRunner, policyPath, invokerPath, timeoutMs: 45 * 60 * 1000,
    now: () => new Date("2026-08-16T20:00:00.000Z"), powershellCommand: "powershell",
    randomUUID: (() => { let n = 0; return () => `00000000-0000-4000-8000-00000000000${++n}` })(),
    ...overrides,
  })
  return { root, runtimeRoot, workspacePath, policyDir, policyPath, invokerPath, commonDir, calls, commandRunner, client }
}

// The client now probes `git rev-parse --git-common-dir` before and after the invoker (I5),
// so every fake runner has to answer those two calls as well.
const gitOr = (call: Call, commonDir: string, result: unknown) =>
  (call.command === "git" ? { code: 0, stdout: `${commonDir}\n`, stderr: "" } : result) as any

const patchPolicy = (policyPath: string, mutate: (policy: any) => void) => {
  const policy = JSON.parse(fs.readFileSync(policyPath, "utf8")); mutate(policy)
  fs.writeFileSync(policyPath, JSON.stringify(policy))
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

    const clone = fixture(); patchPolicy(clone.policyPath, (p) => { p.placement.workspaceMode = "BASELINE_CLONE" })
    await expect(clone.client.connect()).rejects.toMatchObject({ code: "RESIDENT_MODEL_LANE_WORKSPACE_MODE" })

    const revoked = fixture(); patchPolicy(revoked.policyPath, (p) => { p.promotion.status = "REVOKED" })
    await expect(revoked.client.connect()).rejects.toMatchObject({ code: "RESIDENT_MODEL_LANE_NOT_AUTHORIZED" })

    const foreign = fixture({ workspacePath: os.tmpdir() })
    await expect(foreign.client.connect()).rejects.toMatchObject({ code: "RESIDENT_MODEL_LANE_WORKSPACE" })

    const linked = fixture(); const target = path.join(linked.root, "elsewhere"); fs.mkdirSync(target)
    const linkPath = path.join(linked.runtimeRoot, "worktrees", "linked"); fs.symlinkSync(target, linkPath, "junction")
    const viaLink = fixture({ runtimeRoot: linked.runtimeRoot, workspacePath: linkPath, policyPath: linked.policyPath })
    await expect(viaLink.client.connect()).rejects.toMatchObject({ code: "RESIDENT_MODEL_LANE_WORKSPACE" })
  })
  it("refuses to connect while any declared evidence line is unproven", async () => {
    const unproven = fixture()
    patchPolicy(unproven.policyPath, (p) => { p.promotion.satisfiedEvidence.OWNED_WORKTREE_CONFINEMENT_PROVEN = null })
    await expect(unproven.client.connect()).rejects.toMatchObject({ code: "RESIDENT_MODEL_LANE_EVIDENCE_UNPROVEN" })
    await expect(unproven.client.connect()).rejects.toBeInstanceOf(AppServerWallError)

    const blank = fixture()
    patchPolicy(blank.policyPath, (p) => { p.promotion.satisfiedEvidence.IMAGE_BUILD_PROVEN = "   " })
    await expect(blank.client.connect()).rejects.toMatchObject({ code: "RESIDENT_MODEL_LANE_EVIDENCE_UNPROVEN" })

    const missing = fixture()
    patchPolicy(missing.policyPath, (p) => { delete p.promotion.satisfiedEvidence.IMAGE_BUILD_PROVEN })
    await expect(missing.client.connect()).rejects.toMatchObject({ code: "RESIDENT_MODEL_LANE_EVIDENCE_UNPROVEN" })
  })
  it("refuses to connect on the runtime quarantine marker, a missing invoker, or a turn budget under the kernel deadline", async () => {
    const runtimeMarker = fixture()
    fs.mkdirSync(path.dirname(kernelQuarantinePath(runtimeMarker.runtimeRoot)), { recursive: true })
    fs.writeFileSync(kernelQuarantinePath(runtimeMarker.runtimeRoot), "ACTIVE_CONTAINER=x")
    await expect(runtimeMarker.client.connect()).rejects.toMatchObject({ code: "RESIDENT_MODEL_LANE_QUARANTINED" })

    const noInvoker = fixture(); fs.rmSync(noInvoker.invokerPath)
    await expect(noInvoker.client.connect()).rejects.toMatchObject({ code: "RESIDENT_MODEL_LANE_INVOKER_MISSING" })

    const tooShort = fixture({ timeoutMs: 1000 })
    await expect(tooShort.client.connect()).rejects.toMatchObject({ code: "RESIDENT_MODEL_LANE_TIMEOUT" })
    const exact = fixture({ timeoutMs: 1800 * 1000 })
    await expect(exact.client.connect()).resolves.toBeUndefined()
  })
  it("refuses a workspace carrying a top-level reparse point", async () => {
    const junction = fixture(); const target = path.join(junction.root, "outside"); fs.mkdirSync(target)
    fs.symlinkSync(target, path.join(junction.workspacePath, "escape"), "junction")
    await expect(junction.client.connect()).rejects.toMatchObject({ code: "RESIDENT_MODEL_LANE_WORKSPACE" })
  })
  it("names the leftover validation dependencies when it refuses a workspace carrying node_modules", async () => {
    // repository-lifecycle.mjs:853 junctions <worktree>/node_modules to the workspace copy so the
    // validators can run, and :919 unlinks it afterwards. A cycle that dies between those two
    // leaves the junction behind, and every later turn walls non-retryably. Failing closed is
    // correct — the kernel must never inherit that bin/symlink farm — but an operator reading the
    // log needs the code to name what to delete, not a generic workspace refusal.
    const modules = fixture(); fs.mkdirSync(path.join(modules.workspacePath, "node_modules"))
    await expect(modules.client.connect()).rejects.toMatchObject({ code: "RESIDENT_MODEL_LANE_WORKSPACE_DEPENDENCIES" })
    await expect(modules.client.connect()).rejects.toBeInstanceOf(AppServerWallError)

    const abandoned = fixture()
    const source = path.join(abandoned.root, "workspace-node-modules"); fs.mkdirSync(source)
    fs.symlinkSync(source, path.join(abandoned.workspacePath, "node_modules"), "junction")
    await expect(abandoned.client.connect()).rejects.toMatchObject({ code: "RESIDENT_MODEL_LANE_WORKSPACE_DEPENDENCIES" })
  })
  it("starts a thread as a session directory and refuses to resume until resume is proven", async () => {
    const { client, runtimeRoot, workspacePath } = fixture()
    await expect(client.startThread({})).rejects.toMatchObject({ code: "RESIDENT_MODEL_LANE_NOT_CONNECTED" })
    await client.connect()
    const threadId = await client.startThread({ cwd: workspacePath, approvalPolicy: "never", sandbox: "workspace-write", ephemeral: false })
    expect(threadId).toBe("00000000-0000-4000-8000-000000000001")
    const sessionPath = path.join(kernelThreadsRoot(runtimeRoot), threadId, "session.json")
    expect(JSON.parse(fs.readFileSync(sessionPath, "utf8"))).toEqual({
      schemaVersion: 1, threadId, workspacePath, createdAt: "2026-08-16T20:00:00.000Z", kernelSessionId: null, turns: [],
    })
    await expect(client.resumeThread(threadId, { cwd: workspacePath })).rejects.toMatchObject({ code: "RESIDENT_MODEL_THREAD_RESUME_UNAVAILABLE" })
    await expect(client.resumeThread("unknown-thread", { cwd: workspacePath })).rejects.toMatchObject({ code: "RESIDENT_MODEL_THREAD_UNKNOWN" })
    client.close(); client.close()
    // close() drops the connection: the lane must be re-proven before more work.
    await expect(client.startThread({})).rejects.toMatchObject({ code: "RESIDENT_MODEL_LANE_NOT_CONNECTED" })
  })
  it("resumes only a known thread for the same workspace once resume is proven", async () => {
    const { client, policyPath, workspacePath, runtimeRoot } = fixture()
    patchPolicy(policyPath, (p) => { p.execution.sessionResumeProven = true })
    await client.connect()
    const threadId = await client.startThread({ cwd: workspacePath })
    // A kernel session must have been captured before a thread is resumable (P2b).
    const sessionFile = path.join(kernelThreadsRoot(runtimeRoot), threadId, "session.json")
    const session = JSON.parse(fs.readFileSync(sessionFile, "utf8")); session.kernelSessionId = "20260816_200044_30d6e1"; fs.writeFileSync(sessionFile, JSON.stringify(session))
    await expect(client.resumeThread(threadId, { cwd: workspacePath })).resolves.toBe(threadId)
    const other = createHermesKernelClient({ workspacePath: path.join(runtimeRoot, "worktrees", "other"), runtimeRoot, commandRunner: async () => ({ code: 0, stdout: "", stderr: "" }), policyPath, invokerPath: path.join(runtimeRoot, "x.ps1") })
    fs.mkdirSync(path.join(runtimeRoot, "worktrees", "other"), { recursive: true })
    await expect(other.resumeThread(threadId, {})).rejects.toMatchObject({ code: "RESIDENT_MODEL_THREAD_WORKSPACE_MISMATCH" })
  })
})

const okResult = (runId: string, json = fullTurnJson()) => ({
  code: 0, stderr: "", stdout: `agent chatter\n\`\`\`json\n${json}\n\`\`\`\nHERMES_FREE_AGENT_COMPLETE runId=${runId} workspace=D:\\w\n`,
})

describe("Hermes kernel client — runTurn", () => {
  it("builds a v2 packet with the verbatim prompt plus the output-contract epilogue", () => {
    const policy = { workOrderId: "WO-HERMES-FREE-DEV-AGENT-001", model: { id: "williamos-qwen3-4b:64k" }, execution: { maximumTurns: 20, allowedToolsets: ["file", "terminal"] } }
    const packet = buildKernelPacket({ policy, prompt: "Do the thing.", workspacePath: "D:\\w", runId: "run-1", statePath: "D:\\s" })
    expect(Object.keys(packet).sort()).toEqual(["kernelSessionId", "maximumTurns", "model", "prompt", "runId", "schemaVersion", "statePath", "toolsets", "workOrderId", "workspaceMode", "workspacePath"])
    expect(packet).toMatchObject({ statePath: "D:\\s", kernelSessionId: null })
    expect(packet).toMatchObject({ schemaVersion: 3, workOrderId: "WO-HERMES-FREE-DEV-AGENT-001", model: "williamos-qwen3-4b:64k", maximumTurns: 20, toolsets: ["file", "terminal"], workspaceMode: "OWNED_WORKTREE", workspacePath: "D:\\w", runId: "run-1" })
    expect(packet.prompt.startsWith("Do the thing.\n\n")).toBe(true)
    expect(packet.prompt.endsWith(buildKernelPromptEpilogue("run-1"))).toBe(true)
    expect(buildKernelPromptEpilogue("run-1")).toContain(JSON.stringify(HERMES_TURN_OUTPUT_SCHEMA))
    expect(buildKernelPromptEpilogue("run-1")).toContain("Do not commit, push, open PRs")
    // the answer delimiter is bound to this run, so pre-written workspace content cannot forge it
    expect(buildKernelPromptEpilogue("run-1")).toContain("runId=run-1")
  })
  it("invokes the reviewed PowerShell invoker with the packet, policy, workspace, run id and runtime quarantine path, then harvests finalText", async () => {
    const { client, calls, commandRunner, workspacePath, runtimeRoot, policyPath, invokerPath, commonDir } = fixture()
    commandRunner.mockImplementation(async (call: Call) => { calls.push(call); return gitOr(call, commonDir, okResult(call.args[call.args.indexOf("-RunId") + 1])) })
    await client.connect()
    const threadId = await client.startThread({ cwd: workspacePath })
    const turn = await client.runTurn({ threadId, prompt: "Deliver WO-1", turn: { outputSchema: HERMES_TURN_OUTPUT_SCHEMA }, timeoutMs: 1800 * 1000 })
    expect(turn).toEqual({ threadId, turnId: expect.stringMatching(/^[0-9a-f-]{36}$/), status: "completed", finalText: fullTurnJson() })
    const call = calls.find((candidate) => candidate.command === "powershell")!
    expect(call.args.slice(0, 5)).toEqual(["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File"])
    expect(call.args[5]).toBe(invokerPath)
    const arg = (flag: string) => call.args[call.args.indexOf(flag) + 1]
    expect(arg("-PolicyPath")).toBe(policyPath)
    expect(arg("-WorkspacePath")).toBe(fs.realpathSync(workspacePath))
    expect(arg("-RunId")).toBe(turn.turnId)
    // I2: the durable marker lives in the runtime root, never in the version-controlled config dir.
    expect(arg("-QuarantinePath")).toBe(kernelQuarantinePath(runtimeRoot))
    expect(path.isAbsolute(arg("-QuarantinePath"))).toBe(true)
    expect(call.cwd).toBe(fs.realpathSync(workspacePath))
    expect(call.timeoutMs).toBe(1800 * 1000)
    expect(call.credentialAccess).toBe(false)
    // I5: the git-common-dir identity is captured before and re-asserted after the invocation.
    const gitCalls = calls.filter((candidate) => candidate.command === "git")
    expect(gitCalls).toHaveLength(2)
    for (const probe of gitCalls) {
      expect(probe.args).toEqual(["-C", fs.realpathSync(workspacePath), "rev-parse", "--path-format=absolute", "--git-common-dir"])
      expect(probe.credentialAccess).toBe(false)
    }
    const packet = JSON.parse(fs.readFileSync(arg("-PacketPath"), "utf8"))
    expect(packet).toMatchObject({ schemaVersion: 3, runId: turn.turnId, workspaceMode: "OWNED_WORKTREE", workspacePath: fs.realpathSync(workspacePath), kernelSessionId: null })
    expect(arg("-StatePath")).toBe(path.join(kernelThreadsRoot(runtimeRoot), threadId, "kernel-state"))
    expect(packet.prompt.startsWith("Deliver WO-1\n\n")).toBe(true)
    const session = JSON.parse(fs.readFileSync(path.join(kernelThreadsRoot(runtimeRoot), threadId, "session.json"), "utf8"))
    expect(session.turns).toEqual([expect.objectContaining({ turnId: turn.turnId, exitCode: 0, harvested: true, packetSha256: expect.stringMatching(/^[0-9a-f]{64}$/), stdoutSha256: expect.stringMatching(/^[0-9a-f]{64}$/), at: "2026-08-16T20:00:00.000Z" })])
    const stdoutPath = path.join(kernelThreadsRoot(runtimeRoot), threadId, "turns", "1", "stdout.txt")
    const persistedStdout = fs.readFileSync(stdoutPath, "utf8")
    expect(persistedStdout).toContain("HERMES_FREE_AGENT_COMPLETE")
    expect(session.turns[0].stdoutSha256).toBe(crypto.createHash("sha256").update(persistedStdout).digest("hex"))
    if (process.platform !== "win32") {
      expect(fs.statSync(stdoutPath).mode & 0o777).toBe(0o600)
      expect(fs.statSync(path.join(kernelThreadsRoot(runtimeRoot), threadId, "turns", "1", "packet.json")).mode & 0o777).toBe(0o600)
    }
  })
  it("refuses a turn before connect, for an unknown thread, or when the prompt exceeds the policy budget", async () => {
    const { client, workspacePath, policyPath } = fixture()
    await expect(client.runTurn({ threadId: "x", prompt: "p" })).rejects.toMatchObject({ code: "RESIDENT_MODEL_LANE_NOT_CONNECTED" })
    await client.connect()
    await expect(client.runTurn({ threadId: "00000000-0000-4000-8000-0000000000ff", prompt: "p" })).rejects.toMatchObject({ code: "RESIDENT_MODEL_THREAD_UNKNOWN" })
    const threadId = await client.startThread({ cwd: workspacePath })
    patchPolicy(policyPath, (p) => { p.execution.promptMaxChars = 40 })
    await expect(client.runTurn({ threadId, prompt: "x".repeat(41) })).rejects.toMatchObject({ code: "RESIDENT_MODEL_PROMPT_TOO_LONG" })
  })
  it("re-checks the per-turn budget against the kernel deadline before it touches anything", async () => {
    // connect() can only see the client-level budget (spec §4 item 6), but runTurn takes a per-turn
    // override. A budget under the kernel's own deadline means the host runner kills the invoker
    // mid-run, so the invoker never reaches HERMES_FREE_AGENT_TIMEOUT_WALL and its container
    // cleanup / quarantine never happen. The invariant has to hold where the budget is used.
    const { client, calls, workspacePath, runtimeRoot } = fixture()
    await client.connect()
    const threadId = await client.startThread({ cwd: workspacePath })
    await expect(client.runTurn({ threadId, prompt: "p", timeoutMs: 60_000 }))
      .rejects.toMatchObject({ code: "RESIDENT_MODEL_LANE_TIMEOUT" })
    // Refused before the git probe, the packet write and the invoker — nothing ran.
    expect(calls).toEqual([])
    expect(fs.existsSync(path.join(kernelThreadsRoot(runtimeRoot), threadId, "turns"))).toBe(false)
    // The boundary is equality, not a blanket refusal: a budget at the deadline still runs.
    await expect(client.runTurn({ threadId, prompt: "p", timeoutMs: 1800 * 1000 }))
      .rejects.toMatchObject({ code: "APP_SERVER_TURN_INTERRUPTED" })
    expect(calls.some((call) => call.command === "powershell")).toBe(true)
  })
  it("maps invoker outcomes onto the orchestrator's existing error taxonomy", async () => {
    const cases: Array<[(runId: string) => Record<string, unknown>, (error: any) => void]> = [
      [() => ({ code: 0, stdout: "chatter without completion", stderr: "" }), (e) => { expect(e).toBeInstanceOf(AppServerTurnEndedError); expect(e.code).toBe("APP_SERVER_TURN_INTERRUPTED") }],
      [(runId) => ({ code: 0, stdout: `HERMES_FREE_AGENT_COMPLETE runId=${runId} workspace=w\n`, stderr: "" }), (e) => { expect(e).toBeInstanceOf(AppServerTurnEndedError); expect(e.code).toBe("APP_SERVER_TURN_FAILED"); expect(e.detail).toBe("RESIDENT_MODEL_TURN_OUTPUT_INVALID:NO_JSON_BLOCK") }],
      [() => ({ code: 1, stdout: "", stderr: "HERMES_FREE_AGENT_EXECUTION_WALL" }), (e) => { expect(e).toBeInstanceOf(AppServerTurnEndedError); expect(e.code).toBe("APP_SERVER_TURN_FAILED") }],
      [() => ({ code: 1, stdout: "", stderr: "HERMES_FREE_AGENT_TIMEOUT_WALL" }), (e) => { expect(e).toBeInstanceOf(AppServerTimeoutError) }],
      [() => ({ code: 1, stdout: "", stderr: "", timedOut: true }), (e) => { expect(e).toBeInstanceOf(AppServerTimeoutError) }],
      [() => ({ code: 1, stdout: "", stderr: "HERMES_FREE_AGENT_IMAGE_ID_WALL" }), (e) => { expect(e).toBeInstanceOf(AppServerWallError); expect(e.code).toBe("HERMES_FREE_AGENT_IMAGE_ID_WALL") }],
      [() => ({ code: 3, stdout: "", stderr: "boom" }), (e) => { expect(e).toBeInstanceOf(AppServerTurnEndedError); expect(e.code).toBe("APP_SERVER_TURN_INTERRUPTED") }],
    ]
    for (const [build, assert] of cases) {
      const { client, commandRunner, workspacePath, commonDir } = fixture()
      commandRunner.mockImplementation(async (call: Call) => gitOr(call, commonDir, build(call.args[call.args.indexOf("-RunId") + 1])))
      await client.connect()
      const threadId = await client.startThread({ cwd: workspacePath })
      await expect(client.runTurn({ threadId, prompt: "p" })).rejects.toSatisfy((error: any) => { assert(error); return true })
    }
  })
  it("only believes wall tokens and completion lines the invoker itself printed", async () => {
    // I6: a model narrating a wall token mid-line must not forge a timeout verdict.
    const chatty = fixture()
    chatty.commandRunner.mockImplementation(async (call: Call) => gitOr(call, chatty.commonDir, {
      code: 0, stderr: "",
      stdout: `I considered raising a HERMES_FREE_AGENT_TIMEOUT_WALL here but did not.\n\`\`\`json\n${fullTurnJson()}\n\`\`\`\nHERMES_FREE_AGENT_COMPLETE runId=${call.args[call.args.indexOf("-RunId") + 1]} workspace=w\n`,
    }))
    await chatty.client.connect()
    const chattyThread = await chatty.client.startThread({ cwd: chatty.workspacePath })
    await expect(chatty.client.runTurn({ threadId: chattyThread, prompt: "p" })).resolves.toMatchObject({ status: "completed" })

    // I6: a completion line for someone else's run is not this run's completion.
    const wrongRun = fixture()
    wrongRun.commandRunner.mockImplementation(async (call: Call) => gitOr(call, wrongRun.commonDir, okResult("00000000-0000-4000-8000-0000000000ff")))
    await wrongRun.client.connect()
    const wrongThread = await wrongRun.client.startThread({ cwd: wrongRun.workspacePath })
    await expect(wrongRun.client.runTurn({ threadId: wrongThread, prompt: "p" })).rejects.toMatchObject({ code: "APP_SERVER_TURN_INTERRUPTED" })
  })
  it("walls when the workspace git identity changes across the invocation", async () => {
    const { client, commandRunner, workspacePath, root, runtimeRoot } = fixture()
    let probe = 0
    commandRunner.mockImplementation(async (call: Call) => {
      if (call.command === "git") { probe += 1; return { code: 0, stdout: `${path.join(root, `repo-${probe}`, ".git")}\n`, stderr: "" } }
      return okResult(call.args[call.args.indexOf("-RunId") + 1])
    })
    await client.connect()
    const threadId = await client.startThread({ cwd: workspacePath })
    await expect(client.runTurn({ threadId, prompt: "p" })).rejects.toMatchObject({ code: "RESIDENT_MODEL_LANE_WORKSPACE_TAMPERED" })
    const session = JSON.parse(fs.readFileSync(path.join(kernelThreadsRoot(runtimeRoot), threadId, "session.json"), "utf8"))
    expect(session.turns).toHaveLength(1)
    expect(session.turns[0].harvested).toBe(false)
  })
  it("rejects a harvested object that does not satisfy the turn output schema", async () => {
    const missingKey = fixture()
    missingKey.commandRunner.mockImplementation(async (call: Call) =>
      gitOr(call, missingKey.commonDir, okResult(call.args[call.args.indexOf("-RunId") + 1], '{"result":"READY_FOR_VALIDATION"}')))
    await missingKey.client.connect()
    const thread = await missingKey.client.startThread({ cwd: missingKey.workspacePath })
    await expect(missingKey.client.runTurn({ threadId: thread, prompt: "p" })).rejects.toMatchObject({
      code: "APP_SERVER_TURN_FAILED", detail: "RESIDENT_MODEL_TURN_OUTPUT_INVALID:SCHEMA:MISSING:workOrder",
    })

    const badEnum = fixture()
    badEnum.commandRunner.mockImplementation(async (call: Call) =>
      gitOr(call, badEnum.commonDir, okResult(call.args[call.args.indexOf("-RunId") + 1], fullTurnJson({ result: "MAYBE" }))))
    await badEnum.client.connect()
    const enumThread = await badEnum.client.startThread({ cwd: badEnum.workspacePath })
    await expect(badEnum.client.runTurn({ threadId: enumThread, prompt: "p" })).rejects.toMatchObject({
      code: "APP_SERVER_TURN_FAILED", detail: "RESIDENT_MODEL_TURN_OUTPUT_INVALID:SCHEMA:result:ENUM",
    })

    const badState = fixture()
    badState.commandRunner.mockImplementation(async (call: Call) =>
      gitOr(call, badState.commonDir, okResult(call.args[call.args.indexOf("-RunId") + 1], fullTurnJson({ nextState: "lower case" }))))
    await badState.client.connect()
    const stateThread = await badState.client.startThread({ cwd: badState.workspacePath })
    await expect(badState.client.runTurn({ threadId: stateThread, prompt: "p" })).rejects.toMatchObject({
      code: "APP_SERVER_TURN_FAILED", detail: "RESIDENT_MODEL_TURN_OUTPUT_INVALID:SCHEMA:nextState:PATTERN",
    })

    const extra = fixture()
    extra.commandRunner.mockImplementation(async (call: Call) =>
      gitOr(call, extra.commonDir, okResult(call.args[call.args.indexOf("-RunId") + 1], fullTurnJson({ sneaked: true }))))
    await extra.client.connect()
    const extraThread = await extra.client.startThread({ cwd: extra.workspacePath })
    await expect(extra.client.runTurn({ threadId: extraThread, prompt: "p" })).rejects.toMatchObject({
      code: "APP_SERVER_TURN_FAILED", detail: "RESIDENT_MODEL_TURN_OUTPUT_INVALID:SCHEMA:ADDITIONAL:sneaked",
    })
  })
  it("records evidence and interrupts when the command runner itself rejects", async () => {
    const { client, commandRunner, workspacePath, runtimeRoot, commonDir } = fixture()
    commandRunner.mockImplementation(async (call: Call) => {
      if (call.command === "git") return { code: 0, stdout: `${commonDir}\n`, stderr: "" }
      throw new Error(`spawn EPERM for ghp_${"a".repeat(36)}`)
    })
    await client.connect()
    const threadId = await client.startThread({ cwd: workspacePath })
    await expect(client.runTurn({ threadId, prompt: "p" })).rejects.toMatchObject({ code: "APP_SERVER_TURN_INTERRUPTED" })
    const session = JSON.parse(fs.readFileSync(path.join(kernelThreadsRoot(runtimeRoot), threadId, "session.json"), "utf8"))
    expect(session.turns).toHaveLength(1)
    expect(session.turns[0]).toMatchObject({ exitCode: null, harvested: false })
    expect(session.turns[0].failure).toContain("spawn EPERM")
    expect(session.turns[0].failure).not.toContain("ghp_")
    expect(session.turns[0].failure.length).toBeLessThanOrEqual(256)
    const recorded = fs.readFileSync(path.join(kernelThreadsRoot(runtimeRoot), threadId, "turns", "1", "stdout.txt"), "utf8")
    expect(recorded).toBe(session.turns[0].failure)
  })
  it("sanitises secrets out of the recorded stdout evidence", async () => {
    const { client, commandRunner, workspacePath, runtimeRoot, commonDir } = fixture()
    commandRunner.mockImplementation(async (call: Call) => {
      if (call.command === "git") return { code: 0, stdout: `${commonDir}\n`, stderr: "" }
      const r = okResult(call.args[call.args.indexOf("-RunId") + 1]); r.stdout = `token ghp_${"a".repeat(36)}\n${r.stdout}`; return r
    })
    await client.connect()
    const threadId = await client.startThread({ cwd: workspacePath })
    await client.runTurn({ threadId, prompt: "p" })
    const recorded = fs.readFileSync(path.join(kernelThreadsRoot(runtimeRoot), threadId, "turns", "1", "stdout.txt"), "utf8")
    expect(recorded).not.toContain("ghp_")
    expect(recorded).toContain("[REDACTED]")
  })
})

describe("Hermes kernel client - post-turn workspace confinement (issue #806)", () => {
  it("walls a reparse point created inside a subdirectory during the turn", async () => {
    const { client, calls, commandRunner, workspacePath, commonDir } = fixture()
    const nested = path.join(workspacePath, "sub", "deep")
    fs.mkdirSync(nested, { recursive: true })
    const escape = path.join(nested, "escape")
    commandRunner.mockImplementation(async (call: Call) => {
      calls.push(call)
      // the model holds a terminal for the whole turn: it links out mid-turn, then reports success
      if (call.command !== "git" && !fs.existsSync(escape)) fs.symlinkSync(os.tmpdir(), escape, "junction")
      return gitOr(call, commonDir, okResult(call.args[call.args.indexOf("-RunId") + 1]))
    })
    await client.connect()
    const thread = await client.startThread()
    await expect(client.runTurn({ threadId: thread, prompt: "p" })).rejects.toMatchObject({
      code: "RESIDENT_MODEL_LANE_WORKSPACE_TAMPERED",
    })
    // non-vacuous: the link really exists and is really a reparse point
    expect(fs.lstatSync(escape).isSymbolicLink()).toBe(true)
  })
  it("accepts a turn whose workspace gained only ordinary files and directories", async () => {
    const { client, calls, commandRunner, workspacePath, commonDir } = fixture()
    commandRunner.mockImplementation(async (call: Call) => {
      calls.push(call)
      if (call.command !== "git") {
        fs.mkdirSync(path.join(workspacePath, "src", "nested"), { recursive: true })
        fs.writeFileSync(path.join(workspacePath, "src", "nested", "file.txt"), "work")
      }
      return gitOr(call, commonDir, okResult(call.args[call.args.indexOf("-RunId") + 1]))
    })
    await client.connect()
    const thread = await client.startThread()
    await expect(client.runTurn({ threadId: thread, prompt: "p" })).resolves.toMatchObject({ status: "completed" })
  })
})

describe("Hermes kernel client — per-thread kernel state and session continuity (P2b)", () => {
  const sessionLine = (id: string) => `Session:        ${id}\n`
  it("refuses a policy without per-thread state persistence", async () => {
    const { client, policyPath } = fixture()
    const p = JSON.parse(fs.readFileSync(policyPath, "utf8")); p.containment.agentStatePersistence = false; fs.writeFileSync(policyPath, JSON.stringify(p))
    await expect(client.connect()).rejects.toMatchObject({ code: "RESIDENT_MODEL_LANE_STATE_MODE" })
  })
  it("creates the thread's kernel-state dir, passes it to the invoker, and threads the captured kernel session through later turns", async () => {
    const { client, calls, commandRunner, workspacePath, runtimeRoot } = fixture()
    let invocation = 0
    commandRunner.mockImplementation(async (call: Call) => {
      calls.push(call)
      if (call.command === "git") return { code: 0, stdout: path.join(runtimeRoot, "canonical", ".git"), stderr: "" }
      invocation += 1
      const r = okResult(call.args[call.args.indexOf("-RunId") + 1])
      r.stdout = `chatter\n${r.stdout}${sessionLine(invocation === 1 ? "20260816_200044_30d6e1" : "20260816_201500_abcdef")}`
      return r
    })
    await client.connect()
    const threadId = await client.startThread({ cwd: workspacePath })
    const stateDir = path.join(kernelThreadsRoot(runtimeRoot), threadId, "kernel-state")
    expect(fs.existsSync(stateDir)).toBe(true)
    const first = await client.runTurn({ threadId, prompt: "first" })
    const firstCall = calls.filter((c) => c.command === "powershell").at(-1)!
    const argOf = (call: Call, flag: string) => call.args[call.args.indexOf(flag) + 1]
    expect(argOf(firstCall, "-StatePath")).toBe(stateDir)
    const firstPacket = JSON.parse(fs.readFileSync(argOf(firstCall, "-PacketPath"), "utf8"))
    expect(firstPacket).toMatchObject({ schemaVersion: 3, statePath: stateDir, kernelSessionId: null })
    let session = JSON.parse(fs.readFileSync(path.join(kernelThreadsRoot(runtimeRoot), threadId, "session.json"), "utf8"))
    expect(session.kernelSessionId).toBe("20260816_200044_30d6e1")
    expect(session.turns[0]).toMatchObject({ turnId: first.turnId, kernelSessionId: "20260816_200044_30d6e1", resumedKernelSessionId: null })
    await client.runTurn({ threadId, prompt: "second" })
    const secondCall = calls.filter((c) => c.command === "powershell").at(-1)!
    const secondPacket = JSON.parse(fs.readFileSync(argOf(secondCall, "-PacketPath"), "utf8"))
    expect(secondPacket.kernelSessionId).toBe("20260816_200044_30d6e1")
    session = JSON.parse(fs.readFileSync(path.join(kernelThreadsRoot(runtimeRoot), threadId, "session.json"), "utf8"))
    expect(session.turns[1]).toMatchObject({ resumedKernelSessionId: "20260816_200044_30d6e1", kernelSessionId: "20260816_201500_abcdef" })
    expect(session.kernelSessionId).toBe("20260816_201500_abcdef")
  })
  it("resumes only when resume is proven AND a kernel session was captured AND the state dir exists", async () => {
    const { client, calls, commandRunner, workspacePath, runtimeRoot, policyPath } = fixture()
    const p = JSON.parse(fs.readFileSync(policyPath, "utf8")); p.execution.sessionResumeProven = true; fs.writeFileSync(policyPath, JSON.stringify(p))
    commandRunner.mockImplementation(async (call: Call) => {
      calls.push(call)
      if (call.command === "git") return { code: 0, stdout: path.join(runtimeRoot, "canonical", ".git"), stderr: "" }
      const r = okResult(call.args[call.args.indexOf("-RunId") + 1]); r.stdout = `${r.stdout}${sessionLine("20260816_200044_30d6e1")}`; return r
    })
    await client.connect()
    const threadId = await client.startThread({ cwd: workspacePath })
    // proven, but no kernel session captured yet → still unavailable
    await expect(client.resumeThread(threadId, { cwd: workspacePath })).rejects.toMatchObject({ code: "RESIDENT_MODEL_THREAD_RESUME_UNAVAILABLE" })
    await client.runTurn({ threadId, prompt: "first" })
    await expect(client.resumeThread(threadId, { cwd: workspacePath })).resolves.toBe(threadId)
    fs.rmSync(path.join(kernelThreadsRoot(runtimeRoot), threadId, "kernel-state"), { recursive: true, force: true })
    await expect(client.resumeThread(threadId, { cwd: workspacePath })).rejects.toMatchObject({ code: "RESIDENT_MODEL_THREAD_RESUME_UNAVAILABLE" })
  })
})

describe("Hermes kernel client — promotion is reviewed, not self-asserted (P3)", () => {
  it("leaves a pilot lane untouched while its promotion evidence is unproven", async () => {
    const { client, policyPath } = fixture()
    patchPolicy(policyPath, (p) => {
      p.promotion.status = "PILOT_AUTHORIZED"
      p.promotion.promotionRequires = ["V2_OWNED_WORKTREE_REVIEW_APPROVED"]
      p.promotion.satisfiedEvidence.V2_OWNED_WORKTREE_REVIEW_APPROVED = null
    })
    await expect(client.connect()).resolves.toBeUndefined()
  })
  it("refuses a policy that calls itself PROMOTED while a declared promotion line is unproven", async () => {
    for (const unproven of [null, undefined, "", "   "]) {
      const { client, policyPath } = fixture()
      patchPolicy(policyPath, (p) => {
        p.promotion.status = "PROMOTED"
        p.promotion.promotionRequires = ["V2_OWNED_WORKTREE_REVIEW_APPROVED"]
        p.promotion.satisfiedEvidence.V2_OWNED_WORKTREE_REVIEW_APPROVED = unproven
      })
      await expect(client.connect()).rejects.toMatchObject({ code: "RESIDENT_MODEL_LANE_PROMOTION_UNPROVEN" })
    }
  })
  it("accepts PROMOTED once every declared promotion line is satisfied", async () => {
    const { client, policyPath } = fixture()
    patchPolicy(policyPath, (p) => {
      p.promotion.status = "PROMOTED"
      p.promotion.promotionRequires = ["V2_OWNED_WORKTREE_REVIEW_APPROVED"]
      p.promotion.satisfiedEvidence.V2_OWNED_WORKTREE_REVIEW_APPROVED = "review-2026-08-20-codex"
    })
    await expect(client.connect()).resolves.toBeUndefined()
  })
})
