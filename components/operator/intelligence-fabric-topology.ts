import { z } from "zod"

import { hashRecord } from "../../lib/governance/hash"
import {
  ComputeIdentitySchema,
  ResourceCapacitySchema,
  RuntimeCapabilitySchema,
} from "./intelligence-fabric-contracts"

const Identifier = z.string().trim().min(1).regex(/^[A-Za-z0-9][A-Za-z0-9._:/@-]*$/)
const Timestamp = z.string().datetime({ offset: true })
const Digest = z.string().regex(/^sha256:[a-f0-9]{64}$/)
const PositiveInteger = z.number().int().positive()
const FiniteNonNegative = z.number().finite().nonnegative()

const EvidenceBindingSchema = z
  .object({
    ref: z.string().trim().min(1),
    digest: Digest,
  })
  .strict()

export const FABRIC_NODE_ROLES = [
  "COCKPIT",
  "ORCHESTRATOR_LOCAL_AI",
  "DURABLE_STATE_EVIDENCE",
  "GOVERNED_EXECUTION",
  "DISCOVERED_COMPUTE",
] as const

export const COMPUTE_ADMISSION_STATES = [
  "UNKNOWN",
  "OBSERVED",
  "ADMITTED",
  "RESERVED",
  "DEGRADED",
  "UNAVAILABLE",
] as const

export const NODE_DEPENDENCY_CLASSES = [
  "RESIDENT_REQUIRED",
  "RESIDENT_OPTIONAL",
  "OPPORTUNISTIC",
  "EPHEMERAL",
] as const

const CANONICAL_NODE_BINDINGS = {
  omen: {
    hostname: "OMEN",
    role: "COCKPIT",
    dependencyClass: "OPPORTUNISTIC",
    trustClass: "ENROLLED_COCKPIT",
    requiredForOrchestration: false,
  },
  "hermes-node": {
    hostname: "HERMES",
    role: "ORCHESTRATOR_LOCAL_AI",
    dependencyClass: "RESIDENT_REQUIRED",
    trustClass: "SOVEREIGN_LOCAL",
    requiredForOrchestration: true,
  },
  atlas: {
    hostname: "ATLAS",
    role: "DURABLE_STATE_EVIDENCE",
    dependencyClass: "RESIDENT_REQUIRED",
    trustClass: "SOVEREIGN_LOCAL",
    requiredForOrchestration: false,
  },
  aegis: {
    hostname: "AEGIS",
    role: "GOVERNED_EXECUTION",
    dependencyClass: "RESIDENT_OPTIONAL",
    trustClass: "GOVERNED_WORKER",
    requiredForOrchestration: false,
  },
} as const

const CANONICAL_NODE_IDS = Object.keys(CANONICAL_NODE_BINDINGS) as Array<
  keyof typeof CANONICAL_NODE_BINDINGS
>

const canonicalUuid = (value: string) => value.trim().toUpperCase()

const AcceleratorUuidSchema = z
  .string()
  .trim()
  .min(8)
  .regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/)
  .transform(canonicalUuid)

export const AcceleratorHardwareSchema = z
  .object({
    uuid: AcceleratorUuidSchema,
    class: Identifier,
    vendor: z.enum(["NVIDIA", "AMD", "INTEL", "OTHER"]),
    model: z.string().trim().min(1),
    memoryBytes: PositiveInteger,
    pciBusId: z
      .string()
      .trim()
      .regex(/^[0-9a-f]{4}:[0-9a-f]{2}:[0-9a-f]{2}\.[0-7]$/i)
      .transform((value) => value.toLowerCase())
      .optional(),
    pcie: z
      .object({
        generation: PositiveInteger.optional(),
        negotiatedWidth: PositiveInteger.optional(),
      })
      .strict(),
  })
  .strict()
  .superRefine((hardware, context) => {
    if (
      hardware.vendor === "NVIDIA" &&
      !/^GPU-[A-F0-9]{8}(?:-[A-F0-9]{4}){3}-[A-F0-9]{12}$/.test(hardware.uuid)
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["uuid"],
        message: "NVIDIA accelerator identity must be a durable nvidia-smi GPU UUID, not an alias",
      })
    }
  })

const TimedEvidenceSchema = z
  .object({
    state: z.enum(["COMPLETE", "PARTIAL", "UNKNOWN", "UNAVAILABLE"]),
    observedAt: Timestamp.optional(),
    expiresAt: Timestamp.optional(),
    evidence: EvidenceBindingSchema.optional(),
  })
  .strict()
  .superRefine((observation, context) => {
    const hasCompleteBinding = Boolean(
      observation.observedAt && observation.expiresAt && observation.evidence,
    )
    if (["COMPLETE", "PARTIAL"].includes(observation.state) && !hasCompleteBinding) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["evidence"],
        message: "Measured observations require observedAt, expiresAt, and exact evidence",
      })
    }
    if (
      observation.observedAt &&
      observation.expiresAt &&
      Date.parse(observation.expiresAt) < Date.parse(observation.observedAt)
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["expiresAt"],
        message: "Observation expiry cannot precede observation time",
      })
    }
  })

