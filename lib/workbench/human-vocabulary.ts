/**
 * Owner-facing infrastructure-vocabulary guard (IF-12).
 *
 * The WilliamOS Environment should make the Intelligence Fabric disappear in normal use: the owner
 * sees "Working on it" / "Done" / "needs attention", never model/provider/GPU/runtime/placement
 * terms. This guard neutralizes that vocabulary in owner-facing human text. Drilldown/raw technical
 * surfaces (the optional Technical/Execution projection) intentionally do NOT use this — provenance
 * is allowed to name the machinery when the owner explicitly opens it.
 */

const INFRA_VOCAB = /\b(qwen|kimi|llm|large language model|provider|gpu|vram|ollama|transformers|runtime|daedalus|omen|aegis|atlas|hermes|codex|claude|vllm|llama\.cpp|inference|tokenizer|placement|fabric|worker lane|hypervisor|accelerator)\b/i

/** True when a human-facing string leaks Intelligence Fabric / infrastructure vocabulary. */
export function leaksInfrastructureVocabulary(value: string): boolean {
  return INFRA_VOCAB.test(value)
}

/**
 * Neutralize an owner-facing human message. A message that leaks infrastructure vocabulary is
 * replaced with the fallback; a clean human message passes through unchanged. Use this on any text
 * the owner sees in the normal (required) path.
 */
export function humanMessage(value: unknown, fallback: string): string {
  const candidate = typeof value === "string" && value.trim() ? value : fallback
  return leaksInfrastructureVocabulary(candidate) ? fallback : candidate
}
