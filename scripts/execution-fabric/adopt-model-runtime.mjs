import fs from "node:fs"

/**
 * IF-03 registry adoption loader.
 *
 * The adoption record (config/execution-fabric/model-runtime-adoption.json) is data; this loader is
 * what makes it real in the registry. It projects the recorded ModelArtifact / Runtime / capability
 * / policy-provenance into the registry's node model so the assembled registry can reconstruct the
 * exact model, runtime, and policy identity -- and it refuses to attach an adoption to a node the
 * registry does not know (unknown nodes are denied, never invented).
 *
 * The production registry entrypoint (assemble-registry.mjs) consumes this loader, so adopted
 * runtimes and their bound model inventory are part of the registry the placement engine reads.
 */

function assertAdoptionRecord(adoption) {
  if (!adoption || adoption.schema !== "williamos-if03-model-runtime-adoption/1") {
    throw new Error("IF03_ADOPTION_RECORD_INVALID")
  }
}

/** The host node a runtime is published onto, or null. Publications are the only source of that fact. */
export function publishedHostNodeId(adoption, runtimeId) {
  const publication = (adoption.runtimePublications ?? []).find((entry) => entry.runtimeId === runtimeId)
  return publication ? publication.hostNodeId : null
}

/**
 * Project the publications bound to one host node into registry-legal runtime entries.
 *
 * `state` is always "unknown": the record's lifecycle is a commissioning observation, not live
 * evidence, so an adopted runtime must never be presented as live-capable by the record alone. The
 * assembly keeps a live probe's state when the probe reports the same runtime kind.
 */
export function registryRuntimePublications(adoption, hostNodeId) {
  assertAdoptionRecord(adoption)
  const runtimesById = new Map((adoption.runtimes ?? []).map((runtime) => [runtime.id, runtime]))
  const artifactsById = new Map((adoption.modelArtifacts ?? []).map((artifact) => [artifact.id, artifact]))
  return (adoption.runtimePublications ?? [])
    .filter((publication) => publication.hostNodeId === hostNodeId)
    .map((publication) => {
      const runtime = runtimesById.get(publication.runtimeId)
      if (!runtime) throw new Error(`IF03_PUBLICATION_UNKNOWN_RUNTIME:${publication.runtimeId}`)
      if (typeof publication.registryKind !== "string" || publication.registryKind.trim() === "") {
        throw new Error(`IF03_PUBLICATION_MISSING_REGISTRY_KIND:${publication.runtimeId}`)
      }
      const models = (publication.modelArtifactIds ?? []).map((id) => {
        const artifact = artifactsById.get(id)
        if (!artifact) throw new Error(`IF03_PUBLICATION_UNKNOWN_ARTIFACT:${id}`)
        return artifact.repository
      })
      return {
        id: runtime.id,
        kind: publication.registryKind,
        version: runtime.version ?? null,
        state: "unknown",
        ...(models.length > 0 ? { details: { models: [...new Set(models)].sort() } } : {}),
      }
    })
}

/**
 * Merge published (adopted) runtimes into the runtimes a live probe reported for one node.
 *
 * Truth rule: the live probe owns existence, state and its own model inventory. The record may only
 * add model inventory the probe did not report, and it says so in a warning — the assembled registry
 * never presents a reviewed record as a live observation.
 */
export function mergePublishedRuntimes(probedRuntimes, publications, warnings) {
  const result = (probedRuntimes ?? []).map((runtime) => ({ ...runtime }))
  for (const publication of publications ?? []) {
    const index = result.findIndex((runtime) => String(runtime.kind ?? "").toLowerCase() === String(publication.kind).toLowerCase())
    if (index < 0) {
      warnings.push(`ADOPTED_RUNTIME_NOT_LIVE_OBSERVED ${publication.id} state=unknown (not selectable until a live probe reports it)`)
      result.push({ ...publication })
      continue
    }
    const live = result[index]
    const liveModels = Array.isArray(live.details?.models) ? live.details.models : null
    if (liveModels === null || liveModels.length === 0) {
      const adoptedModels = publication.details?.models ?? []
      if (adoptedModels.length > 0) {
        warnings.push(`MODEL_INVENTORY_FROM_ADOPTION_RECORD ${publication.id} (the live probe reported no model inventory)`)
        result[index] = { ...live, details: { ...(live.details ?? {}), models: [...new Set(adoptedModels)].sort() } }
      }
    }
  }
  return result
}

export function adoptModelRuntime(seed, adoption) {
  assertAdoptionRecord(adoption)
  const nodes = seed.nodes.map((node) => ({ ...node }))
  const byId = new Map(nodes.map((node) => [node.id, node]))
  const attached = []

  for (const runtime of adoption.runtimes ?? []) {
    // A runtime is adopted onto a node only when its publication names that node as its host. An
    // unnamed or unknown host is denied, never invented.
    const hostId = publishedHostNodeId(adoption, runtime.id)
    if (!hostId) throw new Error(`IF03_ADOPTION_UNKNOWN_NODE:${runtime.id}`)
    if (!byId.has(hostId)) throw new Error(`IF03_ADOPTION_UNKNOWN_NODE:${hostId}`)
    const node = byId.get(hostId)
    const runtimes = Array.isArray(node.runtimes) ? [...node.runtimes] : []
    if (!runtimes.some((entry) => entry.id === runtime.id)) {
      // Registry-legal entry: `version` is a runtime field (never a details key) and the state is
      // never "healthy" from the record alone.
      const published = registryRuntimePublications(adoption, hostId).find((entry) => entry.id === runtime.id)
      runtimes.push(published ?? { id: runtime.id, kind: runtime.kind, version: runtime.version ?? null, state: "unknown" })
    }
    node.runtimes = runtimes
    attached.push({ nodeId: hostId, runtimeId: runtime.id })
  }

  return {
    ...seed,
    nodes,
    modelRuntimeAdoption: {
      schema: adoption.schema,
      recordedAt: adoption.recordedAt,
      modelArtifacts: adoption.modelArtifacts ?? [],
      runtimeCapabilities: adoption.runtimeCapabilities ?? [],
      policyProvenance: adoption.policyProvenance ?? null,
      attached,
    },
  }
}

export function loadAdoption(path = "config/execution-fabric/model-runtime-adoption.json") {
  return JSON.parse(fs.readFileSync(path, "utf8"))
}

/** Reconstruct the exact model/runtime/policy identity the registry now carries. */
export function reconstructIdentity(registry) {
  const adoption = registry.modelRuntimeAdoption
  if (!adoption) return null
  const artifact = (adoption.modelArtifacts ?? [])[0]
  if (!artifact) return null
  const boundRuntimeId = artifact.admissionEvidence?.runtime?.id
  const boundRuntime = (registry.nodes ?? [])
    .flatMap((node) => node.runtimes ?? [])
    .find((r) => r.id === boundRuntimeId) ?? null
  return {
    model: artifact.immutableIdentity,
    runtime: boundRuntime ? { id: boundRuntime.id, version: boundRuntime.version ?? boundRuntime.details?.version } : null,
    policy: adoption.policyProvenance
      ? { status: adoption.policyProvenance.promotionStatus, digest: adoption.policyProvenance.policySha256 }
      : null,
  }
}
