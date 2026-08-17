import crypto from "node:crypto"

import { auth } from "@/lib/auth"
import { pool } from "@/lib/db"
import { hashDeviceLinkCode, inspectDeviceLink, normalizeDeviceLinkCode } from "@/lib/device-link"

export const dynamic = "force-dynamic"

/**
 * Redeem a one-time code and give this device its own session.
 *
 * Redemption is a single conditional UPDATE that both claims the row and returns it, so two devices
 * racing the same code cannot both be signed in: the second finds nothing to claim. The code is
 * looked up by digest, never by value, and every failure answers the same way so the endpoint
 * cannot be used to learn whether a code exists.
 */
export async function POST(request: Request) {
  const invalid = () => Response.json({ error: "CODE_INVALID" }, { status: 400 })

  let submitted: unknown
  try {
    submitted = (await request.json())?.code
  } catch {
    return invalid()
  }
  const code = normalizeDeviceLinkCode(submitted)
  if (code === null) return invalid()

  let claimed: { userId: string; expiresAt: Date; consumedAt: Date | null } | undefined
  try {
    const result = await pool.query(
      `UPDATE "device_link"
          SET "consumedAt" = now()
        WHERE "tokenSha256" = $1
          AND "consumedAt" IS NULL
          AND "expiresAt" > now()
      RETURNING "userId", "expiresAt", "consumedAt"`,
      [hashDeviceLinkCode(code)],
    )
    claimed = result.rows[0]
  } catch {
    return Response.json({ error: "DEVICE_LINK_UNAVAILABLE" }, { status: 503 })
  }
  if (!claimed) return invalid()

  // The row was claimed inside the window; confirm the invariant rather than trusting the query.
  const verdict = inspectDeviceLink({ expiresAt: claimed.expiresAt, consumedAt: null })
  if (!verdict.usable) return invalid()

  const context = await auth.$context
  const session = await context.internalAdapter.createSession(claimed.userId, false)
  if (!session) return Response.json({ error: "SESSION_UNAVAILABLE" }, { status: 503 })

  const response = Response.json({ ok: true }, { headers: { "cache-control": "no-store" } })
  const cookie = context.authCookies.sessionToken
  // Better Auth stores the session token as a signed cookie: value.signature, where the signature
  // is a base64 HMAC-SHA256 of the token under the auth secret. An unsigned cookie is accepted by
  // the browser and then silently rejected by the server, which looks exactly like a working
  // sign-in that never signed anyone in, so it is signed here the same way the library does.
  const signature = crypto.createHmac("sha256", context.secret).update(session.token).digest("base64")
  const attributes = [
    `${cookie.name}=${encodeURIComponent(`${session.token}.${signature}`)}`,
    `Path=${cookie.attributes.path ?? "/"}`,
    "HttpOnly",
    "SameSite=Lax",
    "Secure",
    `Max-Age=${Math.max(1, Math.floor((new Date(session.expiresAt).getTime() - Date.now()) / 1000))}`,
  ].join("; ")
  response.headers.append("set-cookie", attributes)
  return response
}
