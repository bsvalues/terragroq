const HTML_IDENTITY_LIMIT = 64 * 1024
const IDENTITY_HEADER = "x-williamos-workspace-app"

export type WorkspaceAppAdmission =
  | Readonly<{ ok: true; url: string }>
  | Readonly<{ ok: false; reason: "NOT_CONFIGURED" | "URL_INVALID" | "UNREACHABLE" | "IDENTITY_MISMATCH" | "EMBEDDING_REFUSED" }>

/** Resolve WilliamOS identity from server configuration, never request-controlled proxy headers. */
export function williamOsOrigin(canonicalUrl: string | null | undefined, requestUrl: string): string {
  try {
    if (canonicalUrl) return new URL(canonicalUrl).origin
  } catch {
    // An invalid canonical value cannot authorize a forged forwarded origin; use the actual URL.
  }
  return new URL(requestUrl).origin
}

function configuredUrl(value: string | null | undefined): URL | null {
  if (!value) return null
  try {
    const url = new URL(value)
    if ((url.protocol !== "http:" && url.protocol !== "https:") || url.username || url.password) return null
    url.hash = ""
    return url
  } catch {
    return null
  }
}

function frameAncestorsAllows(value: string | null, appOrigin: string, williamOrigin: string): boolean {
  if (!value) return true
  const directive = value.split(";").map((part) => part.trim()).find((part) => /^frame-ancestors\b/i.test(part))
  if (!directive) return true
  const sources = directive.split(/\s+/).slice(1)
  if (sources.includes("'none'")) return false
  if (sources.includes("*")) return true
  return sources.some((source) =>
    (source === "'self'" && appOrigin === williamOrigin)
    || source.replace(/\/$/, "") === williamOrigin,
  )
}

function responseCanBeFramed(response: Response, williamOrigin: string): boolean {
  const appOrigin = new URL(response.url).origin
  const xFrameOptions = response.headers.get("x-frame-options")?.trim().toLowerCase()
  if (xFrameOptions === "deny") return false
  if (xFrameOptions === "sameorigin" && appOrigin !== williamOrigin) return false
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

  try {
    const response = await fetcher(url, {
      method: "GET",
      redirect: "follow",
      cache: "no-store",
      signal: AbortSignal.timeout(2_500),
      headers: { accept: "text/html,application/xhtml+xml" },
    })
    const finalUrl = configuredUrl(response.url)
    if (!finalUrl || finalUrl.origin !== url.origin || !response.ok) return { ok: false, reason: "UNREACHABLE" }
    if (!responseCanBeFramed(response, williamOrigin)) return { ok: false, reason: "EMBEDDING_REFUSED" }
    if (!/^text\/html\b/i.test(response.headers.get("content-type") ?? "")) {
      return { ok: false, reason: "IDENTITY_MISMATCH" }
    }

    const declaredIdentity = response.headers.get(IDENTITY_HEADER)?.trim().toLowerCase()
    const html = await readIdentityPrefix(response)
    if (declaredIdentity !== "terrafusion" && !/terrafusion/i.test(html)) {
      return { ok: false, reason: "IDENTITY_MISMATCH" }
    }
    return { ok: true, url: url.toString() }
  } catch {
    return { ok: false, reason: "UNREACHABLE" }
  }
}
