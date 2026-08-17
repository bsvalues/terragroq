import crypto from "node:crypto"
import fs from "node:fs/promises"

import { passkeyResolution } from "@/lib/auth"
import { pool } from "@/lib/db"
import { hashDeviceLinkCode, normalizeDeviceLinkCode } from "@/lib/device-link"
import { buildAppleIdentityProfile } from "@/lib/device-onboarding"

export const dynamic = "force-dynamic"

/**
 * Hand a device its own identity, so it never sees a sign-in page again.
 *
 * This profile carries a PRIVATE KEY: whoever installs it can open the cockpit. It is therefore
 * gated behind a one-time code minted on a device that is already signed in — the same proof used
 * to link a device — rather than being served openly like the public trust anchor. The code is
 * consumed on issue, so a profile cannot be fetched twice from one authorisation.
 */
export async function GET(request: Request) {
  const url = new URL(request.url)
  const code = normalizeDeviceLinkCode(url.searchParams.get("code"))
  if (code === null) {
    return Response.json({ error: "CODE_INVALID" }, { status: 400, headers: { "cache-control": "no-store" } })
  }

  let claimed: { userId: string } | undefined
  try {
    const result = await pool.query(
      `UPDATE "device_link"
          SET "consumedAt" = now()
        WHERE "tokenSha256" = $1 AND "consumedAt" IS NULL AND "expiresAt" > now()
      RETURNING "userId"`,
      [hashDeviceLinkCode(code)],
    )
    claimed = result.rows[0]
  } catch {
    return Response.json({ error: "UNAVAILABLE" }, { status: 503, headers: { "cache-control": "no-store" } })
  }
  // A wrong code and an expired one answer identically, so this cannot be used to probe for codes.
  if (!claimed) return Response.json({ error: "CODE_INVALID" }, { status: 400, headers: { "cache-control": "no-store" } })

  const caPath = process.env.WILLIAMOS_ROOT_CA_PATH
  const identityPath = process.env.WILLIAMOS_DEVICE_IDENTITY_P12
  const identityPassword = process.env.WILLIAMOS_DEVICE_IDENTITY_PASSWORD
  if (!caPath || !identityPath || !identityPassword) {
    return Response.json({ error: "IDENTITY_NOT_CONFIGURED" }, { status: 503, headers: { "cache-control": "no-store" } })
  }

  let certificatePem: string
  let identityP12Base64: string
  try {
    certificatePem = await fs.readFile(caPath, "utf8")
    identityP12Base64 = (await fs.readFile(identityPath)).toString("base64")
  } catch {
    return Response.json({ error: "IDENTITY_UNREADABLE" }, { status: 503, headers: { "cache-control": "no-store" } })
  }

  const origin = passkeyResolution.available ? passkeyResolution.relyingParty.origin : "this cockpit"
  const identifier = "lan.williamos.identity"
  const seed = `${identifier}:${certificatePem}:${identityP12Base64.slice(0, 64)}`

  let profile: string
  try {
    profile = buildAppleIdentityProfile({
      certificatePem,
      displayName: "WilliamOS",
      identifier,
      profileUuid: uuidFrom(`${seed}:profile`),
      payloadUuid: uuidFrom(`${seed}:root`),
      identityUuid: uuidFrom(`${seed}:identity`),
      identityName: "WilliamOS device identity",
      identityP12Base64,
      identityPassword,
      origin,
    })
  } catch {
    return Response.json({ error: "IDENTITY_INVALID" }, { status: 503, headers: { "cache-control": "no-store" } })
  }

  // Served inline: iOS only offers to install a configuration profile when it is not an attachment.
  return new Response(profile, {
    status: 200,
    headers: { "content-type": "application/x-apple-aspen-config", "cache-control": "no-store" },
  })
}

function uuidFrom(seed: string): string {
  const digest = crypto.createHash("sha256").update(seed).digest("hex")
  const variant = ((parseInt(digest.slice(16, 17), 16) & 0x3) | 0x8).toString(16)
  return [digest.slice(0, 8), digest.slice(8, 12), `4${digest.slice(13, 16)}`, `${variant}${digest.slice(17, 20)}`, digest.slice(20, 32)].join("-")
}
