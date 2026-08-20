/** Extracts the kernel's final turn JSON from invoker stdout. Pure; no IO. */

export const HERMES_FREE_AGENT_COMPLETE_PATTERN = /^HERMES_FREE_AGENT_COMPLETE runId=([A-Za-z0-9-]+)/m

const FENCE = /```json[ \t]*\r?\n([\s\S]*?)\r?\n```/g

/**
 * Per-run answer sentinel. The run id is minted by the client for this turn only, so
 * workspace content echoed into stdout cannot pre-forge a delimited block: an attacker
 * would have to know a value that did not exist when the content was written.
 */
export const TURN_OUTPUT_SENTINEL_OPEN = "HERMES_TURN_OUTPUT"
export const TURN_OUTPUT_SENTINEL_CLOSE = "HERMES_TURN_OUTPUT_END"

export function sentinelBlocks(text, runId) {
  if (typeof text !== "string" || typeof runId !== "string" || !/^[A-Za-z0-9-]{8,64}$/.test(runId)) return []
  const pattern = new RegExp(
    `^${TURN_OUTPUT_SENTINEL_OPEN} runId=${runId}[ \\t]*\\r?\\n([\\s\\S]*?)\\r?\\n${TURN_OUTPUT_SENTINEL_CLOSE}[ \\t]*$`,
    "gm",
  )
  return [...text.matchAll(pattern)].map((match) => match[1].trim())
}

function parseObject(candidate) {
  let parsed
  try { parsed = JSON.parse(candidate) } catch { return null }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null
  return parsed
}

function classify(candidate) {
  let parsed
  try { parsed = JSON.parse(candidate) } catch { return { ok: false, reason: "INVALID_JSON" } }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return { ok: false, reason: "NOT_AN_OBJECT" }
  return { ok: true, finalText: candidate }
}

/**
 * Balanced top-level `{…}` object in `text` beginning at `start`, or null.
 * Strings and escapes are honoured while balancing so braces inside JSON strings do not
 * confuse the scan.
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
        if (parseObject(candidate)) return { candidate, end: index }
        return null
      }
    }
  }
  return null
}

/**
 * Every balanced top-level JSON object in `text`, in order. The Hermes CLI renders markdown
 * fences as decorated boxes, so the fenced form is not reliably present in captured stdout;
 * the answer object itself is.
 */
function allBalancedObjects(text) {
  const found = []
  let index = text.indexOf("{")
  while (index !== -1) {
    const match = balancedObjectAt(text, index)
    if (match) { found.push(match.candidate); index = text.indexOf("{", match.end + 1) }
    else index = text.indexOf("{", index + 1)
  }
  return found
}

/** Distinct parseable JSON objects in stdout: fenced blocks first, then bare balanced objects. */
export function harvestTurnCandidates(stdout) {
  const text = typeof stdout === "string" ? stdout : ""
  const candidates = []
  const seen = new Set()
  const push = (value) => {
    const trimmed = typeof value === "string" ? value.trim() : ""
    if (!trimmed || seen.has(trimmed) || !parseObject(trimmed)) return
    seen.add(trimmed); candidates.push(trimmed)
  }
  for (const match of text.matchAll(FENCE)) push(match[1])
  for (const candidate of allBalancedObjects(text)) push(candidate)
  return candidates
}

/**
 * The turn's answer object, or a typed failure.
 *
 * Selection is fail-closed rather than last-wins. Taking the last candidate let any JSON that
 * appeared after the model's answer — workspace content the model echoed, a second fence — silently
 * become the turn verdict, which is the same forgery the wall tokens are line-anchored against in
 * hermes-kernel-client.mjs. Instead:
 *   1. if the per-run sentinel is present, only a block delimited by it is eligible; and
 *   2. otherwise exactly one candidate must be acceptable to the caller's contract check.
 * Zero acceptable candidates and two-or-more acceptable candidates are both walls, never a guess.
 *
 * `isAcceptable(parsedObject) => boolean` is supplied by the client (a schema check), so an echoed
 * non-answer object — a prompt echo of the schema, a tool payload — is filtered out rather than
 * competing with the real answer.
 */
