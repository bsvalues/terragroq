import crypto from "node:crypto"

/**
 * One-time device links.
 *
 * A device that is already signed in mints a short code; a second device types it once and receives
 * its own session. Nothing here depends on WebAuthn, a platform authenticator, or any operating
 * system capability — which is the point. It works on a phone whose browser will not create a
 * passkey for this origin, on Windows builds that cannot do cross-device passkeys, and on anything
 * else on the network.
 *
 * A QR code was the obvious shape, but a hand-written encoder that has never been read back by a
 * real camera is a guess, and sending the owner to scan an unverifiable square is how the last few
 * hours were spent. Eight typed characters are worse UX and strictly better engineering.
 *
 * The bounds that make this safe are narrow rather than ceremonial:
 *  - only an authenticated session can mint a code, so possession never escalates beyond the
 *    operator who already had access;
 *  - it lives for two minutes and is redeemable exactly once;
 *  - only a SHA-256 digest is stored, so reading the database yields nothing usable;
 *  - redemption is a single conditional update, so two devices racing the same code cannot both win.
 *
 * Pure: no IO, no database, no framework.
 */

export const DEVICE_LINK_TTL_MS = 2 * 60 * 1000

/** Crockford-style alphabet: no I, L, O, U, so a typed code cannot be misread. */
const ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ"
const CODE_LENGTH = 8
const CODE_PATTERN = /^[0-9A-HJKMNP-TV-Z]{8}$/

/** ~1.1e12 possibilities, drawn from a CSPRNG without modulo bias. */
export function createDeviceLinkCode(randomBytes: (size: number) => Buffer = crypto.randomBytes): string {
  let code = ""
  while (code.length < CODE_LENGTH) {
    for (const byte of randomBytes(CODE_LENGTH)) {
      if (byte >= 256 - (256 % ALPHABET.length)) continue // reject the biased tail
      code += ALPHABET[byte % ALPHABET.length]
      if (code.length === CODE_LENGTH) break
    }
  }
  return code
}

/** Accepts what a human actually types: spaces, dashes, lower case, and the usual misreadings. */
export function normalizeDeviceLinkCode(input: unknown): string | null {
  if (typeof input !== "string") return null
  const cleaned = input
    .toUpperCase()
    .replace(/[\s-]/g, "")
    .replace(/[IL]/g, "1")
    .replace(/O/g, "0")
    .replace(/U/g, "V")
  return CODE_PATTERN.test(cleaned) ? cleaned : null
}

export function hashDeviceLinkCode(code: string): string {
  const normalized = normalizeDeviceLinkCode(code)
  if (normalized === null) throw new Error("DEVICE_LINK_CODE_INVALID")
  return crypto.createHash("sha256").update(normalized).digest("hex")
}

/** Grouped for reading aloud or off a screen. */
export function formatDeviceLinkCode(code: string): string {
  const normalized = normalizeDeviceLinkCode(code)
  if (normalized === null) throw new Error("DEVICE_LINK_CODE_INVALID")
  return `${normalized.slice(0, 4)}-${normalized.slice(4)}`
}

export type DeviceLinkRecord = {
  readonly expiresAt: Date | string
  readonly consumedAt: Date | string | null
}

export type DeviceLinkVerdict =
  | { readonly usable: true }
  | { readonly usable: false; readonly reason: "EXPIRED" | "ALREADY_USED" }

/** Whether a stored link may still be redeemed at `now`. */
export function inspectDeviceLink(record: DeviceLinkRecord, now: Date = new Date()): DeviceLinkVerdict {
  if (record.consumedAt !== null && record.consumedAt !== undefined) return { usable: false, reason: "ALREADY_USED" }
  const expires = record.expiresAt instanceof Date ? record.expiresAt : new Date(record.expiresAt)
  if (!Number.isFinite(expires.getTime()) || expires.getTime() <= now.getTime()) return { usable: false, reason: "EXPIRED" }
  return { usable: true }
}

export function deviceLinkExpiry(now: Date = new Date(), ttlMs: number = DEVICE_LINK_TTL_MS): Date {
  return new Date(now.getTime() + ttlMs)
}

/** Where the second device goes to type the code. */
export function deviceLinkEntryUrl(origin: string): string {
  return `${origin.replace(/\/+$/, "")}/link`
}