export const NodeTelemetrySchema = z
  .object({
    timing: TimedEvidenceSchema,
    cpu: z
      .object({
        logicalCores: PositiveInteger.optional(),
        sockets: PositiveInteger.optional(),
        numaDomains: PositiveInteger.optional(),
        architecture: z.string().trim().min(1).optional(),
      })
      .strict(),
    memory: z
      .object({
        capacityBytes: PositiveInteger.optional(),
        measuredBandwidthBytesPerSecond: FiniteNonNegative.optional(),
      })
      .strict(),
    storageModelLoadBytesPerSecond: FiniteNonNegative.optional(),
  })
  .strict()
  .superRefine((telemetry, context) => {
    const carriesMeasurements = Object.values(telemetry.cpu).some((value) => value !== undefined) ||
      Object.values(telemetry.memory).some((value) => value !== undefined) ||
      telemetry.storageModelLoadBytesPerSecond !== undefined
    if (
      carriesMeasurements &&
      !["COMPLETE", "PARTIAL"].includes(telemetry.timing.state)
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["timing", "state"],
        message: "Node measurements require complete or partial timed evidence",
      })
    }
    if (
      telemetry.timing.state === "COMPLETE" &&
      (!telemetry.cpu.logicalCores || !telemetry.memory.capacityBytes)
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["timing", "state"],
        message: "Complete node telemetry requires CPU and system-memory capacity",
      })
    }
  })

const RuntimeCapabilityObservationSchema = z
  .object({
    capability: RuntimeCapabilitySchema,
    expiresAt: Timestamp,
    evidenceDigest: Digest,
  })
  .strict()
  .superRefine((runtime, context) => {
    if (
      runtime.capability.observedAt &&
      Date.parse(runtime.expiresAt) < Date.parse(runtime.capability.observedAt)
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["expiresAt"],
        message: "Runtime capability expiry cannot precede its observation",
      })
    }
  })

export const AcceleratorTelemetrySchema = z
  .object({
    hardware: AcceleratorHardwareSchema,
    purpose: z.enum(["INFERENCE", "DISPLAY_UTILITY", "OPPORTUNISTIC", "UNADMITTED"]),
    admission: z.enum(COMPUTE_ADMISSION_STATES),
    providerClass: z.enum([
      "RESIDENT_LOCAL",
      "MANAGED_OPEN",
      "ELASTIC_OPEN",
      "BROKERED",
      "DIRECT_FRONTIER",
    ]),
    health: z.enum(["UNKNOWN", "AVAILABLE", "RESERVED", "DEGRADED", "UNAVAILABLE"]),
    driverVersion: z.string().trim().min(1).optional(),
    temperatureC: z.number().finite().optional(),
    powerWatts: FiniteNonNegative.optional(),
    powerLimitWatts: FiniteNonNegative.optional(),
    hostToDeviceBandwidthBytesPerSecond: FiniteNonNegative.optional(),
    timing: TimedEvidenceSchema,
    runtimeCapabilities: z.array(RuntimeCapabilityObservationSchema),
  })
  .strict()
  .superRefine((accelerator, context) => {
    const carriesVolatileMeasurements = accelerator.driverVersion !== undefined ||
      accelerator.temperatureC !== undefined ||
      accelerator.powerWatts !== undefined ||
      accelerator.powerLimitWatts !== undefined ||
      accelerator.hostToDeviceBandwidthBytesPerSecond !== undefined ||
      accelerator.runtimeCapabilities.length > 0
    if (
      carriesVolatileMeasurements &&
      !["COMPLETE", "PARTIAL"].includes(accelerator.timing.state)
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["timing", "state"],
        message: "Accelerator measurements and runtime evidence require timed evidence",
      })
    }
    const placementEligible = ["ADMITTED", "RESERVED"].includes(accelerator.admission)
    if (
      ["DISPLAY_UTILITY", "UNADMITTED"].includes(accelerator.purpose) &&
      placementEligible
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["admission"],
        message: "Display/utility and unadmitted accelerators cannot become placement eligible",
      })
    }
    if (placementEligible && !["AVAILABLE", "RESERVED"].includes(accelerator.health)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["health"],
        message: "Admitted or reserved accelerators require available or reserved health",
      })
    }
    if (placementEligible && accelerator.timing.state !== "COMPLETE") {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["timing", "state"],
        message: "Placement-eligible accelerators require complete telemetry",
      })
    }
    if (placementEligible) {
      const compatible = accelerator.runtimeCapabilities.some(
        ({ capability }) =>
          capability.hardwarePlatform === accelerator.hardware.class &&
          capability.verdict === "PROVEN",
      )
      if (!compatible) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["runtimeCapabilities"],
          message: "Placement-eligible accelerators require exact PROVEN runtime compatibility",
        })
      }
    }
  })

