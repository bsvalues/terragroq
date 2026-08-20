import type { WorldEndpointIdentity } from "@/lib/environment/world-projection"
import { requireAllowedEnvironmentEndpoint, requirePublicEnvironmentEndpoint } from "@/lib/environment/endpoint-policy"

export type UnverifiedWorldEndpoint = Omit<WorldEndpointIdentity, "provenance"> & Readonly<{
  provenance: Omit<WorldEndpointIdentity["provenance"], "liveness">
}>

/**
 * Real acceptance seam: check the endpoint's declared application URL without starting, changing, or
 * authorizing anything. A caller must persist its own evidence reference; this helper cannot mint a
 * runtime receipt. Redirects stay manual so a shared sign-in shell cannot silently look like success.
 */
export async function verifyEndpointLiveness(
  endpoint: UnverifiedWorldEndpoint,
  {
    fetchImpl = fetch,
    evidenceRef,
    now = () => new Date().toISOString(),
  }: {
    fetchImpl?: typeof fetch
    evidenceRef: string
    now?: () => string
  },
): Promise<WorldEndpointIdentity> {
  if (!evidenceRef.trim()) throw new Error("ENDPOINT_LIVENESS_EVIDENCE_REQUIRED")
  const url = requireAllowedEnvironmentEndpoint(endpoint.probeUrl)
  let response: Response
  try {
    response = await fetchImpl(url, {
      method: "GET",
      redirect: "manual",
      headers: { accept: "text/html,application/json" },
      signal: AbortSignal.timeout(5_000),
    })
  } catch {
    throw new Error("ENDPOINT_NOT_LIVE")
  }
  // Redirects are evidence of a different location, not proof that this admitted application is ready.
  if (response.status < 200 || response.status >= 300) throw new Error("ENDPOINT_NOT_READY")
  const publicBase = requirePublicEnvironmentEndpoint(endpoint.appUrl)
  const publicIdentity = new URL(`${publicBase.pathname.replace(/\/?$/, "/")}api/environment/preview-identity`, publicBase)
  publicIdentity.search = ""
  let publicResponse: Response
  try {
    publicResponse = await fetchImpl(publicIdentity, {
      method: "GET",
      redirect: "manual",
      headers: { accept: "application/json" },
      signal: AbortSignal.timeout(5_000),
    })
  } catch {
    throw new Error("ENDPOINT_PUBLIC_NOT_LIVE")
  }
  if (publicResponse.status < 200 || publicResponse.status >= 300) throw new Error("ENDPOINT_PUBLIC_NOT_READY")
  const encoded = await publicResponse.text()
  if (encoded.length > 4_096) throw new Error("ENDPOINT_PUBLIC_IDENTITY_INVALID")
  let identity: unknown
  try { identity = JSON.parse(encoded) } catch { throw new Error("ENDPOINT_PUBLIC_IDENTITY_INVALID") }
  const expectedPort = Number(new URL(endpoint.probeUrl).port)
  if (!identity || typeof identity !== "object" || Array.isArray(identity) ||
      (identity as Record<string, unknown>).worldId !== endpoint.worldId ||
      (identity as Record<string, unknown>).head !== endpoint.head ||
      (identity as Record<string, unknown>).port !== expectedPort) {
    throw new Error("ENDPOINT_PUBLIC_IDENTITY_MISMATCH")
  }
  const observedAt = now()
  return {
    ...endpoint,
    provenance: {
      ...endpoint.provenance,
      liveness: {
        status: "reachable",
        httpStatus: response.status,
        observedAt,
        evidenceRef: evidenceRef.trim(),
        publicRoute: {
          status: "reachable",
          httpStatus: publicResponse.status,
          observedAt,
          evidenceRef: evidenceRef.trim(),
        },
      },
    },
  }
}
