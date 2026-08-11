import crypto from "node:crypto"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { describe, expect, it } from "vitest"

// The production evaluator is intentionally a dependency-free CLI module.
// @ts-expect-error JavaScript module has no declaration file.
import { evaluatePlacement, runCli } from "../scripts/execution-fabric/recommend-placement.mjs"

type JsonObject = Record<string, any>

const repositoryRoot = process.cwd()
const seed = JSON.parse(fs.readFileSync(path.join(repositoryRoot, "config/execution-fabric/registry.seed.json"), "utf8")) as JsonObject
const registrySchema = JSON.parse(fs.readFileSync(path.join(repositoryRoot, "config/execution-fabric/registry.schema.json"), "utf8")) as JsonObject
const catalog = JSON.parse(fs.readFileSync(path.join(repositoryRoot, "config/execution-fabric/placement-workloads.json"), "utf8")) as JsonObject
const evaluatedAt = "2026-08-10T03:38:05.166Z"

function clone<T>(value: T): T {
  return structuredClone(value)
}

function observedRegistry(): JsonObject {
  const registry = clone(seed)
  const observedTimes: Record<string, string> = {
    omen: "2026-08-10T03:37:39.527Z",
    "hermes-node": "2026-08-10T03:37:41.325Z",
    atlas: "2026-08-10T03:37:02.109Z",
    aegis: "2026-08-10T03:37:09.776Z",
  }
  for (const node of registry.nodes) {
    if (!observedTimes[node.id]) continue
    node.evidence = {
      ...node.evidence,
      confidence: "observed",
      observed_at: observedTimes[node.id],
      ttl_seconds: 300,
      probe_version: "0.1-node-probe",
    }
    node.capability_health.compute = {
      state: "READY",
      reason: "COMPUTE_CAPABILITY_READY",
      observed_at: observedTimes[node.id],
      expires_at: "2026-08-10T03:42:00.000Z",
      snapshot_sha256: null,
      evidence_ref: `${node.id}.json`,
    }
  }
  return registry
}

function workload(id: string): JsonObject {
  const found = catalog.workloads.find((candidate: JsonObject) => candidate.id === id)
  if (!found) throw new Error(`missing workload ${id}`)
  return found
}

function recommendation(id: string, registry = observedRegistry()): JsonObject {
  return evaluatePlacement(registry, workload(id), { evaluatedAt, schema: registrySchema })
}

function expectRejected(result: JsonObject, detail: string) {
  expect(result).toMatchObject({
    status: "INPUT_REJECTED",
    recommendation: null,
    eligible_nodes: [],
    ineligible_nodes: [],
    error: { code: "FABRIC_PLACEMENT_INVALID" },
  })
  expect(result.error.detail).toContain(detail)
}