export const BottleneckBaselineSchema = z
  .object({
    state: z.enum(["MEASURED", "PARTIAL", "UNKNOWN", "NOT_APPLICABLE"]),
    dimensions: z.array(
      z
        .object({
          id: z.enum([
            "CPU",
            "SYSTEM_MEMORY_CAPACITY",
            "SYSTEM_MEMORY_BANDWIDTH",
            "ACCELERATOR_MEMORY",
            "ACCELERATOR_COMPUTE",
            "PCIE_HOST_DEVICE",
            "MODEL_LOAD_STORAGE",
            "FABRIC_LINK",
          ]),
          state: z.enum(["MEASURED", "UNKNOWN", "NOT_APPLICABLE"]),
          value: z.number().finite().optional(),
          unit: z.string().trim().min(1).optional(),
        })
        .strict()
        .superRefine((dimension, context) => {
          if (dimension.state === "MEASURED" && (dimension.value === undefined || !dimension.unit)) {
            context.addIssue({
              code: z.ZodIssueCode.custom,
              path: ["value"],
              message: "Measured bottleneck dimensions require a value and unit",
            })
          }
        }),
    ),
    evidence: EvidenceBindingSchema.optional(),
  })
  .strict()
  .superRefine((baseline, context) => {
    const ids = baseline.dimensions.map(({ id }) => id)
    if (new Set(ids).size !== ids.length) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["dimensions"],
        message: "Bottleneck dimensions must be unique",
      })
    }
    if (["MEASURED", "PARTIAL"].includes(baseline.state) && !baseline.evidence) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["evidence"],
        message: "Measured or partial bottleneck baselines require exact evidence",
      })
    }
    if (
      baseline.state === "MEASURED" &&
      (
        baseline.dimensions.length === 0 ||
        !baseline.dimensions.some(({ state }) => state === "MEASURED") ||
        baseline.dimensions.some(({ state }) => state === "UNKNOWN")
      )
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["dimensions"],
        message: "A measured bottleneck baseline cannot omit dimensions or retain unknowns",
      })
    }
    if (
      baseline.state === "PARTIAL" &&
      (
        !baseline.dimensions.some(({ state }) => state === "MEASURED") ||
        !baseline.dimensions.some(({ state }) => state !== "MEASURED")
      )
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["dimensions"],
        message: "A partial bottleneck baseline requires measured and unresolved/not-applicable dimensions",
      })
    }
    if (
      baseline.state === "UNKNOWN" &&
      baseline.dimensions.some(({ state }) => state === "MEASURED")
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["dimensions"],
        message: "An unknown bottleneck baseline cannot carry measured dimensions",
      })
    }
    if (
      baseline.state === "NOT_APPLICABLE" &&
      baseline.dimensions.some(({ state }) => state !== "NOT_APPLICABLE")
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["dimensions"],
        message: "A not-applicable baseline can contain only not-applicable dimensions",
      })
    }
  })

