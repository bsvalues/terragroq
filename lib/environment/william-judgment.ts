import {
  validateWilliamJudgment,
  type WilliamJudgment,
  type WorkingWorldSnapshot,
} from "@/lib/environment/working-world"

export type WilliamSafetyFact = Readonly<{
  key: string
  label: string
  value: string
  source: "deterministic"
}>

type JudgmentDependencies = Readonly<{
  baseUrl: string
  model: string
  fetchImpl?: typeof fetch
  now?: () => string
  apiKey?: string | null
}>

function fact(key: string, label: string, value: string): WilliamSafetyFact {
  return { key, label, value, source: "deterministic" }
}

/** Facts computed from persisted state, kept separate from William's inference-authored opinion. */
export function deriveWilliamSafetyFacts(world: WorkingWorldSnapshot): readonly WilliamSafetyFact[] {
  const facts: WilliamSafetyFact[] = [
    fact("intent", "Current intent", world.intent),
    fact("project", "Project", world.spine.projectName ?? "not bound"),
    fact("execution", "Execution", world.spine.execution),
  ]
  const activePane = world.space?.panes.find((pane) => pane.id === world.space?.activePaneId)
  facts.push(fact("active-file", "Active file", activePane?.filePath ?? "none selected"))
  facts.push(fact("preview", "Developer preview", world.space?.runningAppUrl ? "attached" : "not attached"))
  if (world.lastGreenValidation) {
    facts.push(fact(
      "last-green-validation",
      "Last green validation",
      `${world.lastGreenValidation.ref} at ${world.lastGreenValidation.at}`,
    ))
  }
  if (world.lastRedValidation) {
    facts.push(fact(
      "last-red-validation",
      "Last red validation",
      `${world.lastRedValidation.ref} at ${world.lastRedValidation.at}`,
    ))
  }
  if (world.openConcerns.length > 0) {
    facts.push(fact("open-concerns", "Open concerns", world.openConcerns.slice(0, 5).join(" | ")))
  }
  if (world.unresolvedFailures.length > 0) {
    facts.push(fact("unresolved-failures", "Unresolved failures", world.unresolvedFailures.slice(0, 5).join(" | ")))
  }
  return facts
}

export function williamJudgmentBasisFingerprint(world: WorkingWorldSnapshot): string {
  return createHash("sha256").update(JSON.stringify(deriveWilliamSafetyFacts(world))).digest("hex")
}

function boundedModelString(value: unknown, error: string, max: number): string {
  if (typeof value !== "string" || value.trim() === "" || value.length > max || value.includes("\0")) {
    throw new Error(error)
  }
  return value.trim()
}

function parseModelPayload(content: string): Record<string, unknown> {
  const trimmed = content.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "")
  let parsed: unknown
  try { parsed = JSON.parse(trimmed) } catch { throw new Error("JUDGMENT_OUTPUT_MALFORMED") }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("JUDGMENT_OUTPUT_MALFORMED")
  const record = parsed as Record<string, unknown>
  const allowed = new Set(["recommendation", "rationale", "basisKeys", "confidence"])
  for (const key of Object.keys(record)) if (!allowed.has(key)) throw new Error(`JUDGMENT_OUTPUT_UNKNOWN_KEY:${key}`)
  return record
}

/** Ask the configured sovereign inference seam for one bounded, inspectably grounded opinion. */
export async function requestWilliamJudgment(
  world: WorkingWorldSnapshot,
  dependencies: JudgmentDependencies,
): Promise<WilliamJudgment> {
  const facts = deriveWilliamSafetyFacts(world)
  const fetchImpl = dependencies.fetchImpl ?? fetch
  let response: Response
  try {
    response = await fetchImpl(`${dependencies.baseUrl.replace(/\/$/, "")}/chat/completions`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(dependencies.apiKey ? { authorization: `Bearer ${dependencies.apiKey}` } : {}),
      },
      body: JSON.stringify({
        model: dependencies.model,
        stream: false,
        max_tokens: 500,
        messages: [
          {
            role: "system",
            content:
              "You are William inside WilliamOS: calm, concise, opinionated, proactive, and overridable. " +
              "Form one useful software-development judgment from only the supplied deterministic facts. " +
              "Return JSON only with recommendation, rationale, basisKeys, and confidence (0..1). " +
              "basisKeys must contain 1-8 exact keys from the supplied facts. Never claim an action ran.",
          },
          { role: "user", content: JSON.stringify({ deterministicFacts: facts }) },
        ],
      }),
      signal: AbortSignal.timeout(90_000),
    })
  } catch {
    throw new Error("JUDGMENT_INFERENCE_UNAVAILABLE")
  }
  if (!response.ok) throw new Error("JUDGMENT_INFERENCE_UNAVAILABLE")
  let envelope: unknown
  try { envelope = await response.json() } catch { throw new Error("JUDGMENT_OUTPUT_MALFORMED") }
  const content = (envelope as { choices?: { message?: { content?: unknown } }[] })
    ?.choices?.[0]?.message?.content
  if (typeof content !== "string") throw new Error("JUDGMENT_OUTPUT_MALFORMED")
  const output = parseModelPayload(content)
  const recommendation = boundedModelString(output.recommendation, "JUDGMENT_RECOMMENDATION_INVALID", 400)
  const rationale = boundedModelString(output.rationale, "JUDGMENT_RATIONALE_INVALID", 1_200)
  if (!Array.isArray(output.basisKeys) || output.basisKeys.length === 0 || output.basisKeys.length > 8
    || output.basisKeys.some((key) => typeof key !== "string")) {
    throw new Error("JUDGMENT_BASIS_INVALID")
  }
  const factByKey = new Map(facts.map((entry) => [entry.key, entry]))
  const keys = [...new Set(output.basisKeys as string[])]
  const basis = keys.map((key) => {
    const grounded = factByKey.get(key)
    if (!grounded) throw new Error("JUDGMENT_BASIS_UNKNOWN")
    return { key: grounded.key, label: grounded.label, value: grounded.value }
  })
  if (typeof output.confidence !== "number" || !Number.isFinite(output.confidence)
    || output.confidence < 0 || output.confidence > 1) {
    throw new Error("JUDGMENT_CONFIDENCE_INVALID")
  }
  return validateWilliamJudgment({
    recommendation,
    rationale,
    basis,
    confidence: output.confidence,
    generatedAt: (dependencies.now ?? (() => new Date().toISOString()))(),
    basisFingerprint: williamJudgmentBasisFingerprint(world),
    provenance: { provider: "williamos-inference", model: dependencies.model },
  })
}
import { createHash } from "node:crypto"
