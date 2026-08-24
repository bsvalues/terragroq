import {
  canonicalNodeIdForHostname,
  type NodeIdentityContract,
} from "./node-identity-contract.ts"

/**
 * A canonical, read-only projection of the two object kinds Gate 1 covers: `NODE` and `ACCELERATOR`.
 *
 * This is a PROJECTION over truth that already exists. It is not an authority, not a second
 * inventory, not a second observer, and it exposes nothing that mutates. Everything it returns is
 * frozen, and every value it cannot establish says `unknown` rather than picking a number that reads
 * like a measurement.
 *
 * Two registries feed it, and they are not the same registry:
 *
 *   Fabric inventory (`config/execution-fabric/registry.seed.json` -> assembled snapshot)
 *       identity, hardware, owner-directed role, authority, evidence freshness
 *   transport registry (`~/.williamos/fabric/nodes.json`)
 *       transport, host, user, os, operational role label, enrolment
 *
 * The transport record carries no machine pin and no timestamp -- `{ transport, host, user, os, role,
 * enrolled }` is the whole of it. So a transport record cannot be joined by identity before probing.
 * It selects a PROVISIONAL ENDPOINT; the canonical probe observes the host identity; and only a match
 * against the reviewed inventory pin promotes that endpoint to a canonical node. Promotion is an
 * observation result, never a lookup.
 *
 * The asymmetry is deliberate. An inventory-only node projects with transport `unknown`. A
 * transport-only record does NOT project as a canonical object -- the symmetric rule would promote
 * any line someone added to a local JSON file into a node of this lab.
 */

export type SystemObjectKind = "NODE" | "ACCELERATOR"

/**
 * `stale` is a distinct state from `unknown` on purpose: "we measured this, and the measurement has
 * aged out" and "we have no measurement" are different claims, and collapsing them is how a stale
 * reading gets presented as a live one.
 */
export type ObjectTruthState = "live" | "stale" | "unknown"

/** Why a value is not a measurement. Always carried, never inferred by the reader. */
export interface UnknownReason {
  state: "unknown"
  reason: string
  /**
   * A number that is provably <= the real value but is NOT the value. Present only for the Windows
   * `Win32_VideoController` fallback, which understates VRAM above 4 GiB. It exists so the
   * observation is not thrown away, and it is never capacity and never headroom.
   */
  lowerBoundBytes?: number
}

export interface MeasuredBytes {
  state: "measured"
  bytes: number
  source: string
}

export type ByteValue = MeasuredBytes | UnknownReason

/**
 * Accelerator identity is a UUID or a PCI bus id, never a friendly name and never a slot index.
 *
 * `identity-unresolved` is not a formality. The shipped Windows CIM fallback emits
 * `uuid: null, pci_bus_id: null`, and the declared HERMES GPUs in the seed do too. A UUID/PCI-only
 * rule cannot represent either, so they would have to be dropped or keyed on something weaker --
 * both worse than saying so. An unresolved object is visible and truthful, and is explicitly
 * ineligible to inherit or accumulate canonical history.
 */
export type AcceleratorIdentity =
  | { resolved: true; kind: "uuid" | "pci-bus-id"; value: string }
  | { resolved: false; state: "identity-unresolved"; reason: string; inheritsHistory: false }

export interface AcceleratorObject {
  kind: "ACCELERATOR"
  /** Stable object key. For unresolved identity it is scoped to the node and never reused as a pin. */
  objectId: string
  nodeId: string
  identity: AcceleratorIdentity
  vendor: string
  model: string
  truthState: ObjectTruthState
  memory: {
    /** Total VRAM. Never presented as reservable or free capacity -- see `headroom`. */
    total: ByteValue
    used: ByteValue
    /** Free VRAM. `unknown` unless BOTH total and used are measured. Never total-minus-nothing. */
    headroom: ByteValue
  }
  /** Capability is bench evidence only. Gate 1a can never produce it, so it is always `UNKNOWN` here. */
  capability: "UNKNOWN"
  annotations: readonly string[]
}

export type TransportProjection =
  | { state: "unknown"; reason: string }
  | {
      state: "present"
      transport: string | null
      host: string | null
      user: string | null
      enrolled: boolean | null
      /**
       * The transport registry's `role` is an operational label. It never overrides the inventory's
       * owner-directed role. When the two disagree both project and this side is marked
       * `CONFLICTING` -- NOT `stale`, because that record carries no timestamp to support a temporal
       * claim.
       */
      role: string | null
      roleAgreement: "AGREES" | "CONFLICTING" | "UNKNOWN"
    }

