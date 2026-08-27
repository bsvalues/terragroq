import { describe, expect, it } from "vitest"
import {
  FabricTopologySchema,
  HardwareChangeEventSchema,
  diffAccelerators,
  topologyObservationIsFresh,
} from "../components/operator/intelligence-fabric-topology"

const timestamp = "2026-08-27T17:10:00.000Z"
const digest = (character: string) => `sha256:${character.repeat(64)}`

const accelerator = (
  uuid: string,
  purpose: "INFERENCE" | "DISPLAY_UTILITY" | "OPPORTUNISTIC" | "UNADMITTED",
  model = "NVIDIA GPU",
) => ({
  uuid,
  vendor: "NVIDIA" as const,
  model,
  memoryBytes: 24_000_000_000,
  purpose,
  admission: purpose === "INFERENCE" ? ("ADMITTED" as const) : ("OBSERVED" as const),
  runtimeCompatibility: purpose === "INFERENCE" ? ["ollama.0.9.2"] : [],
  observedAt: timestamp,
  evidenceRef: `evidence://fabric/gpu/${uuid}`,
})

const topology = () => ({
  schemaVersion: 1 as const,
  topologyId: "topology.williamos.four-node.v1",
  nodes: [
    {
      id: "node.omen",
      hostname: "OMEN",
      role: "COCKPIT" as const,
      requiredForOrchestration: false,
      trustClass: "ENROLLED_COCKPIT" as const,
      cpuLogicalCores: 16,
      systemMemoryBytes: 32_000_000_000,
      accelerators: [accelerator("GPU-OMEN-5060", "OPPORTUNISTIC", "RTX 5060")],
      topologyObservedAt: timestamp,
      topologyEvidenceRef: "evidence://fabric/omen",
    },
    {
      id: "node.hermes",
      hostname: "HERMES",
      role: "ORCHESTRATOR_LOCAL_AI" as const,
      requiredForOrchestration: true,
      trustClass: "SOVEREIGN_LOCAL" as const,
      cpuLogicalCores: 16,
      systemMemoryBytes: 32_000_000_000,
      accelerators: [
        accelerator("GPU-HERMES-P40", "INFERENCE", "Tesla P40"),
        accelerator("GPU-HERMES-3050", "DISPLAY_UTILITY", "RTX 3050"),
      ],
      topologyObservedAt: timestamp,
      topologyEvidenceRef: "evidence://fabric/hermes-commissioned",
    },
    {
      id: "node.atlas",
      hostname: "ATLAS",
      role: "DURABLE_STATE_EVIDENCE" as const,
      requiredForOrchestration: false,
      trustClass: "SOVEREIGN_LOCAL" as const,
      cpuLogicalCores: 28,
      systemMemoryBytes: 48_000_000_000,
      accelerators: [],
      topologyObservedAt: timestamp,
      topologyEvidenceRef: "evidence://fabric/atlas",
    },
    {
      id: "node.aegis",
      hostname: "AEGIS",
      role: "GOVERNED_EXECUTION" as const,
      requiredForOrchestration: false,
      trustClass: "GOVERNED_WORKER" as const,
      cpuLogicalCores: 28,
      systemMemoryBytes: 24_000_000_000,
      accelerators: [],
      topologyObservedAt: timestamp,
      topologyEvidenceRef: "evidence://fabric/aegis",
    },
  ],
  observedAt: timestamp,
  evidenceDigest: digest("a"),
})

describe("IF-02 canonical four-node topology", () => {
  it("accepts the canonical OMEN/HERMES/ATLAS/AEGIS role split", () => {
    const parsed = FabricTopologySchema.parse(topology())
    expect(parsed.nodes).toHaveLength(4)
    expect(parsed.nodes.find((node) => node.id === "node.hermes")?.accelerators).toHaveLength(2)
  })

  it("refuses to make OMEN an orchestration dependency", () => {
    const candidate = topology()
    candidate.nodes[0].requiredForOrchestration = true
    expect(FabricTopologySchema.safeParse(candidate).success).toBe(false)
  })

  it("requires exactly one node for every canonical role", () => {
    const candidate = topology()
    candidate.nodes[3].role = "DURABLE_STATE_EVIDENCE"
    expect(FabricTopologySchema.safeParse(candidate).success).toBe(false)
  })

  it("rejects duplicate accelerator UUIDs across nodes", () => {
    const candidate = topology()
    candidate.nodes[0].accelerators[0].uuid = "GPU-HERMES-P40"
    expect(FabricTopologySchema.safeParse(candidate).success).toBe(false)
  })

  it("rejects unknown fields at the topology boundary", () => {
    expect(FabricTopologySchema.safeParse({ ...topology(), currentIpAddresses: {} }).success).toBe(
      false,
    )
  })
})

describe("IF-02 freshness and hardware-change truth", () => {
  it("does not authorize placement from stale or future observations", () => {
    expect(topologyObservationIsFresh(timestamp, "2026-08-27T17:14:59.999Z", 300_000)).toBe(true)
    expect(topologyObservationIsFresh(timestamp, "2026-08-27T17:15:00.001Z", 300_000)).toBe(false)
    expect(topologyObservationIsFresh("2026-08-27T18:00:00.000Z", timestamp, 300_000)).toBe(false)
    expect(topologyObservationIsFresh(timestamp, timestamp, -1)).toBe(false)
  })

  it("emits durable arrival and disappearance events instead of overwriting inventory", () => {
    const k2200 = accelerator("GPU-HERMES-K2200", "UNADMITTED", "Quadro K2200")
    const p40 = accelerator("GPU-HERMES-P40", "INFERENCE", "Tesla P40")
    const events = diffAccelerators(
      "node.hermes",
      [k2200],
      [p40],
      timestamp,
      (item) => (item.uuid.endsWith("K2200") ? digest("b") : digest("c")),
    )

    expect(events.map((event) => event.kind)).toEqual([
      "ACCELERATOR_REMOVED",
      "ACCELERATOR_ADDED",
    ])
    expect(events[0]).toMatchObject({
      acceleratorUuid: "GPU-HERMES-K2200",
      previousObservationDigest: digest("b"),
    })
    expect(events[1]).toMatchObject({
      acceleratorUuid: "GPU-HERMES-P40",
      currentObservationDigest: digest("c"),
    })
  })

  it("requires both sides of a changed-hardware event", () => {
    expect(
      HardwareChangeEventSchema.safeParse({
        id: "hardware-change.hermes.p40",
        nodeId: "node.hermes",
        kind: "ACCELERATOR_CHANGED",
        acceleratorUuid: "GPU-HERMES-P40",
        currentObservationDigest: digest("c"),
        detectedAt: timestamp,
        evidenceRef: "evidence://fabric/hermes/p40-change",
      }).success,
    ).toBe(false)
  })
})
