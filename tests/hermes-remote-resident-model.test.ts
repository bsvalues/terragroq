import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import crypto from "node:crypto"
import { afterEach, describe, expect, it } from "vitest"
import { RemoteResidentModelExecutionBackend, selectExecutionBackend } from "../scripts/hermes-bridge/execution-backend.mjs"
import { createRemoteResidentClient, residentSshTransport } from "../scripts/hermes-bridge/remote-resident-model-client.mjs"
import { handleResidentRequest } from "../scripts/hermes-bridge/remote-resident-model-worker.mjs"

const roots: string[] = []
afterEach(() => { for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true }) })
const output = JSON.stringify({ result: "READY_FOR_VALIDATION", workOrder: "WO-1", branch: "codex/x", commit: null, prUrl: null,
  merged: false, mergeCommit: null, validation: ["pass"], reviewThreads: 0, ownerTouchCount: 0, blockedScopeCrossed: false,
  nextState: "READY_FOR_HERMES_MERGE", blockedAction: null, authorityBoundary: null, minimumChoice: null,
  approveConsequence: null, denyConsequence: null, findings: [] })

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "remote-resident-")); roots.push(root)
  const config = { nodeId: "daedalus", modelId: "Qwen/Qwen3-8B", runtimeRoot: path.join(root, "runtime"),
    repositoryRoot: root, policyPath: path.join(root, "policy.json"), invokerPath: path.join(root, "invoke.ps1") }
  const workspacePath = path.join(config.runtimeRoot, "worktrees", "owned")
  fs.mkdirSync(workspacePath, { recursive: true }); fs.writeFileSync(config.invokerPath, "# fixture")
  fs.writeFileSync(config.policyPath, JSON.stringify({ model: { id: config.modelId }, workOrderId: "WO-1",
    placement: { executionNode: "daedalus", workspaceMode: "OWNED_WORKTREE" },
    containment: { agentStatePersistence: "PER_THREAD_STATE_DIR" },
    promotion: { status: "PILOT_AUTHORIZED", requiredEvidence: ["FIXTURE"], satisfiedEvidence: { FIXTURE: "test-only" } },
    execution: { maximumTurns: 1, allowedToolsets: ["file"], timeoutSeconds: 1 } }))
  const calls: any[] = []
  const commandRunner = async (call: any) => {
    calls.push(call)
    if (call.command === "git") return { code: 0, stdout: call.args.includes("rev-parse") ? path.join(root, ".git") : "", stderr: "" }
    const runId = call.args[call.args.indexOf("-RunId") + 1]
    return { code: 0, stderr: "", stdout: `\`\`\`json\n${output}\n\`\`\`\nHERMES_FREE_AGENT_COMPLETE runId=${runId} workspace=fixture\n` }
  }
  const transport = async ({ request }: any) => {
    try { return { schemaVersion: 1, ok: true, result: await handleResidentRequest(request, { commandRunner }) } }
    catch (error: any) { return { schemaVersion: 1, ok: false, error: { name: error.name, message: error.message, code: error.code, method: error.method } } }
  }
  const client = createRemoteResidentClient({ host: "daedalus", workerPath: "/fixture/worker.mjs", config, workspacePath,
    evidenceRoot: path.join(root, "returned"), timeoutMs: 5000, transport })
  return { root, config, workspacePath, client, transport, calls }
}

