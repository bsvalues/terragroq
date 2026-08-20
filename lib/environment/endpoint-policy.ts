const LOOPBACK_IPV4 = /^127(?:\.\d{1,3}){3}$/

/**
 * Network boundary for server-side world observations. Loopback is allowed for local sandboxes;
 * every other origin must be named explicitly so an authority-bearing runtime report cannot become
 * a general-purpose SSRF primitive.
 */
export function requireAllowedEnvironmentEndpoint(
  raw: string,
  allowedOrigins = process.env.WILLIAMOS_ENVIRONMENT_ALLOWED_ORIGINS ?? "",
): URL {
  let url: URL
  try {
    url = new URL(raw)
  } catch {
    throw new Error("ENDPOINT_APP_URL_INVALID")
  }
  if (!/^https?:$/.test(url.protocol) || url.username || url.password || url.hash) {
    throw new Error("ENDPOINT_APP_URL_INVALID")
  }

  const hostname = url.hostname.replace(/^\[|\]$/g, "").toLowerCase()
  const loopback = hostname === "::1" || LOOPBACK_IPV4.test(hostname)
  const allowlist = new Set(
    allowedOrigins
      .split(",")
      .map((candidate) => candidate.trim())
      .filter(Boolean)
      .map((candidate) => {
        try {
          return new URL(candidate).origin
        } catch {
          return ""
        }
      })
      .filter(Boolean),
  )
  if (!loopback && !allowlist.has(url.origin)) throw new Error("ENDPOINT_ORIGIN_NOT_ALLOWED")
  return url
}
