import { pool } from "@/lib/db"
import { getSignupPolicy, type SignupPolicy } from "@/lib/auth-policy"

export type AuthReadinessIssue = {
  code:
    | "DATABASE_URL_MISSING"
    | "DATABASE_UNREACHABLE"
    | "AUTH_SECRET_MISSING"
    | "AUTH_SECRET_WEAK"
    | "AUTH_BASE_URL_MISSING"
  severity: "error" | "warning"
  message: string
}

type ReadinessCheck = {
  ok: boolean
  detail?: string
  latencyMs?: number
}

export type AuthReadiness = {
  ready: boolean
  databaseReady: boolean
  authReady: boolean
  signup: SignupPolicy
  checkedAt: string
  checks: {
    databaseUrl: ReadinessCheck
    databaseConnectivity: ReadinessCheck | null
    authSecret: ReadinessCheck
    baseUrl: ReadinessCheck
  }
  issues: AuthReadinessIssue[]
}

function resolveBaseUrl() {
  return (
    process.env.BETTER_AUTH_URL ??
    (process.env.VERCEL_PROJECT_PRODUCTION_URL
      ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`
      : process.env.VERCEL_URL
        ? `https://${process.env.VERCEL_URL}`
        : process.env.V0_RUNTIME_URL)
  )
}

function checkDatabaseUrl(): ReadinessCheck {
  if (process.env.DATABASE_URL?.trim()) return { ok: true }
  return { ok: false, detail: "DATABASE_URL is not configured." }
}

function checkAuthSecret(): ReadinessCheck {
  const secret = process.env.BETTER_AUTH_SECRET?.trim()
  if (!secret) {
    return { ok: false, detail: "BETTER_AUTH_SECRET is not configured." }
  }
  if (secret.length < 32) {
    return {
      ok: false,
      detail:
        "BETTER_AUTH_SECRET is too short. Use at least 32 bytes (openssl rand -base64 32).",
    }
  }
  return { ok: true }
}

function checkBaseUrl(): ReadinessCheck {
  if (resolveBaseUrl()) return { ok: true }
  return {
    ok: false,
    detail:
      "Auth base URL is not configured (set BETTER_AUTH_URL or deployment URL env vars).",
  }
}

async function checkDatabaseConnectivity(
  probeDatabase: boolean,
  databaseUrlCheck: ReadinessCheck,
): Promise<ReadinessCheck | null> {
  if (!probeDatabase || !databaseUrlCheck.ok) return null

  const startedAt = Date.now()
  try {
    await pool.query("select 1")
    return { ok: true, latencyMs: Date.now() - startedAt }
  } catch (error) {
    return {
      ok: false,
      latencyMs: Date.now() - startedAt,
      detail:
        error instanceof Error ? error.message : "Database connectivity probe failed.",
    }
  }
}

export async function getAuthReadiness(options?: {
  probeDatabase?: boolean
}): Promise<AuthReadiness> {
  const probeDatabase = options?.probeDatabase ?? false
  const isProd = process.env.NODE_ENV === "production"

  const databaseUrl = checkDatabaseUrl()
  const authSecret = checkAuthSecret()
  const baseUrl = checkBaseUrl()
  const databaseConnectivity = await checkDatabaseConnectivity(
    probeDatabase,
    databaseUrl,
  )
  const signup = await getSignupPolicy()

  const databaseReady = databaseConnectivity
    ? databaseConnectivity.ok
    : databaseUrl.ok
  const authReady = authSecret.ok && (isProd ? baseUrl.ok : true)

  const issues: AuthReadinessIssue[] = []
  if (!databaseUrl.ok) {
    issues.push({
      code: "DATABASE_URL_MISSING",
      severity: "error",
      message: databaseUrl.detail!,
    })
  } else if (databaseConnectivity && !databaseConnectivity.ok) {
    issues.push({
      code: "DATABASE_UNREACHABLE",
      severity: "error",
      message: databaseConnectivity.detail ?? "Database connectivity probe failed.",
    })
  }

  if (!authSecret.ok) {
    issues.push({
      code: authSecret.detail?.includes("too short")
        ? "AUTH_SECRET_WEAK"
        : "AUTH_SECRET_MISSING",
      severity: "error",
      message: authSecret.detail!,
    })
  }

  if (!baseUrl.ok) {
    issues.push({
      code: "AUTH_BASE_URL_MISSING",
      severity: isProd ? "error" : "warning",
      message:
        baseUrl.detail ??
        "Auth base URL is not configured and callbacks may be unreliable.",
    })
  }

  return {
    ready: databaseReady && authReady,
    databaseReady,
    authReady,
    signup,
    checkedAt: new Date().toISOString(),
    checks: {
      databaseUrl,
      databaseConnectivity,
      authSecret,
      baseUrl,
    },
    issues,
  }
}
