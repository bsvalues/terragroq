import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { afterEach, describe, expect, it } from "vitest"
import { refreshModelFabric } from "../scripts/hermes-bridge/refresh-model-fabric.mjs"

const roots: string[] = []
afterEach(() => { for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true }) })
function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "fabric-refresh-")); roots.push(root)
  const directory = path.join(root, "config/execution-fabric"); fs.mkdirSync(directory, { recursive: true })
  for (const name of ["registry.seed.json", "registry.schema.json", "placement-workloads.json"]) fs.copyFileSync(path.join(process.cwd(), "config/execution-fabric", name), path.join(directory, name))
  const seed = JSON.parse(fs.readFileSync(path.join(directory, "registry.seed.json"), "utf8"))
  const node = seed.nodes.find((entry: any) => entry.id === "daedalus")
  node.identity = { hostname: "daedalus-thinkstation-p620", machine_id_sha256: "a".repeat(64), source: "linux-machine-id-sha256" }
  fs.writeFileSync(path.join(directory, "registry.seed.json"), JSON.stringify(seed))
  const at = new Date("2026-09-10T02:00:00Z")
  const probe: any = { schema_version: "0.1-node-probe", node: { id: "daedalus", identity: node.identity, observed_at: at.toISOString(),
    gpus: [{ id: "gpu0", uuid: "GPU-123", model: "RTX 3090", vendor: "NVIDIA", vram_bytes: 25769803776 }], runtimes: [] },
    evidence: { observed_at: at.toISOString() } }
  const health: any = { nodeId: "daedalus", observedAt: at.toISOString(), ready: true, reachable: true, quarantined: false, invokerPresent: true,
    executionMode: "read-only-inference", agentToolsEnabled: false, gpu: { uuid: "GPU-123", name: "RTX 3090", vramBytes: 25769803776 },
    models: [{ id: "Qwen/Qwen3-8B", runtimeState: "healthy" }] }
  let assembled = 0
  const config = { WILLIAMOS_EXECUTOR: "remote-resident-model", WILLIAMOS_MODEL_EVIDENCE_ROOT: path.join(root, "evidence") }
  const backend = { nodeId: "daedalus", modelId: "Qwen/Qwen3-8B", repositoryRoot: "/repo", async health() { return health },
    async runCommand(request: any) { expect(request.command).toBe("bash"); expect(request.args).toEqual(["/repo/scripts/execution-fabric/probe-linux.sh", "daedalus"]); return { exitCode: 0, stdout: JSON.stringify(probe) } } }
  const refresh = () => refreshModelFabric(config, { repositoryRoot: root, now: () => at, backendFactory: () => backend,
    commandRunner: async ({ args }: any) => {
      assembled++
      const enriched = JSON.parse(fs.readFileSync(path.join(config.WILLIAMOS_MODEL_EVIDENCE_ROOT, "placement/daedalus.json"), "utf8"))
      const snapshot = structuredClone(seed), current = snapshot.nodes.find((entry: any) => entry.id === "daedalus")
      current.gpus = enriched.node.gpus; current.runtimes = enriched.node.runtimes
      current.evidence = { ...current.evidence, observed_at: at.toISOString(), ttl_seconds: 300, confidence: "observed" }
      current.capability_health.compute = { ...current.capability_health.compute, state: current.runtimes[0].state === "healthy" ? "READY" : "UNKNOWN", observed_at: at.toISOString(), expires_at: new Date(+at + 300000).toISOString() }
      fs.writeFileSync(args[args.indexOf("--out") + 1], JSON.stringify(snapshot))
      return { code: 0 }
    },
  })
  return { root, config, probe, health, refresh, assembled: () => assembled }
}

describe("model fabric observation refresh", () => {
  it("binds live model and GPU observations to the pinned machine before recommending", async () => {
    const f = fixture(), result = await f.refresh()
    expect(result.recommendation.recommendation.node_id).toBe("daedalus")
    expect(result.autonomousDispatch).toBe(false)
    expect(JSON.parse(fs.readFileSync(result.probePath, "utf8")).node.runtimes[0].details.models).toEqual(["Qwen/Qwen3-8B"])
    expect(f.assembled()).toBe(1)
  })
  it.each(["not-ready", "different-gpu"])("does not advertise a healthy model for %s", async (failure) => {
    const f = fixture()
    if (failure === "not-ready") f.health.ready = false
    else f.health.gpu.uuid = "GPU-WRONG"
    const result = await f.refresh()
    expect(result.recommendation.recommendation).toBeNull()
    expect(JSON.parse(fs.readFileSync(result.probePath, "utf8")).node.runtimes[0].details.models).toEqual([])
  })
  it("rejects a different machine before writing observed evidence", async () => {
    const f = fixture()
    f.probe.node.identity.machine_id_sha256 = "b".repeat(64)
    await expect(f.refresh()).rejects.toThrow("IDENTITY_MISMATCH")
    expect(f.assembled()).toBe(0)
  })
  it("rejects stale health rather than refreshing its timestamp", async () => {
    const f = fixture(); f.health.observedAt = "2026-09-09T02:00:00Z"
    await expect(f.refresh()).rejects.toThrow("OBSERVATION_STALE")
    expect(f.assembled()).toBe(0)
  })
})
