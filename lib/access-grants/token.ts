import { createHmac, randomBytes, timingSafeEqual } from "node:crypto"
import {
  ACCESS_GRANT_TOKEN_MAX_LENGTH,
  ACCESS_GRANT_TOKEN_MIN_PAYLOAD_LENGTH,
  ACCESS_GRANT_TOKEN_PREFIX,
  ACCESS_GRANT_TOKEN_RANDOM_BYTES,
} from "./constants"

export type AccessGrantTokenParseResult =
  | { ok: true; token: string; tokenPrefix: string }
  | { ok: false; reason: "missing" | "too_long" | "unsupported_prefix" | "malformed" }

const TOKEN_PAYLOAD_PATTERN = /^[A-Za-z0-9_-]+$/

export function generateAccessGrantToken(): string {
  return `${ACCESS_GRANT_TOKEN_PREFIX}${randomBytes(ACCESS_GRANT_TOKEN_RANDOM_BYTES).toString("base64url")}`
}

export function parseAccessGrantToken(input: unknown): AccessGrantTokenParseResult {
  if (typeof input !== "string" || input.trim().length === 0) {
    return { ok: false, reason: "missing" }
  }

  const token = input.trim()
  if (token.length > ACCESS_GRANT_TOKEN_MAX_LENGTH) {
    return { ok: false, reason: "too_long" }
  }

  if (!token.startsWith(ACCESS_GRANT_TOKEN_PREFIX)) {
    return { ok: false, reason: "unsupported_prefix" }
  }

  const payload = token.slice(ACCESS_GRANT_TOKEN_PREFIX.length)
  if (
    payload.length < ACCESS_GRANT_TOKEN_MIN_PAYLOAD_LENGTH ||
    !TOKEN_PAYLOAD_PATTERN.test(payload)
  ) {
    return { ok: false, reason: "malformed" }
  }

  return {
    ok: true,
    token,
    tokenPrefix: token.slice(0, Math.min(12, token.length)),
  }
}

export function hashAccessGrantToken(token: string, pepper: string): string {
  if (!pepper.trim()) {
    throw new Error("Access grant token pepper is required.")
  }

  return createHmac("sha256", pepper).update(token, "utf8").digest("hex")
}

export function safeCompareAccessGrantTokenHash(a: string, b: string): boolean {
  const left = Buffer.from(a, "hex")
  const right = Buffer.from(b, "hex")
  if (left.length === 0 || left.length !== right.length) return false
  return timingSafeEqual(left, right)
}