export const FabricNodeSchema = z
  .object({
    registryNodeId: Identifier,
    registryEnrollment: z.enum(["CANONICAL", "ENROLLED", "UNENROLLED"]),
    registryEvidence: EvidenceBindingSchema,
    machineIdentityDigest: Digest.optional(),
    hostname: z.string().trim().min(1),
    role: z.enum(FABRIC_NODE_ROLES),
    dependencyClass: z.enum(NODE_DEPENDENCY_CLASSES),
    requiredForOrchestration: z.boolean(),
    trustClass: z.enum([
      "SOVEREIGN_LOCAL",
      "ENROLLED_COCKPIT",
      "GOVERNED_WORKER",
      "UNENROLLED",
    ]),
    telemetry: NodeTelemetrySchema,
    compute: ComputeIdentitySchema.optional(),
    capacity: ResourceCapacitySchema.optional(),
    capacityExpiresAt: Timestamp.optional(),
    capacityEvidence: EvidenceBindingSchema.optional(),
    accelerators: z.array(AcceleratorTelemetrySchema),
    bottleneckBaseline: BottleneckBaselineSchema,
  })
  .strict()
  .superRefine((node, context) => {
    if (node.requiredForOrchestration && node.role !== "ORCHESTRATOR_LOCAL_AI") {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["requiredForOrchestration"],
        message: "Only the canonical local orchestrator may be an orchestration dependency",
      })
    }
    if (node.registryEnrollment === "UNENROLLED") {
      if (node.trustClass !== "UNENROLLED" || node.role !== "DISCOVERED_COMPUTE") {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["registryEnrollment"],
          message: "Unenrolled discoveries cannot claim a canonical role or trust class",
        })
      }
      if (node.compute && ["AVAILABLE", "RESERVED"].includes(node.compute.health)) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["compute", "health"],
          message: "Unenrolled compute cannot become placement eligible",
        })
      }
      if (node.accelerators.some(({ admission }) => ["ADMITTED", "RESERVED"].includes(admission))) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["accelerators"],
          message: "Unenrolled accelerator observations cannot be admitted or reserved",
        })
      }
    }
    if (node.registryEnrollment !== "UNENROLLED" && node.trustClass === "UNENROLLED") {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["trustClass"],
        message: "Canonical or enrolled registry nodes require a governed trust class",
      })
    }
    if (node.accelerators.length > 0 && !node.compute) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["compute"],
        message: "Accelerator observations must project through the IF-01 compute identity",
      })
    }
    if (node.capacity && !node.compute) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["capacity"],
        message: "Resource capacity cannot exist without an IF-01 compute identity",
      })
    }
    if ((node.capacityExpiresAt || node.capacityEvidence) && !node.capacity) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["capacityExpiresAt"],
        message: "Capacity evidence/expiry cannot exist without a capacity observation",
      })
    }
    if (node.capacity && (!node.capacityExpiresAt || !node.capacityEvidence)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["capacityEvidence"],
        message: "Capacity observations require expiry and exact evidence",
      })
    }
    if (node.compute) {
      if (
        node.compute.expiresAt &&
        Date.parse(node.compute.expiresAt) < Date.parse(node.compute.observedAt)
      ) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["compute", "expiresAt"],
          message: "Compute expiry cannot precede its observation",
        })
      }
      const healthEligible = ["AVAILABLE", "RESERVED"].includes(node.compute.health)
      const lifecycleEligible = ["AVAILABLE", "RESERVED"].includes(node.compute.lifecycle)
      if (healthEligible !== lifecycleEligible) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["compute", "lifecycle"],
          message: "IF-01 compute health and lifecycle must agree on placement eligibility",
        })
      }
      if (node.compute.nodeId !== node.registryNodeId) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["compute", "nodeId"],
          message: "IF-01 compute identity must bind to the canonical registry node id",
        })
      }
      if (node.compute.trustClass !== node.trustClass) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["compute", "trustClass"],
          message: "IF-01 compute trust must exactly match the governed topology-node trust",
        })
      }
      const projected = new Map(node.accelerators.map(({ hardware }) => [hardware.uuid, hardware]))
      const identities = new Map(
        node.compute.accelerators.map((accelerator) => [canonicalUuid(accelerator.uuid), accelerator]),
      )
      if (identities.size !== node.compute.accelerators.length) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["compute", "accelerators"],
          message: "IF-01 compute accelerator UUIDs must be canonically unique",
        })
      }
      if (
        projected.size !== identities.size ||
        [...projected.entries()].some(([uuid, hardware]) => {
          const identity = identities.get(uuid)
          return !identity ||
            identity.class !== hardware.class ||
            identity.vendor.toUpperCase() !== hardware.vendor ||
            identity.model !== hardware.model ||
            identity.vramBytes !== hardware.memoryBytes
        })
      ) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["accelerators"],
          message: "Topology accelerators must exactly project the IF-01 compute identity",
        })
      }
    }
    if (node.capacity && node.compute && node.capacity.computeResourceId !== node.compute.id) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["capacity", "computeResourceId"],
        message: "Capacity must bind to the exact IF-01 compute resource",
      })
    }
    if (
      node.capacity &&
      node.capacityExpiresAt &&
      Date.parse(node.capacityExpiresAt) < Date.parse(node.capacity.observedAt)
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["capacityExpiresAt"],
        message: "Capacity expiry cannot precede its observation",
      })
    }
    if (node.capacity && node.compute) {
      const placementEligibleUuids = new Set(
        node.accelerators
          .filter(({ admission }) => ["ADMITTED", "RESERVED"].includes(admission))
          .map(({ hardware }) => hardware.uuid),
      )
      const acceleratorMemory = node.compute.accelerators.reduce(
        (total, accelerator) =>
          total + (placementEligibleUuids.has(canonicalUuid(accelerator.uuid))
            ? accelerator.vramBytes
            : 0),
        0,
      )
      if (node.capacity.totalAcceleratorMemoryBytes !== acceleratorMemory) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["capacity", "totalAcceleratorMemoryBytes"],
          message: "Capacity must equal admitted/reserved accelerator memory and exclude utility hardware",
        })
      }
      if (
        node.telemetry.memory.capacityBytes !== undefined &&
        node.capacity.totalSystemMemoryBytes !== node.telemetry.memory.capacityBytes
      ) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["capacity", "totalSystemMemoryBytes"],
          message: "Capacity must equal measured system-memory capacity",
        })
      }
      if (
        node.telemetry.cpu.logicalCores !== undefined &&
        node.capacity.totalCpuLogicalCores !== node.telemetry.cpu.logicalCores
      ) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["capacity", "totalCpuLogicalCores"],
          message: "Capacity must equal measured CPU logical-core capacity",
        })
      }
    }
  })

