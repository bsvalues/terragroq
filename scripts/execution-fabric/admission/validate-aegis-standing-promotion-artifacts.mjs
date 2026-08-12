#!/usr/bin/node
import { evaluateAegisStandingEligibility } from "./evaluate-aegis-standing-authority.mjs"
import { fileURLToPath } from "node:url"

const MAX_STDIN_BYTES = 16 * 1024 * 1024

function exactKeys(value, keys) {
  return value && typeof value === "object" && !Array.isArray(value)
    && JSON.stringify(Object.keys(value).sort()) === JSON.stringify([...keys].sort())
}

export function validatePromotionArtifacts(payload) {
  if (!exactKeys(payload, ["authority", "request", "candidateAdmission", "now"])
    || typeof payload.now !== "string" || new Date(payload.now).toISOString() !== payload.now) {
    return { status: "REJECTED", code: "PROMOTION_VALIDATOR_INPUT_INVALID",
      execution_authorized: false, dispatch_allowed: false,
      scheduler_activated: false, autonomous_selection: false }
  }
  return evaluateAegisStandingEligibility({
    authority: payload.authority,
    request: payload.request,
    candidateAdmission: payload.candidateAdmission,
    now: () => Date.parse(payload.now),
  })
}

export async function main({ stdin = process.stdin, stdout = process.stdout } = {}) {
  const chunks = []
  let size = 0
  for await (const chunk of stdin) {
    size += chunk.length
    if (size > MAX_STDIN_BYTES) throw new Error("PROMOTION_VALIDATOR_INPUT_TOO_LARGE")
    chunks.push(chunk)
  }
  const result = validatePromotionArtifacts(JSON.parse(Buffer.concat(chunks).toString("utf8")))
  stdout.write(`${JSON.stringify(result)}\n`)
  return result.status === "ADMITTED" ? 0 : 2
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().then((code) => { process.exitCode = code }).catch((error) => {
    process.stderr.write(`${JSON.stringify({ status: "REJECTED", code: error?.message ?? "PROMOTION_VALIDATOR_FAILED" })}\n`)
    process.exitCode = 2
  })
}
