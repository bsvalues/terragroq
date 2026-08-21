import type { RetainedStartWork } from "@/lib/environment/working-world"

/**
 * The START_WORK transition (#762 real-operator acceptance, criterion 6).
 *
 * The invariant this file exists to hold: the exact outcome the current-work read named "next
 * startable" is the exact outcome started when the owner says "continue it". So the transition
 * consumes the RETAINED selection verbatim — no second project resolution, no second queue read to
 * re-find highest priority, no title matching, no recomputation. Eligibility is revalidated but never
 * reselected: the authorization call itself is an atomic compare-and-swap on (version 0, suggested,
 * unapproved), so a selection that went stale between the read and "continue" fails closed as
 * INELIGIBLE/CONFLICT rather than silently becoming a different item.
 */

// "continue the highest-priority TerraFusion OS work" / "continue it" / a bare "continue".
const CONTINUE = /\bcontinue\b(?:\s+it\b|[^?]*\bwork\b|[^?]*\b(?:highest|priority|outcome)\b|\s*[.!]?\s*$)/i

export function isContinueIntent(text: string): boolean {
  return CONTINUE.test(text.trim())
}

/**
 * A deterministic idempotency key for starting one outcome, so a duplicate click / retry reuses the
 * same key and the authorization dedupes (ALREADY_AUTHORIZED) rather than dispatching twice. Matches
 * the authorization contract's key shape: /^[A-Za-z0-9][A-Za-z0-9._:-]{7,199}$/.
 */
export function startWorkIdempotencyKey(selection: Pick<RetainedStartWork, "outcomeKey">): string {
  const safe = selection.outcomeKey.replace(/[^A-Za-z0-9._:-]/g, "-").slice(0, 180)
  return `startwork.${safe || "outcome"}`
}

/** The authorization result, narrowed to what the Line renders (the real shape has more). */
export type StartWorkAuthorization =
  | Readonly<{
      status: "AUTHORIZED_FOR_ACQUISITION" | "ALREADY_AUTHORIZED"
      queueVersion: number
      authorization: Readonly<{ authorityLevel: string; scope: string; allowedAction: string; authorizedAt: string; expiresAt: string }>
    }>
  | Readonly<{ status: "CONFLICT" | "UNAVAILABLE" | "INELIGIBLE"; reason: string }>

export type StartWorkOutcome = Readonly<{
  say: string
  /** True only when the governed authorization actually transitioned the outcome into work. */
  started: boolean
  /** A trace of what happened, for an activity surface. */
  trace: readonly Readonly<{ step: string; detail: string }>[]
}>

/**
 * Render the governed authorization result honestly: what ACTUALLY started (not "work has begun"), or
 * a fail-closed refusal naming the stale selection. Never claims a start that did not happen.
 */
export function composeStartWorkResult(selection: RetainedStartWork, result: StartWorkAuthorization): StartWorkOutcome {
  const item = `"${selection.outcomeTitle}"`
  const provenance = `${selection.projectName} · outcome ${selection.outcomeKey} · thread ${selection.threadId}`

  if (result.status === "AUTHORIZED_FOR_ACQUISITION" || result.status === "ALREADY_AUTHORIZED") {
    if (result.status === "AUTHORIZED_FOR_ACQUISITION") {
      return {
        started: true,
        say:
          `Started ${item} on ${selection.projectName}. It's authorized for acquisition ` +
          `(${result.authorization.authorityLevel}, ${result.authorization.allowedAction}, ` +
          `expires ${result.authorization.expiresAt}) and has moved out of the queue into governed work. ` +
          `That's the exact outcome I named — no re-selection.`,
        trace: [
          { step: "selection", detail: provenance },
          { step: "authorize", detail: `START_WORK → ${result.status} (queue v${result.queueVersion})` },
          { step: "authority", detail: `${result.authorization.authorityLevel} · ${result.authorization.scope}` },
          { step: "state", detail: "outcome authorized for acquisition; work order acquisition proceeds under the runtime lane" },
        ],
      }
    }
    return {
      started: true,
      say:
        `${item} was already started — the authorization is in place (queue v${result.queueVersion}), so nothing was ` +
        `dispatched twice. It's the same outcome I named.`,
      trace: [
        { step: "selection", detail: provenance },
        { step: "authorize", detail: `START_WORK → ALREADY_AUTHORIZED (idempotent; no double dispatch)` },
      ],
    }
  }
  // Fail closed: the selection went stale or is unavailable. Do NOT reselect.
  const reason = "reason" in result ? result.reason : "UNSPECIFIED"
  return {
    started: false,
    say:
      `I couldn't start ${item}: ${reason}. The item I selected has changed state since I read it, so I ` +
      `won't quietly start a different one. Ask "what are we doing on ${selection.projectName}?" again and I'll ` +
      `re-read the governed queue.`,
    trace: [
      { step: "selection", detail: provenance },
      { step: "authorize", detail: `START_WORK → ${result.status}: ${reason}` },
      { step: "outcome", detail: "no work started; selection is stale (fail closed, no re-selection)" },
    ],
  }
}
