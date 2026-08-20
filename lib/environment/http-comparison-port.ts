import crypto from "node:crypto"

import type { EnvironmentComparisonPort } from "@/lib/environment/world-service"
import { requireAllowedEnvironmentEndpoint } from "@/lib/environment/endpoint-policy"

const MAX_COMPARE_BYTES = 2_000_000

/**
 * Compare two admitted applications by observing both endpoints now. This is deliberately a factual
 * transport comparison, not a semantic merge: it reports response/status/content differences and
 * never claims one implementation is better or that their source was composed.
 */
export function createHttpEnvironmentComparisonPort({
  fetchImpl = fetch,
  now = () => new Date().toISOString(),
}: {
  fetchImpl?: typeof fetch
  now?: () => string
} = {}): EnvironmentComparisonPort {
  return {
    async compare({ left, right }) {
      const [a, b] = await Promise.all([
        observe(left.appUrl, fetchImpl),
        observe(right.appUrl, fetchImpl),
      ])
      const observedAt = now()
      const canonical = JSON.stringify({
        left: { endpointId: left.id, ...a },
        right: { endpointId: right.id, ...b },
        observedAt,
      })
      const digest = crypto.createHash("sha256").update(canonical).digest("hex")
      const conflicts: string[] = []
      if (a.status !== b.status) conflicts.push("HTTP_STATUS_DIFFERS")
      if (a.contentType !== b.contentType) conflicts.push("CONTENT_TYPE_DIFFERS")
      if (a.sha256 !== b.sha256) conflicts.push("RESPONSE_CONTENT_DIFFERS")
      return {
        artifactRef: `environment-compare:sha256:${digest}`,
        evidenceRef: `environment-http-observation:${digest}`,
        observedAt,
        subject: `${left.id} beside ${right.id}`,
        conflicts,
        content: {
          left: `${a.status} · ${a.contentType} · ${a.byteLength} bytes · ${a.sha256.slice(0, 12)}`,
          right: `${b.status} · ${b.contentType} · ${b.byteLength} bytes · ${b.sha256.slice(0, 12)}`,
          summary: conflicts.length === 0
            ? "Both isolated applications returned the same observed document."
            : `Observed ${conflicts.length} concrete response difference${conflicts.length === 1 ? "" : "s"}.`,
        },
      }
    },
  }
}

async function observe(url: string, fetchImpl: typeof fetch) {
  const allowedUrl = requireAllowedEnvironmentEndpoint(url)
  let response: Response
  try {
    response = await fetchImpl(allowedUrl, {
      method: "GET",
      redirect: "manual",
      headers: { accept: "text/html,application/json" },
      signal: AbortSignal.timeout(8_000),
    })
  } catch {
    throw new Error("COMPARISON_ENDPOINT_UNREACHABLE")
  }
  if (response.status < 200 || response.status >= 300) throw new Error("COMPARISON_ENDPOINT_NOT_READY")
  const declaredLength = Number(response.headers.get("content-length"))
  if (Number.isFinite(declaredLength) && declaredLength > MAX_COMPARE_BYTES) {
    throw new Error("COMPARISON_RESPONSE_TOO_LARGE")
  }
  const hash = crypto.createHash("sha256")
  let byteLength = 0
  const reader = response.body?.getReader()
  if (reader) {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      byteLength += value.byteLength
      if (byteLength > MAX_COMPARE_BYTES) {
        await reader.cancel()
        throw new Error("COMPARISON_RESPONSE_TOO_LARGE")
      }
      hash.update(value)
    }
  }
  return {
    status: response.status,
    contentType: response.headers.get("content-type") ?? "unknown",
    byteLength,
    sha256: hash.digest("hex"),
  }
}
