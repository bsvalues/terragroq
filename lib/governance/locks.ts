// WO-020 — Unlock & Revocation Protocol (pure logic).
//
// STOP/HOLD/FREEZE locks need explicit release mechanics. Vague language
// ("let's go", "go ahead") can NEVER release a lock. Release requires a reason,
// a new posture, and (implicitly) operator intent expressed as structured input.

export const LOCK_KINDS = ["HOLD", "STOP", "FREEZE"] as const
export type LockKind = (typeof LOCK_KINDS)[number]

// Phrases that are too vague to ever constitute a lock release.
const VAGUE_RELEASE = [
  "let's go",
  "lets go",
  "go ahead",
  "just do it",
  "ship it",
  "send it",
  "proceed",
  "go for it",
  "do it",
  "yolo",
]

export function isVagueRelease(text: string): boolean {
  const lc = (text ?? "").trim().toLowerCase()
  if (lc.length === 0) return true
  return VAGUE_RELEASE.some((v) => lc === v || lc.includes(v))
}

export interface ReleaseValidation {
  ok: boolean
  reason: string
}

// Validate a structured release request. Both a substantive reason and a new
// posture are mandatory; vague phrasing is rejected outright.
export function validateRelease(input: {
  reason?: string
  newPosture?: string
}): ReleaseValidation {
  const reason = (input.reason ?? "").trim()
  const posture = (input.newPosture ?? "").trim()
  if (!reason || reason.length < 8) {
    return { ok: false, reason: "Release requires a substantive reason (≥ 8 characters)." }
  }
  if (isVagueRelease(reason)) {
    return { ok: false, reason: "Vague language cannot release a lock. State a concrete reason." }
  }
  if (!posture) {
    return { ok: false, reason: "Release requires an explicit new posture and allowed actions." }
  }
  return { ok: true, reason: "Release request is well-formed." }
}
