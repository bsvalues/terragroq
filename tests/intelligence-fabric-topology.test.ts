import { describe, expect, it } from "vitest"
import {
  AcceleratorHardwareSchema,
  AcceleratorTelemetrySchema,
  FabricTopologySchema,
  FabricNodeSchema,
  HardwareChangeEventSchema,
  acceleratorConfigurationDigest,
  diffAccelerators,
  orchestrationIsAvailable,
  topologyObservationIsFresh,
} from "../components/operator/intelligence-fabric-topology"

const observedAt = "2026-08-27T17:09:00.000Z"
const evaluatedAt = "2026-08-27T17:10:00.000Z"
const expiresAt = "2026-08-27T17:15:00.000Z"
const staleExpiry = "2026-08-27T17:09:59.999Z"
const futureObservation = "2026-08-27T17:10:00.001Z"
const digest = (c: string) => `sha256:${c.repeat(64)}`
const evidence = (name: string, c = "a") => ({ ref: `evidence://fabric/${name}`, digest: digest(c) })

const p40Hardware = () => ({
  uuid: "GPU-11111111-2222-3333-4444-555555555555",
  class: "NVIDIA_PASCAL",
  vendor: "NVIDIA" as const,
  model: "Tesla P40",
  memoryBytes: 25_769_803_776,
  pciBusId: "0000:01:00.0",
  pcie: { generation: 3, negotiatedWidth: 16 },
})

const rtx3050Hardware = () => ({
  uuid: "GPU-AAAAAAAA-BBBB-CCCC-DDDD-EEEEEEEEEEEE",
  class: "NVIDIA_AMPERE",
  vendor: "NVIDIA" as const,
  model: "RTX 3050",
  memoryBytes: 8_589_934_592,
  pciBusId: "0000:02:00.0",
  pcie: { generation: 4, negotiatedWidth: 8 },
})

const provenRuntime = (hardwarePlatform: string) => ({
  capability: {
    runtimeId: "runtime.hermes-ollama",
    runtimeVersion: "0.9.2",
    hardwarePlatform,
    feature: "structured-output",
    verdict: "PROVEN" as const,
    evidenceRef: "evidence://runtime/ollama/structured-output",
    observedAt,
  },
  expiresAt,
  evidenceDigest: digest("b"),
})

const p40Telemetry = () => ({
  hardware: p40Hardware(),
  purpose: "INFERENCE" as const,
  admission: "ADMITTED" as const,
  providerClass: "RESIDENT_LOCAL" as const,
  health: "AVAILABLE" as const,
  driverVersion: "576.80",
  temperatureC: 42,
  powerWatts: 87,
  powerLimitWatts: 250,
  hostToDeviceBandwidthBytesPerSecond: 11_500_000_000,
  timing: { state: "COMPLETE" as const, observedAt, expiresAt, evidence: evidence("hermes/p40", "c") },
  runtimeCapabilities: [provenRuntime("NVIDIA_PASCAL")],
})

const rtx3050Telemetry = () => ({
  hardware: rtx3050Hardware(),
  purpose: "DISPLAY_UTILITY" as const,
  admission: "OBSERVED" as const,
  providerClass: "RESIDENT_LOCAL" as const,
  health: "AVAILABLE" as const,
  driverVersion: "576.80",
  timing: { state: "COMPLETE" as const, observedAt, expiresAt, evidence: evidence("hermes/3050", "d") },
  runtimeCapabilities: [],
})

const completeNodeTelemetry = () => ({
  timing: { state: "COMPLETE" as const, observedAt, expiresAt, evidence: evidence("node", "e") },
  cpu: { logicalCores: 16, sockets: 1, numaDomains: 1, architecture: "x86_64" },
  memory: { capacityBytes: 68_719_476_736, measuredBandwidthBytesPerSecond: 42_000_000_000 },
  storageModelLoadBytesPerSecond: 2_500_000_000,
})

const unknownNodeTelemetry = () => ({ timing: { state: "UNKNOWN" as const }, cpu: {}, memory: {} })
const unknownBaseline = () => ({
  state: "UNKNOWN" as const,
  dimensions: [
    { id: "CPU" as const, state: "UNKNOWN" as const },
    { id: "FABRIC_LINK" as const, state: "UNKNOWN" as const },
  ],
})

