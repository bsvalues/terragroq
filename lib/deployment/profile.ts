export const WILLIAMOS_DEPLOYMENT_PROFILES = ["hermes-anchor", "county-development"] as const

export type WilliamOSDeploymentProfile = (typeof WILLIAMOS_DEPLOYMENT_PROFILES)[number]

export const COUNTY_DEVELOPMENT_DEFAULT_ORIGIN = "http://127.0.0.1:3200"
export const COUNTY_DEVELOPMENT_DEFAULT_AI_BASE_URL = "http://127.0.0.1:11434/v1"
export const COUNTY_DEVELOPMENT_DEFAULT_CHAT_MODEL = "qwen2.5-coder:1.5b"
export const COUNTY_DEVELOPMENT_DEFAULT_EMBEDDING_MODEL = "snowflake-arctic-embed2"

const LOOPBACK_HOSTS = new Set(["127.0.0.1", "localhost", "::1", "[::1]"])
const REMOTE_PROVIDER_SECRET_KEYS = [
  "ANTHROPIC_API_KEY",
  "GROQ_API_KEY",
  "OPENAI_API_KEY",
  "GOOGLE_GENERATIVE_AI_API_KEY",
  "AI_GATEWAY_API_KEY",
  "VERCEL_AI_GATEWAY_API_KEY",
] as const

export type WilliamOSDeploymentStatus = Readonly<{
  profile: WilliamOSDeploymentProfile
  deploymentId: string
  label: string
  countyControlled: boolean
  localOnlyInference: boolean
  serviceOrigin: string
  inferenceBaseUrl: string
  chatModel: string
  embeddingModel: string
  dataBoundary: string
  valid: boolean
  violations: readonly string[]
}>

function trimmed(value: string | undefined): string {
  return value?.trim() ?? ""
}

export function resolveDeploymentProfileName(
  env: NodeJS.ProcessEnv = process.env,
): WilliamOSDeploymentProfile {
  const raw = trimmed(env.WILLIAMOS_DEPLOYMENT_PROFILE) || "hermes-anchor"
  if ((WILLIAMOS_DEPLOYMENT_PROFILES as readonly string[]).includes(raw)) {
    return raw as WilliamOSDeploymentProfile
  }
  throw new Error(`WILLIAMOS_DEPLOYMENT_PROFILE_INVALID:${raw}`)
}

export function isCountyDevelopmentProfile(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  return resolveDeploymentProfileName(env) === "county-development"
}

function parsedUrl(value: string, violation: string, violations: string[]): URL | null {
  try {
    return new URL(value)
  } catch {
    violations.push(violation)
    return null
  }
}

function requireLoopbackUrl(
  value: string,
  violation: string,
  violations: string[],
  protocols: readonly string[],
): URL | null {
  const url = parsedUrl(value, violation, violations)
  if (!url) return null
  if (!protocols.includes(url.protocol) || !LOOPBACK_HOSTS.has(url.hostname.toLowerCase())) {
    violations.push(violation)
    return null
  }
  return url
}

/**
 * Fail closed before the AI SDK can be constructed in County Development mode.
 * The County profile never accepts a remote model endpoint or silently falls back to one.
 */
export function resolveInferenceBaseUrl(
  configured: string | undefined,
  env: NodeJS.ProcessEnv = process.env,
): string {
  const profile = resolveDeploymentProfileName(env)
  const candidate = trimmed(configured)
    || (profile === "county-development"
      ? COUNTY_DEVELOPMENT_DEFAULT_AI_BASE_URL
      : "http://127.0.0.1:11434/v1")

  if (profile !== "county-development") return candidate

  let url: URL
  try {
    url = new URL(candidate)
  } catch {
    throw new Error("COUNTY_DEVELOPMENT_INFERENCE_URL_INVALID")
  }
  if (!['http:', 'https:'].includes(url.protocol) || !LOOPBACK_HOSTS.has(url.hostname.toLowerCase())) {
    throw new Error("COUNTY_DEVELOPMENT_REMOTE_INFERENCE_FORBIDDEN")
  }
  return candidate
}

