import { dependencyClosure, mayAdvanceAnchor } from "./receipt-anchor.ts"
import { receiptToken, type WorkContextFacts } from "./work-context-receipt.ts"

/**
 * Reviewer-side enforcement of the pre-execution gate.
 *
 * #831 acceptance criterion 8: a reviewer rejects a pull request with no valid WORK_CONTEXT_RECEIPT
 * even when the tests are green. The route gate already refuses unproven mutations made through the
 * application, but a lane committing straight to a branch never touches it -- which is most of them.
 * This is the half that sees those.
 *
 * What it can establish, and what it cannot, is worth being exact about. It re-derives the token from
 * the declared claims, so a receipt that was edited after issuance stops matching. It measures main
 * and the doctrine itself, so those cannot be asserted by the lane. It checks the changed files
 * against the declared reservation, so scope escape is visible. It CANNOT check the authority grant,
 * which lives in a database no CI runner can reach -- that binding is enforced at issuance instead.
 */

export const RECEIPT_BLOCK = "WORK_CONTEXT_RECEIPT"

export type PrReceiptFailure =
  | "FAILED_CONTEXT_NOT_PROVEN"
  | "FAILED_RECEIPT_MISMATCH"
  | "FAILED_STALE_MAIN"
  | "FAILED_SCOPE_ESCAPE"

export interface PrReceiptVerdict {
  ok: boolean
  failure?: PrReceiptFailure
  detail?: string
  /** How the lane recovers without asking the owner. #831 requires every refusal to carry one. */
  recovery?: string
}

export interface DeclaredReceipt {
  token: string
  facts: WorkContextFacts
}

/**
 * Pull the receipt out of a pull request body.
 *
 * A fenced block keyed by name rather than a loose regex over prose: the body is written by humans and
 * agents both, and "mentions the word receipt" must never be enough to pass.
 */
export function parseDeclaredReceipt(body: string | null | undefined): DeclaredReceipt | null {
  if (!body) return null
  const fence = new RegExp("```" + RECEIPT_BLOCK + "\\s*([\\s\\S]*?)```")
  const match = fence.exec(body)
  if (!match) return null
  try {
    const parsed = JSON.parse(match[1].trim()) as { token?: unknown; receipt?: unknown; facts?: unknown }
    // establish-work-context.mjs writes the token under `receipt`, and its own closing line tells the
    // lane to paste that file. Rejecting the file the tool just produced made the documented recovery
    // path unusable, so both spellings of the same field are accepted.
    const token = typeof parsed.token === "string" ? parsed.token : parsed.receipt
    if (typeof token !== "string" || !token.trim()) return null
    if (!parsed.facts || typeof parsed.facts !== "object") return null
    return { token: token.trim(), facts: parsed.facts as WorkContextFacts }
  } catch {
    return null
  }
}

export interface ReviewInputs {
  body: string | null | undefined
  /** Files the pull request changes. */
  changedFiles: string[]
  /** Files that moved on main between the receipt's anchor and current main. */
  mainMovedFiles: string[]
  /** Measured now, never taken from the receipt. */
  liveDoctrineDigest: string
}

export function reviewPullRequestReceipt(input: ReviewInputs): PrReceiptVerdict {
  const declared = parseDeclaredReceipt(input.body)
  if (!declared) {
    return {
      ok: false,
      failure: "FAILED_CONTEXT_NOT_PROVEN",
      detail: `the pull request declares no ${RECEIPT_BLOCK} block`,
      recovery: `POST /api/governance/work-context, then add the returned token and its claims to the pull request body in a fenced ${RECEIPT_BLOCK} block.`,
    }
  }

  // Doctrine is measured here rather than believed. A lane that can state its own instruction chain
  // digest can state that it read something it did not.
  const facts: WorkContextFacts = { ...declared.facts, doctrineDigest: input.liveDoctrineDigest }
  if (receiptToken(facts) !== declared.token) {
    // Re-derive against the doctrine the lane claimed. If THAT matches, doctrine moved under a real
    // receipt; if it does not, the token never belonged to these claims.
    const asClaimed = receiptToken(declared.facts)
    if (asClaimed === declared.token) {
      return {
        ok: false,
        failure: "FAILED_STALE_MAIN",
        detail: "the controlling doctrine changed after this receipt was issued",
        recovery: "Re-read the instruction chain and re-issue the receipt; the work does not need redoing.",
      }
    }
    return {
      ok: false,
      failure: "FAILED_RECEIPT_MISMATCH",
      detail: "the token was not issued for these claims; re-establish context rather than editing the claim",
      recovery: "Re-establish context and issue a new receipt. Editing the declared claims to match a token is the failure this check exists to catch.",
    }
  }

  const closure = dependencyClosure(facts)
  const advance = mayAdvanceAnchor(closure, input.mainMovedFiles)
  if (!advance.ok) {
    return {
      ok: false,
      failure: "FAILED_STALE_MAIN",
      detail: `main moved under this receipt's dependencies: ${advance.intersecting.join(", ")}`,
      recovery: "Rebase onto current main, re-run the subsystem search for the changed dependencies, and re-issue the receipt.",
    }
  }

  // Scope escape is checked here because the reservation is the only claim whose violation is visible
  // from the diff alone. Doctrine belongs to the stale-main closure, not to the lane's writable scope.
  const escaped = input.changedFiles.filter((file) => !within(file, facts.reservedPaths))
  if (escaped.length > 0) {
    return {
      ok: false,
      failure: "FAILED_SCOPE_ESCAPE",
      detail: `changed outside the declared reservation: ${escaped.slice(0, 10).join(", ")}`,
      recovery: "Either revert the out-of-scope changes, or re-issue a receipt whose reservation actually covers them and re-check for collisions.",
    }
  }

  return { ok: true }
}

function within(file: string, reserved: string[]): boolean {
  const path = file.trim().replace(/\\/g, "/")
  return reserved.some((entry) => {
    const normalized = entry.trim().replace(/\\/g, "/")
    if (!normalized) return false
    // A reservation is a directory when it says so, and also when it plainly names one: --reserve
    // scripts/runtime-operator without a trailing slash used to mean "exactly that file", so every
    // directory reservation escaped its own scope and no honest lane could pass.
    if (normalized.endsWith("/")) return path.startsWith(normalized)
    if (normalized.endsWith("/**")) return path.startsWith(normalized.slice(0, -2))
    if (path === normalized) return true
    return !normalized.includes(".") && path.startsWith(`${normalized}/`)
  })
}
