import { describe, expect, it } from "vitest"

import { ModelIdentitySchema, RuntimeIdentitySchema } from "@/components/operator/intelligence-fabric-contracts"
import { SPECIALIST_CLASSES, isServiceable, registerSpecialist } from "../scripts/execution-fabric/multimodal.mjs"

const embeddingModel = {
  id: "bge-m3", family: "BGE", repository: "BAAI/bge-m3", source: "huggingface",
  revision: "b968826d9c46dd6066d109eabc6255188de91218", immutableIdentity: "BAAI/bge-m3@b968826d9c46dd6066d109eabc6255188de91218",
  architecture: "bert", modalities: ["EMBEDDING"], license: { id: "mit", evidenceRef: "hf://BAAI/bge-m3/LICENSE", commercialUse: "ALLOWED", redistribution: "ALLOWED" },
  quantization: { disclosure: "DISCLOSED", format: "fp16" }, context: { maxInputTokens: 8192, maxOutputTokens: 1, maxTotalTokens: 8193 },
  sourceTrust: "APPROVED", admission: "ACTIVE",
  admissionEvidence: {
    kind: "CAPABILITY_EVIDENCE_BINDING", modelImmutableIdentity: "BAAI/bge-m3@b968826d9c46dd6066d109eabc6255188de91218",
    capability: { id: "embeddings", version: "1" }, runtime: { id: "whisper-local", version: "1.0.0" },
    runtimeConfigurationDigest: "sha256:" + "b".repeat(64), computeClass: "NVIDIA_AMPERE_RTX3090_24GB",
    evaluationId: "eval-bge-001", verdict: "PROVEN", evidenceRef: "local://daedalus/evaluations/eval-bge-001.json",
    measuredAt: "2026-09-10T15:00:00Z", promotedBy: "agent.hermes.independent-review",
  },
  createdAt: "2026-09-10T15:00:00Z",
}
const sttRuntime = {
  id: "whisper-local", kind: "SPECIALIST", version: "1.0.0",
  artifact: { kind: "NATIVE_BINARY", binaryDigest: "sha256:" + "a".repeat(64) },
  endpointClass: "CLI", lifecycle: "HEALTHY", features: ["offline-inference"], observedAt: "2026-09-10T15:00:00Z",
}
const compute = { id: "daedalus", trustClass: "sovereign-local" }

describe("IF-09 multimodal foundation", () => {
  it("specialist services use the common model/runtime/compute/capability contracts", () => {
    expect(ModelIdentitySchema.safeParse(embeddingModel).success).toBe(true)
    expect(RuntimeIdentitySchema.safeParse(sttRuntime).success).toBe(true)
    const svc = registerSpecialist({ id: "embed-bge", specialistClass: "embeddings", model: embeddingModel, runtime: sttRuntime, compute })
    expect(svc.modality).toBe("EMBEDDING")
    expect(svc.model).toBe(embeddingModel)
    expect(svc.runtime).toBe(sttRuntime)
  })

  it("at least two specialist classes are available", () => {
    expect(Object.keys(SPECIALIST_CLASSES).length).toBeGreaterThanOrEqual(2)
    expect(SPECIALIST_CLASSES.embeddings.modality).toBe("EMBEDDING")
    expect(SPECIALIST_CLASSES.reranking.modality).toBe("RERANK")
  })

  it("specialist services do NOT require repository worker-lane semantics", () => {
    const svc = registerSpecialist({ id: "embed-bge", specialistClass: "embeddings", model: embeddingModel, runtime: sttRuntime, compute })
    expect(svc.workerLaneBinding).toBeNull()
    expect(svc.capabilities).not.toContain("implementation")
    expect(svc.capabilities).toHaveLength(0)
  })

  it("an unknown specialist class is refused", () => {
    expect(() => registerSpecialist({ id: "x", specialistClass: "magic", model: embeddingModel, runtime: sttRuntime, compute })).toThrow(/SPECIALIST_CLASS_UNKNOWN/)
  })

  it("an unproven modality is never treated as capable (fail-closed)", () => {
    const svc = registerSpecialist({ id: "embed-bge", specialistClass: "embeddings", model: embeddingModel, runtime: sttRuntime, compute })
    expect(isServiceable(svc, { modality: "EMBEDDING", dataClass: "S1" }).serviceable).toBe(false)
    expect(isServiceable(svc, { modality: "EMBEDDING", dataClass: "S1" }).reason).toBe("unproven-modality")
  })

  it("a specialist with in-scope modality evidence is serviceable for that modality only", () => {
    const svc = registerSpecialist({
      id: "embed-bge", specialistClass: "embeddings", model: embeddingModel, runtime: sttRuntime, compute,
      capabilityEvidence: { verdict: "PROVEN", modality: "EMBEDDING" },
    })
    expect(isServiceable(svc, { modality: "EMBEDDING", dataClass: "S1" }).serviceable).toBe(true)
    expect(isServiceable(svc, { modality: "RERANK", dataClass: "S1" }).serviceable).toBe(false) // wrong modality
  })

  it("modality-specific privacy/egress remains enforceable for sovereign data", () => {
    // embeddings is local-only, not sovereign-local: sovereign data cannot use it
    const svc = registerSpecialist({
      id: "embed-bge", specialistClass: "embeddings", model: embeddingModel, runtime: sttRuntime, compute,
      capabilityEvidence: { verdict: "PROVEN", modality: "EMBEDDING" },
    })
    expect(isServiceable(svc, { modality: "EMBEDDING", dataClass: "S4" }).serviceable).toBe(false)
    expect(isServiceable(svc, { modality: "EMBEDDING", dataClass: "S4" }).reason).toBe("egress-violation")
    expect(isServiceable(svc, { modality: "EMBEDDING", dataClass: "S1" }).serviceable).toBe(true) // public data ok
  })

  it("a sovereign-local modality (speech-to-text) can serve sovereign data", () => {
    const svc = registerSpecialist({
      id: "stt-whisper", specialistClass: "speech-to-text", model: embeddingModel, runtime: sttRuntime, compute,
      capabilityEvidence: { verdict: "PROVEN", modality: "AUDIO" },
    })
    expect(isServiceable(svc, { modality: "AUDIO", dataClass: "S4" }).serviceable).toBe(true)
  })
})
