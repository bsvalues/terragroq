import crypto from "node:crypto"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { spawnSync } from "node:child_process"
import { describe, expect, it } from "vitest"

import { canonicalizeJcs } from "../scripts/execution-fabric/canonical-json.mjs"
import {
  runPinnedPlacementCli,
  runPinnedPlacementInProcessCli,
} from "../scripts/execution-fabric/recommend-pinned-placement.mjs"

type JsonObject = Record<string, any>
type Fixture = { root: string; snapshotRoot: string; refs: Record<string, string> }

const repositoryRoot = process.cwd()
const testPython = process.platform === "win32" ? "py" : "python3"
const verifier = path.join(repositoryRoot, "scripts/execution-fabric/verify_snapshot.py")
const pinHelper = path.join(repositoryRoot, "tests/fixtures/execution-fabric/pin_test_snapshot.py")

function feeds(): Record<string, JsonObject> {
  return {
    "hermes-node": {
      schema: "hermes-placement-readiness/1", canonicalization: "jcs-rfc8785/1", node: "hermes-node",
      observed_at: "2026-08-10T06:55:42Z", scheduler: "OFF",
      resources: {
        cpu_cores: 8, cpu_threads: 16, cpu_load_pct: 25, ram_total_gb: 31.9, ram_free_gb: 19.4,
        c_free_gb: 311.9, d_free_gb: 106.3, workspace_free_gb: 311.9, docker: "v28.5.1",
        gpus: [{ name: "NVIDIA GeForce RTX 3050", vram_total_mb: 6144, vram_free_mb: 5279, vram_used_mb: 724, util_pct: 15, temp_c: 28 }],
        ollama: "running", running_workloads: ["ollama", "open-webui", "portainer"],
      },
      node_health: "OK", compute_capability_health: "READY", gpu_inference_capability_health: "READY",
      gpu_reason: "OK", local_llm_capability_health: "READY", local_llm_reason: "OK",
      limits: {
        min_free_ram_gb: 4, min_free_disk_gb: 20, gpu_vram_headroom_mb: 1024, max_concurrent_ai_jobs: 1,
        inference_fail_closed_when: ["no GPU/driver"], do_not_fail_node_when: ["GPU busy/hot"],
      },
      model_inventory: [{
        name: "llama3.2:3b", id: "a80c4f17acd5", size_gb: 2, params: "3b", quantization: "default(~q4)",
        est_vram_mb: 2048, fits_gpu: true, preferred_path: "gpu", latency_class: "low", task_class: "general-lightweight-llm",
      }],
      workload_classes: { ready: ["local-llm-inference", "gpu-batch", "agent-runtime", "model-evaluation"], pending_or_reject: ["authoritative-state"] },
    },
    atlas: {
      schema: "atlas-placement-readiness/1", canonicalization: "jcs-rfc8785/1", node: "atlas",
      observed_at: "2026-08-10T06:58:20Z", scheduler: "OFF",
      resources: {
        cores: 28, load1: "0.05", ram_total_mb: 32007, ram_avail_pct: 96, root_free_gb: 638,
        forge: "mounted", forge_free_gb: 3156, forge_smart: "PASSED", io_pressure_avg10: "0.33",
        cpu_pressure_avg10: "0.00", nic: "up@1000Mb", postgres: "ready", mongo: "ready", redis: "running",
      },
      node_health: "OK", state_capability_health: "READY", state_reason: "OK",
      retrieval_capability_health: "READY", retrieval_reason: "OK", storage_capability_health: "READY", storage_reason: "OK",
      thresholds: { min_ram_headroom_pct: 15, min_forge_free_gb: 100, io_pressure_cutoff: 25, max_load_for_optional: 19.6 },
      placement_constraints: ["retains authoritative durable state", "DB latency + storage health take priority"],
      workload_classes: { ready_with_headroom: ["retrieval-index-read", "db-backed-query", "state-read"], disfavored: ["noisy-unbounded-cpu-batch"], reject: ["county-production-writes"] },
    },
    aegis: {
      schema: "aegis-capability/1", canonicalization: "jcs-rfc8785/1", node: "aegis",
      observed_at: "2026-08-10T06:59:09Z", timestamp: "2026-08-10T06:59:09+00:00", status: "warn",
      root_avail_gb: 1747, root_use_pct: 1, docker_active: "active", docker_disk: "Images=786.2MB",
      portainer_agent: "running", load1: "0.02", cores: 28, cpu_temp_c: "36", ram_total_mb: 15906,
      ram_avail_pct: 94, smart: "sda=PASSED", nic: "up@1000Mb", storage_role: "backup-ready",
      node_health: "WARN", compute_capability_health: "READY", backup_capability_health: "READY",
      archive_capability_health: "READY", backup_reason: "OK", scheduler: "OFF",
      backup: { last_backup: "20260810T061501Z", last_restore_verify: "20260810T061501Z", age_hours: "0.7", capability: "READY", reason: "OK", threshold_hours: 48 },
      issues: "sdb ABSENT_OR_PHANTOM",
    },
  }
}

