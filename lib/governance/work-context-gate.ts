import { headers } from "next/headers"

import { pool } from "@/lib/db"
import { measureLiveWorkContext } from "@/lib/governance/work-context-live"
import { verifyWorkContextReceipt, type WorkContextFacts, type WorkContextVerdict } from "@/lib/governance/work-context-receipt"

/** The header a lane presents to prove it established context before mutating. */
export const WORK_CONTEXT_HEADER = "x-williamos-work-context"

/**
 * Refuse a mutation whose premise was never proven, or has since gone stale.
 *
 * This is the enforcement half. Everything else in the receipt design is bookkeeping until something
 * actually declines to act on it -- and the thing that declines has to sit on the mutation path
 * itself, not in a reviewer's checklist, because a checklist is another instruction an agent can
 * skip while a 409 is not.
 *
 * Staleness is recomputed rather than trusted: the stored claims are re-hashed against current main
 * and the current doctrine digest, so a receipt issued ten minutes and three merges ago fails here
 * without anything having to expire it.
 */
export async function requireWorkContext(requestedPath?: string): Promise<WorkContextVerdict> {
  const presented = (await headers()).get(WORK_CONTEXT_HEADER)?.trim()
  if (!presented) {
    return { ok: false, failure: "FAILED_CONTEXT_NOT_PROVEN", detail: "no work context receipt was presented" }
  }

  let stored: WorkContextFacts | null = null
  try {
    const result = await pool.query(
      `SELECT "metadata" FROM "governance_event"
        WHERE "entityType" = 'work_context_receipt' AND "entityId" = $1
        ORDER BY "createdAt" DESC LIMIT 1`,
      [presented],
    )
    stored = (result.rows[0]?.metadata as WorkContextFacts) ?? null
  } catch {
    // An unreadable ledger must not become an open gate. If the record cannot be consulted, the
    // premise is unproven by definition.
    return { ok: false, failure: "FAILED_CONTEXT_NOT_PROVEN", detail: "the receipt ledger could not be read" }
  }
  if (!stored) {
    return { ok: false, failure: "FAILED_CONTEXT_NOT_PROVEN", detail: "that receipt was never issued" }
  }

  const live = await measureLiveWorkContext()
  if (!live) {
    return { ok: false, failure: "FAILED_STALE_MAIN", detail: "current origin/main could not be measured" }
  }

  // Re-derive from the stored claims plus TODAY's measured truth. If main or doctrine moved, the
  // token no longer matches and the lane must prove context again before its next effect.
  const verified = verifyWorkContextReceipt(presented, {
    ...stored,
    mainSha: live.mainSha,
    doctrineDigest: live.doctrineDigest,
  })
  if (!verified.ok || requestedPath === undefined) return verified
  return reservationCoversRequestedPath(requestedPath, stored.reservedPaths)
}

type PathScopeVerdict =
  | Readonly<{ ok: true }>
  | Readonly<{ ok: false; failure: "FAILED_SCOPE_COLLISION"; detail: string }>

function normalizedRelativePath(value: string): string | null {
  const candidate = value.trim().replace(/\\/g, "/")
  if (!candidate || candidate.includes("\0") || candidate.startsWith("/")
    || candidate.startsWith("//") || /^[A-Za-z]:/.test(candidate)) return null
  const segments = candidate.split("/").filter((segment) => segment !== "" && segment !== ".")
  if (segments.length === 0 || segments.some((segment) => segment === "..")) return null
  return segments.join("/")
}

/** Bind a proven receipt's declared reservation to the exact mutation path being attempted. */
export function reservationCoversRequestedPath(
  requestedPath: string,
  reservedPaths: readonly string[],
): PathScopeVerdict {
  const requested = normalizedRelativePath(requestedPath)
  if (!requested) {
    return { ok: false, failure: "FAILED_SCOPE_COLLISION", detail: `${requestedPath} is outside the receipt path reservation` }
  }
  for (const rawReservation of reservedPaths) {
    const slashNormalized = rawReservation.trim().replace(/\\/g, "/")
    const directory = slashNormalized.endsWith("/") || slashNormalized.endsWith("/**")
    const withoutGlob = slashNormalized.endsWith("/**") ? slashNormalized.slice(0, -3) : slashNormalized
    const reserved = normalizedRelativePath(withoutGlob)
    if (!reserved) continue
    if (requested === reserved || (directory && requested.startsWith(`${reserved}/`))) return { ok: true }
  }
  return {
    ok: false,
    failure: "FAILED_SCOPE_COLLISION",
    detail: `${requested} is outside the receipt path reservation`,
  }
}

/** Shape a refusal the same way everywhere, so a blocked lane always learns which premise failed. */
export function workContextRefusal(verdict: WorkContextVerdict): Response {
  return Response.json(
    {
      error: verdict.failure ?? "FAILED_CONTEXT_NOT_PROVEN",
      detail: verdict.detail,
      remedy: "POST /api/governance/work-context with the work order, reservation, subsystem search and parent acceptance, then retry with the returned receipt.",
    },
    { status: 409, headers: { "cache-control": "no-store" } },
  )
}
