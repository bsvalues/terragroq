import {
  CeremonialContextRetirementError,
  retireCeremonialContexts,
} from "@/lib/environment/ceremonial-context-retirement"
import { guardLineRequest, readBoundedJson } from "@/lib/environment/line-guard"
import { isDeclaredPrimaryEmail } from "@/lib/primary-identity"
import { getSession } from "@/lib/session"

export const dynamic = "force-dynamic"
export const runtime = "nodejs"

const OWNER_USER_ID = "YCAbP6TPTU1sxkpf4gVl5FcX9Nf4lrwZ"

const reply = (value: unknown, status = 200) => Response.json(value, {
  status,
  headers: { "cache-control": "no-store" },
})

export async function POST(request: Request): Promise<Response> {
  const rejection = guardLineRequest(request)
  if (rejection) return reply({ error: rejection.error }, rejection.status)

  const session = await getSession()
  if (!session?.user) return reply({ error: "UNAUTHENTICATED" }, 401)
  if (session.user.id !== OWNER_USER_ID || !isDeclaredPrimaryEmail(session.user.email)) {
    return reply({ error: "OWNER_MISMATCH" }, 403)
  }

  const parsed = await readBoundedJson(request, 100)
  if (!parsed.ok) return reply({ error: parsed.error }, parsed.status)
  if (!parsed.value || typeof parsed.value !== "object" || Array.isArray(parsed.value)
    || Object.keys(parsed.value).length !== 0) {
    return reply({ error: "REQUEST_FIELDS_INVALID" }, 400)
  }

  try {
    return reply(await retireCeremonialContexts({ userId: session.user.id }))
  } catch (caught) {
    if (caught instanceof CeremonialContextRetirementError) {
      return reply({ error: caught.code }, caught.code === "TARGET_FOREIGN" || caught.code === "OWNER_MISMATCH" ? 403 : 409)
    }
    return reply({ error: "CEREMONIAL_CONTEXT_RETIREMENT_UNAVAILABLE" }, 503)
  }
}