const hermesCompute = () => ({
  id: "compute.hermes-node",
  nodeId: "hermes-node",
  placement: "LOCAL_FABRIC" as const,
  trustClass: "SOVEREIGN_LOCAL",
  health: "AVAILABLE" as const,
  lifecycle: "AVAILABLE" as const,
  hardwareDisclosure: "ATTESTED" as const,
  accelerators: [p40Hardware(), rtx3050Hardware()].map((hardware) => ({
    uuid: hardware.uuid,
    class: hardware.class,
    vendor: hardware.vendor,
    model: hardware.model,
    vramBytes: hardware.memoryBytes,
  })),
  cpu: { logicalCores: 16, architecture: "x86_64" },
  systemMemoryBytes: 68_719_476_736,
  storageClass: "LOCAL_NVME",
  networkClass: "RESIDENT_LAN",
  observedAt,
  expiresAt,
})

const hermesCapacity = () => ({
  computeResourceId: "compute.hermes-node",
  totalAcceleratorMemoryBytes: 25_769_803_776,
  reservedWeightBytes: 0,
  reservedKvBytes: 0,
  reservedRuntimeOverheadBytes: 0,
  totalSystemMemoryBytes: 68_719_476_736,
  reservedSystemMemoryBytes: 0,
  totalCpuLogicalCores: 16,
  reservedCpuLogicalCores: 0,
  currentReservationIds: [],
  modelResidencyAllocations: [],
  observedAt,
})

const canonicalNode = (id: "omen" | "hermes-node" | "atlas" | "aegis") => {
  const binding = {
    omen: ["OMEN", "COCKPIT", "OPPORTUNISTIC", "ENROLLED_COCKPIT", false],
    "hermes-node": ["HERMES", "ORCHESTRATOR_LOCAL_AI", "RESIDENT_REQUIRED", "SOVEREIGN_LOCAL", true],
    atlas: ["ATLAS", "DURABLE_STATE_EVIDENCE", "RESIDENT_REQUIRED", "SOVEREIGN_LOCAL", false],
    aegis: ["AEGIS", "GOVERNED_EXECUTION", "RESIDENT_OPTIONAL", "GOVERNED_WORKER", false],
  }[id] as [string, "COCKPIT" | "ORCHESTRATOR_LOCAL_AI" | "DURABLE_STATE_EVIDENCE" | "GOVERNED_EXECUTION", "OPPORTUNISTIC" | "RESIDENT_REQUIRED" | "RESIDENT_OPTIONAL", "ENROLLED_COCKPIT" | "SOVEREIGN_LOCAL" | "GOVERNED_WORKER", boolean]
  const node = {
    registryNodeId: id,
    registryEnrollment: "CANONICAL" as const,
    registryEvidence: evidence(`registry/${id}`, "f"),
    machineIdentityDigest: digest("1"),
    hostname: binding[0],
    role: binding[1],
    dependencyClass: binding[2],
    requiredForOrchestration: binding[4],
    trustClass: binding[3],
    telemetry: completeNodeTelemetry(),
    accelerators: [] as Array<ReturnType<typeof p40Telemetry> | ReturnType<typeof rtx3050Telemetry>>,
    bottleneckBaseline: unknownBaseline(),
  }
  if (id === "omen") return {
    ...node,
    telemetry: {
      timing: { state: "UNAVAILABLE" as const, observedAt, expiresAt, evidence: evidence("omen/down", "2") },
      cpu: {},
      memory: {},
    },
  }
  if (id === "hermes-node") return {
    ...node,
    compute: hermesCompute(),
    capacity: hermesCapacity(),
    capacityExpiresAt: expiresAt,
    capacityEvidence: evidence("hermes/capacity", "c"),
    accelerators: [p40Telemetry(), rtx3050Telemetry()],
  }
  return node
}