export function harvestTurnOutput(stdout, { runId = null, isAcceptable = null } = {}) {
  const text = typeof stdout === "string" ? stdout : ""

  const delimited = sentinelBlocks(text, runId)
  if (delimited.length === 1) return classify(delimited[0])
  if (delimited.length > 1) return { ok: false, reason: "AMBIGUOUS_SENTINEL_BLOCKS" }

  const candidates = harvestTurnCandidates(text)
  if (candidates.length === 0) {
    // Preserve the precise reason when a fenced block existed but was not a JSON object.
    const fenced = [...text.matchAll(FENCE)].map((match) => match[1].trim())
    if (fenced.length > 0) return classify(fenced.at(-1))
    return { ok: false, reason: "NO_JSON_BLOCK" }
  }

  // One candidate cannot be a substitution: return it and let the caller's schema check report the
  // precise structural failure, so an almost-compliant model still produces a diagnosable reason.
  if (candidates.length === 1) return { ok: true, finalText: candidates[0] }

  // More than one candidate is the forgery shape. The contract decides which is the answer; if it
  // cannot single one out, that is a wall rather than a positional guess.
  const accept = typeof isAcceptable === "function" ? isAcceptable : null
  if (!accept) return { ok: false, reason: "AMBIGUOUS_OUTPUT" }
  const eligible = candidates.filter((candidate) => {
    try { return accept(JSON.parse(candidate)) === true } catch { return false }
  })
  if (eligible.length === 1) return { ok: true, finalText: eligible[0] }
  if (eligible.length === 0) return { ok: false, reason: "NO_ACCEPTABLE_OUTPUT" }
  return { ok: false, reason: "AMBIGUOUS_OUTPUT" }
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

// Every keyword this checker actually implements. Anything else in a schema is refused rather
// than skipped: silently ignoring an unimplemented constraint would make a tightened schema look
// enforced while doing nothing.
const SUPPORTED_KEYWORDS = new Set([
  "type", "enum", "pattern", "minimum", "minItems", "maxItems", "minLength", "maxLength",
  "items", "properties", "required", "additionalProperties",
])

function unsupportedKeyword(spec) {
  if (!spec || typeof spec !== "object" || Array.isArray(spec)) return null
  for (const key of Object.keys(spec)) if (!SUPPORTED_KEYWORDS.has(key)) return key
  return null
}

function checkValue(value, spec, label) {
  if (!spec || typeof spec !== "object") return null
  const unsupported = unsupportedKeyword(spec)
  if (unsupported) return `${label}:UNSUPPORTED:${unsupported}`
  for (const keyword of ["minItems", "maxItems", "minLength", "maxLength"]) {
    if (spec[keyword] !== undefined
      && (!Number.isInteger(spec[keyword]) || spec[keyword] < 0)) return `${label}:INVALID:${keyword}`
  }
  if (spec.type !== undefined) {
    const types = Array.isArray(spec.type) ? spec.type : [spec.type]
    if (!types.some((type) => typeMatches(value, type))) return `${label}:TYPE`
  }
  if (Array.isArray(spec.enum) && !spec.enum.includes(value)) return `${label}:ENUM`
  if (Array.isArray(value) && typeof spec.minItems === "number" && value.length < spec.minItems) return `${label}:MIN_ITEMS`
  if (Array.isArray(value) && typeof spec.maxItems === "number" && value.length > spec.maxItems) return `${label}:MAX_ITEMS`
  if (typeof value === "string" && typeof spec.minLength === "number" && value.length < spec.minLength) return `${label}:MIN_LENGTH`
  if (typeof value === "string" && typeof spec.maxLength === "number" && value.length > spec.maxLength) return `${label}:MAX_LENGTH`
  // A nullable member may legitimately be null; the pattern then does not apply.
  if (typeof spec.pattern === "string" && value !== null) {
    if (typeof value !== "string" || !new RegExp(spec.pattern).test(value)) return `${label}:PATTERN`
  }
  if (typeof spec.minimum === "number" && typeof value === "number" && value < spec.minimum) return `${label}:MINIMUM`
  if (Array.isArray(value) && spec.items) {
    for (let index = 0; index < value.length; index += 1) {
      const failure = checkValue(value[index], spec.items, `${label}[${index}]`)
      if (failure) return failure
    }
  }
  // Nested objects are validated with the same rules as the root, so a nested `required` or
  // `additionalProperties:false` is enforced instead of quietly ignored.
  if (value !== null && typeof value === "object" && !Array.isArray(value) && (spec.properties || spec.required || spec.additionalProperties === false)) {
    const nested = validateAgainstTurnSchema(value, spec)
    if (!nested.ok) return `${label}.${String(nested.reason).replace(/^SCHEMA:/, "")}`
  }
  return null
}

/**
 * Structural JSON-Schema check for the turn-output contract. Implements exactly the constructs in
 * SUPPORTED_KEYWORDS — including nested objects — and fails closed on any other keyword.
 */
export function validateAgainstTurnSchema(object, schema) {
  const failure = (detail) => ({ ok: false, reason: `SCHEMA:${detail}` })
  if (!schema || typeof schema !== "object" || Array.isArray(schema)) return failure("NO_SCHEMA")
  const unsupported = unsupportedKeyword(schema)
  if (unsupported) return failure(`UNSUPPORTED:${unsupported}`)
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
