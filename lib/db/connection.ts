import type { PoolConfig } from "pg"

const AMBIGUOUS_SSL_MODES = new Set(["prefer", "require", "verify-ca"])

export function normalizeDatabaseUrlForPg(rawUrl: string | undefined) {
  if (!rawUrl?.trim()) return rawUrl

  const trimmed = rawUrl.trim()
  let parsed: URL
  try {
    parsed = new URL(trimmed)
  } catch {
    return trimmed
  }

  if (!["postgres:", "postgresql:"].includes(parsed.protocol)) {
    return trimmed
  }

  const sslMode = parsed.searchParams.get("sslmode")?.toLowerCase()
  if (sslMode && AMBIGUOUS_SSL_MODES.has(sslMode)) {
    parsed.searchParams.set("sslmode", "verify-full")
  }

  return parsed.toString()
}

export function buildPoolConfig(databaseUrl = process.env.DATABASE_URL): PoolConfig {
  if (!databaseUrl?.trim()) return {}

  return {
    connectionString: normalizeDatabaseUrlForPg(databaseUrl),
  }
}