export const FabricLinkSchema = z
  .object({
    id: Identifier,
    fromNodeId: Identifier,
    toNodeId: Identifier,
    transportClass: Identifier,
    trustClass: Identifier,
    policyBoundary: z.string().trim().min(1),
    materialForPlacement: z.boolean(),
    measuredBandwidthBytesPerSecond: FiniteNonNegative.optional(),
    latencyMsP50: FiniteNonNegative.optional(),
    latencyMsP95: FiniteNonNegative.optional(),
    reliability: z.number().finite().min(0).max(1).optional(),
    timing: TimedEvidenceSchema,
  })
  .strict()
  .superRefine((link, context) => {
    const carriesMeasurements = link.measuredBandwidthBytesPerSecond !== undefined ||
      link.latencyMsP50 !== undefined ||
      link.latencyMsP95 !== undefined ||
      link.reliability !== undefined
    if (carriesMeasurements && !["COMPLETE", "PARTIAL"].includes(link.timing.state)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["timing", "state"],
        message: "Fabric-link measurements require complete or partial timed evidence",
      })
    }
    if (link.fromNodeId === link.toNodeId) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["toNodeId"],
        message: "Fabric links must connect distinct nodes",
      })
    }
    if (
      link.latencyMsP50 !== undefined &&
      link.latencyMsP95 !== undefined &&
      link.latencyMsP95 < link.latencyMsP50
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["latencyMsP95"],
        message: "p95 latency cannot be lower than p50 latency",
      })
    }
    if (
      link.materialForPlacement &&
      link.timing.state === "COMPLETE" &&
      (
        link.measuredBandwidthBytesPerSecond === undefined ||
        link.latencyMsP50 === undefined ||
        link.latencyMsP95 === undefined ||
        link.reliability === undefined
      )
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["materialForPlacement"],
        message: "Complete material links require measured bandwidth, p50/p95 latency, and reliability",
      })
    }
  })

function isFreshAt(
  observedAt: string | undefined,
  expiresAt: string | undefined,
  evaluatedAt: string,
): boolean {
  if (!observedAt || !expiresAt) return false
  const observed = Date.parse(observedAt)
  const expires = Date.parse(expiresAt)
  const evaluated = Date.parse(evaluatedAt)
  return Number.isFinite(observed) && Number.isFinite(expires) && Number.isFinite(evaluated) &&
    observed <= evaluated && evaluated <= expires
}

export function topologyObservationIsFresh(
  observedAt: string,
  expiresAt: string,
  evaluatedAt: string,
): boolean {
  if (
    !Timestamp.safeParse(observedAt).success ||
    !Timestamp.safeParse(expiresAt).success ||
    !Timestamp.safeParse(evaluatedAt).success
  ) return false
  return isFreshAt(observedAt, expiresAt, evaluatedAt)
}

