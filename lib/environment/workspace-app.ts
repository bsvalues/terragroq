import { createHash } from "node:crypto"

const HTML_IDENTITY_LIMIT = 64 * 1024
const IDENTITY_HEADER = "x-williamos-workspace-app"
const COMPOSITION_HEADER = "x-williamos-preview-composition"
const COMPOSITION_HEADER_LIMIT = 8 * 1024
const COMPOSITION_PAYLOAD_LIMIT = 6 * 1024
const REVISION_IDENTITY = /^[a-f0-9]{40}(?:[a-f0-9]{24})?$/
const RUNTIME_INSTANCE = /^[A-Za-z0-9][A-Za-z0-9._:@+-]{0,127}$/
const ARTIFACT_IDENTITY = /^[A-Za-z0-9][A-Za-z0-9._:@/+\-]{0,199}$/
const SUITES = ["forge", "atlas", "dais", "dossier", "gpt"] as const

export type WorkspacePreviewRuntimeComposition = Readonly<{
  schemaVersion: 1
  runtime: Readonly<{
    repositoryIdentity: "bsvalues/terrafusion_os_1.0"
    revision: string
    instance: string
  }>
  consumedArtifacts: readonly Readonly<{
    suite: typeof SUITES[number]
    repositoryIdentity: string
    artifactIdentity: string
    sourceRevision: string
  }>[]
}>

export type WorkspaceAppAdmission =
  | Readonly<{ ok: true; url: string }>
  | Readonly<{ ok: false; reason: "NOT_CONFIGURED" | "URL_INVALID" | "UNREACHABLE" | "IDENTITY_MISMATCH" | "EMBEDDING_REFUSED" }>

export type WorkspacePreviewEvidenceReason = "NOT_CONFIGURED" | "URL_INVALID" | "UNREACHABLE" | "IDENTITY_MISMATCH" | "EMBEDDING_REFUSED"

export type WorkspacePreviewEvidence = Readonly<{
  schemaVersion: 1
  status: "attached" | "unavailable"
  reason: WorkspacePreviewEvidenceReason | null
  configuredUrl: string | null
  admittedUrl: string | null
  origin: string | null
  identity: "TerraFusion" | "unverified"
  reachable: boolean
  frameable: boolean
  composition: WorkspacePreviewRuntimeComposition | null
  checkedAt: string
  limitations: Readonly<{ dom: "unavailable"; console: "unavailable"; network: "unavailable" }>
  fingerprint: string
}>

/** Resolve WilliamOS identity from server configuration, never request-controlled proxy headers. */
export function williamOsOrigin(canonicalUrl: string | null | undefined, requestUrl: string): string {
  try {
    if (canonicalUrl) return new URL(canonicalUrl).origin
  } catch {
    // An invalid canonical value cannot authorize a forged forwarded origin; use the actual URL.
  }
  return new URL(requestUrl).origin
}

type PreviewUrlValidation =
  | Readonly<{ ok: true; url: URL }>
  | Readonly<{ ok: false; reason: "NOT_CONFIGURED" | "URL_INVALID" }>

function validateConfiguredUrl(value: string | null | undefined): PreviewUrlValidation {
  if (!value) return { ok: false, reason: "NOT_CONFIGURED" }
  try {
    const url = new URL(value)
    if ((url.protocol !== "http:" && url.protocol !== "https:") || url.username || url.password || url.search) {
      return { ok: false, reason: "URL_INVALID" }
    }
    url.hash = ""
    return { ok: true, url }
  } catch {
    return { ok: false, reason: "URL_INVALID" }
  }
}

function configuredUrl(value: string | null | undefined): URL | null {
  const validated = validateConfiguredUrl(value)
  return validated.ok ? validated.url : null
}

function frameAncestorDirectiveAllows(directive: string, appOrigin: string, williamOrigin: string): boolean {
  const sources = directive.split(/\s+/).slice(1)
  if (sources.length === 0 || sources.includes("'none'")) return false
  return sources.some((source) =>
    source === "*"
    || (source === "'self'" && appOrigin === williamOrigin)
    || source.replace(/\/$/, "") === williamOrigin,
  )
}

