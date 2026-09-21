const SECRET_PATTERNS = Object.freeze([
  /WILLIAMOS_SECRET_SENTINEL(?:_[A-Z0-9_-]+)?/i,
  /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/,
  /\b(?:sk|csk)-[A-Za-z0-9_-]{20,}\b/,
  /\b(?:CEREBRAS_API_KEY|OPENAI_API_KEY|DATABASE_URL|AUTH_SECRET)\s*[:=]\s*["']?[^\s"']{6,}/i,
  /(?:https?|postgres(?:ql)?):\/\/[^\s/:@]+:[^\s/@]+@/i,
])

function visit(value, seen, depth) {
  if (depth > 12) throw new Error("APPLICATION_PROPOSAL_SECRET_SCAN_INVALID")
  if (typeof value === "string") {
    if (SECRET_PATTERNS.some((pattern) => pattern.test(value))) throw new Error("APPLICATION_PROPOSAL_SECRET_DETECTED")
    return
  }
  if (value === null || ["number", "boolean", "undefined"].includes(typeof value)) return
  if (Buffer.isBuffer(value)) return visit(value.toString("utf8"), seen, depth + 1)
  if (typeof value !== "object" || seen.has(value)) throw new Error("APPLICATION_PROPOSAL_SECRET_SCAN_INVALID")
  seen.add(value)
  if (Array.isArray(value)) {
    if (value.length > 10_000) throw new Error("APPLICATION_PROPOSAL_SECRET_SCAN_INVALID")
    for (const item of value) visit(item, seen, depth + 1)
  } else {
    const entries = Object.entries(value)
    if (entries.length > 1_000) throw new Error("APPLICATION_PROPOSAL_SECRET_SCAN_INVALID")
    for (const [key, item] of entries) {
      if (/^(?:apiKey|secret|password|credential|token)$/i.test(key)
        && typeof item === "string" && item.length > 0 && !/^\[?redacted\]?$/i.test(item)) {
        throw new Error("APPLICATION_PROPOSAL_SECRET_DETECTED")
      }
      visit(item, seen, depth + 1)
    }
  }
  seen.delete(value)
}

export function assertProposalSecretFree(value) {
  visit(value, new Set(), 0)
  return value
}
