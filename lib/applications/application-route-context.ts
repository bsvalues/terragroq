import { assertOwner, resolveOwnerUserId } from "@/lib/governance/owner"
import { ownerLookup } from "@/lib/governance/owner-lookup"
import { getSession } from "@/lib/session"
import { guardLineRequest } from "@/lib/environment/line-guard"
import { discoverApplications, type CatalogApplication } from "./application-catalog"
import { isApplicationId } from "./application-manifest"

export const applicationReply = (value: unknown, status = 200) => Response.json(value, {
  status, headers: { "cache-control": "no-store" },
})

export async function authorizeApplicationOwner() {
  const session = await getSession().catch(() => null)
  if (!session) return { ok: false as const, response: applicationReply({ error: "UNAUTHENTICATED" }, 401) }
  const ownerId = await resolveOwnerUserId(ownerLookup(), process.env.WILLIAMOS_OWNER_EMAIL)
  const owner = assertOwner(session.user.id, ownerId)
  if (!owner.ok) return { ok: false as const, response: applicationReply({ error: owner.failure }, owner.failure === "NOT_OWNER" ? 403 : 409) }
  return { ok: true as const, userId: session.user.id }
}

export function guardApplicationMutation(request: Request): Response | null {
  const rejection = guardLineRequest(request)
  if (rejection) return applicationReply({ error: rejection.error }, rejection.status)
  // The shared guard uses Host/forwarded headers. Also cover ordinary Request objects with neither.
  if (request.headers.get("origin") && !request.headers.get("host") && !request.headers.get("x-forwarded-host")
    && request.headers.get("origin") !== new URL(request.url).origin) return applicationReply({ error: "CROSS_ORIGIN_REFUSED" }, 403)
  return null
}

export type ApplicationRouteContext = Readonly<{ userId: string; application: CatalogApplication }>
export async function resolveApplicationRouteContext(projectKey: unknown): Promise<
  Readonly<{ ok: true; context: ApplicationRouteContext }> | Readonly<{ ok: false; response: Response }>
> {
  const owner = await authorizeApplicationOwner()
  if (!owner.ok) return owner
  if (!isApplicationId(projectKey)) return { ok: false, response: applicationReply({ error: "APPLICATION_NOT_FOUND" }, 404) }
  try {
    const catalog = await discoverApplications()
    const application = catalog.applications.find(({ manifest }) => manifest.id === projectKey)
    if (!application) return { ok: false, response: applicationReply({ error: "APPLICATION_NOT_FOUND" }, 404) }
    return { ok: true, context: { userId: owner.userId, application } }
  } catch { return { ok: false, response: applicationReply({ error: "APPLICATION_CATALOG_UNAVAILABLE" }, 503) } }
}
