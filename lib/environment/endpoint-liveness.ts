import type { WorldEndpointIdentity } from "@/lib/environment/world-projection"
import { requireAllowedEnvironmentEndpoint } from "@/lib/environment/endpoint-policy"

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
  const url = requireAllowedEnvironmentEndpoint(endpoint.appUrl)
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
  return {
    ...endpoint,
    provenance: {
      ...endpoint.provenance,
      liveness: {
        status: "reachable",
        httpStatus: response.status,
        observedAt: now(),
        evidenceRef: evidenceRef.trim(),
      },
    },
  }
}
