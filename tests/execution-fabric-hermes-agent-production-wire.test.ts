import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { afterEach, describe, expect, it, vi } from "vitest"

import { createHermesKernelClient } from "../scripts/hermes-bridge/hermes-kernel-client.mjs"

type Call = { command: string; args: string[]; timeoutMs?: number; credentialAccess?: boolean }

const REQUIRED_EVIDENCE = ["IMAGE_BUILD_PROVEN", "OWNED_WORKTREE_CONFINEMENT_PROVEN"]
const SATISFIED_EVIDENCE = { IMAGE_BUILD_PROVEN: "sha256:deadbeef", OWNED_WORKTREE_CONFINEMENT_PROVEN: "bootstrap-owned-1" }

const fullTurnJson = () => JSON.stringify({
  result: "READY_FOR_VALIDATION", workOrder: "WO-1", branch: "codex/x", commit: null, prUrl: null,
  merged: false, mergeCommit: null, validation: ["pass"], reviewThreads: 0, ownerTouchCount: 0,
  blockedScopeCrossed: false, nextState: "READY_FOR_HERMES_MERGE", blockedAction: null,
  authorityBoundary: null, minimumChoice: null, approveConsequence: null, denyConsequence: null, findings: [],
})
const okResult = (runId: string) => ({
  code: 0, stderr: "", stdout: `agent chatter\n\`\`\`json\n${fullTurnJson()}\n\`\`\`\nHERMES_FREE_AGENT_COMPLETE runId=${runId} workspace=D:\\w\n`,
})

const roots: string[] = []
afterEach(() => { for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true }) })

function fixture({ placementProvider }: { placementProvider?: () => Promise<unknown> } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "tier2-")); roots.push(root)
  const runtimeRoot = path.join(root, "runtime")
  const workspacePath = path.join(runtimeRoot, "worktrees", "resident-1")
  fs.mkdirSync(workspacePath, { recursive: true })
  const policyDir = path.join(root, "policy"); fs.mkdirSync(policyDir)
  const policyPath = path.join(policyDir, "hermes-free-dev-agent-v2.policy.json")
  fs.writeFileSync(policyPath, JSON.stringify({
    schemaVersion: 2, packetSchemaVersion: 3, workOrderId: "WO-HERMES-FREE-DEV-AGENT-001",
    providerId: "hermes-agent-local-qwen-v2",
    runtime: "NousResearch/hermes-agent@fa83af3f",
    model: { id: "williamos-qwen3-4b:64k" },
    modelRoster: [
      { modelIdentity: "williamos-qwen3-4b:64k@fabric:commissioned-v1", alias: "williamos-qwen3-4b:64k", runtimeId: "hermes-ollama", computeId: "hermes-node", executionClass: "LOCAL" },
      { modelIdentity: "Qwen/Qwen3-8B@b968826d9c46dd6066d109eabc6255188de91218", alias: "Qwen3-8B", runtimeId: "daedalus-hf-transformers", computeId: "daedalus", executionClass: "LOCAL" },
    ],
    containment: { agentStatePersistence: "PER_THREAD_STATE_DIR" },
    // The lane is commissioned to execute on hermes-node; the Fabric may place it across the
    // qualified roster, and every roster binding must be a complete model × runtime × compute.
    placement: { workspaceMode: "OWNED_WORKTREE", executionNode: "hermes-node", allowedWorkspaceRoots: [path.join(runtimeRoot, "worktrees")] },
    execution: { maximumTurns: 20, allowedToolsets: ["file", "terminal"], promptMaxChars: 60000, sessionResumeProven: false, timeoutSeconds: 1800 },
    promotion: { status: "PILOT_AUTHORIZED", requiredEvidence: [...REQUIRED_EVIDENCE], satisfiedEvidence: { ...SATISFIED_EVIDENCE } },
  }))
  const invokerPath = path.join(root, "invoke.ps1"); fs.writeFileSync(invokerPath, "# fake")
  const commonDir = path.join(root, "canonical", ".git")
  const calls: Call[] = []
  const commandRunner = vi.fn(async (call: Call) => {
    calls.push(call)
    if (call.command === "git") return { code: 0, stdout: `${commonDir}\n`, stderr: "" }
    return okResult(call.args[call.args.indexOf("-RunId") + 1])
  })
  const client = createHermesKernelClient({
    workspacePath, runtimeRoot, commandRunner, policyPath, invokerPath, timeoutMs: 45 * 60 * 1000,
    now: () => new Date("2026-09-10T20:00:00.000Z"), powershellCommand: "powershell",
    randomUUID: (() => { let n = 0; return () => `00000000-0000-4000-8000-00000000000${++n}` })(),
    ...(placementProvider === undefined ? {} : { placementProvider }),
  } as any)
  return { root, runtimeRoot, workspacePath, policyPath, invokerPath, calls, client }
}

describe("Tier 2 production wire — the kernel client actually consumes the placement", () => {
  it("runTurn builds the packet from the Fabric-selected model (the resolver runs in production)", async () => {
    const f = fixture({ placementProvider: async () => ({ recommendation: { recommendation: { node_id: "daedalus" } }, status: "RECOMMENDED" }) })
    await f.client.connect()
    const threadId = await f.client.startThread()
    await (f.client as any).runTurn({ threadId, prompt: "Deliver WO-1" } as any)
    const packetCall = f.calls.find((call) => call.command === "powershell")!
    const packetPath = packetCall.args[packetCall.args.indexOf("-PacketPath") + 1]
    const packet = JSON.parse(fs.readFileSync(packetPath, "utf8"))
    // The packet names the PLACED alias, not the policy default — proving the production consumer
    // is the placement, not the module being referenced only by its test.
    expect(packet.model).toBe("Qwen3-8B")
    expect(packet.placement).toEqual({ runtimeId: "daedalus-hf-transformers", computeId: "daedalus", executionClass: "LOCAL" })
    // the immutable identity never travels in the packet; the invoker re-derives from trusted state
    expect(JSON.stringify(packet)).not.toContain("b968826d")
  })

  it("a placement recommending an unqualified node fails closed before the invoker runs", async () => {
    const f = fixture({ placementProvider: async () => ({ recommendation: { recommendation: { node_id: "atlas" } }, status: "RECOMMENDED" }) })
    await f.client.connect()
    const threadId = await f.client.startThread()
    await expect((f.client as any).runTurn({ threadId, prompt: "Deliver WO-1" } as any)).rejects.toThrow(/PLACEMENT_INCOMPLETE:no-model-for-node:atlas/)
    expect(f.calls.some((call) => call.command === "powershell")).toBe(false)
  })

  it("without a placement provider the commissioned default packet is unchanged (probe/test lanes)", async () => {
    const f = fixture()
    await f.client.connect()
    const threadId = await f.client.startThread()
    await (f.client as any).runTurn({ threadId, prompt: "Deliver WO-1" } as any)
    const packetCall = f.calls.find((call) => call.command === "powershell")!
    const packetPath = packetCall.args[packetCall.args.indexOf("-PacketPath") + 1]
    const packet = JSON.parse(fs.readFileSync(packetPath, "utf8"))
    expect(packet.model).toBe("williamos-qwen3-4b:64k")
    expect("placement" in packet).toBe(false)
  })
})
