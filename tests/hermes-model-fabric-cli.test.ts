import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { afterEach, describe, expect, it } from "vitest"
import { runModelFabric, validateModelWorkOrder } from "../scripts/hermes-bridge/model-fabric-cli.mjs"

const roots: string[] = []
afterEach(() => { for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true }) })
function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "model-fabric-cli-")); roots.push(root)
  const config = { WILLIAMOS_EXECUTOR: "remote-resident-model", WILLIAMOS_MODEL_EVIDENCE_ROOT: root }
  const workOrder = { id: "WO-TEST-1", objective: "Summarize the supplied file.", branch: "codex/test-1", baseSha: "a".repeat(40), contextPaths: ["README.md"] }
  const output = { result: "READY_FOR_VALIDATION", workOrder: workOrder.id, branch: workOrder.branch, commit: null, prUrl: null,
    merged: false, mergeCommit: null, validation: ["The fixture documents an example. Read-only inference; no tests executed."],
    reviewThreads: 0, ownerTouchCount: 0, blockedScopeCrossed: false, nextState: "RETURN_TO_HERMES", blockedAction: null,
    authorityBoundary: null, minimumChoice: null, approveConsequence: null, denyConsequence: null, findings: [] }
  const calls: any[] = []
  let turns = 0
  let turnHook: (() => Promise<void>) | undefined
  const health: any = { nodeId: "daedalus", reachable: true, ready: true, invokerPresent: true, quarantined: false,
    executionMode: "read-only-inference", agentToolsEnabled: false, policyWorkOrderId: "WO-LANE" }
  const backend = {
    nodeId: "daedalus", modelId: "Qwen/Qwen3-8B",
    async health() { return health },
    async prepareWorkspace(args: any) { calls.push(args); return { workspacePath: "/owned/test-1" } },
    async git({ args }: any) {
      calls.push(args)
      return { exitCode: 0, stdout: args[0] === "rev-parse" ? workOrder.baseSha : args[0] === "cat-file" ? (args[1] === "-t" ? "blob" : "7") : args[0] === "show" ? "example" : "" }
    },
    async runCodexClient() { return {
      async connect() {}, async startThread() { return "thread-1" }, close() {},
      async runTurn({ prompt }: any) {
        turns++; calls.push(prompt); await turnHook?.()
        return { threadId: "thread-1", turnId: "turn-1", finalText: JSON.stringify(output), evidencePath: path.join(root, "evidence") }
      },
    } },
  }
  const placement: any = { status: "RECOMMENDED", recommendation: { recommendation: { node_id: "daedalus" } } }
  let placements = 0
  const invoke = (order: any = workOrder) => runModelFabric({ command: "dispatch", config, workOrder: order }, {
    backendFactory: () => backend, placementRefresher: async () => { placements++; return placement },
  })
  return { root, config, workOrder, output, health, backend, calls, invoke, placement, placements: () => placements, turns: () => turns, setTurnHook: (hook: () => Promise<void>) => { turnHook = hook } }
}

