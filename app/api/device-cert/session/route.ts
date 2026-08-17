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
 * The x-williamos-device-cert header is asserted solely by the proxy, which strips any inbound copy before
 * forwarding, and the app listens on loopback so nothing else can reach it. A request without that
 * header is simply not a certificate-bearing device and falls through to the ordinary path.
 */
export async function GET(request: Request) {
  const url = new URL(request.url)
  const next = url.searchParams.get("next")
  const destination = typeof next === "string" && next.startsWith("/") && !next.startsWith("//") ? next : "/"

  const device = (await headers()).get("x-williamos-device-cert")
  if (!device) return new Response(null, { status: 303, headers: { location: "/sign-in" } })

  // The certificate proves a trusted DEVICE; it must still resolve to the right operator. Taking the
  // oldest row was wrong: this database also holds abandoned rows from setup and diagnostics, and
  // the oldest of those is not the owner. Resolve explicitly, and refuse to guess when ambiguous --
  // signing someone into the wrong identity is worse than sending them to a sign-in page.
  let userId: string | undefined
  try {
    const configured = process.env.WILLIAMOS_OWNER_EMAIL?.trim().toLowerCase()
    if (configured) {
      const byEmail = await pool.query('SELECT "id" FROM "user" WHERE lower("email") = $1 LIMIT 1', [configured])
      userId = byEmail.rows[0]?.id
    }
    if (!userId) {
      // Fall back to the only account that can actually sign in: one with a credential.
      const credentialed = await pool.query(
        `SELECT u."id" FROM "user" u
           JOIN "account" a ON a."userId" = u."id" AND a."providerId" = 'credential' AND a."password" IS NOT NULL`,
      )
      if (credentialed.rowCount === 1) userId = credentialed.rows[0].id
    }
  } catch {
    return new Response(null, { status: 303, headers: { location: "/sign-in" } })
  }
  if (!userId) return new Response(null, { status: 303, headers: { location: "/sign-in?reason=owner-unresolved" } })

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