function frameAncestorsAllows(value: string | null, appOrigin: string, williamOrigin: string): boolean {
  if (!value) return true
  const directives = value.split(",").flatMap((policy) => policy.split(";")
    .map((part) => part.trim())
    .filter((part) => /^frame-ancestors(?:\s|$)/i.test(part)))
  return directives.every((directive) => frameAncestorDirectiveAllows(directive, appOrigin, williamOrigin))
}

function responseCanBeFramed(response: Response, appOrigin: string, williamOrigin: string): boolean {
  const xFrameOptions = response.headers.get("x-frame-options")?.trim().toLowerCase() ?? null
  if (xFrameOptions) {
    const directives = xFrameOptions.split(",").map((part) => part.trim())
    if (directives.length !== 1 || !directives[0]) return false
    if (directives[0] === "deny") return false
    if (directives[0] !== "sameorigin" || appOrigin !== williamOrigin) return false
  }
  return frameAncestorsAllows(response.headers.get("content-security-policy"), appOrigin, williamOrigin)
}

async function readIdentityPrefix(response: Response): Promise<string> {
  if (!response.body) return ""
  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let seen = 0
  let text = ""
  try {
    while (seen < HTML_IDENTITY_LIMIT) {
      const { done, value } = await reader.read()
      if (done) break
      const bounded = value.byteLength > HTML_IDENTITY_LIMIT - seen
        ? value.subarray(0, HTML_IDENTITY_LIMIT - seen)
        : value
      seen += bounded.byteLength
      text += decoder.decode(bounded, { stream: seen < HTML_IDENTITY_LIMIT })
      if (bounded.byteLength !== value.byteLength) break
    }
  } finally {
    await reader.cancel().catch(() => undefined)
  }
  return text + decoder.decode()
}

const PREVIEW_LIMITATIONS = {
  dom: "unavailable",
  console: "unavailable",
  network: "unavailable",
} as const

function previewEvidence(
  input: Omit<WorkspacePreviewEvidence, "schemaVersion" | "checkedAt" | "limitations" | "fingerprint" | "composition">
    & Readonly<{ composition?: WorkspacePreviewRuntimeComposition | null }>,
  now: () => Date,
): WorkspacePreviewEvidence {
  const normalized = { ...input, composition: input.composition ?? null }
  const fingerprint = createHash("sha256").update(JSON.stringify({ schemaVersion: 1, ...normalized })).digest("hex")
  return {
    schemaVersion: 1,
    ...normalized,
    checkedAt: now().toISOString(),
    limitations: PREVIEW_LIMITATIONS,
    fingerprint,
  }
}

function exactKeys(value: Record<string, unknown>, expected: readonly string[]): boolean {
  const actual = Object.keys(value).sort()
  const wanted = [...expected].sort()
  return actual.length === wanted.length && actual.every((key, index) => key === wanted[index])
}

