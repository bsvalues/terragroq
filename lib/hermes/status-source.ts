import { createHash, randomUUID } from "node:crypto"
import { readFile, stat } from "node:fs/promises"

import {
  unavailableHermesStatus,
  validateHermesStatus,
  type HermesDomainName,
  type ValidatedHermesStatus,
} from "./status-contract"

const DEFAULT_STATUS_PATH = "C:\\ProgramData\\Hermes\\status\\current.json"
const MAX_STATUS_BYTES = 128 * 1024
const OLLAMA_ORIGIN = "http://127.0.0.1:11434"

export type HermesStatusProjection = ValidatedHermesStatus & Readonly<{
  source: Readonly<{ label: "HERMES native status"; sha256: string | null }>
}>

function sha256(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex")
}

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`
  if (value && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => `${JSON.stringify(key)}:${canonical(entry)}`)
      .join(",")}}`
  }
  return JSON.stringify(value)
}

export async function readHermesStatus({
  path = process.env.HERMES_STATUS_PATH?.trim() || DEFAULT_STATUS_PATH,
  now = new Date(),
  maxAgeSeconds = 300,
}: { path?: string; now?: Date; maxAgeSeconds?: number } = {}): Promise<HermesStatusProjection> {
  try {
    const metadata = await stat(path)
    if (!metadata.isFile() || metadata.size < 2 || metadata.size > MAX_STATUS_BYTES) {
      throw new Error("HERMES_STATUS_SOURCE_INVALID")
    }
    const raw = await readFile(path, "utf8")
    return {
      ...validateHermesStatus(JSON.parse(raw), { now, maxAgeSeconds }),
      source: { label: "HERMES native status", sha256: sha256(raw) },
    }
  } catch {
    return {
      // Do not reflect filesystem paths, ACL details, parser fragments, or other host internals into
      // the owner surface. The operational fact is that the canonical packet could not be trusted;
      // the exact exception belongs in server diagnostics, not in browser-visible appliance state.
      ...unavailableHermesStatus("The canonical HERMES status packet could not be validated."),
      source: { label: "HERMES native status", sha256: null },
    }
  }
}

function domainSummary(status: HermesStatusProjection, name: HermesDomainName): string {
  return `${name}: ${status.domains[name].state.toLowerCase()}`
}

export function describeHermesForOwner(status: HermesStatusProjection): string {
  if (status.freshness.state !== "FRESH") {
    return "HERMES evidence is stale or unavailable, so WilliamOS is making no green claim and cannot determine whether owner authority is needed."
  }
  const needsYou = status.ownerActions.length === 0
    ? "Nothing requires owner authority."
    : `${status.ownerActions.length} owner ${status.ownerActions.length === 1 ? "decision requires" : "decisions require"} attention.`
  const exceptions = (["inference", "protection", "storage", "security", "doctrine"] as const)
    .filter((name) => status.domains[name].state !== "HEALTHY")
    .map((name) => domainSummary(status, name))
  return `HERMES is ${status.ownerState.toLowerCase()}. ${exceptions.length ? `Current exceptions: ${exceptions.join(", ")}. ` : ""}${needsYou}`
}

type OllamaGenerate = Readonly<{ response?: unknown; model?: unknown }>
type OllamaPs = Readonly<{ models?: readonly Readonly<{ name?: unknown; model?: unknown; size_vram?: unknown }>[] }>

export type HermesInferenceReceipt = Readonly<{
  schema: "hermes-inference-verification/1"
  receiptId: string
  observedAt: string
  result: "PASS" | "FAIL"
  model: string
  generatedExpectedToken: boolean
  modelLoadedInGpuMemory: boolean
  canonicalP40EvidenceFresh: boolean
  sourceStatusSha256: string | null
  receiptSha256: string
}>

export async function verifyHermesInference({
  fetcher = fetch,
  now = new Date(),
}: { fetcher?: typeof fetch; now?: Date } = {}): Promise<HermesInferenceReceipt> {
  const status = await readHermesStatus({ now })
  const exactFact = (label: string): string => {
    const matches = status.domains.inference.facts.filter((fact) => fact.label === label)
    return matches.length === 1 ? matches[0].value : ""
  }
  const model = exactFact("Golden model")
  const p40 = exactFact("P40")
  const owner = exactFact("Owner")
  const listener = exactFact("Listener")
  const canonicalP40EvidenceFresh = status.freshness.state === "FRESH"
    && status.domains.inference.state === "HEALTHY"
    && Boolean(model)
    && /^\d+(?:\.\d+)? C \| 150(?:\.0+)? W cap \| TCC$/.test(p40)
    && owner === "WilliamOS-HERMES-Ollama | fresh"
    && /^Loopback-only 127\.0\.0\.1:11434 \| pid [1-9]\d*$/.test(listener)

  let generatedExpectedToken = false
  let modelLoadedInGpuMemory = false
  if (canonicalP40EvidenceFresh && model) {
    try {
      const generated = await fetcher(`${OLLAMA_ORIGIN}/api/generate`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          model,
          prompt: "Reply with exactly HERMES_READY and nothing else.",
          stream: false,
          options: { temperature: 0, num_predict: 8 },
          keep_alive: "5m",
        }),
        signal: AbortSignal.timeout(60_000),
      })
      if (!generated.ok) throw new Error(`OLLAMA_GENERATE_${generated.status}`)
      const generatedBody = await generated.json() as OllamaGenerate
      generatedExpectedToken = typeof generatedBody.response === "string"
        && generatedBody.response.trim() === "HERMES_READY"
        && generatedBody.model === model

      const processes = await fetcher(`${OLLAMA_ORIGIN}/api/ps`, {
        cache: "no-store",
        signal: AbortSignal.timeout(10_000),
      })
      if (!processes.ok) throw new Error(`OLLAMA_PS_${processes.status}`)
      const processBody = await processes.json() as OllamaPs
      modelLoadedInGpuMemory = (processBody.models ?? []).some((entry) => {
        const loadedModel = typeof entry.name === "string" ? entry.name : typeof entry.model === "string" ? entry.model : ""
        return loadedModel === model && typeof entry.size_vram === "number" && entry.size_vram > 0
      })
    } catch {
      generatedExpectedToken = false
      modelLoadedInGpuMemory = false
    }
  }

  const receiptWithoutDigest = {
    schema: "hermes-inference-verification/1" as const,
    receiptId: randomUUID(),
    observedAt: now.toISOString(),
    result: generatedExpectedToken && modelLoadedInGpuMemory && canonicalP40EvidenceFresh ? "PASS" as const : "FAIL" as const,
    model: model || "unavailable",
    generatedExpectedToken,
    modelLoadedInGpuMemory,
    canonicalP40EvidenceFresh,
    sourceStatusSha256: status.source.sha256,
  }
  return { ...receiptWithoutDigest, receiptSha256: sha256(canonical(receiptWithoutDigest)) }
}