describe("Execution Fabric recommendation-only placement", () => {
  it("keeps the workload catalog generic and recommendation-only", () => {
    expect(catalog).toMatchObject({
      schema_version: "0.1-placement-workloads",
      recommendation_only: true,
    })
    expect(catalog.workloads.map((entry: JsonObject) => entry.id)).toEqual([
      "cpu-heavy-build",
      "gpu-local-inference",
      "authoritative-state-operation",
      "interactive-development",
    ])

    const source = fs.readFileSync(path.join(repositoryRoot, "scripts/execution-fabric/recommend-placement.mjs"), "utf8")
    for (const nodeId of ["omen", "hermes-node", "atlas", "aegis", "azure"]) {
      expect(source).not.toContain(`"${nodeId}"`)
    }
    expect(source).not.toMatch(/\b(dispatch|scheduleWorkload|placeWorkload|activateScheduler)\s*\(/)
    expect(source).not.toContain("localeCompare")
  })

  it("ranks the CPU-heavy scratch workload by registered evidence rather than node identity", () => {
    const result = recommendation("cpu-heavy-build")

    expect(result.recommendation).toMatchObject({
      node_id: "aegis",
      execution_authorized: false,
      dispatch_allowed: false,
    })
    expect(result.eligible_nodes.map((node: JsonObject) => node.node_id)).toEqual(["aegis", "hermes-node", "omen"])
    expect(result.eligible_nodes.map((node: JsonObject) => node.rank_basis.preferred_capability_count)).toEqual([3, 1, 1])
    expect(result.eligible_nodes[0].evidence_used).toContainEqual({
      path: "nodes.aegis.capabilities.ci-build-test-candidate",
      value: true,
    })
    expect(result.ineligible_nodes.find((node: JsonObject) => node.node_id === "atlas").reasons).toContainEqual(expect.objectContaining({
      code: "AUTHORITY_EXCLUDED",
      detail: "authoritative-durable-state",
    }))
    expect(result.ineligible_nodes.find((node: JsonObject) => node.node_id === "azure").reasons).toContainEqual(expect.objectContaining({
      code: "OBSERVED_EVIDENCE_REQUIRED",
      detail: "confidence is declared",
    }))
    for (const node of result.ineligible_nodes) {
      for (const entry of node.reasons) {
        expect(entry).toEqual(expect.objectContaining({
          required: expect.anything(),
          evidence_ref: expect.any(Array),
        }))
        expect(entry).toHaveProperty("observed")
      }
    }
  })

  it("rejects CPU placement when the compute health axis is degraded or expired", () => {
    const degradedRegistry = observedRegistry()
    const aegis = degradedRegistry.nodes.find((node: JsonObject) => node.id === "aegis")
    aegis.capability_health.compute.state = "DEGRADED"
    aegis.capability_health.compute.reason = "RUNTIME_UNAVAILABLE"
    let result = recommendation("cpu-heavy-build", degradedRegistry)

    expect(result.ineligible_nodes.find((node: JsonObject) => node.node_id === "aegis").reasons)
      .toContainEqual(expect.objectContaining({ code: "CAPABILITY_NOT_READY", detail: "compute" }))

    const expiredRegistry = observedRegistry()
    expiredRegistry.nodes.find((node: JsonObject) => node.id === "aegis").capability_health.compute.expires_at = evaluatedAt
    result = recommendation("cpu-heavy-build", expiredRegistry)
    expect(result.ineligible_nodes.find((node: JsonObject) => node.node_id === "aegis").reasons)
      .toContainEqual(expect.objectContaining({ code: "CAPABILITY_EVIDENCE_STALE", detail: "compute" }))
  })

  it.each([
    ["backup-target", "backup_target"],
    ["archive-storage", "archive_storage"],
  ])("requires current READY health for declared %s capability", (capability, axisName) => {
    const selectedWorkload = clone(workload("cpu-heavy-build"))
    selectedWorkload.requirements.capabilities_all = [capability]
    selectedWorkload.requirements.minimum_cpu_threads = 0
    selectedWorkload.preferences = {
      capabilities: [],
      availability_order: [],
      higher_cpu_threads: false,
      higher_gpu_vram: false,
    }
    const pendingRegistry = observedRegistry()
    const pending = evaluatePlacement(pendingRegistry, selectedWorkload, { evaluatedAt, schema: registrySchema })
    const pendingAegis = pending.ineligible_nodes.find((node: JsonObject) => node.node_id === "aegis")

    expect(pendingAegis.reasons).toContainEqual(expect.objectContaining({
      code: "CAPABILITY_NOT_READY",
      detail: capability,
      observed: "PENDING",
    }))

    const expiredRegistry = observedRegistry()
    const aegis = expiredRegistry.nodes.find((node: JsonObject) => node.id === "aegis")
    aegis.capability_health[axisName] = {
      state: "READY",
      reason: "RESTORE_VERIFIED",
      observed_at: "2026-08-10T03:30:00.000Z",
      expires_at: evaluatedAt,
      snapshot_sha256: "a".repeat(64),
      evidence_ref: "fixture",
    }
    const expired = evaluatePlacement(expiredRegistry, selectedWorkload, { evaluatedAt, schema: registrySchema })
    const expiredAegis = expired.ineligible_nodes.find((node: JsonObject) => node.node_id === "aegis")

    expect(expiredAegis.reasons).toContainEqual(expect.objectContaining({
      code: "CAPABILITY_EVIDENCE_STALE",
      detail: capability,
    }))
  })

  it.each([
    ["gpu-local-inference", "hermes-node"],
    ["authoritative-state-operation", "atlas"],
    ["interactive-development", "omen"],
  ])("recommends the evidence-qualified node for %s", (workloadId, nodeId) => {
    const result = recommendation(workloadId)

    expect(result.recommendation.node_id).toBe(nodeId)
    expect(result.eligible_nodes.map((node: JsonObject) => node.node_id)).toEqual([nodeId])
    expect(result.eligible_nodes[0].evidence_used.length).toBeGreaterThan(4)
    expect(result.confidence).toMatchObject({ state: "observed", freshness: "fresh" })
  })

  it("never turns a recommendation into execution or scheduler authority", () => {
    const result = recommendation("cpu-heavy-build")

    expect(result).toMatchObject({
      recommendation_only: true,
      scheduler: {
        state: "disabled",
        authority: "not-granted",
        autonomous_dispatch: "forbidden",
      },
      authority_mutated: false,
      remote_systems_modified: false,
    })
    expect([...result.eligible_nodes, ...result.ineligible_nodes]).toEqual(
      expect.arrayContaining([expect.objectContaining({ execution_authorized: false, dispatch_allowed: false })]),
    )
  })

  it("fails closed when observed evidence is stale", () => {
    const result = evaluatePlacement(observedRegistry(), workload("cpu-heavy-build"), {
      evaluatedAt: "2026-08-10T04:00:00.000Z",
      schema: registrySchema,
    })

    expect(result.recommendation).toBeNull()
    expect(result.confidence.state).toBe("insufficient")
    expect(result.ineligible_nodes.filter((node: JsonObject) => node.node_id !== "azure")).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ reasons: expect.arrayContaining([expect.objectContaining({ code: "EVIDENCE_STALE" })]) }),
      ]),
    )
  })

  it("accepts schema-valid RFC 3339 offsets in registry evidence", () => {
    const registry = observedRegistry()
    registry.nodes.find((node: JsonObject) => node.id === "omen").evidence.observed_at = "2026-08-09T22:37:39.527-05:00"

    expect(recommendation("interactive-development", registry).recommendation.node_id).toBe("omen")
  })

  it("rejects future-dated observed evidence as conflicting input", () => {
    const registry = observedRegistry()
    registry.nodes.find((node: JsonObject) => node.id === "aegis").evidence.observed_at = "2026-08-10T03:39:00.000Z"

    expectRejected(evaluatePlacement(registry, workload("cpu-heavy-build"), { evaluatedAt, schema: registrySchema }), "observed evidence is future-dated")
  })

  it("rejects future-dated declared evidence as conflicting input", () => {
    const registry = observedRegistry()
    registry.nodes.find((node: JsonObject) => node.id === "azure").evidence.observed_at = "2026-08-10T03:39:00.000Z"

    expectRejected(evaluatePlacement(registry, workload("cpu-heavy-build"), { evaluatedAt, schema: registrySchema }), "observed evidence is future-dated")
  })

  it.each([
    { state: "enabled", authority: "not-granted" },
    { state: "disabled", authority: "granted" },
  ])("refuses to reason across an unauthorized scheduler boundary: %j", (scheduler) => {
    const registry = observedRegistry()
    registry.scheduler = scheduler

    expectRejected(
      evaluatePlacement(registry, workload("cpu-heavy-build"), { evaluatedAt, schema: registrySchema }),
      "scheduler must remain disabled with authority not-granted",
    )
  })

  it("rejects malformed requirements rather than guessing intent", () => {
    const malformed = clone(workload("cpu-heavy-build"))
    malformed.requirements.minimum_cpu_threads = -1

    expectRejected(
      evaluatePlacement(observedRegistry(), malformed, { evaluatedAt, schema: registrySchema }),
      "minimum_cpu_threads must be a non-negative number",
    )
  })

  it("rejects malformed workload display fields", () => {
    const malformed = clone(workload("cpu-heavy-build"))
    malformed.title = null

    expectRejected(
      evaluatePlacement(observedRegistry(), malformed, { evaluatedAt, schema: registrySchema }),
      "title must be a non-empty string",
    )
  })

  it("rejects internally contradictory authority requirements", () => {
    const contradictory = clone(workload("interactive-development"))
    contradictory.requirements.excluded_authority.push("interactive-development")

    expectRejected(
      evaluatePlacement(observedRegistry(), contradictory, { evaluatedAt, schema: registrySchema }),
      "authority is both required and excluded",
    )
  })

  it("requires an explicit UTC evaluation timestamp and the registry schema", () => {
    expectRejected(
      evaluatePlacement(observedRegistry(), workload("cpu-heavy-build"), { schema: registrySchema }),
      "evaluated_at must be an explicit UTC timestamp",
    )
    expectRejected(evaluatePlacement(observedRegistry(), workload("cpu-heavy-build"), {
      evaluatedAt: "2026-08-10 03:38:05",
      schema: registrySchema,
    }), "evaluated_at must be an explicit UTC timestamp")
    expectRejected(
      evaluatePlacement(observedRegistry(), workload("cpu-heavy-build"), { evaluatedAt }),
      "registry schema is required",
    )
  })

  it("rejects registry shape drift before recommendation logic", () => {
    const registry = observedRegistry()
    registry.nodes[0].evidence.untrusted = true

    expectRejected(
      evaluatePlacement(registry, workload("cpu-heavy-build"), { evaluatedAt, schema: registrySchema }),
      "additional property untrusted",
    )
  })

  it.each([
    ["duplicate risk tuple", (bounded: JsonObject) => { bounded.risk_classes = ["R0", "R0"] }],
    ["reordered workload tuple", (bounded: JsonObject) => { bounded.workload_classes = ["HASH_VERIFY", "CI_BUILD_TEST", "COMPRESSION"] }],
  ])("rejects %s before placement reasoning", (_case, mutate) => {
    const registry = observedRegistry()
    const aegis = registry.nodes.find((node: JsonObject) => node.id === "aegis")
    mutate(aegis.authority.bounded_compute)

    expectRejected(
      evaluatePlacement(registry, workload("cpu-heavy-build"), { evaluatedAt, schema: registrySchema }),
      "const mismatch",
    )
  })

  it("preserves schema-optional constraints as an empty evidence list", () => {
    const registry = observedRegistry()
    delete registry.nodes.find((node: JsonObject) => node.id === "omen").constraints

    const result = recommendation("interactive-development", registry)
    expect(result.recommendation.node_id).toBe("omen")
    expect(result.eligible_nodes[0].evidence_used).toContainEqual({ path: "nodes.omen.constraints", value: [] })
  })

  it("distinguishes unknown resources and unhealthy runtime state", () => {
    const cpuUnknown = observedRegistry()
    const azure = cpuUnknown.nodes.find((node: JsonObject) => node.id === "azure")
    azure.evidence = { ...azure.evidence, confidence: "observed", observed_at: evaluatedAt, ttl_seconds: 300, probe_version: "0.1-node-probe" }
    expect(recommendation("cpu-heavy-build", cpuUnknown).ineligible_nodes.find((node: JsonObject) => node.node_id === "azure").reasons)
      .toContainEqual(expect.objectContaining({ code: "CPU_THREADS_UNKNOWN", detail: "CPU thread inventory is unavailable" }))

    const gpuUnknown = recommendation("gpu-local-inference")
    expect(gpuUnknown.ineligible_nodes.find((node: JsonObject) => node.node_id === "aegis").reasons)
      .toContainEqual(expect.objectContaining({ code: "GPU_VRAM_UNKNOWN", detail: "GPU VRAM inventory is unavailable" }))

    const runtimeUnhealthy = observedRegistry()
    runtimeUnhealthy.nodes.find((node: JsonObject) => node.id === "hermes-node").runtimes
      .find((runtime: JsonObject) => runtime.kind === "ollama").state = "degraded"
    expect(recommendation("gpu-local-inference", runtimeUnhealthy).ineligible_nodes.find((node: JsonObject) => node.node_id === "hermes-node").reasons)
      .toContainEqual(expect.objectContaining({ code: "RUNTIME_STATE_INELIGIBLE", detail: "ollama" }))
  })

  it("accepts schema-valid proven evidence", () => {
    const registry = observedRegistry()
    registry.nodes.find((node: JsonObject) => node.id === "omen").evidence.confidence = "proven"

    expect(recommendation("interactive-development", registry).recommendation.node_id).toBe("omen")
    expect(recommendation("interactive-development", registry).confidence.state).toBe("proven")
  })

  it("reports explicit authority denial and its evidence", () => {
    const deniedWorkload = clone(workload("interactive-development"))
    deniedWorkload.requirements.authority_all = ["county-production-write"]
    deniedWorkload.requirements.capabilities_all = []
    const result = evaluatePlacement(observedRegistry(), deniedWorkload, { evaluatedAt, schema: registrySchema })
    const omen = result.ineligible_nodes.find((node: JsonObject) => node.node_id === "omen")

    expect(omen.reasons).toContainEqual(expect.objectContaining({ code: "AUTHORITY_DENIED", detail: "county-production-write" }))
    expect(omen.evidence_used).toContainEqual({
      path: "nodes.omen.authority.deny.county-production-write",
      value: true,
    })
  })

  it("binds CLI recommendations to the exact snapshot digest", () => {
    const temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "fabric-placement-"))
    const snapshotPath = path.join(temporaryDirectory, "snapshot.json")
    const catalogPath = path.join(temporaryDirectory, "workloads.json")
    const snapshotBytes = Buffer.from(`${JSON.stringify(observedRegistry(), null, 2)}\n`)
    fs.writeFileSync(snapshotPath, snapshotBytes)
    fs.writeFileSync(catalogPath, `${JSON.stringify(catalog, null, 2)}\n`)
    const digest = crypto.createHash("sha256").update(snapshotBytes).digest("hex")

    const result = runCli([
      "--snapshot", snapshotPath,
      "--schema", path.join(repositoryRoot, "config/execution-fabric/registry.schema.json"),
      "--workloads", catalogPath,
      "--workload", "cpu-heavy-build",
      "--expected-snapshot-sha256", digest,
      "--at", evaluatedAt,
    ])
    expect(result.snapshot.sha256).toBe(digest.toUpperCase())
    expect(result.catalog_schema_version).toBe("0.1-placement-workloads")
    expect(result.recommendation.node_id).toBe("aegis")

    expectRejected(runCli([
      "--snapshot", snapshotPath,
      "--schema", path.join(repositoryRoot, "config/execution-fabric/registry.schema.json"),
      "--workloads", catalogPath,
      "--workload", "cpu-heavy-build",
      "--expected-snapshot-sha256", "f".repeat(64),
      "--at", evaluatedAt,
    ]), "snapshot digest mismatch")
  })

  it("rejects duplicate workload IDs and a missing CLI evaluation time", () => {
    const temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "fabric-placement-catalog-"))
    const snapshotPath = path.join(temporaryDirectory, "snapshot.json")
    const catalogPath = path.join(temporaryDirectory, "workloads.json")
    const snapshotBytes = Buffer.from(`${JSON.stringify(observedRegistry(), null, 2)}\n`)
    const duplicateCatalog = clone(catalog)
    duplicateCatalog.workloads.push(clone(duplicateCatalog.workloads[0]))
    fs.writeFileSync(snapshotPath, snapshotBytes)
    fs.writeFileSync(catalogPath, `${JSON.stringify(duplicateCatalog, null, 2)}\n`)
    const digest = crypto.createHash("sha256").update(snapshotBytes).digest("hex")
    const common = [
      "--snapshot", snapshotPath,
      "--schema", path.join(repositoryRoot, "config/execution-fabric/registry.schema.json"),
      "--workloads", catalogPath,
      "--workload", "cpu-heavy-build",
      "--expected-snapshot-sha256", digest,
    ]

    expectRejected(runCli([...common, "--at", evaluatedAt]), "duplicate workload id")
    expectRejected(runCli(common), "--at is required")
  })

  it("uses stable node-id tie breaking for reproducible output", () => {
    const tiedWorkload = clone(workload("cpu-heavy-build"))
    tiedWorkload.preferences = {
      capabilities: [],
      availability_order: [],
      higher_cpu_threads: false,
      higher_gpu_vram: false,
    }
    const result = evaluatePlacement(observedRegistry(), tiedWorkload, { evaluatedAt, schema: registrySchema })

    expect(result.eligible_nodes.map((node: JsonObject) => node.node_id)).toEqual(["aegis", "hermes-node", "omen"])
  })

  it("enforces scratch-only semantics independently of a redundant workload exclusion", () => {
    const scratch = clone(workload("cpu-heavy-build"))
    scratch.requirements.excluded_authority = []
    const result = evaluatePlacement(observedRegistry(), scratch, { evaluatedAt, schema: registrySchema })

    expect(result.ineligible_nodes.find((node: JsonObject) => node.node_id === "atlas").reasons).toContainEqual(
      expect.objectContaining({ code: "STORAGE_SEMANTICS_INELIGIBLE" }),
    )
  })

  it("rejects duplicate physical resource identities before capacity aggregation", () => {
    const registry = observedRegistry()
    const aegis = registry.nodes.find((node: JsonObject) => node.id === "aegis")
    aegis.cpus.push(clone(aegis.cpus[0]))

    expectRejected(
      evaluatePlacement(registry, workload("cpu-heavy-build"), { evaluatedAt, schema: registrySchema }),
      "duplicate cpus resource id",
    )
  })

  it("uses schema-defined DIMM locators as physical resource identity", () => {
    const registry = observedRegistry()
    const omen = registry.nodes.find((node: JsonObject) => node.id === "omen")
    omen.dimms = [
      { locator: "DIMM_A1", bank: null, manufacturer: null, part_number: null, serial: null, capacity_bytes: 16 * 1024 ** 3, memory_type: "DDR5", configured_mhz: 5600 },
      { locator: "DIMM_B1", bank: null, manufacturer: null, part_number: null, serial: null, capacity_bytes: 16 * 1024 ** 3, memory_type: "DDR5", configured_mhz: 5600 },
    ]

    expect(recommendation("interactive-development", registry).recommendation.node_id).toBe("omen")
    omen.dimms.push(clone(omen.dimms[0]))
    expectRejected(
      evaluatePlacement(registry, workload("interactive-development"), { evaluatedAt, schema: registrySchema }),
      "duplicate dimms resource locator",
    )
  })

  it("is invariant to registry node order and does not mutate either input", () => {
    const registry = observedRegistry()
    registry.nodes.reverse()
    const selectedWorkload = clone(workload("cpu-heavy-build"))
    const registryBefore = JSON.stringify(registry)
    const workloadBefore = JSON.stringify(selectedWorkload)

    const result = evaluatePlacement(registry, selectedWorkload, { evaluatedAt, schema: registrySchema })

    expect(result.eligible_nodes.map((node: JsonObject) => node.node_id)).toEqual(["aegis", "hermes-node", "omen"])
    expect(JSON.stringify(registry)).toBe(registryBefore)
    expect(JSON.stringify(selectedWorkload)).toBe(workloadBefore)
  })

  it("rejects conflicting authority instead of ranking through it", () => {
    const registry = observedRegistry()
    registry.nodes[0].authority.deny.push(registry.nodes[0].authority.allow[0])

    expectRejected(
      evaluatePlacement(registry, workload("cpu-heavy-build"), { evaluatedAt, schema: registrySchema }),
      "authority conflict",
    )
  })
})
