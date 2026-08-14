import { createHash, createPublicKey, verify } from "node:crypto"

export const DEVICE_AUTH_HEADER = "x-williamos-device"
export const DEVICE_SESSION_COOKIE = "__Host-williamos-device"
export const DEVICE_SESSION_TTL_SECONDS = 12 * 60 * 60

type DeviceProofInput = {
  purpose: "enroll" | "authenticate"
  challengeId: string
  challenge: string
  origin: string
  expiresAt: string
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const BASE64URL_32 = /^[A-Za-z0-9_-]{43}$/

function canonicalOrigin(value: string) {
  const url = new URL(value)
  if ((url.protocol !== "https:" && url.protocol !== "http:") || url.pathname !== "/" || url.search || url.hash) {
    throw new Error("DEVICE_ORIGIN_INVALID")
  }
  return url.origin
}

export function buildDeviceProof(input: DeviceProofInput) {
  if (!UUID.test(input.challengeId) || !BASE64URL_32.test(input.challenge)) {
    throw new Error("DEVICE_CHALLENGE_INVALID")
  }
  const expiresAt = new Date(input.expiresAt)
  if (!Number.isFinite(expiresAt.getTime()) || expiresAt.toISOString() !== input.expiresAt) {
    throw new Error("DEVICE_EXPIRY_INVALID")
  }
  return [
    "williamos-device-auth-v1",
    `purpose=${input.purpose}`,
    `requestId=${input.challengeId.toLowerCase()}`,
    `challenge=${input.challenge}`,
    `origin=${canonicalOrigin(input.origin)}`,
    `expiresAt=${input.expiresAt}`,
  ].join("\n")
}

export function verifyDeviceProof(input: {
  proof: string
  signature: string
  publicKeySpki: string
}) {
  try {
    if (input.proof.length > 512 || input.signature.length > 128 || input.publicKeySpki.length > 128) return false
    const signature = Buffer.from(input.signature, "base64url")
    const publicKey = Buffer.from(input.publicKeySpki, "base64url")
    if (signature.length !== 64 || publicKey.length < 40 || publicKey.length > 64) return false
    const key = createPublicKey({ key: publicKey, type: "spki", format: "der" })
    return key.asymmetricKeyType === "ed25519" && verify(null, Buffer.from(input.proof), key, signature)
  } catch {
    return false
  }
}

export function hashOpaqueValue(value: string) {
  if (value.length < 16 || value.length > 256) throw new Error("DEVICE_OPAQUE_VALUE_INVALID")
  return createHash("sha256").update(value, "utf8").digest("hex")
}

export function validateDeviceMutationOrigin(
  request: Request,
  trustedOrigins: string[],
  options: { trustLoopbackHttpsProxy?: boolean } = {},
) {
  if (request.method !== "POST" || request.headers.get(DEVICE_AUTH_HEADER) !== "1") {
    throw new Error("DEVICE_ORIGIN_REJECTED")
  }
  const supplied = request.headers.get("origin")
  if (!supplied) throw new Error("DEVICE_ORIGIN_REJECTED")
  let origin: string
  try {
    origin = canonicalOrigin(supplied)
  } catch {
    throw new Error("DEVICE_ORIGIN_REJECTED")
  }
  if (!trustedOrigins.includes(origin)) {
    throw new Error("DEVICE_ORIGIN_REJECTED")
  }
  const requestUrl = new URL(request.url)
  if (requestUrl.origin !== origin) {
    const external = new URL(origin)
    const internalIsLoopback = requestUrl.hostname === "localhost"
      || requestUrl.hostname === "127.0.0.1"
      || requestUrl.hostname === "[::1]"
    const forwardedIsExact = request.headers.get("host") === external.host
      && request.headers.get("forwarded") === null
      && request.headers.get("x-forwarded-host") === external.host
      && request.headers.get("x-forwarded-port") === (external.port || "443")
      && request.headers.get("x-forwarded-proto") === "https"
    if (!options.trustLoopbackHttpsProxy || external.protocol !== "https:" || !internalIsLoopback || !forwardedIsExact) {
      throw new Error("DEVICE_ORIGIN_REJECTED")
    }
  }
  return origin
}

export function deviceSessionCookieOptions(production: boolean) {
  return {
    httpOnly: true,
    secure: production,
    sameSite: "strict" as const,
    path: "/",
    maxAge: DEVICE_SESSION_TTL_SECONDS,
  }
}