export const FabricTopologySchema = z
  .object({
    schemaVersion: z.literal(2),
    topologyId: Identifier,
    sourceRegistry: z
      .object({
        schemaVersion: z.literal("0.3"),
        snapshotDigest: Digest,
        evidenceRef: z.string().trim().min(1),
      })
      .strict(),
    nodes: z.array(FabricNodeSchema).min(4),
    links: z.array(FabricLinkSchema),
    evaluatedAt: Timestamp,
    evidenceDigest: Digest,
  })
  .strict()
  .superRefine((topology, context) => {
    const nodeIds = topology.nodes.map(({ registryNodeId }) => registryNodeId)
    const hostnames = topology.nodes.map(({ hostname }) => hostname.toUpperCase())
    if (new Set(nodeIds).size !== nodeIds.length) {
      context.addIssue({ code: z.ZodIssueCode.custom, path: ["nodes"], message: "Registry node ids must be unique" })
    }
    if (new Set(hostnames).size !== hostnames.length) {
      context.addIssue({ code: z.ZodIssueCode.custom, path: ["nodes"], message: "Fabric hostnames must be unique" })
    }

    for (const registryNodeId of CANONICAL_NODE_IDS) {
      const candidates = topology.nodes.filter((node) => node.registryNodeId === registryNodeId)
      if (candidates.length !== 1) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["nodes"],
          message: `Canonical registry node ${registryNodeId} must occur exactly once`,
        })
        continue
      }
      const node = candidates[0]
      const expected = CANONICAL_NODE_BINDINGS[registryNodeId]
      const exact = node.registryEnrollment === "CANONICAL" &&
        Boolean(node.machineIdentityDigest) &&
        node.hostname.toUpperCase() === expected.hostname &&
        node.role === expected.role &&
        node.dependencyClass === expected.dependencyClass &&
        node.trustClass === expected.trustClass &&
        node.requiredForOrchestration === expected.requiredForOrchestration
      if (!exact) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["nodes", topology.nodes.indexOf(node)],
          message: `Canonical registry binding for ${registryNodeId} does not match its fixed role, trust, and dependency class`,
        })
      }
    }

    topology.nodes.forEach((node, nodeIndex) => {
      if (!CANONICAL_NODE_IDS.includes(node.registryNodeId as keyof typeof CANONICAL_NODE_BINDINGS)) {
        if (node.role !== "DISCOVERED_COMPUTE" || node.registryEnrollment === "CANONICAL") {
          context.addIssue({
            code: z.ZodIssueCode.custom,
            path: ["nodes", nodeIndex],
            message: "Additional nodes must remain discovered compute and cannot claim canonical identity",
          })
        }
      }
      const timing = node.telemetry.timing
      if (timing.observedAt && Date.parse(timing.observedAt) > Date.parse(topology.evaluatedAt)) {
        context.addIssue({ code: z.ZodIssueCode.custom, path: ["nodes", nodeIndex, "telemetry"], message: "Future node telemetry is invalid" })
      }
      const computeEligible = node.compute && ["AVAILABLE", "RESERVED"].includes(node.compute.health)
      if (
        computeEligible &&
        (timing.state !== "COMPLETE" ||
          !isFreshAt(timing.observedAt, timing.expiresAt, topology.evaluatedAt))
      ) {
        context.addIssue({ code: z.ZodIssueCode.custom, path: ["nodes", nodeIndex, "telemetry"], message: "Stale node telemetry cannot authorize available compute" })
      }
      if (node.compute && Date.parse(node.compute.observedAt) > Date.parse(topology.evaluatedAt)) {
        context.addIssue({ code: z.ZodIssueCode.custom, path: ["nodes", nodeIndex, "compute", "observedAt"], message: "Future compute identity observations are invalid" })
      }
      if (
        node.compute?.expiresAt &&
        Date.parse(node.compute.expiresAt) < Date.parse(node.compute.observedAt)
      ) {
        context.addIssue({ code: z.ZodIssueCode.custom, path: ["nodes", nodeIndex, "compute", "expiresAt"], message: "Compute expiry cannot precede its observation" })
      }
      if (
        computeEligible &&
        !isFreshAt(node.compute?.observedAt, node.compute?.expiresAt, topology.evaluatedAt)
      ) {
        context.addIssue({ code: z.ZodIssueCode.custom, path: ["nodes", nodeIndex, "compute", "expiresAt"], message: "Available compute requires a fresh IF-01 identity observation" })
      }
      if (computeEligible && !node.capacity) {
        context.addIssue({ code: z.ZodIssueCode.custom, path: ["nodes", nodeIndex, "capacity"], message: "Available compute requires current IF-01 capacity" })
      }
      if (node.capacity) {
        if (Date.parse(node.capacity.observedAt) > Date.parse(topology.evaluatedAt)) {
          context.addIssue({ code: z.ZodIssueCode.custom, path: ["nodes", nodeIndex, "capacity", "observedAt"], message: "Future capacity observations are invalid" })
        }
        if (
          node.capacityExpiresAt &&
          Date.parse(node.capacityExpiresAt) < Date.parse(node.capacity.observedAt)
        ) {
          context.addIssue({ code: z.ZodIssueCode.custom, path: ["nodes", nodeIndex, "capacityExpiresAt"], message: "Capacity expiry cannot precede its observation" })
        }
        if (computeEligible && !isFreshAt(node.capacity.observedAt, node.capacityExpiresAt, topology.evaluatedAt)) {
          context.addIssue({ code: z.ZodIssueCode.custom, path: ["nodes", nodeIndex, "capacity"], message: "Stale capacity cannot authorize available compute" })
        }
      }
      node.accelerators.forEach((accelerator, acceleratorIndex) => {
        const placementEligible = ["ADMITTED", "RESERVED"].includes(accelerator.admission)
        const acceleratorTiming = accelerator.timing
        if (acceleratorTiming.observedAt && Date.parse(acceleratorTiming.observedAt) > Date.parse(topology.evaluatedAt)) {
          context.addIssue({ code: z.ZodIssueCode.custom, path: ["nodes", nodeIndex, "accelerators", acceleratorIndex, "timing"], message: "Future accelerator telemetry is invalid" })
        }
        if (placementEligible && !isFreshAt(acceleratorTiming.observedAt, acceleratorTiming.expiresAt, topology.evaluatedAt)) {
          context.addIssue({ code: z.ZodIssueCode.custom, path: ["nodes", nodeIndex, "accelerators", acceleratorIndex, "timing"], message: "Stale accelerator telemetry cannot remain admitted or reserved" })
        }
        accelerator.runtimeCapabilities.forEach((runtime, runtimeIndex) => {
          const observedAt = runtime.capability.observedAt
          if (observedAt && Date.parse(observedAt) > Date.parse(topology.evaluatedAt)) {
            context.addIssue({ code: z.ZodIssueCode.custom, path: ["nodes", nodeIndex, "accelerators", acceleratorIndex, "runtimeCapabilities", runtimeIndex], message: "Future runtime capability evidence is invalid" })
          }
          if (
            placementEligible &&
            runtime.capability.verdict === "PROVEN" &&
            !isFreshAt(observedAt, runtime.expiresAt, topology.evaluatedAt)
          ) {
            context.addIssue({ code: z.ZodIssueCode.custom, path: ["nodes", nodeIndex, "accelerators", acceleratorIndex, "runtimeCapabilities", runtimeIndex], message: "Stale runtime evidence cannot support accelerator admission" })
          }
        })
      })
    })

    const acceleratorUuids = topology.nodes.flatMap((node) =>
      node.accelerators.map(({ hardware }) => hardware.uuid),
    )
    if (new Set(acceleratorUuids).size !== acceleratorUuids.length) {
      context.addIssue({ code: z.ZodIssueCode.custom, path: ["nodes"], message: "Canonical accelerator UUIDs must be unique across the fabric" })
    }

    const nodeIdSet = new Set(nodeIds)
    const linkIds = topology.links.map(({ id }) => id)
    if (new Set(linkIds).size !== linkIds.length) {
      context.addIssue({ code: z.ZodIssueCode.custom, path: ["links"], message: "Fabric link ids must be unique" })
    }
    topology.links.forEach((link, linkIndex) => {
      if (!nodeIdSet.has(link.fromNodeId) || !nodeIdSet.has(link.toNodeId)) {
        context.addIssue({ code: z.ZodIssueCode.custom, path: ["links", linkIndex], message: "Fabric link endpoints must name nodes in this registry projection" })
      }
      const timing = link.timing
      if (timing.observedAt && Date.parse(timing.observedAt) > Date.parse(topology.evaluatedAt)) {
        context.addIssue({ code: z.ZodIssueCode.custom, path: ["links", linkIndex, "timing"], message: "Future link telemetry is invalid" })
      }
      if (
        link.materialForPlacement &&
        timing.state === "COMPLETE" &&
        !isFreshAt(timing.observedAt, timing.expiresAt, topology.evaluatedAt)
      ) {
        context.addIssue({ code: z.ZodIssueCode.custom, path: ["links", linkIndex, "timing"], message: "Stale material link evidence cannot authorize placement" })
      }
    })
  })

