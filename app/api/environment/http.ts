import { getSession } from "@/lib/session"

const MAX_ENVIRONMENT_REQUEST_BYTES = 2_250_000

export async function authenticatedUserId(): Promise<string | null> {
  try {
    const session = await getSession()
    return session?.user?.id ?? null
  } catch {
    return null
  }
}

/** Runtime writers authenticate through the enrolled-device path, never a normal browser session. */
export async function authenticatedRuntimeUserId(): Promise<string | null> {
  try {
    const session = await getSession()
    return session?.user?.id && session.session?.token === "<device-session-redacted>"
      ? session.user.id
      : null
  } catch {
    return null
  }
}

export const NO_STORE_HEADERS = { "cache-control": "no-store" }

export async function readEnvironmentJson(request: Request): Promise<unknown> {
  const declaredLength = Number(request.headers.get("content-length"))
  if (Number.isFinite(declaredLength) && declaredLength > MAX_ENVIRONMENT_REQUEST_BYTES) {
    throw new Error("REQUEST_BODY_TOO_LARGE")
  }
  if (!request.body) throw new Error("INVALID_BODY")
  const reader = request.body.getReader()
  const chunks: Uint8Array[] = []
  let length = 0
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    length += value.byteLength
    if (length > MAX_ENVIRONMENT_REQUEST_BYTES) {
      await reader.cancel()
      throw new Error("REQUEST_BODY_TOO_LARGE")
    }
    chunks.push(value)
  }
  const bytes = new Uint8Array(length)
  let offset = 0
  for (const chunk of chunks) {
    bytes.set(chunk, offset)
    offset += chunk.byteLength
  }
  try {
    return JSON.parse(new TextDecoder().decode(bytes)) as unknown
  } catch {
    throw new Error("INVALID_BODY")
  }
}

export function environmentError(error: unknown): Response {
  const rawCode = error instanceof Error ? error.message : "ENVIRONMENT_ERROR"
  const code = /^[A-Z][A-Z0-9_]*(?::[A-Z0-9_,]+)?$/.test(rawCode) ? rawCode : "ENVIRONMENT_ERROR"
  const status = code === "WORLD_NOT_FOUND"
    ? 404
    : code.startsWith("RUNTIME_AUTHORITY_") || code === "RUNTIME_WORK_ORDER_NOT_ACTIVE" || code === "RUNTIME_WORK_ORDER_WORLD_MISMATCH"
      ? 403
      : code.startsWith("RUNTIME_EVIDENCE_")
        ? 409
        : code === "ENDPOINT_NOT_LIVE" || code === "ENDPOINT_NOT_READY" || code === "ENDPOINT_ORIGIN_NOT_ALLOWED"
          ? 422
          : code === "REQUEST_BODY_TOO_LARGE" || code === "CONTENT_TOO_LARGE" || code === "COMPARISON_RESPONSE_TOO_LARGE" || code.startsWith("TOO_MANY_")
            ? 413
            : code.startsWith("JOB4_ENDPOINTS_NOT_ISOLATED") || code.endsWith("_MISMATCH")
              ? 409
              : code === "MESSAGE_EMPTY" || code === "MESSAGE_TOO_LONG" || code === "INVALID_BODY" || code.endsWith("_REQUIRED") || code.endsWith("_INVALID") || code.endsWith("_MALFORMED")
              ? 400
              : 500
  return Response.json({ error: code }, { status, headers: NO_STORE_HEADERS })
}