function fixture(mutate?: (values: Record<string, JsonObject>) => void): Fixture {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "fabric-pinned-placement-"))
  const snapshotRoot = path.join(root, "snapshots")
  const values = feeds()
  mutate?.(values)
  const refs: Record<string, string> = {}
  for (const [node, feed] of Object.entries(values)) {
    const feedPath = path.join(root, `${node}.json`)
    fs.writeFileSync(feedPath, `${JSON.stringify(feed, null, 2)}\n`)
    const pinned = spawnSync(testPython, [pinHelper, feedPath, snapshotRoot], { encoding: "utf8", windowsHide: true })
    if (pinned.status !== 0) throw new Error(`test snapshot pin failed: ${pinned.stderr || pinned.stdout}`)
    refs[node] = pinned.stdout.trim()
  }
  return { root, snapshotRoot, refs }
}

function inProcessFixture(mutate?: (values: Record<string, JsonObject>) => void): Fixture {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "fabric-pinned-placement-in-process-"))
  const snapshotRoot = path.join(root, "snapshots")
  const values = feeds()
  mutate?.(values)
  const refs: Record<string, string> = {}
  for (const [node, feed] of Object.entries(values)) {
    const snapshotSha256 = crypto.createHash("sha256").update(canonicalizeJcs(feed)).digest("hex")
    const directory = path.join(snapshotRoot, node)
    fs.mkdirSync(directory, { recursive: true })
    fs.writeFileSync(path.join(directory, `${snapshotSha256}.json`), `${JSON.stringify({
      ...feed,
      snapshot_sha256: snapshotSha256,
    }, null, 2)}\n`)
    refs[node] = snapshotSha256
  }
  return { root, snapshotRoot, refs }
}

function args(value: Fixture, at = "2026-08-10T07:00:00.000Z") {
  return [
    "--snapshot-root", value.snapshotRoot, "--verifier", verifier, "--python", testPython,
    "--registry", path.join(repositoryRoot, "config/execution-fabric/registry.seed.json"),
    "--schema", path.join(repositoryRoot, "config/execution-fabric/registry.schema.json"),
    "--policy", path.join(repositoryRoot, "config/execution-fabric/pinned-evidence-policy.json"),
    "--workloads", path.join(repositoryRoot, "config/execution-fabric/placement-workloads.json"),
    "--workload", "cpu-heavy-build", "--at", at,
    "--evidence", `hermes-node=${value.refs["hermes-node"]}`,
    "--evidence", `atlas=${value.refs.atlas}`,
    "--evidence", `aegis=${value.refs.aegis}`,
  ]
}

function run(value: Fixture, at?: string) {
  return runPinnedPlacementCli(args(value, at)) as JsonObject
}

function expectRejected(result: JsonObject, detail: string) {
  expect(result).toMatchObject({
    schema_version: "0.2-pinned-placement-recommendation", status: "INPUT_REJECTED",
    recommendation: null, evidence_snapshot: [], authority_mutated: false, remote_systems_modified: false,
  })
  expect(result.error.detail).toContain(detail)
}

