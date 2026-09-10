import { getSession } from "@/lib/session"
import { readHermesStatus, verifyHermesInference } from "@/lib/hermes/status-source"
import { guardLineRequest, readBoundedJson } from "@/lib/environment/line-guard"

export const dynamic = "force-dynamic"
export const runtime = "nodejs"
export const maxDuration = 90

const reply = (value: unknown, status = 200) => Response.json(value, {
  status,
  headers: { "cache-control": "no-store" },
})

async function authenticated(): Promise<boolean> {
  try {
    return Boolean((await getSession())?.user)
  } catch {
    return false
  }
}

export async function GET() {
  if (!await authenticated()) return reply({ error: "UNAUTHENTICATED" }, 401)
  return reply(await readHermesStatus())
}

export async function POST(request: Request) {
  const rejection = guardLineRequest(request)
  if (rejection) return reply({ error: rejection.error }, rejection.status)
  if (!await authenticated()) return reply({ error: "UNAUTHENTICATED" }, 401)
  const declaredLength = request.headers.get("content-length")
  if (declaredLength !== null && (!/^\d+$/.test(declaredLength) || Number(declaredLength) > 4096)) {
    return reply({ error: "MESSAGE_TOO_LARGE" }, 413)
  }
  const parsed = await readBoundedJson(request, 4096)
  if (!parsed.ok) return reply({ error: parsed.error }, parsed.status)
  const body = parsed.value
  if (!body || typeof body !== "object" || Array.isArray(body)
    || Object.keys(body as Record<string, unknown>).join("|") !== "action") {
    return reply({ error: "ACTION_REQUEST_INVALID" }, 400)
  }
  if ((body as Record<string, unknown>).action !== "verify-inference") {
    return reply({ error: "ACTION_NOT_SUPPORTED" }, 400)
  }
  const receipt = await verifyHermesInference()
  return reply({ receipt }, receipt.result === "PASS" ? 200 : 409)
}
