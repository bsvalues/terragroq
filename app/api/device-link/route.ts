import crypto from "node:crypto"

import { headers } from "next/headers"

import { auth } from "@/lib/auth"
import { pool } from "@/lib/db"
import { createDeviceLinkCode, deviceLinkExpiry, formatDeviceLinkCode, hashDeviceLinkCode } from "@/lib/device-link"

export const dynamic = "force-dynamic"

/**
 * Mint a one-time code that signs another device in.
 *
 * Only an authenticated session may mint one, so a code never grants more than the operator who
 * asked for it already had. The code itself is returned exactly once, here, and only its digest is
 * written down.
 */
export async function POST() {
  const session = await auth.api.getSession({ headers: await headers() })
  if (!session?.user) {
    return Response.json({ error: "UNAUTHENTICATED" }, { status: 401 })
  }

  const code = createDeviceLinkCode()
  const expiresAt = deviceLinkExpiry()

  try {
    // Invalidate this operator's pending codes: at most one link should ever be live, so a code
    // left on screen from an abandoned attempt cannot be redeemed later.
    await pool.query(
      'UPDATE "device_link" SET "consumedAt" = now() WHERE "userId" = $1 AND "consumedAt" IS NULL',
      [session.user.id],
    )
    await pool.query(
      'INSERT INTO "device_link" ("id", "userId", "tokenSha256", "expiresAt") VALUES ($1, $2, $3, $4)',
      [crypto.randomUUID(), session.user.id, hashDeviceLinkCode(code), expiresAt.toISOString()],
    )
  } catch {
    return Response.json({ error: "DEVICE_LINK_UNAVAILABLE" }, { status: 503 })
  }

  return Response.json(
    { code: formatDeviceLinkCode(code), expiresAt: expiresAt.toISOString() },
    { headers: { "cache-control": "no-store" } },
  )
}
