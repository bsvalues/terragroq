// Tamper-evidence hashing for durable governance records.
// A stable SHA-256 over canonicalized JSON so the same logical record always
// produces the same hash regardless of key ordering.

import { createHash } from "node:crypto"

// Deterministically stringify a value with sorted object keys.
function canonical(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "null"
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`
  const obj = value as Record<string, unknown>
  const keys = Object.keys(obj).sort()
  return `{${keys.map((k) => `${JSON.stringify(k)}:${canonical(obj[k])}`).join(",")}}`
}

// SHA-256 hex digest of a string.
export function sha256Hex(input: string): string {
  return createHash("sha256").update(input, "utf8").digest("hex")
}

// SHA-256 hex digest of an object (canonicalized so it is order-independent).
export function hashRecord(record: unknown): string {
  return sha256Hex(canonical(record))
}