const materialLink = () => ({
  id: "link.hermes-atlas",
  fromNodeId: "hermes-node",
  toNodeId: "atlas",
  transportClass: "ETHERNET",
  trustClass: "SOVEREIGN_LAN",
  policyBoundary: "LOCAL_GOVERNED",
  materialForPlacement: true,
  measuredBandwidthBytesPerSecond: 117_000_000,
  latencyMsP50: 0.4,
  latencyMsP95: 0.9,
  reliability: 0.999,
  timing: { state: "COMPLETE" as const, observedAt, expiresAt, evidence: evidence("link", "3") },
})

const topology = (): any => ({
  schemaVersion: 2 as const,
  topologyId: "topology.execution-fabric.projection.v2",
  sourceRegistry: {
    schemaVersion: "0.3" as const,
    snapshotDigest: digest("4"),
    evidenceRef: "evidence://execution-fabric/registry/snapshot-4",
  },
  nodes: [canonicalNode("omen"), canonicalNode("hermes-node"), canonicalNode("atlas"), canonicalNode("aegis")],
  links: [materialLink()],
  evaluatedAt,
  evidenceDigest: digest("5"),
})

const clone = <T>(value: T): T => structuredClone(value)

describe("IF-02 canonical registry projection", () => {
  it("accepts exact canonical bindings and HERMES IF-01 compute/capacity/runtime projection", () => {
    const parsed = FabricTopologySchema.parse(topology())
    const hermes = parsed.nodes.find((node) => node.registryNodeId === "hermes-node")!
    expect(parsed.schemaVersion).toBe(2)
    expect(parsed.sourceRegistry.snapshotDigest).toBe(digest("4"))
    expect(hermes.compute?.id).toBe("compute.hermes-node")
    expect(hermes.capacity?.computeResourceId).toBe("compute.hermes-node")
    expect(hermes.accelerators[0]).toMatchObject({ purpose: "INFERENCE", admission: "ADMITTED", providerClass: "RESIDENT_LOCAL" })
    expect(hermes.accelerators[1]).toMatchObject({ purpose: "DISPLAY_UTILITY", admission: "OBSERVED" })
  })

  it("rejects canonical role/trust/dependency swaps and non-HERMES orchestration authority", () => {
    const role = topology(); role.nodes[2].role = "GOVERNED_EXECUTION"; expect(FabricTopologySchema.safeParse(role).success).toBe(false)
    const trust = topology(); trust.nodes[1].trustClass = "GOVERNED_WORKER"; expect(FabricTopologySchema.safeParse(trust).success).toBe(false)
    const dependency = topology(); dependency.nodes[0].dependencyClass = "RESIDENT_REQUIRED"; expect(FabricTopologySchema.safeParse(dependency).success).toBe(false)
    const authority = topology(); authority.nodes[3].requiredForOrchestration = true; expect(FabricTopologySchema.safeParse(authority).success).toBe(false)
  })

  it("requires schema v2 and exact source-registry binding", () => {
    expect(FabricTopologySchema.safeParse({ ...topology(), schemaVersion: 1 }).success).toBe(false)
    expect(FabricTopologySchema.safeParse({ ...topology(), sourceRegistry: { ...topology().sourceRegistry, schemaVersion: "0.2" } }).success).toBe(false)
    expect(FabricTopologySchema.safeParse({ ...topology(), sourceRegistry: { ...topology().sourceRegistry, snapshotDigest: "bad" } }).success).toBe(false)
  })

  it("ignores OMEN unavailability for orchestration but not HERMES unavailability", () => {
    const parsed = FabricTopologySchema.parse(topology())
    expect(parsed.nodes[0].telemetry.timing.state).toBe("UNAVAILABLE")
    expect(orchestrationIsAvailable(parsed)).toBe(true)
    const down = clone(parsed); down.nodes[1].telemetry.timing.state = "UNAVAILABLE"
    expect(orchestrationIsAvailable(down)).toBe(false)
  })

  it("preserves UNKNOWN unenrolled discovery and rejects AVAILABLE/ADMITTED claims", () => {
    const candidate = topology()
    candidate.nodes.push({
      registryNodeId: "discovered.compute-1",
      registryEnrollment: "UNENROLLED",
      registryEvidence: evidence("registry/discovered", "6"),
      hostname: "DISCOVERED-1",
      role: "DISCOVERED_COMPUTE",
      dependencyClass: "EPHEMERAL",
      requiredForOrchestration: false,
      trustClass: "UNENROLLED",
      telemetry: unknownNodeTelemetry(),
      accelerators: [],
      bottleneckBaseline: unknownBaseline(),
    })
    expect(FabricTopologySchema.parse(candidate).nodes.at(-1)?.telemetry.timing.state).toBe("UNKNOWN")
    const available = clone(candidate); const node = available.nodes.at(-1)!
    node.telemetry = completeNodeTelemetry(); node.compute = { ...hermesCompute(), id: "compute.discovered", nodeId: "discovered.compute-1", trustClass: "UNENROLLED" }; node.capacity = { ...hermesCapacity(), computeResourceId: "compute.discovered" }; node.capacityExpiresAt = expiresAt; node.accelerators = [p40Telemetry(), rtx3050Telemetry()]
    expect(FabricTopologySchema.safeParse(available).success).toBe(false)
    const admitted = clone(available); admitted.nodes.at(-1)!.compute!.health = "UNAVAILABLE"; admitted.nodes.at(-1)!.compute!.lifecycle = "OFFLINE"
    expect(FabricTopologySchema.safeParse(admitted).success).toBe(false)
    const enrolledUntrusted = clone(available); enrolledUntrusted.nodes.at(-1)!.registryEnrollment = "ENROLLED"; enrolledUntrusted.nodes.at(-1)!.trustClass = "UNENROLLED"; expect(FabricTopologySchema.safeParse(enrolledUntrusted).success).toBe(false)
  })

  it("preserves partial/UNKNOWN measurements and rejects unknown fields", () => {
    const partial = topology(); partial.nodes[2].telemetry = { timing: { state: "PARTIAL", observedAt, expiresAt, evidence: evidence("atlas/partial", "7") }, cpu: { architecture: "x86_64" }, memory: {} }
    const parsed = FabricTopologySchema.parse(partial)
    expect(parsed.nodes[2].telemetry.cpu.logicalCores).toBeUndefined()
    expect(parsed.nodes[2].bottleneckBaseline.state).toBe("UNKNOWN")
    expect(FabricTopologySchema.safeParse({ ...topology(), activatesRouting: true }).success).toBe(false)
    const nested = topology(); Object.assign(nested.nodes[1].telemetry, { inferredCapacity: true })
    expect(FabricTopologySchema.safeParse(nested).success).toBe(false)
    const unknownMeasured = topology(); unknownMeasured.nodes[2].telemetry = { timing: { state: "UNKNOWN" }, cpu: { logicalCores: 28 }, memory: {} }; expect(FabricTopologySchema.safeParse(unknownMeasured).success).toBe(false)
    const unknownAccelerator = { ...p40Telemetry(), admission: "OBSERVED" as const, health: "UNKNOWN" as const, timing: { state: "UNKNOWN" as const }, runtimeCapabilities: [] }; expect(AcceleratorTelemetrySchema.safeParse(unknownAccelerator).success).toBe(false)
  })
})

