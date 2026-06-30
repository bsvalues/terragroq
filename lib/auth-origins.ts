export type TrustedOriginSource =
  | "BETTER_AUTH_URL"
  | "BETTER_AUTH_TRUSTED_ORIGINS"
  | "VERCEL_PROJECT_PRODUCTION_URL"
  | "VERCEL_URL"
  | "V0_RUNTIME_URL"
  | "development-default"

export type TrustedOriginEntry = {
  origin: string
  sources: TrustedOriginSource[]
}

export type InvalidTrustedOrigin = {
  value: string
  source: TrustedOriginSource
  reason: string
}

export type TrustedOriginConfig = {
  authBaseOrigin: string | null
  trustedOrigins: string[]
  entries: TrustedOriginEntry[]
  invalidConfiguredOrigins: InvalidTrustedOrigin[]
}

export type OriginDiagnostics = TrustedOriginConfig & {
  currentOrigin: string | null
  isCurrentOriginTrusted: boolean | null
  warnings: string[]
  recoveryActions: string[]
}

function splitConfiguredOrigins(value: string | undefined) {
  return (value ?? "")
    .split(/[,\s]+/)
    .map((item) => item.trim())
    .filter(Boolean)
}

function normalizeStrictOrigin(value: string) {
  const trimmed = value.trim().replace(/\/+$/, "")
  if (!trimmed) return { origin: null, reason: "Origin is empty." }

  let url: URL
  try {
    url = new URL(trimmed)
  } catch {
    return { origin: null, reason: "Origin must be an absolute URL." }
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") {
    return { origin: null, reason: "Origin must use http or https." }
  }
  if (url.pathname !== "/" || url.search || url.hash) {
    return {
      origin: null,
      reason: "Origin must not include a path, query string, or fragment.",
    }
  }

  return { origin: url.origin, reason: null }
}

function normalizeHostnameAsHttpsOrigin(value: string | undefined) {
  if (!value?.trim()) return null
  return normalizeStrictOrigin(`https://${value.trim()}`)
}

function addOrigin(
  map: Map<string, Set<TrustedOriginSource>>,
  invalid: InvalidTrustedOrigin[],
  value: string | undefined,
  source: TrustedOriginSource,
  options?: { hostnameOnly?: boolean },
) {
  if (!value?.trim()) return

  const normalized = options?.hostnameOnly
    ? normalizeHostnameAsHttpsOrigin(value)
    : normalizeStrictOrigin(value)

  if (!normalized || !normalized.origin) {
    invalid.push({
      value,
      source,
      reason: normalized?.reason ?? "Origin is not configured.",
    })
    return
  }

  const sources = map.get(normalized.origin) ?? new Set<TrustedOriginSource>()
  sources.add(source)
  map.set(normalized.origin, sources)
}

export function resolveAuthBaseUrl() {
  return (
    process.env.BETTER_AUTH_URL ??
    (process.env.VERCEL_PROJECT_PRODUCTION_URL
      ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`
      : process.env.VERCEL_URL
        ? `https://${process.env.VERCEL_URL}`
        : process.env.V0_RUNTIME_URL)
  )
}

function resolveAuthBaseUrlSource(): TrustedOriginSource | null {
  if (process.env.BETTER_AUTH_URL) return "BETTER_AUTH_URL"
  if (process.env.VERCEL_PROJECT_PRODUCTION_URL) return "VERCEL_PROJECT_PRODUCTION_URL"
  if (process.env.VERCEL_URL) return "VERCEL_URL"
  if (process.env.V0_RUNTIME_URL) return "V0_RUNTIME_URL"
  return null
}