export interface NodeObject {
  kind: "NODE"
  objectId: string
  nodeId: string
  /** Owner-directed role, from the Fabric inventory. The transport label never replaces it. */
  role: string
  hostname: string
  truthState: ObjectTruthState
  /** Preserved verbatim when a node is unreachable or its identity did not match the reviewed pin. */
  reason: string | null
  observedAt: string | null
  /** Enumerable without parsing any presentation string. */
  accelerators: readonly AcceleratorObject[]
  transport: TransportProjection
  promotion: {
    /** Promotion is an observation result: an observed identity matched the reviewed inventory pin. */
    promoted: boolean
    reason: string
  }
}

export type SystemObject = NodeObject | AcceleratorObject

/**
 * A transport record that named an endpoint no reviewed pin claims.
 *
 * It is neither promoted nor dropped. Dropping it hides a machine someone enrolled; promoting it
 * would let a local file mint a node.
 */
export interface UnverifiedEndpointCandidate {
  kind: "UNVERIFIED_ENDPOINT_CANDIDATE"
  endpoint: string
  transport: string | null
  host: string | null
  reason: string
}

export interface SystemObjectGraph {
  objects: readonly SystemObject[]
  unverifiedEndpointCandidates: readonly UnverifiedEndpointCandidate[]
}

export interface InventoryGpu {
  id: string
  vendor?: string | null
  model?: string | null
  uuid?: string | null
  pci_bus_id?: string | null
  vram_bytes?: number | null
  vram_used_bytes?: number | null
  vram_source?: "nvidia-smi" | "win32-videocontroller" | null
}

export interface InventoryNode {
  id: string
  identity?: { hostname?: string | null; machine_id_sha256?: string | null } | null
  role?: string | null
  gpus?: InventoryGpu[] | null
  evidence?: { observed_at?: string | null; confidence?: string | null; ttl_seconds?: number | null } | null
}

export interface TransportRecord {
  transport?: string | null
  host?: string | null
  user?: string | null
  os?: string | null
  role?: string | null
  enrolled?: boolean | null
}

/** What the brokered canonical probe measured for one endpoint, this request. */
export interface EndpointObservation {
  reachable: boolean
  /** Preserved verbatim. "unreachable" alone sends the reader looking in the wrong place. */
  detail?: string | null
  observedIdentity?: { hostname?: string | null; machine_id_sha256?: string | null } | null
  observedAt?: string | null
}

export interface ProjectionInput {
  inventory: readonly InventoryNode[]
  /** Keyed by transport-registry name. Neither registry owns reachability; it is measured per request. */
  transport?: Record<string, TransportRecord>
  observations?: Record<string, EndpointObservation>
  contract: NodeIdentityContract
  nowMs?: number
  defaultFreshnessSeconds?: number
}

const DEFAULT_FRESHNESS_SECONDS = 300

function frozen<T>(value: T): T {
  return Object.freeze(value)
}

function unknownBytes(reason: string, lowerBoundBytes?: number): UnknownReason {
  // `lowerBoundBytes` is only ever attached where a real observation exists but is not a measurement.
  return lowerBoundBytes === undefined
    ? frozen({ state: "unknown" as const, reason })
    : frozen({ state: "unknown" as const, reason, lowerBoundBytes })
}

/**
 * Total VRAM, by source.
 *
 * `nvidia-smi` measures it. `win32-videocontroller` does not: `AdapterRAM` understates VRAM above
 * 4 GiB, so it is a qualified LOWER BOUND -- never capacity, never headroom, never compared against a
 * model requirement. Absent source is `unknown`, and `unknown` is never rendered as 0.
 */
function projectTotalVram(gpu: InventoryGpu): ByteValue {
  const bytes = gpu.vram_bytes
  if (gpu.vram_source === "nvidia-smi") {
    return typeof bytes === "number"
      ? frozen({ state: "measured" as const, bytes, source: "nvidia-smi" })
      : unknownBytes("nvidia-smi reported no total VRAM")
  }
  if (gpu.vram_source === "win32-videocontroller") {
    return typeof bytes === "number"
      ? unknownBytes(
          "Win32_VideoController AdapterRAM is a qualified lower bound, not a measurement of VRAM",
          bytes,
        )
      : unknownBytes("Win32_VideoController reported no AdapterRAM")
  }
  return unknownBytes("no vram_source: this record is declared, not observed")
}

