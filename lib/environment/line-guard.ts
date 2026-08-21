/**
 * Request guard for the Line's state-changing POST (#762).
 *
 * `/api/environment/line` is cookie-authenticated and every call mutates state (it creates worlds
 * and fans out to the inference backend). An independent adversarial review found it accepted the
 * CORS "simple" content types (`text/plain`, form-encoded, none at all), which a cross-site HTML
 * form can send with NO preflight — a classic CSRF shape, guarded only by a cookie SameSite flag the
 * server cannot see. Same review: an unbounded body is a model-call amplifier, worse when reachable
 * cross-site. This closes both, before the browser ever reaches the handler:
 *
 *   1. Require `application/json`. A cross-site form cannot set it; a cross-site fetch that sets it
 *      triggers a preflight this server never answers permissively. Same-origin JSON passes.
 *   2. When an `Origin` is present (always, on a browser POST), require it to match this request's
 *      own forwarded origin — belt to the content-type's suspenders, and it cannot be spoofed by
 *      page script. A tokenless server-to-server client sends no Origin and is unaffected.
 *   3. Cap the body. Reject an oversized `Content-Length` fast, and the handler re-checks the parsed
 *      length in case the header lied.
 */

// A conversational line is words, not a payload. 32 KB is a generous ceiling for one turn while
// still refusing the megabyte-scale amplification inputs the review demonstrated.
export const MAX_LINE_BYTES = 32_000

export type GuardRejection = Readonly<{ status: number; error: string }>

/** The origin this request was actually served on, from the proxy's forwarded headers or the Host. */
function selfOrigin(request: Request): string | null {
  const headers = request.headers
  const forwardedProto = headers.get("x-forwarded-proto")
  const forwardedHost = headers.get("x-forwarded-host")
  if (forwardedHost) return `${(forwardedProto ?? "https").split(",")[0].trim()}://${forwardedHost.split(",")[0].trim()}`
  const host = headers.get("host")
  if (host) {
    // Direct (unproxied) access is loopback-only; assume http there, https otherwise.
    const proto = /^(127\.|localhost|\[::1\])/.test(host) ? "http" : "https"
    return `${proto}://${host}`
  }
  return null
}

/** Returns a rejection to send, or null when the request may proceed. Length is header-only here. */
export function guardLineRequest(request: Request): GuardRejection | null {
  const contentType = request.headers.get("content-type") ?? ""
  // Match the media type only; a charset parameter is fine.
  if (!/^application\/json\s*(;|$)/i.test(contentType.trim())) {
    return { status: 415, error: "UNSUPPORTED_MEDIA_TYPE" }
  }

  const origin = request.headers.get("origin")
  if (origin) {
    const self = selfOrigin(request)
    if (self && origin !== self) return { status: 403, error: "CROSS_ORIGIN_REFUSED" }
  }

  const declaredLength = Number(request.headers.get("content-length") ?? "")
  if (Number.isFinite(declaredLength) && declaredLength > MAX_LINE_BYTES) {
    return { status: 413, error: "MESSAGE_TOO_LARGE" }
  }

  return null
}

/** True when already-read text exceeds the cap (the header can lie or be absent). */
export function exceedsLineCap(text: string): boolean {
  // Byte length, not code units: the cap is about payload size, not character count.
  return Buffer.byteLength(text, "utf8") > MAX_LINE_BYTES
}

/**
 * True only for a `worldId` that is PRESENT and not a usable id. Absence spells "new world" — and
 * the Desk client spells absence as an explicit `null` on the first message — so both `undefined`
 * and `null` are valid, and only a present, non-null, non-string value is malformed. (Codex P1:
 * rejecting `null` here 400s every first message, so no world can ever be created.)
 */
export function isMalformedWorldId(value: unknown): boolean {
  return value !== undefined && value !== null && typeof value !== "string"
}

export type BoundedBody =
  | Readonly<{ ok: true; value: unknown }>
  | Readonly<{ ok: false; status: number; error: string }>

/**
 * Reads and JSON-parses the request body while counting bytes as they arrive, aborting the moment
 * the running total exceeds the cap. The `Content-Length` guard above is only a fast reject: it is
 * absent under chunked transfer-encoding and can understate the real size, and a small `text` beside
 * a huge ignored property would otherwise buffer entirely in memory before any per-field check
 * (Codex P2). This bounds the ACTUAL bytes, so nothing larger than the cap is ever fully held.
 */
export async function readBoundedJson(request: Request, max: number = MAX_LINE_BYTES): Promise<BoundedBody> {
  const body = request.body
  if (!body) {
    // No stream: fall back to text(), still bounded by byte length before parsing.
    const raw = await request.text()
    if (Buffer.byteLength(raw, "utf8") > max) return { ok: false, status: 413, error: "MESSAGE_TOO_LARGE" }
    try {
      return { ok: true, value: raw ? JSON.parse(raw) : {} }
    } catch {
      return { ok: false, status: 400, error: "INVALID_BODY" }
    }
  }

  const reader = body.getReader()
  const chunks: Uint8Array[] = []
  let total = 0
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      if (value) {
        total += value.byteLength
        if (total > max) {
          await reader.cancel().catch(() => {})
          return { ok: false, status: 413, error: "MESSAGE_TOO_LARGE" }
        }
        chunks.push(value)
      }
    }
  } catch {
    return { ok: false, status: 400, error: "INVALID_BODY" }
  }

  const raw = Buffer.concat(chunks.map((chunk) => Buffer.from(chunk))).toString("utf8")
  try {
    return { ok: true, value: raw ? JSON.parse(raw) : {} }
  } catch {
    return { ok: false, status: 400, error: "INVALID_BODY" }
  }
}
