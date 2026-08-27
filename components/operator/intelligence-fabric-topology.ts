import { z } from "zod"

const Id = z.string().trim().min(1).regex(/^[A-Za-z0-9][A-Za-z0-9._:/@-]*$/)
const Timestamp = z.string().datetime({ offset: true })
const Digest = z.string().regex(/^sha256:[a-f0-9]{64}$/)
const PositiveInteger = z.number().int().positive()

export const FABRIC_NODE_ROLES = [
  "COCKPIT",
  "ORCHESTRATOR_LOCAL_AI",
  "DURABLE_STATE_EVIDENCE",
  "GOVERNED_EXECUTION",
] as const

export const COMPUTE_ADMISSION_STATES = [
  "OBSERVED",
  "ADMITTED",
  "RESERVED",
  "DEGRADED",
  "UNAVAILABLE",
] as const

export const AcceleratorObservationSchema = z
  .object({
    uuid: Id,
    vendor: z.enum(["NVIDIA", "AMD", "INTEL", "OTHER"]),
    model: z.string().trim().min(1),
    memoryBytes: PositiveInteger,
    purpose: z.enum(["INFERENCE", "DISPLAY_UTILITY", "OPPORTUNISTIC", "UNADMITTED"]),
    admission: z.enum(COMPUTE_ADMISSION_STATES),
    runtimeCompatibility: z.array(Id),
    observedAt: Timestamp,
    evidenceRef: z.string().trim().min(1),
  })
  .strict()

export const FabricNodeSchema = z
  .object({
    id: Id,
    hostname: z.string().trim().min(1),
    role: z.enum(FABRIC_NODE_ROLES),
    requiredForOrchestration: z.boolean(),
    trustClass: z.enum(["SOVEREIGN_LOCAL", "ENROLLED_COCKPIT", "GOVERNED_WORKER"]),
    cpuLogicalCores: PositiveInteger,
    systemMemoryBytes: PositiveInteger,
    accelerators: z.array(AcceleratorObservationSchema),
    topologyObservedAt: Timestamp,
    topologyEvidenceRef: z.string().trim().min(1),
  })
  .strict()

export const FabricTopologySchema = z
  .object({
    schemaVersion: z.literal(1),
    topologyId: Id,
    nodes: z.array(FabricNodeSchema).length(4),
    observedAt: Timestamp,
    evidenceDigest: Digest,
  })
  .strict()
  .superRefine((topology, context) => {
    const ids = topology.nodes.map((node) => node.id)
    const hostnames = topology.nodes.map((node) => node.hostname.toLowerCase())
    const roles = topology.nodes.map((node) => node.role)
    const acceleratorUuids = topology.nodes.flatMap((node) =>
      node.accelerators.map((accelerator) => accelerator.uuid),
    )

    for (const [values, path, message] of [
      [ids, ["nodes"], "Fabric node ids must be unique"],
      [hostnames, ["nodes"], "Fabric hostnames must be unique"],
      [roles, ["nodes"], "Every canonical fabric role must occur exactly once"],
      [acceleratorUuids, ["nodes"], "Accelerator UUIDs must be unique across the fabric"],
    ] as const) {
      if (new Set(values).size !== values.length) {
        context.addIssue({ code: z.ZodIssueCode.custom, path: [...path], message })
      }
    }

    for (const role of FABRIC_NODE_ROLES) {
      if (!roles.includes(role)) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["nodes"],
          message: `Missing canonical fabric role: ${role}`,
        })
      }
    }

    const cockpit = topology.nodes.find((node) => node.role === "COCKPIT")
    if (cockpit?.requiredForOrchestration) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["nodes"],
        message: "OMEN/cockpit must never be an orchestration dependency",
      })
    }

    const orchestrators = topology.nodes.filter(
      (node) => node.role === "ORCHESTRATOR_LOCAL_AI" && node.requiredForOrchestration,
    )
    if (orchestrators.length !== 1) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["nodes"],
        message: "Exactly one HERMES orchestration authority is required",
      })
    }
  })

export const HardwareChangeEventSchema = z
  .object({
    id: Id,
    nodeId: Id,
    kind: z.enum(["ACCELERATOR_ADDED", "ACCELERATOR_REMOVED", "ACCELERATOR_CHANGED"]),
    acceleratorUuid: Id,
    previousObservationDigest: Digest.optional(),
    currentObservationDigest: Digest.optional(),
    detectedAt: Timestamp,
    evidenceRef: z.string().trim().min(1),
  })
  .strict()
  .superRefine((event, context) => {
    if (event.kind === "ACCELERATOR_ADDED" && event.previousObservationDigest) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["previousObservationDigest"],
        message: "Added hardware cannot claim a previous observation",
      })
    }
    if (event.kind === "ACCELERATOR_REMOVED" && event.currentObservationDigest) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["currentObservationDigest"],
        message: "Removed hardware cannot claim a current observation",
      })
    }
    if (
      event.kind === "ACCELERATOR_CHANGED" &&
      (!event.previousObservationDigest || !event.currentObservationDigest)
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["currentObservationDigest"],
        message: "Changed hardware requires previous and current observation digests",
      })
    }
  })

export type FabricTopology = z.infer<typeof FabricTopologySchema>
export type HardwareChangeEvent = z.infer<typeof HardwareChangeEventSchema>

export function topologyObservationIsFresh(
  observedAt: string,
  now: string,
  maximumAgeMs: number,
): boolean {
  if (!Number.isFinite(maximumAgeMs) || maximumAgeMs < 0) return false
  const observed = Date.parse(observedAt)
  const current = Date.parse(now)
  return Number.isFinite(observed) && Number.isFinite(current) && observed <= current &&
    current - observed <= maximumAgeMs
}

export function diffAccelerators(
  nodeId: string,
  previous: z.infer<typeof AcceleratorObservationSchema>[],
  current: z.infer<typeof AcceleratorObservationSchema>[],
  detectedAt: string,
  digestFor: (observation: z.infer<typeof AcceleratorObservationSchema>) => string,
): HardwareChangeEvent[] {
  const before = new Map(previous.map((item) => [item.uuid, item]))
  const after = new Map(current.map((item) => [item.uuid, item]))
  const uuids = [...new Set([...before.keys(), ...after.keys()])].sort()
  const events: HardwareChangeEvent[] = []

  for (const uuid of uuids) {
    const oldValue = before.get(uuid)
    const newValue = after.get(uuid)
    const oldDigest = oldValue ? digestFor(oldValue) : undefined
    const newDigest = newValue ? digestFor(newValue) : undefined
    if (oldDigest === newDigest) continue

    events.push(
      HardwareChangeEventSchema.parse({
        id: `hardware-change.${nodeId}.${uuid}.${events.length + 1}`,
        nodeId,
        kind: !oldValue
          ? "ACCELERATOR_ADDED"
          : !newValue
            ? "ACCELERATOR_REMOVED"
            : "ACCELERATOR_CHANGED",
        acceleratorUuid: uuid,
        previousObservationDigest: oldDigest,
        currentObservationDigest: newDigest,
        detectedAt,
        evidenceRef: `evidence://fabric/${nodeId}/hardware-change/${uuid}`,
      }),
    )
  }

  return events
}