describe("remote resident model execution", () => {
  it("requires a successful current GPU probe and a matching accepted GPU identity for health readiness", async () => {
    const f = fixture()
    const config = { ...f.config, invokerKind: "python" }
    const policy = JSON.parse(fs.readFileSync(config.policyPath, "utf8"))
    policy.daedalusInvoker = { expectedGpuUuid: "GPU-abcd", workerPath: config.invokerPath, modelPath: f.root, modelFiles: { "policy.json": "fixture" } }
    fs.writeFileSync(config.policyPath, JSON.stringify(policy))
    const digest = (file: string) => crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex")
    const root = path.join(config.runtimeRoot, "hermes-kernel")
    fs.mkdirSync(root, { recursive: true })
    const accepted = { kernelTurnAccepted: true, observedAt: new Date().toISOString(), nodeId: config.nodeId, modelId: config.modelId,
      policySha256: digest(config.policyPath), workerSha256: digest(config.invokerPath), invokerSha256: digest(config.invokerPath), gpuUuid: "GPU-abcd" }
    const receipt = path.join(root, "daedalus-last-accepted.json")
    fs.writeFileSync(receipt, JSON.stringify(accepted))
    const check = (probe: any) => handleResidentRequest({ schemaVersion: 1, method: "health", config }, { commandRunner: async () => probe })
    const valid = { code: 0, stdout: "GPU-abcd, RTX 3090, 24576\n" }
    expect((await check(valid)).ready).toBe(true)
    for (const probe of [{ ...valid, code: 1 }, { ...valid, timedOut: true }, { ...valid, stdout: "GPU-abcd, RTX 3090, NaN" },
      { ...valid, stdout: "GPU-abcd, RTX 3090, 0" }]) expect((await check(probe)).ready).toBe(false)
    fs.writeFileSync(receipt, JSON.stringify({ ...accepted, gpuUuid: "GPU-different" }))
    expect((await check(valid)).ready).toBe(false)
  })
  it("requires explicit remote paths and model identity, and never falls back to Codex", () => {
    expect(() => selectExecutionBackend({ WILLIAMOS_EXECUTOR: "remote-resident-model", WILLIAMOS_CODEX_EXEC_NODE: "aegis" })).toThrow()
    const backend = selectExecutionBackend({ WILLIAMOS_EXECUTOR: "remote-resident-model", WILLIAMOS_MODEL_EXEC_NODE: "daedalus",
      WILLIAMOS_MODEL_NODE_ID: "daedalus", WILLIAMOS_MODEL_ID: "Qwen/Qwen3-8B", WILLIAMOS_MODEL_RUNTIME_ROOT: "/runtime",
      WILLIAMOS_MODEL_REPOSITORY_ROOT: "/repo", WILLIAMOS_MODEL_POLICY_PATH: "/policy.json", WILLIAMOS_MODEL_INVOKER_PATH: "/invoke.ps1",
      WILLIAMOS_MODEL_EVIDENCE_ROOT: os.tmpdir() })
    expect(backend).toBeInstanceOf(RemoteResidentModelExecutionBackend)
    expect(backend.isResidentModel).toBe(true)
    expect(() => new RemoteResidentModelExecutionBackend({ runtimeRoot: "relative" })).toThrow()
  })

  it("round trips a real kernel session through the protocol and automatically returns turn evidence", async () => {
    const f = fixture()
    await f.client.connect()
    const threadId = await f.client.startThread()
    const result = await f.client.runTurn({ threadId, prompt: "fixture bounded task" })
    expect(result.finalText).toBe(output)
    expect(JSON.parse(fs.readFileSync(path.join(result.evidencePath, "session.json"), "utf8")).turns[0].harvested).toBe(true)
    expect(JSON.parse(fs.readFileSync(path.join(result.evidencePath, "packet.json"), "utf8")).model).toBe("Qwen/Qwen3-8B")
    expect(fs.readFileSync(path.join(result.evidencePath, "stdout.txt"), "utf8")).toContain("HERMES_FREE_AGENT_COMPLETE")
    expect(f.calls.some((call) => call.command === "codex")).toBe(false)
    f.client.close()
    await expect(f.client.startThread()).rejects.toThrow("NOT_CONNECTED")
  })

  it("retains the existing kernel quarantine and evidence gates on the remote side", async () => {
    const f = fixture()
    fs.writeFileSync(path.join(f.root, "HERMES_FREE_AGENT_QUARANTINED"), "fixture")
    await expect(f.client.connect()).rejects.toMatchObject({ code: "RESIDENT_MODEL_LANE_QUARANTINED" })
    expect(f.calls).toEqual([])
  })

  it("refuses unsatisfied qualification evidence and unsafe SSH options", async () => {
    const f = fixture()
    const policy = JSON.parse(fs.readFileSync(f.config.policyPath, "utf8"))
    policy.promotion.satisfiedEvidence.FIXTURE = null
    fs.writeFileSync(f.config.policyPath, JSON.stringify(policy))
    await expect(f.client.connect()).rejects.toMatchObject({ code: "RESIDENT_MODEL_LANE_EVIDENCE_UNPROVEN" })
    expect(f.calls).toEqual([])
    expect(() => residentSshTransport({ host: "-oProxyCommand=bad", workerPath: "/worker.mjs", request: {} })).toThrow("safe SSH")
  })

  it("rejects a policy for a different node or model before invoking anything", async () => {
    const f = fixture()
    const policy = JSON.parse(fs.readFileSync(f.config.policyPath, "utf8"))
    policy.placement.executionNode = "hermes-node"
    fs.writeFileSync(f.config.policyPath, JSON.stringify(policy))
    await expect(f.client.connect()).rejects.toThrow("PLACEMENT_MISMATCH")
    expect(f.calls).toEqual([])
  })

  it("refuses corrupted returned evidence instead of accepting a completed result", async () => {
    const f = fixture()
    const client = createRemoteResidentClient({ host: "daedalus", workerPath: "/fixture/worker.mjs", config: f.config,
      workspacePath: f.workspacePath, evidenceRoot: path.join(f.root, "corrupt"), timeoutMs: 5000,
      transport: async (call: any) => {
        const response: any = await f.transport(call)
        if (call.request.method === "runTurn" && response.ok) response.result.evidence.files["stdout.txt"] += "corruption"
        return response
      } })
    await client.connect()
    const threadId = await client.startThread()
    await expect(client.runTurn({ threadId, prompt: "fixture" })).rejects.toThrow("EVIDENCE_INVALID")
    expect(fs.existsSync(path.join(f.root, "corrupt"))).toBe(false)
  })

  it("reports reachability and configured roster without falsely claiming live inference readiness", async () => {
    const f = fixture()
    const health = await handleResidentRequest({ schemaVersion: 1, method: "health", config: f.config })
    expect(health).toMatchObject({ nodeId: "daedalus", reachable: true, ready: false,
      models: [{ id: "Qwen/Qwen3-8B", runtimeState: "UNKNOWN" }] })
    await expect(handleResidentRequest({ schemaVersion: 1, method: "exec", config: f.config })).rejects.toThrow("REQUEST_INVALID")
  })
})
