import crypto from "node:crypto"

import { headers } from "next/headers"

import { auth } from "@/lib/auth"
import { pool } from "@/lib/db"

export const dynamic = "force-dynamic"

/**
 * Sign in a device that TLS already proved.
 *
 * This cockpit has one operator and lives on his own network, so an account system is the wrong
 * shape: there is nobody to invite, nobody to distinguish, and no reason to type a password into a
 * machine that has already presented a certificate issued by the cockpit's own authority. The proof
 * happens at the transport layer; this route only converts it into the session the app already uses.
 *
 * The device header is asserted solely by the HTTPS proxy, which strips any inbound copy before
 * forwarding, and the app listens on loopback so nothing else can reach it. A request without that
 * header is simply not a certificate-bearing device and falls through to the ordinary path.
 */
export async function GET(request: Request) {
  const url = new URL(request.url)
  const next = url.searchParams.get("next")
  const destination = typeof next === "string" && next.startsWith("/") && !next.startsWith("//") ? next : "/"

  const device = (await headers()).get("x-williamos-device")
  if (!device) return new Response(null, { status: 303, headers: { location: "/sign-in" } })

  // One operator: the certificate proves *a* trusted device, and the cockpit has exactly one owner
  // to attach it to. If that ever stops being true, this is the line that must grow a mapping.
  let userId: string | undefined
  try {
    const result = await pool.query('SELECT "id" FROM "user" ORDER BY "createdAt" ASC LIMIT 1')
    userId = result.rows[0]?.id
  } catch {
    return new Response(null, { status: 303, headers: { location: "/sign-in" } })
  }
  if (!userId) return new Response(null, { status: 303, headers: { location: "/sign-in" } })

  const context = await auth.$context
  const session = await context.internalAdapter.createSession(userId, false)
  if (!session) return new Response(null, { status: 303, headers: { location: "/sign-in" } })

  const cookie = context.authCookies.sessionToken
  const signature = crypto.createHmac("sha256", context.secret).update(session.token).digest("base64")
  const setCookie = [
    `${cookie.name}=${encodeURIComponent(`${session.token}.${signature}`)}`,
    `Path=${cookie.attributes.path ?? "/"}`,
    "HttpOnly",
    "SameSite=Lax",
    "Secure",
    `Max-Age=${Math.max(1, Math.floor((new Date(session.expiresAt).getTime() - Date.now()) / 1000))}`,
  ].join("; ")
  // Response.redirect() produces immutable headers, so the cookie is set in the init instead.
  return new Response(null, {
    status: 303,
    headers: { location: destination, "set-cookie": setCookie, "cache-control": "no-store" },
  })
}