export function orchestrationIsAvailable(topology: FabricTopology): boolean {
  const parsed = FabricTopologySchema.safeParse(topology)
  if (!parsed.success) return false
  const hermes = parsed.data.nodes.find(({ registryNodeId }) => registryNodeId === "hermes-node")
  if (!hermes) return false
  return hermes.requiredForOrchestration &&
    hermes.telemetry.timing.state === "COMPLETE" &&
    isFreshAt(
      hermes.telemetry.timing.observedAt,
      hermes.telemetry.timing.expiresAt,
      parsed.data.evaluatedAt,
    )
}

const HardwareEventCommonSchema = z
  .object({
    id: Identifier,
    nodeId: Identifier,
    acceleratorUuid: AcceleratorUuidSchema,
    previousRegistrySnapshotDigest: Digest,
    currentRegistrySnapshotDigest: Digest,
    detectedAt: Timestamp,
    evidence: EvidenceBindingSchema,
  })
  .strict()

const HardwareAddedSchema = HardwareEventCommonSchema.extend({
  kind: z.literal("ACCELERATOR_ADDED"),
  currentConfigurationDigest: Digest,
}).strict()

const HardwareRemovedSchema = HardwareEventCommonSchema.extend({
  kind: z.literal("ACCELERATOR_REMOVED"),
  previousConfigurationDigest: Digest,
}).strict()

const HardwareChangedSchema = HardwareEventCommonSchema.extend({
  kind: z.literal("ACCELERATOR_CHANGED"),
  previousConfigurationDigest: Digest,
  currentConfigurationDigest: Digest,
}).strict()

type HardwareEventIdentityInput = {
  nodeId: string
  acceleratorUuid: string
  kind: "ACCELERATOR_ADDED" | "ACCELERATOR_REMOVED" | "ACCELERATOR_CHANGED"
  previousRegistrySnapshotDigest: string
  currentRegistrySnapshotDigest: string
  previousConfigurationDigest?: string
  currentConfigurationDigest?: string
  detectedAt: string
  evidence: { ref: string; digest: string }
}

function hardwareEventId(event: HardwareEventIdentityInput & { id?: string }): string {
  return `hardware-change:${hashRecord({
    contract: "intelligence-fabric.hardware-change.v2",
    nodeId: event.nodeId,
    acceleratorUuid: canonicalUuid(event.acceleratorUuid),
    kind: event.kind,
    previousRegistrySnapshotDigest: event.previousRegistrySnapshotDigest,
    currentRegistrySnapshotDigest: event.currentRegistrySnapshotDigest,
    previousConfigurationDigest: event.previousConfigurationDigest ?? null,
    currentConfigurationDigest: event.currentConfigurationDigest ?? null,
    detectedAt: event.detectedAt,
    evidence: event.evidence,
  })}`
}