/**
 * Sanitized runtime identity for UI, health, packaging verification, and support evidence.
 * No credential value is ever returned.
 */
export function getDeploymentStatus(
  env: NodeJS.ProcessEnv = process.env,
): WilliamOSDeploymentStatus {
  const profile = resolveDeploymentProfileName(env)
  const countyDevelopment = profile === "county-development"
  const serviceOrigin = trimmed(env.BETTER_AUTH_URL)
    || (countyDevelopment ? COUNTY_DEVELOPMENT_DEFAULT_ORIGIN : "https://192.168.88.9:3443")
  const inferenceBaseUrl = trimmed(env.WILLIAMOS_AI_BASE_URL)
    || (countyDevelopment ? COUNTY_DEVELOPMENT_DEFAULT_AI_BASE_URL : "http://127.0.0.1:11434/v1")
  const chatModel = trimmed(env.WILLIAMOS_AI_MODEL)
    || (countyDevelopment ? COUNTY_DEVELOPMENT_DEFAULT_CHAT_MODEL : "llama3.2:3b")
  const embeddingModel = trimmed(env.WILLIAMOS_EMBEDDING_MODEL)
    || COUNTY_DEVELOPMENT_DEFAULT_EMBEDDING_MODEL
  const deploymentId = trimmed(env.WILLIAMOS_DEPLOYMENT_ID)
    || (countyDevelopment ? "" : "personal-hermes")
  const violations: string[] = []

  if (countyDevelopment) {
    if (!deploymentId) violations.push("COUNTY_DEVELOPMENT_DEPLOYMENT_ID_REQUIRED")
    if (!trimmed(env.WILLIAMOS_OWNER_EMAIL)) {
      violations.push("COUNTY_DEVELOPMENT_OWNER_EMAIL_REQUIRED")
    }

    requireLoopbackUrl(
      serviceOrigin,
      "COUNTY_DEVELOPMENT_SERVICE_ORIGIN_MUST_BE_LOOPBACK",
      violations,
      ["http:", "https:"],
    )
    requireLoopbackUrl(
      inferenceBaseUrl,
      "COUNTY_DEVELOPMENT_INFERENCE_MUST_BE_LOOPBACK",
      violations,
      ["http:", "https:"],
    )

    const databaseUrl = trimmed(env.DATABASE_URL)
    if (!databaseUrl) {
      violations.push("COUNTY_DEVELOPMENT_DATABASE_URL_REQUIRED")
    } else {
      requireLoopbackUrl(
        databaseUrl,
        "COUNTY_DEVELOPMENT_DATABASE_MUST_BE_LOOPBACK",
        violations,
        ["postgres:", "postgresql:"],
      )
    }

    const previewUrl = trimmed(env.WILLIAMOS_WORKSPACE_APP_URL)
    if (previewUrl) {
      requireLoopbackUrl(
        previewUrl,
        "COUNTY_DEVELOPMENT_PREVIEW_MUST_BE_LOOPBACK",
        violations,
        ["http:", "https:"],
      )
    }

    for (const key of REMOTE_PROVIDER_SECRET_KEYS) {
      if (trimmed(env[key])) {
        violations.push(`COUNTY_DEVELOPMENT_REMOTE_PROVIDER_SECRET_FORBIDDEN:${key}`)
      }
    }
  }

  return {
    profile,
    deploymentId: deploymentId || "unconfigured-county-development",
    label: countyDevelopment ? "COUNTY DEVELOPMENT" : "HERMES ANCHOR",
    countyControlled: countyDevelopment,
    localOnlyInference: countyDevelopment,
    serviceOrigin,
    inferenceBaseUrl,
    chatModel,
    embeddingModel,
    dataBoundary: countyDevelopment
      ? "county-controlled-local; no personal-HERMES data path"
      : "personal development and lab authority",
    valid: violations.length === 0,
    violations,
  }
}