function projectUsedVram(gpu: InventoryGpu): ByteValue {
  if (gpu.vram_source !== "nvidia-smi") {
    return unknownBytes("used VRAM is only measured by nvidia-smi")
  }
  return typeof gpu.vram_used_bytes === "number"
    ? frozen({ state: "measured" as const, bytes: gpu.vram_used_bytes, source: "nvidia-smi" })
    : unknownBytes("nvidia-smi reported no used VRAM")
}

/**
 * Headroom exists only when both sides of the subtraction were measured.
 *
 * Total VRAM is not free VRAM. Treating an absent `used` as zero is exactly how a full accelerator
 * gets scheduled as an empty one.
 */
function projectHeadroom(total: ByteValue, used: ByteValue): ByteValue {
  if (total.state !== "measured") return unknownBytes("headroom needs a measured total")
  if (used.state !== "measured") return unknownBytes("headroom needs a measured used VRAM")
  return frozen({ state: "measured" as const, bytes: Math.max(0, total.bytes - used.bytes), source: total.source })
}

function projectAcceleratorIdentity(gpu: InventoryGpu): AcceleratorIdentity {
  const uuid = String(gpu.uuid ?? "").trim()
  if (uuid) return frozen({ resolved: true as const, kind: "uuid" as const, value: uuid })
  const pci = String(gpu.pci_bus_id ?? "").trim()
  if (pci) return frozen({ resolved: true as const, kind: "pci-bus-id" as const, value: pci })
  return frozen({
    resolved: false as const,
    state: "identity-unresolved" as const,
    reason: "no GPU UUID and no PCI bus id: friendly name and slot are not identity",
    inheritsHistory: false as const,
  })
}

function evidenceAgeSeconds(node: InventoryNode, nowMs: number): number | null {
  const observedAt = node.evidence?.observed_at
  if (!observedAt) return null
  const parsed = Date.parse(observedAt)
  if (!Number.isFinite(parsed)) return null
  return (nowMs - parsed) / 1000
}

function projectAccelerators(node: InventoryNode, truthState: ObjectTruthState): AcceleratorObject[] {
  return (node.gpus ?? []).map((gpu) => {
    const identity = projectAcceleratorIdentity(gpu)
    const total = projectTotalVram(gpu)
    const used = projectUsedVram(gpu)
    const annotations: string[] = []
    if (total.state === "unknown" && total.lowerBoundBytes !== undefined) {
      annotations.push("VRAM_LOWER_BOUND_ONLY")
    }
    if (!identity.resolved) annotations.push("IDENTITY_UNRESOLVED")
    return frozen({
      kind: "ACCELERATOR" as const,
      // A new UUID in the same slot is a NEW object, so the key is the identity -- never the slot.
      objectId: identity.resolved
        ? `accelerator:${identity.kind}:${identity.value}`
        : `accelerator:identity-unresolved:${node.id}:${gpu.id}`,
      nodeId: node.id,
      identity,
      vendor: String(gpu.vendor ?? "unknown"),
      model: String(gpu.model ?? "unknown"),
      truthState,
      memory: frozen({ total, used, headroom: projectHeadroom(total, used) }),
      capability: "UNKNOWN" as const,
      annotations: frozen(annotations),
    })
  })
}

function projectTransport(
  record: TransportRecord | undefined,
  ownerDirectedRole: string,
): TransportProjection {
  if (!record) {
    return frozen({ state: "unknown" as const, reason: "no transport record names this node" })
  }
  const role = record.role ?? null
  const roleAgreement = role === null
    ? ("UNKNOWN" as const)
    : role === ownerDirectedRole
      ? ("AGREES" as const)
      : ("CONFLICTING" as const)
  return frozen({
    state: "present" as const,
    transport: record.transport ?? null,
    host: record.host ?? null,
    user: record.user ?? null,
    enrolled: record.enrolled ?? null,
    role,
    roleAgreement,
  })
}

/**
 * Project the canonical `NODE`/`ACCELERATOR` graph.
 *
 * Read-only by construction: it takes data and returns frozen objects. There is deliberately no
 * inverse, no writer, and no authority anywhere in the result.
 */
