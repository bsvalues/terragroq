/** Extracts the kernel's final turn JSON from invoker stdout. Pure; no IO. */

export const HERMES_FREE_AGENT_COMPLETE_PATTERN = /^HERMES_FREE_AGENT_COMPLETE runId=([A-Za-z0-9-]+)/m

const FENCE = /```json[ \t]*\r?\n([\s\S]*?)\r?\n```/g

function classify(candidate) {
  let parsed
  try { parsed = JSON.parse(candidate) } catch { return { ok: false, reason: "INVALID_JSON" } }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return { ok: false, reason: "NOT_AN_OBJECT" }
  return { ok: true, finalText: candidate }
}

/**
 * Last balanced top-level `{…}` object in `text` that parses to a JSON object, or null.
 * The Hermes CLI renders markdown fences as decorated boxes, so the fenced-block form is not
 * reliably present in captured stdout; the answer object itself is. Strings and escapes are
 * honoured while balancing so braces inside JSON strings do not confuse the scan.
 */
function balancedObjectAt(text, start) {
  let depth = 0; let inString = false; let escaped = false
  for (let index = start; index < text.length; index += 1) {
    const char = text[index]
    if (inString) {
      if (escaped) escaped = false
      else if (char === "\\") escaped = true
      else if (char === "\"") inString = false
      continue
    }
    if (char === "\"") inString = true
    else if (char === "{") depth += 1
    else if (char === "}") {
      depth -= 1
      if (depth === 0) {
        const candidate = text.slice(start, index + 1)
        try {
          const parsed = JSON.parse(candidate)
          if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) return { candidate, end: index }
        } catch { /* balanced but not JSON */ }
        return null
      }
    }
  }
  return null
}

function lastBalancedObject(text) {
  let last = null
  let index = text.indexOf("{")
  while (index !== -1) {
    const found = balancedObjectAt(text, index)
    if (found) { last = found.candidate; index = text.indexOf("{", found.end + 1) }
    else index = text.indexOf("{", index + 1)
  }
  return last
}

export function harvestTurnOutput(stdout) {
  const text = typeof stdout === "string" ? stdout : ""
  let last = null
  for (const match of text.matchAll(FENCE)) last = match[1]
  if (last !== null) return classify(last.trim())
  const lines = text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean)
  const tail = lines.at(-1)
  if (tail && tail.startsWith("{") && tail.endsWith("}")) return classify(tail)
  const balanced = lastBalancedObject(text)
  if (balanced !== null) return { ok: true, finalText: balanced }
  return { ok: false, reason: "NO_JSON_BLOCK" }
}

function typeMatches(value, type) {
  switch (type) {
    case "object": return value !== null && typeof value === "object" && !Array.isArray(value)
    case "array": return Array.isArray(value)
    case "string": return typeof value === "string"
    case "boolean": return typeof value === "boolean"
    case "integer": return Number.isInteger(value)
    case "number": return typeof value === "number" && Number.isFinite(value)
    case "null": return value === null
    default: return false
  }
}

function checkValue(value, spec, label) {
  if (!spec || typeof spec !== "object") return null
  if (spec.type !== undefined) {
    const types = Array.isArray(spec.type) ? spec.type : [spec.type]
    if (!types.some((type) => typeMatches(value, type))) return `${label}:TYPE`
  }
  if (Array.isArray(spec.enum) && !spec.enum.includes(value)) return `${label}:ENUM`
  if (typeof spec.pattern === "string" && (typeof value !== "string" || !new RegExp(spec.pattern).test(value))) return `${label}:PATTERN`
  if (typeof spec.minimum === "number" && typeof value === "number" && value < spec.minimum) return `${label}:MINIMUM`
  if (Array.isArray(value) && spec.items) {
    for (let index = 0; index < value.length; index += 1) {
      const failure = checkValue(value[index], spec.items, `${label}[${index}]`)
      if (failure) return failure
    }
  }
  return null
}

/**
 * Structural JSON-Schema check for the turn-output contract. Covers exactly the
 * constructs HERMES_TURN_OUTPUT_SCHEMA uses (required, additionalProperties:false,
 * type incl. nullable unions, enum, pattern, minimum, array items). No dependency.
 */
export function validateAgainstTurnSchema(object, schema) {
  const failure = (detail) => ({ ok: false, reason: `SCHEMA:${detail}` })
  if (!schema || typeof schema !== "object" || Array.isArray(schema)) return failure("NO_SCHEMA")
  if (object === null || typeof object !== "object" || Array.isArray(object)) return failure("NOT_AN_OBJECT")
  const properties = schema.properties ?? {}
  for (const key of Array.isArray(schema.required) ? schema.required : []) {
    if (!Object.hasOwn(object, key)) return failure(`MISSING:${key}`)
  }
  if (schema.additionalProperties === false) {
    for (const key of Object.keys(object)) {
      if (!Object.hasOwn(properties, key)) return failure(`ADDITIONAL:${key}`)
    }
  }
  for (const [key, spec] of Object.entries(properties)) {
    if (!Object.hasOwn(object, key)) continue
    const detail = checkValue(object[key], spec, key)
    if (detail) return failure(detail)
  }
  return { ok: true }
}
