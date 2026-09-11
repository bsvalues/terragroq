import fs from "node:fs"

/**
 * IF-03 registry adoption loader.
 *
 * The adoption record (config/execution-fabric/model-runtime-adoption.json) is data; this loader is
 * what makes it real in the registry. It projects the recorded ModelArtifact / Runtime / capability
 * / policy-provenance into the registry's node model so the assembled registry can reconstruct the
 * exact model, runtime, and policy identity -- and it refuses to attach an adoption to a node the
 * registry does not know (unknown nodes are denied, never invented).
 */

export function adoptModelRuntime(seed, adoption) {
  if (!adoption || adoption.schema !== "williamos-if03-model-runtime-adoption/1") {
    throw new Error("IF03_ADOPTION_RECORD_INVALID")
  }
  const nodes = seed.nodes.map((node) => ({ ...node }))
  const byId = new Map(nodes.map((node) => [node.id, node]))
  const attached = []

  for (const runtime of adoption.runtimes ?? []) {
    // A runtime is adopted onto a node only when the policy provenance names that node as its host.
    // Local serving runtimes bind to their fabric machine. An EXTERNAL_API runtime is provider-managed:
    // it has no fabric machine host, so it attaches to the commissioning node's declared external
    // capability envelope (the same place an approved external envelope lives) — never an invented host.
    const hostId = runtime.id === "daedalus-hf-transformers" ? "daedalus"
      : runtime.id === "hermes-ollama" ? "hermes-node"
      : runtime.kind === "EXTERNAL_API" ? "hermes-node"
      : null
    if (!hostId || !byId.has(hostId)) throw new Error(`IF03_ADOPTION_UNKNOWN_NODE:${hostId ?? runtime.id}`)
    const node = byId.get(hostId)
    if (runtime.kind === "EXTERNAL_API") {
      // Provider-managed: record it as a declared external capability, not a local runtime, and never
      // mark it healthy without live qualification evidence.
      const externals = Array.isArray(node.externalCapabilities) ? [...node.externalCapabilities] : []
      if (!externals.some((r) => r.id === runtime.id)) {
        externals.push({ id: runtime.id, kind: runtime.kind, state: runtime.lifecycle === "HEALTHY" ? "healthy" : "declared-candidate", details: { version: runtime.version, buildIdentity: runtime.buildIdentity, endpointClass: runtime.endpointClass ?? "OPENAI_COMPATIBLE" } })
      }
      node.externalCapabilities = externals
      attached.push({ nodeId: hostId, runtimeId: runtime.id, external: true })
      continue
    }
    const runtimes = Array.isArray(node.runtimes) ? [...node.runtimes] : []
    if (!runtimes.some((r) => r.id === runtime.id)) {
      runtimes.push({ id: runtime.id, kind: runtime.kind, state: runtime.lifecycle === "HEALTHY" ? "healthy" : "unavailable", details: { version: runtime.version, buildIdentity: runtime.buildIdentity } })
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
    runtime: boundRuntime ? { id: boundRuntime.id, version: boundRuntime.details?.version } : null,
    policy: adoption.policyProvenance
      ? { status: adoption.policyProvenance.promotionStatus, digest: adoption.policyProvenance.policySha256 }
      : null,
  }
}