export const HardwareChangeEventSchema = z
  .discriminatedUnion("kind", [HardwareAddedSchema, HardwareRemovedSchema, HardwareChangedSchema])
  .superRefine((event, context) => {
    if (event.previousRegistrySnapshotDigest === event.currentRegistrySnapshotDigest) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["currentRegistrySnapshotDigest"],
        message: "A hardware transition requires distinct previous and current registry snapshots",
      })
    }
    if (
      event.kind === "ACCELERATOR_CHANGED" &&
      event.previousConfigurationDigest === event.currentConfigurationDigest
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["currentConfigurationDigest"],
        message: "Changed hardware requires distinct previous and current configuration digests",
      })
    }
    if (event.id !== hardwareEventId(event as HardwareEventIdentityInput)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["id"],
        message: "Hardware event id must bind the exact transition and evidence facts",
      })
    }
  })

export function acceleratorConfigurationDigest(
  observation: z.input<typeof AcceleratorHardwareSchema>,
): string {
  const parsed = AcceleratorHardwareSchema.parse(observation)
  const canonical = {
    uuid: parsed.uuid,
    class: parsed.class,
    vendor: parsed.vendor,
    model: parsed.model,
    memoryBytes: parsed.memoryBytes,
    ...(parsed.pciBusId ? { pciBusId: parsed.pciBusId } : {}),
    pcie: {
      ...(parsed.pcie.generation !== undefined ? { generation: parsed.pcie.generation } : {}),
      ...(parsed.pcie.negotiatedWidth !== undefined
        ? { negotiatedWidth: parsed.pcie.negotiatedWidth }
        : {}),
    },
  }
  return `sha256:${hashRecord({
    contract: "intelligence-fabric.accelerator-configuration.v1",
    ...canonical,
  })}`
}

const HardwareDiffInputSchema = z
  .object({
    nodeId: Identifier,
    previous: z.array(AcceleratorHardwareSchema),
    current: z.array(AcceleratorHardwareSchema),
    previousRegistrySnapshotDigest: Digest,
    currentRegistrySnapshotDigest: Digest,
    detectedAt: Timestamp,
    evidence: EvidenceBindingSchema,
  })
  .strict()

export function diffAccelerators(
  input: z.input<typeof HardwareDiffInputSchema>,
): HardwareChangeEvent[] {
  const parsed = HardwareDiffInputSchema.parse(input)
  const duplicate = (items: z.infer<typeof AcceleratorHardwareSchema>[]) => {
    const uuids = items.map(({ uuid }) => uuid)
    return new Set(uuids).size !== uuids.length
  }
  if (duplicate(parsed.previous) || duplicate(parsed.current)) {
    throw new Error("DUPLICATE_ACCELERATOR_UUID: observations must not collapse by last write")
  }

  const before = new Map(parsed.previous.map((item) => [item.uuid, item]))
  const after = new Map(parsed.current.map((item) => [item.uuid, item]))
  const uuids = [...new Set([...before.keys(), ...after.keys()])].sort()
  const events: HardwareChangeEvent[] = []

  for (const acceleratorUuid of uuids) {
    const oldValue = before.get(acceleratorUuid)
    const newValue = after.get(acceleratorUuid)
    const previousConfigurationDigest = oldValue
      ? acceleratorConfigurationDigest(oldValue)
      : undefined
    const currentConfigurationDigest = newValue
      ? acceleratorConfigurationDigest(newValue)
      : undefined
    if (previousConfigurationDigest === currentConfigurationDigest) continue

    const common = {
      nodeId: parsed.nodeId,
      acceleratorUuid,
      previousRegistrySnapshotDigest: parsed.previousRegistrySnapshotDigest,
      currentRegistrySnapshotDigest: parsed.currentRegistrySnapshotDigest,
      detectedAt: parsed.detectedAt,
      evidence: { ref: parsed.evidence.ref, digest: parsed.evidence.digest },
    }
    const facts: HardwareEventIdentityInput = !oldValue
      ? { ...common, kind: "ACCELERATOR_ADDED", currentConfigurationDigest: currentConfigurationDigest! }
      : !newValue
        ? { ...common, kind: "ACCELERATOR_REMOVED", previousConfigurationDigest: previousConfigurationDigest! }
        : {
            ...common,
            kind: "ACCELERATOR_CHANGED",
            previousConfigurationDigest: previousConfigurationDigest!,
            currentConfigurationDigest: currentConfigurationDigest!,
          }
    const event = {
      ...facts,
      id: hardwareEventId(facts),
    }
    events.push(HardwareChangeEventSchema.parse(event))
  }

  return events
}

export type FabricTopology = z.infer<typeof FabricTopologySchema>
export type HardwareChangeEvent = z.infer<typeof HardwareChangeEventSchema>
