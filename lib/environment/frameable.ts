/**
 * Only pages the environment actually frames, allowlisted explicitly. A character-class check alone
 * let an unauthenticated caller relay GETs to internal /api/* routes from loopback (review P1 on
 * #923) — a public proxy must enumerate what it serves, not describe what characters it accepts.
 * Lives in lib because a Next route file may export nothing beyond its HTTP methods, and the
 * predicate must stay testable.
 */
const FRAMEABLE_PAGES = new Set(["", "sign-in"])

export function isFrameablePath(segments: readonly string[]): boolean {
  if (segments.length > 1) return false
  const first = segments[0] ?? ""
  return /^[A-Za-z0-9_-]*$/.test(first) && FRAMEABLE_PAGES.has(first)
}
