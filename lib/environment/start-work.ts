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
// Anything that makes the sentence non-affirmative: a negation, a question, or a hypothetical. Starting
// real governed work is a committing action, so it fires ONLY on an unambiguous affirmative command.
const NOT_AFFIRMATIVE = /\b(don'?t|do not|never|no need|cannot|can'?t|won'?t|not)\b|\?|\b(should|would|could|can|will|may|might|if|whether|what|why|how|explain|suppose)\b/i

export function isContinueIntent(text: string): boolean {
  const t = text.trim()
  if (NOT_AFFIRMATIVE.test(t)) return false
  return CONTINUE.test(t)
}

/**
 * A deterministic idempotency key for starting one outcome, so a duplicate click / retry reuses the
 * same key and the authorization dedupes (ALREADY_AUTHORIZED) rather than dispatching twice. Matches
 * the authorization contract's key shape: /^[A-Za-z0-9][A-Za-z0-9._:-]{7,199}$/.
 */
export function startWorkIdempotencyKey(selection: Pick<RetainedStartWork, "outcomeKey">): string {
  // A readable prefix PLUS a hash of the FULL key, so distinct outcome keys that sanitise or truncate
  // identically ("foo/bar" vs "foo?bar", or keys differing only past char 150) never collide.
  const safe = selection.outcomeKey.replace(/[^A-Za-z0-9._:-]/g, "-").slice(0, 150)
  let hash = 5381
  for (let i = 0; i < selection.outcomeKey.length; i += 1) hash = ((hash << 5) + hash + selection.outcomeKey.charCodeAt(i)) >>> 0
  return `startwork.${safe || "outcome"}.${hash.toString(36)}`
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
  /** True when the governed AUTHORIZATION succeeded (authorized for acquisition). Not 'dispatched'. */
  authorized: boolean
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
        // Authorized, NOT dispatched: this action creates no work order, lease, process, or dispatch
        // (dispatchPerformed: false). It grants authority and moves the outcome to approved; the
        // runtime lane picks up acquisition. Say exactly that, never "work has begun".
        authorized: true,
        say:
          `Authorized ${item} on ${selection.projectName} for acquisition ` +
          `(${result.authorization.authorityLevel}, ${result.authorization.allowedAction}, ` +
          `expires ${result.authorization.expiresAt}). It's out of the queue and cleared to run — the ` +
          `runtime lane picks up dispatch from here. I won't claim work is executing until it is. ` +
          `That's the exact outcome I named — no re-selection.`,
        trace: [
          { step: "selection", detail: provenance },
          { step: "authorize", detail: `START_WORK → ${result.status} (queue v${result.queueVersion})` },
          { step: "authority", detail: `${result.authorization.authorityLevel} · ${result.authorization.scope}` },
          { step: "dispatch", detail: "not dispatched by this action (dispatchPerformed: false); runtime lane acquires" },
        ],
      }
    }
    return {
      authorized: true,
      say:
        `${item} was already authorized for acquisition (queue v${result.queueVersion}), so nothing was ` +
        `re-authorized or dispatched twice. It's the same outcome I named.`,
      trace: [
        { step: "selection", detail: provenance },
        { step: "authorize", detail: `START_WORK → ALREADY_AUTHORIZED (idempotent; no double dispatch)` },
      ],
    }
  }
  // Fail closed: authorization refused. Do NOT reselect — and do NOT assume a single cause. The
  // governed reason is reported verbatim; PROJECT_THREAD_OUTCOME_UNAVAILABLE in particular can mean
  // the project isn't in an `active` lifecycle (a standby/archived project can't start work), the
  // outcome's state changed, or its binding no longer matches — the Line names the possibilities
  // honestly rather than asserting one.
  const reason = "reason" in result ? result.reason : "UNSPECIFIED"
  const GLOSS: Record<string, string> = {
    PROJECT_THREAD_OUTCOME_UNAVAILABLE:
      ` This usually means ${selection.projectName} isn't in an active state that permits starting work (a standby or archived project can't), or the outcome's governed state changed since I read it.`,
    WORK_CONTRACT_UNAVAILABLE:
      ` This means the runtime lane has no registered work contract for this outcome yet — it isn't dispatchable work, even though it's queued. That's the runtime lane's to provide, not something I'll fake.`,
  }
  const gloss = GLOSS[reason] ?? ""
  return {
    authorized: false,
    say:
      `I couldn't start ${item}: ${reason}.${gloss} I won't quietly start a different one. Ask ` +
      `"what are we doing on ${selection.projectName}?" again and I'll re-read the governed queue.`,
    trace: [
      { step: "selection", detail: provenance },
      { step: "authorize", detail: `START_WORK → ${result.status}: ${reason}` },
      { step: "outcome", detail: "no work started (fail closed, no re-selection)" },
    ],
  }
}