export function projectSystemObjects(input: ProjectionInput): SystemObjectGraph {
  const nowMs = input.nowMs ?? Date.now()
  const transport = input.transport ?? {}
  const observations = input.observations ?? {}
  const defaultFreshness = input.defaultFreshnessSeconds ?? DEFAULT_FRESHNESS_SECONDS

  // Which transport endpoint, if any, corresponds to each inventory node. The transport record has no
  // machine pin, so this is a PROVISIONAL binding by name -- it selects an endpoint, nothing more.
  const endpointForNode = new Map<string, string>()
  for (const [endpoint, record] of Object.entries(transport)) {
    const byContract = canonicalNodeIdForHostname(input.contract, endpoint)
      ?? canonicalNodeIdForHostname(input.contract, record.host)
    if (byContract && !endpointForNode.has(byContract)) endpointForNode.set(byContract, endpoint)
  }

  const objects: SystemObject[] = []

  for (const node of input.inventory) {
    const endpoint = endpointForNode.get(node.id)
    const observation = endpoint === undefined ? undefined : observations[endpoint]
    const ownerDirectedRole = String(node.role ?? "unknown")
    const ageSeconds = evidenceAgeSeconds(node, nowMs)
    const ttlSeconds = node.evidence?.ttl_seconds ?? defaultFreshness

    let truthState: ObjectTruthState = "unknown"
    let reason: string | null = null
    let promoted = false
    let promotionReason = "no observation: promotion requires an observed identity"

    if (observation && observation.reachable === false) {
      // Unreachable still projects. The reason is preserved, because "unreachable" alone sends the
      // reader looking in the wrong place while "permission denied" points somewhere specific.
      truthState = "unknown"
      reason = observation.detail ?? "unreachable"
      promotionReason = "endpoint unreachable: nothing was observed to compare against the pin"
    } else if (observation) {
      const pinned = node.identity?.machine_id_sha256 ?? null
      const observed = observation.observedIdentity?.machine_id_sha256 ?? null
      if (pinned && observed && pinned === observed) {
        promoted = true
        promotionReason = "observed machine identity matched the reviewed inventory pin"
      } else {
        // Not a reachability failure, and it must never be reported as one. The endpoint answered;
        // it just is not the machine the reviewed pin names.
        promoted = false
        promotionReason = "observed machine identity did not match the reviewed inventory pin"
        reason = `identity mismatch: pinned=${pinned ?? "none"} observed=${observed ?? "none"}`
      }
    }

    if (promoted || (observation === undefined && ageSeconds !== null)) {
      // Freshness is a claim about a MEASUREMENT, so it is only asked once the record is one.
      //
      // `confidence` is checked before the arithmetic and not after it, because a declared record
      // carries a perfectly well-formed `observed_at` -- the seed's is `2026-08-09T21:57:00Z`. Age it
      // against a non-zero ttl and a record that was never probed reports `live`. It is not `stale`
      // either: staleness says a measurement aged out, and this one was never taken.
      if (node.evidence?.confidence !== "observed") {
        truthState = "unknown"
        reason = reason ?? "declared evidence: no live observation has been recorded for this node"
      } else if (ageSeconds === null) {
        truthState = "unknown"
        reason = reason ?? "no evidence timestamp"
      } else if (ageSeconds > ttlSeconds) {
        // A probe past its bound is `stale`, never `live`.
        truthState = "stale"
        reason = reason ?? `evidence age ${Math.round(ageSeconds)}s exceeds ttl ${ttlSeconds}s`
      } else {
        truthState = "live"
      }
    }

    const accelerators = projectAccelerators(node, truthState)
    objects.push(
      frozen({
        kind: "NODE" as const,
        objectId: `node:${node.id}`,
        nodeId: node.id,
        role: ownerDirectedRole,
        hostname: String(node.identity?.hostname ?? ""),
        truthState,
        reason,
        observedAt: node.evidence?.observed_at ?? null,
        accelerators: frozen(accelerators),
        transport: projectTransport(endpoint === undefined ? undefined : transport[endpoint], ownerDirectedRole),
        promotion: frozen({ promoted, reason: promotionReason }),
      }),
    )
    for (const accelerator of accelerators) objects.push(accelerator)
  }

  // Transport records that bound to no inventory node. Never fabricate the missing half, never
  // silently drop the record -- and never promote it.
  const boundEndpoints = new Set(endpointForNode.values())
  const unverifiedEndpointCandidates: UnverifiedEndpointCandidate[] = []
  for (const [endpoint, record] of Object.entries(transport)) {
    if (boundEndpoints.has(endpoint)) continue
    unverifiedEndpointCandidates.push(
      frozen({
        kind: "UNVERIFIED_ENDPOINT_CANDIDATE" as const,
        endpoint,
        transport: record.transport ?? null,
        host: record.host ?? null,
        reason:
          "no reviewed inventory pin names this endpoint: promotion requires an observed identity matching a pin",
      }),
    )
  }

  return frozen({
    objects: frozen(objects),
    unverifiedEndpointCandidates: frozen(unverifiedEndpointCandidates),
  })
}
