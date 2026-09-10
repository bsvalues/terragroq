/**
 * IF-09 — Multimodal foundation.
 *
 * Proves the Fabric is intelligence-modal, not LLM-only. A specialist service (embeddings,
 * reranking, vision/document, speech-to-text, text-to-speech) is registered on the SAME common
 * model/runtime/compute/capability contracts as the chat path — but it is NOT a repository worker
 * lane: it carries no implementation capability, no patch/PR semantics, no Work Order lane binding.
 * Modality-specific privacy/egress stays enforceable: each modality declares its own egress class
 * and the registry refuses to mark a modality serviceable without in-scope evidence for THAT
 * modality.
 */

// The specialist classes the plan names. Each maps to the common modality enum.
export const SPECIALIST_CLASSES = Object.freeze({
  embeddings: { modality: "EMBEDDING", egressClass: "local-only" },
  reranking: { modality: "RERANK", egressClass: "local-only" },
  "vision-document": { modality: "DOCUMENT", egressClass: "sovereign-local" },
  "speech-to-text": { modality: "AUDIO", egressClass: "sovereign-local" },
  "text-to-speech": { modality: "AUDIO", egressClass: "local-only" },
})

/**
 * Register a specialist service on the common contracts. The service is explicitly NOT a worker
 * lane: workerLaneBinding is null and capabilities never include "implementation".
 *
 * service: { id, specialistClass, model, runtime, compute, capabilityEvidence? }
 */
export function registerSpecialist(service) {
  const spec = SPECIALIST_CLASSES[service.specialistClass]
  if (!spec) throw new Error(`SPECIALIST_CLASS_UNKNOWN:${service.specialistClass}`)
  return {
    id: service.id,
    specialistClass: service.specialistClass,
    modality: spec.modality,
    egressClass: spec.egressClass,
    model: service.model,
    runtime: service.runtime,
    compute: service.compute,
    capabilityEvidence: service.capabilityEvidence ?? null,
    // A specialist is intelligence, not a repository worker: no worker-lane binding, no
    // implementation capability, no patch/PR semantics.
    workerLaneBinding: null,
    capabilities: [],
  }
}

/**
 * Is a specialist serviceable for a requested modality? Fail-closed: it must (a) be the right
 * modality, (b) have in-scope MEASURED/PROVEN evidence for THAT modality, and (c) satisfy the
 * modality's egress constraint against the requirement's data class. An unproven modality is never
 * treated as capable.
 */
export function isServiceable(service, { modality, dataClass }) {
  if (service.modality !== modality) return { serviceable: false, reason: "modality-mismatch" }
  const ev = service.capabilityEvidence
  if (!ev || !["MEASURED", "PROVEN"].includes(ev.verdict) || ev.modality !== modality) {
    return { serviceable: false, reason: "unproven-modality" }
  }
  // Modality-specific privacy/egress: sovereign data (S3/S4) can only use a sovereign-local egress
  // class for that modality.
  if (["S3", "S4"].includes(dataClass) && service.egressClass !== "sovereign-local") {
    return { serviceable: false, reason: "egress-violation" }
  }
  return { serviceable: true, reason: null }
}
