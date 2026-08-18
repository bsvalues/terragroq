import type { ResourceRecord } from "@/lib/resource/resolve"

/**
 * Refuse work that recorded evidence shows is already done.
 *
 * #871 boundary 4. Reconciliation could classify PACS as CONFLICTING and record a conflict, and nothing
 * consumed it. The system would still have admitted a re-import of the 102 GB backup whose 738 GB
 * restore is already recorded -- the failure this session came one command away from committing, and
 * which was committed in substance more than once before that.
 *
 * This is not a new idempotency model. `lib/workbench/outcome-start.ts` already prevents the same
 * REQUEST running twice; that is attempt-level dedup, and it knows nothing about work completed weeks
 * ago by another path. Conflating those two is roughly how this happens.
 *
 * Both rules below name what they refused on. "Blocked" without a reference is indistinguishable from a
 * bug, and an agent that cannot see why it was stopped will route around the stop.
 */

/** Operations that reproduce an artefact, and so can duplicate completed work. */
export const REPRODUCING_OPERATIONS = ["restore", "import", "migrate", "reimport", "rebuild"] as const

export type CompletionRefusal = "OPERATION_NOT_PERMITTED" | "ALREADY_COMPLETE" | "BLOCKED_BY_CONFLICT"

export interface OperationVerdict {
  allowed: boolean
  refusal?: CompletionRefusal
  /** Always populated on a refusal: what the decision was made from. */
  citedEvidence: string[]
  citedConflict: string | null
  detail: string
  /** How to proceed legitimately, so a refusal is not a dead end. */
  remedy?: string
}

export interface OpenConflict {
  ref: string
  severity: string
  description: string | null
}

const BLOCKING = new Set(["high", "critical"])

export function assertOperationAllowed(input: {
  record: ResourceRecord
  operation: string
  openConflicts: OpenConflict[]
}): OperationVerdict {
  const operation = input.operation.trim().toLowerCase()

  // An unresolved contradiction about a resource stops work on it. Refusing is not resolving: the
  // conflict stays open and visible, and nothing here decides which side of it is right.
  const blocking = input.openConflicts.find((conflict) => BLOCKING.has(conflict.severity.toLowerCase()))
  if (blocking) {
    return {
      allowed: false,
      refusal: "BLOCKED_BY_CONFLICT",
      citedEvidence: [],
      citedConflict: blocking.ref,
      detail: `${blocking.ref} is open against ${input.record.identity}: ${blocking.description ?? "unresolved contradiction"}`,
      remedy: "Resolve or downgrade the conflict, or obtain authority that explicitly covers acting despite it.",
    }
  }

  if (input.record.allowedOperations.length > 0 && !input.record.allowedOperations.includes(operation)) {
    return {
      allowed: false,
      refusal: "OPERATION_NOT_PERMITTED",
      citedEvidence: [],
      citedConflict: null,
      detail: `${operation} is not among the permitted operations for ${input.record.identity} (${input.record.allowedOperations.join(", ")})`,
      remedy: "Amend the resource record to permit the operation, which is an owner act, or choose a permitted one.",
    }
  }

  const reproduces = (REPRODUCING_OPERATIONS as readonly string[]).includes(operation)
  if (reproduces && input.record.completionEvidence.length > 0) {
    return {
      allowed: false,
      refusal: "ALREADY_COMPLETE",
      citedEvidence: input.record.completionEvidence.map((item) => `${item.identity} — ${item.label}`),
      citedConflict: null,
      detail: `${operation} would reproduce work already recorded for ${input.record.identity}`,
      remedy:
        "Verify the recorded evidence still holds rather than repeating the work. If it does not, record that finding first so the next lane inherits it.",
    }
  }

  return {
    allowed: true,
    citedEvidence: [],
    citedConflict: null,
    detail: `${operation} is permitted for ${input.record.identity} and duplicates no recorded completion`,
  }
}