/** Decode only the bounded, versioned attestation emitted by the admitted runtime boundary. */
function runtimeComposition(response: Response): WorkspacePreviewRuntimeComposition | null {
  const encoded = response.headers.get(COMPOSITION_HEADER)?.trim() ?? ""
  if (!encoded || encoded.length > COMPOSITION_HEADER_LIMIT || !/^[A-Za-z0-9_-]+$/.test(encoded)) return null
  let parsed: unknown
  try {
    const bytes = Buffer.from(encoded, "base64url")
    if (bytes.byteLength > COMPOSITION_PAYLOAD_LIMIT || bytes.toString("base64url") !== encoded) return null
    parsed = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes))
  } catch {
    return null
  }
  if (!parsed || typeof parsed !== "object") return null
  const candidate = parsed as Record<string, unknown>
  if (!exactKeys(candidate, ["schemaVersion", "runtime", "consumedArtifacts"])
    || candidate.schemaVersion !== 1
    || !candidate.runtime || typeof candidate.runtime !== "object"
    || !Array.isArray(candidate.consumedArtifacts) || candidate.consumedArtifacts.length > SUITES.length) return null
  const runtime = candidate.runtime as Record<string, unknown>
  if (!exactKeys(runtime, ["repositoryIdentity", "revision", "instance"])
    || runtime.repositoryIdentity !== "bsvalues/terrafusion_os_1.0"
    || typeof runtime.revision !== "string" || !REVISION_IDENTITY.test(runtime.revision)
    || typeof runtime.instance !== "string" || !RUNTIME_INSTANCE.test(runtime.instance)) return null

  const seen = new Set<string>()
  const consumedArtifacts: WorkspacePreviewRuntimeComposition["consumedArtifacts"][number][] = []
  for (const value of candidate.consumedArtifacts) {
    if (!value || typeof value !== "object") return null
    const artifact = value as Record<string, unknown>
    if (!exactKeys(artifact, ["suite", "repositoryIdentity", "artifactIdentity", "sourceRevision"])
      || typeof artifact.suite !== "string" || !SUITES.includes(artifact.suite as typeof SUITES[number])
      || artifact.repositoryIdentity !== `bsvalues/terrafusion-${artifact.suite}`
      || typeof artifact.artifactIdentity !== "string" || !ARTIFACT_IDENTITY.test(artifact.artifactIdentity)
      || typeof artifact.sourceRevision !== "string" || !REVISION_IDENTITY.test(artifact.sourceRevision)
      || seen.has(artifact.suite)) return null
    seen.add(artifact.suite)
    consumedArtifacts.push({
      suite: artifact.suite as typeof SUITES[number],
      repositoryIdentity: artifact.repositoryIdentity,
      artifactIdentity: artifact.artifactIdentity,
      sourceRevision: artifact.sourceRevision,
    })
  }
  return {
    schemaVersion: 1,
    runtime: {
      repositoryIdentity: runtime.repositoryIdentity,
      revision: runtime.revision.toLowerCase(),
      instance: runtime.instance,
    },
    consumedArtifacts,
  }
}

const PREVIEW_REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308])
const PREVIEW_REDIRECT_LIMIT = 4

type PreviewFetchResult =
  | Readonly<{ ok: true; response: Response; finalUrl: URL }>
  | Readonly<{ ok: false; reason: "URL_INVALID" | "UNREACHABLE" }>

async function fetchPreviewResponse(initialUrl: URL, fetcher: typeof fetch): Promise<PreviewFetchResult> {
  let current = initialUrl
  const seen = new Set([current.toString()])
  for (let redirectCount = 0; redirectCount <= PREVIEW_REDIRECT_LIMIT; redirectCount += 1) {
    let response: Response
    try {
      response = await fetcher(current, {
        method: "GET",
        redirect: "manual",
        cache: "no-store",
        signal: AbortSignal.timeout(2_500),
        headers: { accept: "text/html,application/xhtml+xml" },
      })
    } catch {
      return { ok: false, reason: "UNREACHABLE" }
    }
    if (!PREVIEW_REDIRECT_STATUSES.has(response.status)) {
      if (response.url) {
        const observed = validateConfiguredUrl(response.url)
        if (!observed.ok) return { ok: false, reason: "URL_INVALID" }
        if (observed.url.origin !== initialUrl.origin || observed.url.toString() !== current.toString()) {
          return { ok: false, reason: "UNREACHABLE" }
        }
      }
      return { ok: true, response, finalUrl: current }
    }
    if (redirectCount === PREVIEW_REDIRECT_LIMIT) return { ok: false, reason: "UNREACHABLE" }
    const location = response.headers.get("location")
    if (!location) return { ok: false, reason: "UNREACHABLE" }
    let redirected: URL
    try {
      redirected = new URL(location, current)
    } catch {
      return { ok: false, reason: "URL_INVALID" }
    }
    const validated = validateConfiguredUrl(redirected.toString())
    if (!validated.ok) return { ok: false, reason: "URL_INVALID" }
    redirected = validated.url
    if (redirected.origin !== initialUrl.origin) return { ok: false, reason: "UNREACHABLE" }
    const canonical = redirected.toString()
    if (seen.has(canonical)) return { ok: false, reason: "UNREACHABLE" }
    seen.add(canonical)
    current = redirected
  }
  return { ok: false, reason: "UNREACHABLE" }
}