describe("Execution Fabric pinned placement recommendations", () => {
  it("replays the pinned verifier contract in-process without an interpreter dependency", () => {
    const value = inProcessFixture()
    const first = runPinnedPlacementInProcessCli(args(value)) as JsonObject
    const replay = runPinnedPlacementInProcessCli(args(value)) as JsonObject
    expect(first).toEqual(replay)
    expect(first).toMatchObject({
      status: "RECOMMENDED",
      recommendation: { node_id: "aegis", execution_authorized: false, dispatch_allowed: false },
      scheduler: { state: "disabled", authority: "not-granted", autonomous_dispatch: "forbidden" },
      evidence_verifier: {
        contract: "jcs-rfc8785/1",
        reference_implementation: "verify_snapshot.py",
        result: "PASS",
      },
    })

    const hermesPath = path.join(value.snapshotRoot, "hermes-node", `${value.refs["hermes-node"]}.json`)
    const changed = JSON.parse(fs.readFileSync(hermesPath, "utf8"))
    changed.resources.cpu_load_pct += 1
    fs.writeFileSync(hermesPath, `${JSON.stringify(changed, null, 2)}\n`)
    expect(runPinnedPlacementInProcessCli(args(value))).toMatchObject({ status: "INPUT_REJECTED" })
  })
  it("runs the real pinned verifier and is invariant to reference order", () => {
    const value = fixture()
    const first = run(value)
    const second = run(value)
    expect(first).toEqual(second)
    expect(first).toMatchObject({
      status: "RECOMMENDED", placement_policy_version: "execution-fabric-placement/0.2",
      recommendation: { node_id: "aegis", execution_authorized: false, dispatch_allowed: false },
      scheduler: { state: "disabled", authority: "not-granted", autonomous_dispatch: "forbidden" },
      evidence_verifier: { contract: "jcs-rfc8785/1", sha256: "c8f488953cf91e7ea8badd59e718185171096783b58a4d75b4ba4a77581297b6", result: "PASS" },
    })
    expect(first.evidence_snapshot).toEqual([
      { node: "aegis", snapshot_sha256: value.refs.aegis },
      { node: "atlas", snapshot_sha256: value.refs.atlas },
      { node: "hermes-node", snapshot_sha256: value.refs["hermes-node"] },
    ])
    expect(first.decision_input_sha256).toMatch(/^[a-f0-9]{64}$/)
    expect(first.eligible_nodes.find((node: JsonObject) => node.node_id === "aegis")?.evidence_used).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          path: "nodes.aegis.capability_health.compute",
          value: expect.objectContaining({
            state: "READY",
            observed_at: feeds().aegis.observed_at,
            expires_at: "2026-08-10T07:04:09.000Z",
            snapshot_sha256: value.refs.aegis,
            evidence_ref: `snapshots/aegis/${value.refs.aegis}.json`,
          }),
        }),
      ]),
    )

    const common = args(value)
    const start = common.indexOf("--evidence")
    const reordered = [...common.slice(0, start),
      "--evidence", `aegis=${value.refs.aegis}`,
      "--evidence", `hermes-node=${value.refs["hermes-node"]}`,
      "--evidence", `atlas=${value.refs.atlas}`]
    expect(runPinnedPlacementCli(reordered)).toEqual(first)
  })

  it("fails closed when verified snapshots are stale", () => {
    const result = run(fixture(), "2026-08-10T10:30:00.000Z")
    expect(result.status).toBe("NO_ELIGIBLE_NODE")
    expect(result.recommendation).toBeNull()
    expect(result.ineligible_nodes.filter((node: JsonObject) => ["hermes-node", "atlas", "aegis"].includes(node.node_id)))
      .toEqual(expect.arrayContaining([expect.objectContaining({ reasons: expect.arrayContaining([expect.objectContaining({ code: "EVIDENCE_STALE" })]) })]))
  })

  it("rejects missing and duplicate evidence references", () => {
    const value = fixture()
    expectRejected(runPinnedPlacementCli(args(value).slice(0, -2)), "evidence node set")
    const duplicate = args(value)
    duplicate.push("--evidence", `aegis=${value.refs.aegis}`)
    expectRejected(runPinnedPlacementCli(duplicate), "duplicate evidence node")
  })

  it("rejects missing, renamed, embedded-hash-mismatched, and tampered snapshots through the real verifier", () => {
    const value = fixture()
    const missing = args(value)
    missing[missing.indexOf(`atlas=${value.refs.atlas}`)] = `atlas=${"d".repeat(64)}`
    expectRejected(runPinnedPlacementCli(missing), "unable to read atlas snapshot")

    const atlasPath = path.join(value.snapshotRoot, "atlas", `${value.refs.atlas}.json`)
    const tampered = JSON.parse(fs.readFileSync(atlasPath, "utf8"))
    tampered.state_reason = "tampered after pin"
    fs.writeFileSync(atlasPath, `${JSON.stringify(tampered, null, 2)}\n`)
    expectRejected(run(value), "reference verifier rejected")
  })

  it("binds each node to its exact schema even when a cross-schema feed is canonically valid", () => {
    const value = fixture((items) => {
      items.atlas = { ...items.aegis, node: "atlas", schema: "aegis-capability/1" }
    })
    expectRejected(run(value), "atlas schema must be atlas-placement-readiness/1")
  })

  it("rejects canonically valid but structurally incomplete feeds", () => {
    const value = fixture((items) => { delete items.atlas.resources.postgres })
    expectRejected(run(value), "atlas.resources must contain exactly")
  })

  it("rejects a policy-bound schema without a supported validator", () => {
    const value = fixture((items) => { items["hermes-node"].schema = "future-placement-readiness/1" })
    const policyPath = path.join(value.root, "policy.json")
    const policy = JSON.parse(fs.readFileSync(path.join(repositoryRoot, "config/execution-fabric/pinned-evidence-policy.json"), "utf8"))
    policy.required_evidence["hermes-node"].schema = "future-placement-readiness/1"
    fs.writeFileSync(policyPath, `${JSON.stringify(policy, null, 2)}\n`)
    const selectedArgs = args(value)
    selectedArgs[selectedArgs.indexOf(path.join(repositoryRoot, "config/execution-fabric/pinned-evidence-policy.json"))] = policyPath
    expectRejected(runPinnedPlacementCli(selectedArgs), "unsupported snapshot schema")
  })

  it("rejects scheduler drift and capability-specific inference failure without changing authority", () => {
    const schedulerOn = fixture((items) => { items.aegis.scheduler = "ON" })
    expectRejected(run(schedulerOn), "scheduler OFF")

    const unhealthy = fixture((items) => {
      items["hermes-node"].gpu_inference_capability_health = "FAIL_CLOSED"
      items["hermes-node"].local_llm_capability_health = "FAIL_CLOSED"
    })
    const selectedArgs = args(unhealthy)
    selectedArgs[selectedArgs.indexOf("cpu-heavy-build")] = "gpu-local-inference"
    const result = runPinnedPlacementCli(selectedArgs) as JsonObject
    expect(result.status).toBe("NO_ELIGIBLE_NODE")
    const hermes = result.ineligible_nodes.find((node: JsonObject) => node.node_id === "hermes-node")
    expect(hermes.reasons).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: "CAPABILITY_REQUIRED", detail: "local-llm-inference" }),
      expect.objectContaining({ code: "RUNTIME_STATE_INELIGIBLE", detail: "ollama" }),
    ]))
    expect(result.authority_mutated).toBe(false)
  })

  it("accepts truthful no-GPU/no-model failure without failing unrelated compute placement", () => {
    const degraded = fixture((items) => {
      items["hermes-node"].resources.gpus = []
      items["hermes-node"].model_inventory = []
      items["hermes-node"].gpu_inference_capability_health = "FAIL_CLOSED"
      items["hermes-node"].local_llm_capability_health = "FAIL_CLOSED"
    })
    const result = run(degraded)

    expect(result.status).toBe("RECOMMENDED")
    expect(result.eligible_nodes.map((node: JsonObject) => node.node_id)).toContain("hermes-node")
    expect(result.ineligible_nodes.find((node: JsonObject) => node.node_id === "hermes-node")).toBeUndefined()
  })

  it("replaces the complete seeded Hermes GPU inventory with observed GPUs", () => {
    const observedSingleGpu = fixture((items) => {
      items["hermes-node"].resources.gpus = [{
        name: "NVIDIA Test GPU", vram_total_mb: 2048, vram_free_mb: 1536,
        vram_used_mb: 512, util_pct: 5, temp_c: 30,
      }]
    })
    const selectedArgs = args(observedSingleGpu)
    selectedArgs[selectedArgs.indexOf("cpu-heavy-build")] = "gpu-local-inference"
    const result = runPinnedPlacementCli(selectedArgs) as JsonObject
    const hermes = result.ineligible_nodes.find((node: JsonObject) => node.node_id === "hermes-node")

    expect(result.status).toBe("NO_ELIGIBLE_NODE")
    expect(hermes.reasons).toContainEqual(expect.objectContaining({
      code: "GPU_VRAM_INSUFFICIENT", observed: 2147483648,
    }))
  })

  it("uses observed AEGIS logical CPU capacity instead of freshening seed capacity", () => {
    const lowCapacity = fixture((items) => { items.aegis.cores = 1 })
    const result = run(lowCapacity)
    const aegis = result.ineligible_nodes.find((node: JsonObject) => node.node_id === "aegis")

    expect(result.recommendation.node_id).toBe("hermes-node")
    expect(aegis.reasons).toContainEqual(expect.objectContaining({
      code: "CPU_THREADS_INSUFFICIENT", required: 8, observed: 1,
    }))
  })

  it("makes failed AEGIS compute health a hard CPU eligibility failure", () => {
    const failedCompute = fixture((items) => { items.aegis.compute_capability_health = "FAIL_CLOSED" })
    const result = run(failedCompute)
    const aegis = result.ineligible_nodes.find((node: JsonObject) => node.node_id === "aegis")

    expect(result.recommendation.node_id).toBe("hermes-node")
    expect(aegis.reasons).toContainEqual(expect.objectContaining({
      code: "CPU_THREADS_UNKNOWN", observed: null,
    }))
    expect(aegis.reasons).toContainEqual(expect.objectContaining({
      code: "CAPABILITY_NOT_READY", detail: "compute", observed: "FAIL_CLOSED",
    }))
  })

  it("rejects path traversal and missing arguments in the snapshot pinning helper", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "fabric-pin-helper-"))
    const feedPath = path.join(root, "feed.json")
    fs.writeFileSync(feedPath, `${JSON.stringify({ node: "../escape" })}\n`)
    const traversal = spawnSync(testPython, [pinHelper, feedPath, path.join(root, "snapshots")], { encoding: "utf8", windowsHide: true })
    const missingArgs = spawnSync(testPython, [pinHelper], { encoding: "utf8", windowsHide: true })

    expect(traversal.status).not.toBe(0)
    expect(traversal.stderr).toContain("feed node must match")
    expect(fs.existsSync(path.join(root, "escape"))).toBe(false)
    expect(missingArgs.status).not.toBe(0)
    expect(missingArgs.stderr).toContain("usage: pin_test_snapshot.py")
  })

  it("rejects an unconstrained interpreter command", () => {
    const value = fixture()
    const selectedArgs = args(value)
    selectedArgs[selectedArgs.indexOf(testPython)] = "fake-python-wrapper"
    expectRejected(runPinnedPlacementCli(selectedArgs), "Python interpreter must be")
  })

  it("rejects a verifier implementation that does not match the contract-pinned digest", () => {
    const value = fixture()
    const fakeVerifier = path.join(value.root, "verify_snapshot.py")
    fs.writeFileSync(fakeVerifier, "raise SystemExit(0)\n")
    const selectedArgs = args(value)
    selectedArgs[selectedArgs.indexOf(verifier)] = fakeVerifier
    expectRejected(runPinnedPlacementCli(selectedArgs), "reference verifier digest mismatch")
  })
})