export function resolveTrustedOriginConfig(): TrustedOriginConfig {
  const origins = new Map<string, Set<TrustedOriginSource>>()
  const invalidConfiguredOrigins: InvalidTrustedOrigin[] = []

  const authBaseUrl = resolveAuthBaseUrl()
  const authBaseSource = resolveAuthBaseUrlSource()
  const authBase = authBaseUrl ? normalizeStrictOrigin(authBaseUrl) : null
  if (authBase?.origin) {
    addOrigin(
      origins,
      invalidConfiguredOrigins,
      authBase.origin,
      authBaseSource ?? "BETTER_AUTH_URL",
    )
  } else if (authBaseUrl) {
    invalidConfiguredOrigins.push({
      value: authBaseUrl,
      source: authBaseSource ?? "BETTER_AUTH_URL",
      reason: authBase?.reason ?? "Auth base URL is invalid.",
    })
  }

  for (const configuredOrigin of splitConfiguredOrigins(
    process.env.BETTER_AUTH_TRUSTED_ORIGINS,
  )) {
    addOrigin(
      origins,
      invalidConfiguredOrigins,
      configuredOrigin,
      "BETTER_AUTH_TRUSTED_ORIGINS",
    )
  }

  addOrigin(
    origins,
    invalidConfiguredOrigins,
    process.env.VERCEL_PROJECT_PRODUCTION_URL,
    "VERCEL_PROJECT_PRODUCTION_URL",
    { hostnameOnly: true },
  )
  addOrigin(origins, invalidConfiguredOrigins, process.env.VERCEL_URL, "VERCEL_URL", {
    hostnameOnly: true,
  })
  addOrigin(origins, invalidConfiguredOrigins, process.env.V0_RUNTIME_URL, "V0_RUNTIME_URL")

  if (process.env.NODE_ENV === "development") {
    addOrigin(origins, invalidConfiguredOrigins, "http://localhost:3000", "development-default")
    addOrigin(origins, invalidConfiguredOrigins, "http://127.0.0.1:3000", "development-default")
  }

  const entries = [...origins.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([origin, sources]) => ({
      origin,
      sources: [...sources].sort(),
    }))

  return {
    authBaseOrigin: authBase?.origin ?? null,
    trustedOrigins: entries.map((entry) => entry.origin),
    entries,
    invalidConfiguredOrigins,
  }
}

function strictOriginFromHeader(value: string | null) {
  if (!value) return null
  const normalized = normalizeStrictOrigin(value)
  return normalized.origin
}

function refererOriginFromHeader(value: string | null) {
  if (!value) return null
  try {
    const url = new URL(value)
    if (url.protocol !== "http:" && url.protocol !== "https:") return null
    return url.origin
  } catch {
    return null
  }
}

function currentOriginFromRequest(req: Request) {
  return (
    strictOriginFromHeader(req.headers.get("origin")) ??
    refererOriginFromHeader(req.headers.get("referer")) ??
    new URL(req.url).origin
  )
}

export function getOriginDiagnostics(req: Request): OriginDiagnostics {
  const config = resolveTrustedOriginConfig()
  const currentOrigin = currentOriginFromRequest(req)
  const isCurrentOriginTrusted = currentOrigin
    ? config.trustedOrigins.includes(currentOrigin)
    : null
  const warnings: string[] = []
  const recoveryActions: string[] = []

  if (!config.authBaseOrigin) {
    warnings.push("Auth base origin is not configured or is invalid.")
    recoveryActions.push("Set BETTER_AUTH_URL to the canonical app origin.")
  }

  if (config.invalidConfiguredOrigins.length > 0) {
    warnings.push("One or more configured trusted origins are invalid.")
    recoveryActions.push(
      "Use origin-only URLs such as https://example.com or http://localhost:3000.",
    )
  }

  if (isCurrentOriginTrusted === false) {
    warnings.push("Current browser origin is not trusted for auth.")
    recoveryActions.push(
      "Add the current origin to BETTER_AUTH_TRUSTED_ORIGINS or open the app from a trusted URL.",
    )
  }

  return {
    ...config,
    currentOrigin,
    isCurrentOriginTrusted,
    warnings,
    recoveryActions,
  }
}
