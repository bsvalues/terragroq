import { ACCESS_GRANT_FORBIDDEN_AUDIT_FIELDS } from "./constants"

const FORBIDDEN_FIELD_NAMES = new Set(
  ACCESS_GRANT_FORBIDDEN_AUDIT_FIELDS.map((field) => field.toLowerCase()),
)

export type RedactedAccessGrantMetadata = Record<string, unknown>

export function isForbiddenAccessGrantAuditField(field: string): boolean {
  return FORBIDDEN_FIELD_NAMES.has(field.toLowerCase())
}

export function redactAccessGrantAuditMetadata(
  metadata: Record<string, unknown>,
): RedactedAccessGrantMetadata {
  return redactObject(metadata)
}

function redactObject(input: Record<string, unknown>): RedactedAccessGrantMetadata {
  return Object.fromEntries(
    Object.entries(input)
      .filter(([key]) => !isForbiddenAccessGrantAuditField(key))
      .map(([key, value]) => [key, redactValue(value)]),
  )
}

function redactValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => redactValue(item))
  }

  if (isPlainObject(value)) {
    return redactObject(value)
  }

  return value
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}