describe("IF-02 freshness and placement truth", () => {
  it("rejects stale/future node evidence", () => {
    const stale = topology(); stale.nodes[1].telemetry.timing.expiresAt = staleExpiry; expect(FabricTopologySchema.safeParse(stale).success).toBe(false)
    const future = topology(); future.nodes[1].telemetry.timing.observedAt = futureObservation; expect(FabricTopologySchema.safeParse(future).success).toBe(false)
    expect(topologyObservationIsFresh(observedAt, expiresAt, evaluatedAt)).toBe(true)
    expect(topologyObservationIsFresh(observedAt, staleExpiry, evaluatedAt)).toBe(false)
    expect(topologyObservationIsFresh(futureObservation, expiresAt, evaluatedAt)).toBe(false)
  })

  it("rejects stale/future accelerator, capacity, runtime, compute, and material-link evidence", () => {
    const a = topology(); a.nodes[1].accelerators[0].timing.expiresAt = staleExpiry; expect(FabricTopologySchema.safeParse(a).success).toBe(false)
    const c = topology(); c.nodes[1].capacityExpiresAt = staleExpiry; expect(FabricTopologySchema.safeParse(c).success).toBe(false)
    const r = topology(); r.nodes[1].accelerators[0].runtimeCapabilities[0].expiresAt = staleExpiry; expect(FabricTopologySchema.safeParse(r).success).toBe(false)
    const fc = topology(); fc.nodes[1].compute!.observedAt = futureObservation; expect(FabricTopologySchema.safeParse(fc).success).toBe(false)
    const sc = topology(); sc.nodes[1].compute!.expiresAt = staleExpiry; expect(FabricTopologySchema.safeParse(sc).success).toBe(false)
    const mc = topology(); delete mc.nodes[1].compute!.expiresAt; expect(FabricTopologySchema.safeParse(mc).success).toBe(false)
    const fcap = topology(); fcap.nodes[1].capacity!.observedAt = futureObservation; expect(FabricTopologySchema.safeParse(fcap).success).toBe(false)
    const fr = topology(); fr.nodes[1].accelerators[0].runtimeCapabilities[0].capability.observedAt = futureObservation; expect(FabricTopologySchema.safeParse(fr).success).toBe(false)
    const l = topology(); l.links[0].timing.expiresAt = staleExpiry; expect(FabricTopologySchema.safeParse(l).success).toBe(false)
    const fl = topology(); fl.links[0].timing.observedAt = futureObservation; expect(FabricTopologySchema.safeParse(fl).success).toBe(false)
    const degradedCompute = topology(); degradedCompute.nodes[1].compute!.health = "DEGRADED"; degradedCompute.nodes[1].compute!.lifecycle = "DEGRADED"; degradedCompute.nodes[1].compute!.expiresAt = "2026-08-27T17:08:59.999Z"; expect(FabricTopologySchema.safeParse(degradedCompute).success).toBe(false)
    const degradedCapacity = topology(); degradedCapacity.nodes[1].compute!.health = "DEGRADED"; degradedCapacity.nodes[1].compute!.lifecycle = "DEGRADED"; degradedCapacity.nodes[1].capacityExpiresAt = "2026-08-27T17:08:59.999Z"; expect(FabricTopologySchema.safeParse(degradedCapacity).success).toBe(false)
    const observedRuntime = topology(); observedRuntime.nodes[1].accelerators[0].admission = "OBSERVED"; observedRuntime.nodes[1].accelerators[0].runtimeCapabilities[0].expiresAt = "2026-08-27T17:08:59.999Z"; expect(FabricTopologySchema.safeParse(observedRuntime).success).toBe(false)
    const nodeCompute = FabricNodeSchema.parse(canonicalNode("hermes-node")); nodeCompute.compute!.health = "DEGRADED"; nodeCompute.compute!.lifecycle = "DEGRADED"; nodeCompute.compute!.expiresAt = "2026-08-27T17:08:59.999Z"; expect(FabricNodeSchema.safeParse(nodeCompute).success).toBe(false)
    const nodeCapacity = FabricNodeSchema.parse(canonicalNode("hermes-node")); nodeCapacity.compute!.health = "DEGRADED"; nodeCapacity.compute!.lifecycle = "DEGRADED"; nodeCapacity.capacityExpiresAt = "2026-08-27T17:08:59.999Z"; expect(FabricNodeSchema.safeParse(nodeCapacity).success).toBe(false)
  })

  it("enforces exact IF-01 compute/capacity/runtime bindings", () => {
    const n = topology(); n.nodes[1].compute!.nodeId = "omen"; expect(FabricTopologySchema.safeParse(n).success).toBe(false)
    const t = topology(); t.nodes[1].compute!.trustClass = "UNTRUSTED_REMOTE"; expect(FabricTopologySchema.safeParse(t).success).toBe(false)
    const c = topology(); c.nodes[1].capacity!.computeResourceId = "compute.other"; expect(FabricTopologySchema.safeParse(c).success).toBe(false)
    const m = topology(); m.nodes[1].compute!.accelerators[0].vramBytes += 1; expect(FabricTopologySchema.safeParse(m).success).toBe(false)
    const duplicate = topology(); duplicate.nodes[1].compute!.accelerators.push(clone(duplicate.nodes[1].compute!.accelerators[0])); duplicate.nodes[1].capacity!.totalAcceleratorMemoryBytes *= 2; expect(FabricTopologySchema.safeParse(duplicate).success).toBe(false)
    const v = topology(); v.nodes[1].accelerators[0].runtimeCapabilities[0].capability.verdict = "SUPPORTED"; expect(FabricTopologySchema.safeParse(v).success).toBe(false)
    const h = topology(); h.nodes[1].accelerators[0].runtimeCapabilities[0].capability.hardwarePlatform = "NVIDIA_AMPERE"; expect(FabricTopologySchema.safeParse(h).success).toBe(false)
  })

  it("rejects utility admission, case-insensitive UUID collision, and NVIDIA alias", () => {
    const u = topology(); u.nodes[1].accelerators[1].admission = "ADMITTED"; u.nodes[1].accelerators[1].runtimeCapabilities = [provenRuntime("NVIDIA_AMPERE")]; expect(FabricTopologySchema.safeParse(u).success).toBe(false)
    const d = topology(); d.nodes[1].accelerators[1].hardware.uuid = p40Hardware().uuid.toLowerCase(); expect(FabricTopologySchema.safeParse(d).success).toBe(false)
    expect(AcceleratorHardwareSchema.safeParse({ ...p40Hardware(), uuid: "TESLA-P40-LOCAL-ALIAS" }).success).toBe(false)
    expect(AcceleratorHardwareSchema.safeParse({ ...p40Hardware(), uuid: "GPU-----------------" }).success).toBe(false)
  })

  it("requires material-link measurements and p95 >= p50", () => {
    const missing = topology(); missing.links[0].measuredBandwidthBytesPerSecond = undefined; expect(FabricTopologySchema.safeParse(missing).success).toBe(false)
    const inverted = topology(); inverted.links[0].latencyMsP50 = 2; inverted.links[0].latencyMsP95 = 1; expect(FabricTopologySchema.safeParse(inverted).success).toBe(false)
    const unknownMetrics = topology(); unknownMetrics.links[0].timing = { state: "UNKNOWN" }; expect(FabricTopologySchema.safeParse(unknownMetrics).success).toBe(false)
    const duplicate = topology(); duplicate.links.push(clone(duplicate.links[0])); expect(FabricTopologySchema.safeParse(duplicate).success).toBe(false)
    const overclaimed = topology(); overclaimed.nodes[2].bottleneckBaseline = { state: "MEASURED", dimensions: [] }; expect(FabricTopologySchema.safeParse(overclaimed).success).toBe(false)
    const unknownMeasured = topology(); unknownMeasured.nodes[2].bottleneckBaseline = { state: "UNKNOWN", dimensions: [{ id: "CPU", state: "MEASURED", value: 1, unit: "score" }] }; expect(FabricTopologySchema.safeParse(unknownMeasured).success).toBe(false)
    const notApplicableMeasured = topology(); notApplicableMeasured.nodes[2].bottleneckBaseline = { state: "NOT_APPLICABLE", dimensions: [{ id: "CPU", state: "MEASURED", value: 1, unit: "score" }] }; expect(FabricTopologySchema.safeParse(notApplicableMeasured).success).toBe(false)
  })
})

