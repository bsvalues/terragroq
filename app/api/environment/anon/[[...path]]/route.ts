/**
 * Server-guaranteed anonymous document fetcher for browser surfaces (#762).
 *
 * A browser surface reproducing an anonymous flow must be anonymous in every browser the owner might
 * sit at. The first attempt used the `credentialless` iframe attribute: it worked in one Chromium
 * build and silently did nothing in the owner's browser, so the signed-in session followed the
 * redirect straight back into the frozen legacy shell — inside the replacement environment. Never
 * again a client feature: this route fetches the requested page of THIS application with no cookies
 * at all, follows redirects itself (still cookieless), and returns the final document. What renders
 * is what an anonymous visitor gets, everywhere, deterministically.
 *
 * Bounded on purpose: GET only, same-application origin only (loopback), path allowlisted to plain
 * page paths, set-cookie stripped from the response.
 */

export const dynamic = "force-dynamic"

// Self-fetches target the standalone listener itself: loopback on the port THIS process serves.
// A hardcoded 3100 was wrong the moment the container mapped a different port (review P1).
const SELF_ORIGIN = process.env.WILLIAMOS_SELF_ORIGIN?.trim() || `http://127.0.0.1:${process.env.PORT ?? "3100"}`

import { isFrameablePath } from "@/lib/environment/frameable"

// Deliberately unauthenticated: this route serves documents to sandboxed, COOKIELESS frames -- the
// whole point is that the frame carries no session, so it cannot present one here either. Demanding
// auth was a catch-22 that blanked every browser surface. Nothing is exposed that an anonymous
// visitor could not fetch directly: GET only, self-origin only, plain page paths only.
export async function GET(request: Request, { params }: { params: Promise<{ path?: string[] }> }) {
  const segments = (await params).path ?? []
  const path = `/${segments.join("/")}`
  if (!isFrameablePath(segments)) return new Response("PATH_REFUSED", { status: 400 })

  let url = `${SELF_ORIGIN}${path}`
  for (let hop = 0; hop < 5; hop += 1) {
    let response: Response
    try {
      response = await fetch(url, {
        redirect: "manual",
        headers: { accept: "text/html" },
        signal: AbortSignal.timeout(15_000),
      })
    } catch {
      return new Response("The application did not answer.", { status: 502 })
    }
    const location = response.headers.get("location")
    if (location) {
      url = location.startsWith("http") ? location : `${SELF_ORIGIN}${location}`
      if (!url.startsWith(SELF_ORIGIN)) return new Response("REDIRECT_REFUSED", { status: 502 })
      continue
    }
    const html = await response.text()
    return new Response(html, {
      status: response.status,
      headers: { "content-type": response.headers.get("content-type") ?? "text/html; charset=utf-8" },
    })
  }
  return new Response("REDIRECT_LOOP", { status: 502 })
}