/**
 * Inspect only the server-configured Preview boundary and return bounded product evidence. Raw
 * response bodies, headers, failure detail and request secrets never cross this seam.
 */
export async function inspectWorkspaceApp(
  configured: string | null | undefined,
  williamOrigin: string,
  fetcher: typeof fetch = fetch,
  now: () => Date = () => new Date(),
): Promise<WorkspacePreviewEvidence> {
  const validated = validateConfiguredUrl(configured)
  if (!validated.ok) {
    return previewEvidence({
      status: "unavailable", reason: validated.reason, configuredUrl: null, admittedUrl: null,
      origin: null, identity: "unverified", reachable: false, frameable: false,
    }, now)
  }
  const url = validated.url
  const canonicalConfiguredUrl = url.toString()
  const origin = url.origin

  const fetched = await fetchPreviewResponse(url, fetcher)
  if (!fetched.ok) {
    return previewEvidence({
      status: "unavailable", reason: fetched.reason, configuredUrl: canonicalConfiguredUrl, admittedUrl: null,
      origin, identity: "unverified", reachable: false, frameable: false,
    }, now)
  }
  const { response, finalUrl } = fetched
  try {
    if (!response.ok) {
      return previewEvidence({
        status: "unavailable", reason: "UNREACHABLE", configuredUrl: canonicalConfiguredUrl, admittedUrl: null,
        origin, identity: "unverified", reachable: false, frameable: false,
      }, now)
    }
    if (!responseCanBeFramed(response, finalUrl.origin, williamOrigin)) {
      return previewEvidence({
        status: "unavailable", reason: "EMBEDDING_REFUSED", configuredUrl: canonicalConfiguredUrl, admittedUrl: null,
        origin, identity: "unverified", reachable: true, frameable: false,
      }, now)
    }
    if (!/^text\/html\b/i.test(response.headers.get("content-type") ?? "")) {
      return previewEvidence({
        status: "unavailable", reason: "IDENTITY_MISMATCH", configuredUrl: canonicalConfiguredUrl, admittedUrl: null,
        origin, identity: "unverified", reachable: true, frameable: true,
      }, now)
    }

    const declaredIdentity = response.headers.get(IDENTITY_HEADER)?.trim().toLowerCase()
    const html = await readIdentityPrefix(response)
    if (declaredIdentity !== "terrafusion" && !/terrafusion/i.test(html)) {
      return previewEvidence({
        status: "unavailable", reason: "IDENTITY_MISMATCH", configuredUrl: canonicalConfiguredUrl, admittedUrl: null,
        origin, identity: "unverified", reachable: true, frameable: true,
      }, now)
    }
    return previewEvidence({
      status: "attached", reason: null, configuredUrl: canonicalConfiguredUrl, admittedUrl: finalUrl.toString(),
      origin, identity: "TerraFusion", reachable: true, frameable: true, composition: runtimeComposition(response),
    }, now)
  } catch {
    return previewEvidence({
      status: "unavailable", reason: "UNREACHABLE", configuredUrl: canonicalConfiguredUrl, admittedUrl: null,
      origin, identity: "unverified", reachable: false, frameable: false,
    }, now)
  }
}

/**
 * Admit only the server-configured, currently running TerraFusion application.
 *
 * This is deliberately not the inert `/api/environment/view` document proxy. The returned URL is
 * framed directly so its scripts, forms, navigation, and hot-reload channel remain the real app.
 */
export async function admitWorkspaceApp(
  configured: string | null | undefined,
  williamOrigin: string,
  fetcher: typeof fetch = fetch,
): Promise<WorkspaceAppAdmission> {
  if (!configured) return { ok: false, reason: "NOT_CONFIGURED" }
  const url = configuredUrl(configured)
  if (!url) return { ok: false, reason: "URL_INVALID" }
  const evidence = await inspectWorkspaceApp(configured, williamOrigin, fetcher)
  return evidence.status === "attached"
    ? { ok: true, url: evidence.admittedUrl! }
    : { ok: false, reason: evidence.reason ?? "UNREACHABLE" }
}
