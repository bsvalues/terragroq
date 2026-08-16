/** Extracts the kernel's final turn JSON from invoker stdout. Pure; no IO. */

export const HERMES_FREE_AGENT_COMPLETE_PATTERN = /^HERMES_FREE_AGENT_COMPLETE runId=([A-Za-z0-9-]+)/m

const FENCE = /```json[ \t]*\r?\n([\s\S]*?)\r?\n```/g

function classify(candidate) {
  let parsed
  try { parsed = JSON.parse(candidate) } catch { return { ok: false, reason: "INVALID_JSON" } }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return { ok: false, reason: "NOT_AN_OBJECT" }
  return { ok: true, finalText: candidate }
}

export function harvestTurnOutput(stdout) {
  const text = typeof stdout === "string" ? stdout : ""
  let last = null
  for (const match of text.matchAll(FENCE)) last = match[1]
  if (last !== null) return classify(last.trim())
  const lines = text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean)
  const tail = lines.at(-1)
  if (tail && tail.startsWith("{") && tail.endsWith("}")) return classify(tail)
  return { ok: false, reason: "NO_JSON_BLOCK" }
}