describe("headless read-only model Work Orders", () => {
  it("waits only for transient refresh-lock contention before one inference", async () => {
    const f = fixture(), waits: number[] = []
    let attempts = 0
    const result = await runModelFabric({ command: "dispatch", config: f.config, workOrder: f.workOrder }, {
      backendFactory: () => f.backend,
      wait: async (ms: number) => { waits.push(ms) },
      placementRefresher: async () => { if (++attempts <= 2) throw new Error("MODEL_FABRIC_REFRESH_IN_PROGRESS"); return f.placement },
    })
    expect(result.status).toBe("COMPLETED")
    expect(waits).toEqual([1000, 1000])
    expect(f.turns()).toBe(1)
  })

  it("bounds lock contention waits and never retries other refresh errors", async () => {
    for (const message of ["MODEL_FABRIC_REFRESH_IN_PROGRESS", "MODEL_FABRIC_REFRESH_IDENTITY_MISMATCH"]) {
      const f = fixture(), waits: number[] = []
      let attempts = 0
      await expect(runModelFabric({ command: "dispatch", config: f.config, workOrder: f.workOrder }, {
        backendFactory: () => f.backend, wait: async (ms: number) => { waits.push(ms) },
        placementRefresher: async () => { attempts++; throw new Error(message) },
      })).rejects.toThrow(message)
      expect(waits.reduce((sum, ms) => sum + ms, 0)).toBeLessThanOrEqual(10000)
      expect(attempts).toBe(message.endsWith("IN_PROGRESS") ? 11 : 1)
      expect(f.turns()).toBe(0)
    }
  })
  it("dispatches actual immutable context and persists machine-readable results without claiming promotion", async () => {
    const f = fixture()
    const receipt = await f.invoke()
    expect(receipt).toMatchObject({ status: "COMPLETED", workOrderId: "WO-TEST-1", policyWorkOrderId: "WO-LANE", nodeId: "daedalus", autonomousDispatch: false })
    expect(f.calls).toContainEqual(["show", `${f.workOrder.baseSha}:README.md`])
    expect(f.calls.find((call) => typeof call === "string")).toContain('"content":"example"')
    expect(JSON.parse(fs.readFileSync(receipt.resultPath, "utf8")).output).toEqual(f.output)
    expect(f.placements()).toBe(1)
  })

  it("replays a completed identical request without a second inference and rejects changed objectives", async () => {
    const f = fixture()
    const first = await f.invoke(), replay = await f.invoke()
    expect(replay).toEqual({ ...first, replayed: true })
    expect(f.turns()).toBe(1)
    expect(f.placements()).toBe(1)
    await expect(f.invoke({ ...f.workOrder, objective: "Different work" })).rejects.toThrow("WORK_ORDER_ID_CONFLICT")
  })

  it("never redispatches after an ambiguous transport failure", async () => {
    const f = fixture()
    f.setTurnHook(async () => { throw new Error("connection lost") })
    await expect(f.invoke()).rejects.toThrow("connection lost")
    await expect(f.invoke()).rejects.toThrow("RECONCILIATION_REQUIRED")
    expect(f.turns()).toBe(1)
    expect(JSON.parse(fs.readFileSync(path.join(f.root, "work-orders", f.workOrder.id, "dispatch.json"), "utf8")).threadId).toBe("thread-1")
  })

  it("holds an exclusive work-order claim while another call is running", async () => {
    const f = fixture()
    let release!: () => void
    let started!: () => void
    const running = new Promise<void>((resolve) => { started = resolve })
    f.setTurnHook(async () => { started(); await new Promise<void>((resolve) => { release = resolve }) })
    const first = f.invoke()
    await running
    await expect(f.invoke()).rejects.toThrow("RECONCILIATION_REQUIRED")
    release(); await first
    expect(f.turns()).toBe(1)
  })

  it("rejects corrupt completed results instead of retrying", async () => {
    const f = fixture(), receipt = await f.invoke()
    fs.appendFileSync(receipt.resultPath, "changed")
    await expect(f.invoke()).rejects.toThrow("RECONCILIATION_REQUIRED")
    expect(f.turns()).toBe(1)
  })

  it.each(["../escape", "/etc/passwd", "a/../b", "a//b", "a\\b", ".env", "a/.git/config"])("rejects unsafe context %s before remote calls", (file) => {
    expect(() => validateModelWorkOrder({ ...fixture().workOrder, contextPaths: [file] })).toThrow("CONTEXT_PATH_INVALID")
  })

  it("refuses other backends, unsafe Git references, and tools-enabled health", async () => {
    const f = fixture()
    await expect(runModelFabric({ command: "health", config: { ...f.config, WILLIAMOS_EXECUTOR: "resident-model" } })).rejects.toThrow("REMOTE_BACKEND_REQUIRED")
    expect(() => validateModelWorkOrder({ ...f.workOrder, branch: "--option" })).toThrow("BRANCH_INVALID")
    expect(() => validateModelWorkOrder({ ...f.workOrder, baseSha: "HEAD" })).toThrow("BASE_SHA_INVALID")
    f.health.agentToolsEnabled = true
    await expect(f.invoke()).rejects.toThrow("READ_ONLY_POLICY_REQUIRED")
    expect(f.turns()).toBe(0)
  })

  it("rejects fabricated mutation claims and wrong work-order output", async () => {
    const f = fixture()
    f.output.commit = "fabricated" as any
    await expect(f.invoke()).rejects.toThrow("RESULT_INVALID")
    const other = fixture()
    other.output.workOrder = "WRONG"
    await expect(other.invoke()).rejects.toThrow("RESULT_INVALID")
  })

  it("rejects oversized context before loading the blob or invoking inference", async () => {
    const f = fixture()
    const original = f.backend.git
    f.backend.git = async (request: any) => request.args[0] === "cat-file" && request.args[1] === "-s" ? { exitCode: 0, stdout: "1000000000" } : original(request)
    await expect(f.invoke()).rejects.toThrow("CONTEXT_TOO_LARGE")
    expect(f.turns()).toBe(0)
    expect(f.calls.some((call) => Array.isArray(call) && call[0] === "show")).toBe(false)
  })

  it("requires eligible placement for normal work and permits explicit commissioning only", async () => {
    const f = fixture()
    f.placement.status = "NO_ELIGIBLE_NODE"
    await expect(f.invoke()).rejects.toThrow("PLACEMENT_REQUIRED")
    expect(f.turns()).toBe(0)
    const pilot = fixture()
    pilot.health.ready = false
    await pilot.invoke({ ...pilot.workOrder, commissioning: true })
    expect(pilot.placements()).toBe(0)
    expect(pilot.turns()).toBe(1)
  })
})
