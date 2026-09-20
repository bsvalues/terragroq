import { assertOwner, resolveOwnerUserId } from "@/lib/governance/owner"
import { ownerLookup } from "@/lib/governance/owner-lookup"
import { getHelloApplicationRuntime } from "@/lib/hello-application/runtime-supervisor"
import { getSession } from "@/lib/session"

export const dynamic = "force-dynamic"
export const runtime = "nodejs"

const MAX_PREVIEW_BYTES = 1_000_000
const PREVIEW_TIMEOUT_MS = 5_000

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

  const controller = new AbortController()
  let timer: ReturnType<typeof setTimeout> | undefined
  let upstream: Response | undefined
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined
  const deadline = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => {
      controller.abort()
      reject(new Error("HELLO_APPLICATION_PREVIEW_TIMEOUT"))
    }, PREVIEW_TIMEOUT_MS)
  })
  const cancelBody = () => {
    try {
      const cancellation = reader ? reader.cancel() : upstream?.body?.cancel()
      void cancellation?.catch(() => {})
    } catch { /* Cancellation is best effort after the response is already refused. */ }
  }

  try {
    upstream = await Promise.race([
      fetch(supervised.url, {
        cache: "no-store",
        credentials: "omit",
        redirect: "error",
        signal: controller.signal,
      }),
      deadline,
    ])
    if (!upstream.ok) {
      controller.abort()
      cancelBody()
      return refuse(`HELLO_APPLICATION_UPSTREAM_${upstream.status}`, 502)
    }
    if (!/^text\/html\b/i.test(upstream.headers.get("content-type") ?? "")) {
      controller.abort()
      cancelBody()
      return refuse("HELLO_APPLICATION_PREVIEW_TYPE_INVALID", 502)
    }
    const declaredLength = upstream.headers.get("content-length")
    if (declaredLength && /^\d+$/.test(declaredLength) && Number(declaredLength) > MAX_PREVIEW_BYTES) {
      controller.abort()
      cancelBody()
      return refuse("HELLO_APPLICATION_PREVIEW_TOO_LARGE", 502)
    }
    const chunks: Uint8Array[] = []
    let total = 0
    if (upstream.body) {
      reader = upstream.body.getReader()
      for (;;) {
        const { done, value } = await Promise.race([reader.read(), deadline])
        if (done) break
        total += value.byteLength
        if (total > MAX_PREVIEW_BYTES) {
          controller.abort()
          cancelBody()
          return refuse("HELLO_APPLICATION_PREVIEW_TOO_LARGE", 502)
        }
        chunks.push(value)
      }
    }
    const bytes = new Uint8Array(total)
    let offset = 0
    for (const chunk of chunks) {
      bytes.set(chunk, offset)
      offset += chunk.byteLength
    }
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
    controller.abort()
    cancelBody()
    return refuse("HELLO_APPLICATION_PREVIEW_UNAVAILABLE", 502)
  } finally {
    if (timer) clearTimeout(timer)
  }
}
