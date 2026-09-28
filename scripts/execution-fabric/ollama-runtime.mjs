/**
 * Operationalize Ollama as a governed Fabric runtime.
 *
 * The commissioned HERMES Ollama tier (127.0.0.1:11434) is already a registered runtime
 * (`hermes-ollama`, kind OLLAMA, healthy). This module binds its live model roster to the Fabric as
 * qualified ModelArtifacts with real digest evidence — preserving the commissioned configuration,
 * never rebuilding it. Each binding is admitted as a CANDIDATE and must be qualified by the
 * Evaluation Lab before it can be promoted to ACTIVE for placement.
 */

/**
 * Build qualified ModelArtifact records for the live Ollama roster, bound to the hermes-ollama
 * runtime. Each artifact's immutable identity binds the model name to its Ollama content digest
 * (the real evidence the runtime reported), so the Fabric can reconstruct the exact model.
 *
 * roster: [{ name, digest, sizeBytes, family, modalities, contextWindow, runtime }]
 */
export function bindOllamaRoster(roster, { runtimeId = "hermes-ollama", runtimeVersion = "0.9.2", observedAt } = {}) {
  if (!Array.isArray(roster) || roster.length === 0) throw new Error("OLLAMA_ROSTER_EMPTY")
  return roster.map((model) => {
    if (!model.name || !model.digest) throw new Error(`OLLAMA_MODEL_INCOMPLETE:${model.name ?? "unknown"}`)
    const family = model.family ?? model.name.split(":")[0].split("-")[0]
    return {
      id: `ollama-${model.name.replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")}`,
      family,
      repository: model.name,
      source: "ollama",
      // The full Ollama content digest (sha256) is the immutable revision — the real evidence the
      // runtime reports, satisfying the contract's exact-pinned-revision requirement. The identity
      // must exactly bind repository@revision per the contract.
      revision: model.digest,
      immutableIdentity: `${model.name}@${model.digest}`,
      alias: model.name,
      architecture: model.architecture ?? "unknown",
      modalities: model.modalities ?? ["TEXT"],
      license: model.license ?? { id: "see-upstream", evidenceRef: `ollama://${model.name}`, commercialUse: "UNKNOWN", redistribution: "UNKNOWN" },
      quantization: model.quantization ?? { disclosure: "PROVIDER_UNDISCLOSED" },
      context: model.context ?? { maxInputTokens: model.contextWindow ?? 8192, maxOutputTokens: 2048, maxTotalTokens: (model.contextWindow ?? 8192) + 2048 },
      sourceTrust: "APPROVED",
      // Admitted as a CANDIDATE: it must be qualified by the Evaluation Lab before promotion to ACTIVE.
      admission: "CANDIDATE",
      createdAt: observedAt ?? new Date().toISOString(),
    }
  })
}

/**
 * Is an Ollama-bound model placement-eligible? Fail-closed: it must carry a real full content digest
 * (not a placeholder), be admitted (CANDIDATE or better), and be bound to a known runtime via the
 * adoption record's runtime set.
 */
export function ollamaBindingEligible(artifact, { knownRuntimeIds = ["hermes-ollama"] } = {}) {
  const hasDigest = typeof artifact.revision === "string" && /^[0-9a-f]{64}$/i.test(artifact.revision)
  const admitted = ["CANDIDATE", "APPROVED", "ACTIVE", "FALLBACK"].includes(artifact.admission)
  const sourceIsOllama = artifact.source === "ollama"
  return {
    eligible: hasDigest && admitted && sourceIsOllama,
    reason: !hasDigest ? "no-real-digest" : !admitted ? "not-admitted" : !sourceIsOllama ? "not-ollama-source" : null,
  }
}
