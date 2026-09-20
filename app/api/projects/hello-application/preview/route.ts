import { assertOwner, resolveOwnerUserId } from "@/lib/governance/owner"
import { ownerLookup } from "@/lib/governance/owner-lookup"
import { getHelloApplicationRuntime } from "@/lib/hello-application/runtime-supervisor"
import { getSession } from "@/lib/session"

export const dynamic = "force-dynamic"
export const runtime = "nodejs"

const MAX_PREVIEW_BYTES = 1_000_000

const refuse = (error: string, status: number) => Response.json({ error }, {
  status,
  headers: { "cache-control": "no-store" },
})

export async function GET() {
  const session = await getSession()
  if (!session) return refuse("UNAUTHENTICATED", 401)
  const ownerId = await resolveOwnerUserId(ownerLookup(), process.env.WILLIAMOS_OWNER_EMAIL)
  const owner = assertOwner(session.user.id, ownerId)
  if (!owner.ok) return refuse(owner.failure ?? "OWNER_AUTHORITY_UNAVAILABLE", owner.failure === "NOT_OWNER" ? 403 : 409)

  const supervised = getHelloApplicationRuntime()
  if (supervised.state !== "running" || !supervised.url) {
    return refuse("HELLO_APPLICATION_NOT_RUNNING", 409)
  }

  try {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), 5_000)
    let upstream: Response
    try {
      upstream = await fetch(supervised.url, {
        cache: "no-store",
        credentials: "omit",
        redirect: "error",
        signal: controller.signal,
      })
    } finally {
      clearTimeout(timer)
    }
    if (!upstream.ok) return refuse(`HELLO_APPLICATION_UPSTREAM_${upstream.status}`, 502)
    if (!/^text\/html\b/i.test(upstream.headers.get("content-type") ?? "")) {
      return refuse("HELLO_APPLICATION_PREVIEW_TYPE_INVALID", 502)
    }
    const bytes = new Uint8Array(await upstream.arrayBuffer())
    if (bytes.byteLength > MAX_PREVIEW_BYTES) return refuse("HELLO_APPLICATION_PREVIEW_TOO_LARGE", 502)
    return new Response(bytes, {
      status: 200,
      headers: {
        "cache-control": "no-store",
        "content-type": "text/html; charset=utf-8",
        "content-security-policy": "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data:; connect-src 'none'; form-action 'none'; base-uri 'none'; sandbox allow-scripts",
        "referrer-policy": "no-referrer",
        "x-content-type-options": "nosniff",
      },
    })
  } catch {
    return refuse("HELLO_APPLICATION_PREVIEW_UNAVAILABLE", 502)
  }
}