describe("IF-02 durable hardware-change record contract", () => {
  const diffInput = (previous: ReturnType<typeof p40Hardware>[], current: ReturnType<typeof p40Hardware>[], overrides: Record<string, unknown> = {}) => ({
    nodeId: "hermes-node",
    previous,
    current,
    previousRegistrySnapshotDigest: digest("8"),
    currentRegistrySnapshotDigest: digest("9"),
    detectedAt: evaluatedAt,
    evidence: evidence("registry/change", "0"),
    ...overrides,
  })

  it("enforces exact ADDED/REMOVED/CHANGED digest sides and unequal change digests", () => {
    const added: any = diffAccelerators(diffInput([], [p40Hardware()]))[0]
    const removed: any = diffAccelerators(diffInput([p40Hardware()], []))[0]
    const changedHardware = { ...p40Hardware(), memoryBytes: p40Hardware().memoryBytes - 1 }
    const changed: any = diffAccelerators(diffInput([p40Hardware()], [changedHardware]))[0]
    expect(added).toMatchObject({ kind: "ACCELERATOR_ADDED", currentConfigurationDigest: acceleratorConfigurationDigest(p40Hardware()) })
    expect(added).not.toHaveProperty("previousConfigurationDigest")
    expect(removed.kind).toBe("ACCELERATOR_REMOVED"); expect(removed).not.toHaveProperty("currentConfigurationDigest")
    expect(changed.kind).toBe("ACCELERATOR_CHANGED"); expect(changed.previousConfigurationDigest).not.toBe(changed.currentConfigurationDigest)
    expect(HardwareChangeEventSchema.safeParse(added).success).toBe(true)
    expect(HardwareChangeEventSchema.safeParse({ ...added, previousConfigurationDigest: digest("a") }).success).toBe(false)
    const { currentConfigurationDigest: _c, ...incompleteAdded } = added; expect(HardwareChangeEventSchema.safeParse(incompleteAdded).success).toBe(false)
    const { previousConfigurationDigest: _p, ...incompleteRemoved } = removed; expect(HardwareChangeEventSchema.safeParse(incompleteRemoved).success).toBe(false)
    expect(HardwareChangeEventSchema.safeParse({ ...changed, currentConfigurationDigest: changed.previousConfigurationDigest }).success).toBe(false)
    expect(HardwareChangeEventSchema.safeParse({ ...added, currentRegistrySnapshotDigest: added.previousRegistrySnapshotDigest }).success).toBe(false)
  })

  it("rejects duplicate canonical UUIDs instead of last-write collapse", () => {
    const duplicate = { ...p40Hardware(), uuid: p40Hardware().uuid.toLowerCase() }
    expect(() => diffAccelerators(diffInput([p40Hardware(), duplicate], []))).toThrow("DUPLICATE_ACCELERATOR_UUID")
  })

  it("uses stable hardware-only configuration digests", () => {
    expect(acceleratorConfigurationDigest(p40Hardware())).toBe(acceleratorConfigurationDigest(clone(p40Hardware())))
    expect(acceleratorConfigurationDigest({ ...p40Hardware(), pciBusId: "0000:0A:00.0" })).toBe(acceleratorConfigurationDigest({ ...p40Hardware(), pciBusId: "0000:0a:00.0" }))
    const withoutBus = p40Hardware(); delete (withoutBus as { pciBusId?: string }).pciBusId
    expect(acceleratorConfigurationDigest(withoutBus)).toBe(acceleratorConfigurationDigest({ ...withoutBus, pciBusId: undefined }))
    expect(AcceleratorHardwareSchema.safeParse({ ...p40Hardware(), observedAt }).success).toBe(false)
  })

  it("is replay-stable, collision-resistant, and retains caller evidence/snapshot binding", () => {
    const input = diffInput([], [p40Hardware()])
    const first = diffAccelerators(input)[0]
    const replay = diffAccelerators(clone(input))[0]
    expect(replay.id).toBe(first.id)
    expect(first.evidence).toEqual(evidence("registry/change", "0"))
    expect(first.previousRegistrySnapshotDigest).toBe(digest("8"))
    expect(first.currentRegistrySnapshotDigest).toBe(digest("9"))
    const upgraded = { ...p40Hardware(), memoryBytes: p40Hardware().memoryBytes + 1 }
    const later = diffAccelerators(diffInput([p40Hardware()], [upgraded], { previousRegistrySnapshotDigest: digest("9"), currentRegistrySnapshotDigest: digest("a"), detectedAt: "2026-08-27T17:11:00.000Z", evidence: evidence("registry/change-2", "b") }))[0]
    expect(later.id).not.toBe(first.id)
  })
})
