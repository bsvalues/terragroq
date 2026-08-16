import crypto from "node:crypto"
import fs from "node:fs/promises"

import { headers } from "next/headers"

import { auth, passkeyResolution } from "@/lib/auth"
import { buildAppleTrustProfile } from "@/lib/device-onboarding"

export const dynamic = "force-dynamic"

/**
 * Serves the cockpit's root CA as an installable Apple configuration profile.
 *
 * Authenticated only: this is an onboarding convenience for the Primary Operator adding one of his
 * own devices, not a public trust-anchor distribution point. The payload is a *public* certificate
 * — no key material — but requiring a session keeps the surface consistent with the rest of the
 * cockpit and keeps the file off an unauthenticated URL.
 *
 * The certificate path is configuration, not a guess, so a missing setting is reported plainly
 * instead of serving an empty profile that would install cleanly and trust nothing.
 */
export async function GET() {
  const session = await auth.api.getSession({ headers: await headers() })
  if (!session?.user) {
    return new Response("Sign in first.", { status: 401, headers: { "content-type": "text/plain; charset=utf-8" } })
  }

  const certificatePath = process.env.WILLIAMOS_ROOT_CA_PATH
  if (!certificatePath) {
    return Response.json(
      { error: "ROOT_CA_PATH_UNSET", detail: "Set WILLIAMOS_ROOT_CA_PATH to the cockpit root CA certificate." },
      { status: 503 },
    )
  }

  let certificatePem: string
  try {
    certificatePem = await fs.readFile(certificatePath, "utf8")
  } catch {
    return Response.json(
      { error: "ROOT_CA_UNREADABLE", detail: "The configured root CA certificate could not be read." },
      { status: 503 },
    )
  }

  const origin = passkeyResolution.available ? passkeyResolution.relyingParty.origin : "this cockpit"
  const identifier = "lan.williamos.trust"

  let profile: string
  try {
    profile = buildAppleTrustProfile({
      certificatePem,
      displayName: "WilliamOS",
      identifier,
      // Stable per certificate: re-installing replaces the profile instead of stacking duplicates.
      profileUuid: uuidFrom(`${identifier}:profile:${certificatePem}`),
      payloadUuid: uuidFrom(`${identifier}:payload:${certificatePem}`),
      origin,
    })
  } catch {
    return Response.json(
      { error: "ROOT_CA_INVALID", detail: "The configured file contains no PEM certificate." },
      { status: 503 },
    )
  }

  return new Response(profile, {
    status: 200,
    headers: {
      "content-type": "application/x-apple-aspen-config",
      "content-disposition": 'attachment; filename="williamos-trust.mobileconfig"',
      "cache-control": "no-store",
    },
  })
}

/** Deterministic RFC-4122-shaped UUID derived from stable input. */
function uuidFrom(seed: string): string {
  const digest = crypto.createHash("sha256").update(seed).digest("hex")
  const variant = ((parseInt(digest.slice(16, 17), 16) & 0x3) | 0x8).toString(16)
  return [
    digest.slice(0, 8),
    digest.slice(8, 12),
    `4${digest.slice(13, 16)}`,
    `${variant}${digest.slice(17, 20)}`,
    digest.slice(20, 32),
  ].join("-")
}
