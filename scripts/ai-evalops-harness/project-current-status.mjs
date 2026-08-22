#!/usr/bin/env node

import { createHash } from "node:crypto"
import { readFileSync, writeFileSync } from "node:fs"
import path from "node:path"
import {
  AI_EVALOPS_CURRENT_STATUS,
  AI_EVALOPS_MATURITY_DEFINITIONS,
  AI_EVALOPS_MATURITY_STATES,
  validateAiEvalOpsCurrentStatus,
} from "../../components/operator/ai-evalops-harness-status.ts"

const argumentsByName = Object.fromEntries(process.argv.slice(2).flatMap((value, index, values) =>
  value.startsWith("--") ? [[value.slice(2), values[index + 1]]] : []))
if (!argumentsByName.output || !argumentsByName["observed-at"]) {
  throw new Error("usage: project-current-status.mjs --output <path> --observed-at <ISO-8601>")
}
const observedAt = new Date(argumentsByName["observed-at"])
if (!Number.isFinite(observedAt.valueOf())) throw new Error("--observed-at must be ISO-8601")

validateAiEvalOpsCurrentStatus(AI_EVALOPS_CURRENT_STATUS)
const root = process.cwd()
const sha256 = (value) => createHash("sha256").update(value).digest("hex")
const historicalEvidence = AI_EVALOPS_CURRENT_STATUS.historyReferences.map((reference) => {
  const absolutePath = path.resolve(root, reference.path)
  const content = readFileSync(absolutePath)
  return { ...reference, sha256: sha256(content), sizeBytes: content.byteLength }
})

const projection = {
  ...AI_EVALOPS_CURRENT_STATUS,
  observedAt: observedAt.toISOString(),
  maturityVocabulary: AI_EVALOPS_MATURITY_STATES.map((state, rank) => ({ state, rank, definition: AI_EVALOPS_MATURITY_DEFINITIONS[state] })),
  historicalEvidence,
  generatedProjectionSha256: null,
}
projection.generatedProjectionSha256 = sha256(JSON.stringify({ ...projection, generatedProjectionSha256: null }))
writeFileSync(argumentsByName.output, `${JSON.stringify(projection, null, 2)}\n`, "utf8")
