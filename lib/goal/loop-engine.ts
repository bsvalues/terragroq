// The governed Loop Engine (§8 of the playbook). Pure, deterministic core that
// evaluates a /loop run against a work order and produces the §8.5 output shape.
//
// CORE RULE: this engine never shells out, never mutates a repo, never executes
// real work. It *governs* loops — it decides whether a loop is permitted, what
// it would do, what evidence it must collect, and when it must STOP. Actual
// mutation happens elsewhere, by the operator's own hand, under granted
// authority. An "execute" loop here records a governed execution iteration and
// its required evidence; it does not perform the mutation itself.

import type { WorkOrder } from "@/lib/db/schema"
import { authorityRank, type AuthorityId } from "./taxonomy"

/* ------------------------------------------------------------------ */
/* Loop types (§8.3)                                                   */
/* ------------------------------------------------------------------ */

export const LOOP_TYPES = [
  {
    id: "read",
    label: "Read",
    description: "Reads current state. No mutation.",
    minAuthority: "A0_READ_ONLY",
    mutating: false,
    requiresAuthorizedWO: false,
  },
  {
    id: "verify",
    label: "Verify",
    description: "Runs approved validators. No repair.",
    minAuthority: "A0_READ_ONLY",
    mutating: false,
    requiresAuthorizedWO: false,
  },
  {
    id: "plan",
    label: "Plan",
    description: "Produces work orders, packets, sequencing, risk registers. No mutation.",
    minAuthority: "A1_DRAFT",
    mutating: false,
    requiresAuthorizedWO: false,
  },
  {
    id: "evidence",
    label: "Evidence",
    description: "Collects, normalizes, and writes evidence files only.",
    minAuthority: "A1_DRAFT",
    mutating: false,
    requiresAuthorizedWO: true,
  },
  {
    id: "watch",
    label: "Watch",
    description: "Checks for condition changes. Must not mutate.",
    minAuthority: "A0_READ_ONLY",
    mutating: false,
    requiresAuthorizedWO: false,
  },
  {
    id: "execute",
    label: "Execute",
    description: "Performs scoped mutation under an authorized work order.",
    minAuthority: "A2_WRITE_OWN",
    mutating: true,
    requiresAuthorizedWO: true,
  },
] as const

export type LoopTypeId = (typeof LOOP_TYPES)[number]["id"]

export function loopType(id: string) {
  return LOOP_TYPES.find((t) => t.id === id)
}

/* ------------------------------------------------------------------ */
/* §8.5 output shape                                                   */
/* ------------------------------------------------------------------ */

export interface LoopOutcome {
  loopType: LoopTypeId
  target: string
  authority: AuthorityId
  iteration: number
  maxIterations: number
  mode: string
  actionsTaken: string[]
  evidenceCollected: string[]
  findings: string[]
  blockers: string[]
  stopReason: string | null
  nextValidMove: string
  // True only when every gate passed and the loop is permitted to proceed.
  permitted: boolean
}

export interface LoopInput {
  loopType: LoopTypeId
  target: string
  authority: AuthorityId
  maxIterations?: number
  iteration?: number
  // Optional environment signals the operator can assert.
  repoDirty?: boolean
  // A doctrine verdict for the loop target, if one was computed.
  doctrineVerdict?: "allowed" | "requires_approval" | "forbidden"
}

/* ------------------------------------------------------------------ */
/* The engine — pure evaluation                                        */
/* ------------------------------------------------------------------ */

// Evaluate a loop run against its work order and the §8.4 stop conditions.
export function evaluateLoop(input: LoopInput, wo: WorkOrder | null): LoopOutcome {
  const spec = loopType(input.loopType)!
  const iteration = input.iteration ?? 1
  const maxIterations = input.maxIterations ?? (spec.mutating ? 3 : 1)
  const blockers: string[] = []
  const findings: string[] = []
  const actionsTaken: string[] = []
  const evidenceCollected: string[] = []
  let stopReason: string | null = null

  const grantedRank = wo?.authorityGranted ? authorityRank(wo.authorityGranted) : -1
  const loopRank = authorityRank(input.authority)

  /* ---- §8.4 stop conditions, evaluated in priority order ---------- */

  // Doctrine conflict appears.
  if (input.doctrineVerdict === "forbidden") {
    stopReason = "Doctrine conflict: the loop target is forbidden by active doctrine."
    blockers.push(stopReason)
  }

  // Loop requires an authorized work order.
  if (!stopReason && spec.requiresAuthorizedWO) {
    if (!wo) {
      stopReason = `A ${spec.label} loop requires a work order target.`
      blockers.push(stopReason)
    } else if (wo.status !== "approved" && wo.status !== "active") {
      stopReason = `Work order ${wo.ref ?? `#${wo.id}`} is "${wo.status}" — not AUTHORIZED. Approve it first.`
      blockers.push(stopReason)
    }
  }

  // Mutating loop without sufficient granted authority.
  if (!stopReason && spec.mutating) {
    if (!wo?.authorityGranted) {
      stopReason = "Execute loop blocked: no authority has been granted on the work order."
      blockers.push(stopReason)
    } else if (loopRank > grantedRank) {
      stopReason = `Execute loop needs ${input.authority} but only ${wo.authorityGranted} is granted.`
      blockers.push(stopReason)
    } else if (input.repoDirty) {
      stopReason = "Repo is dirty and mutation was requested — resolve dirty state first."
      blockers.push(stopReason)
    }
  }

  // Required evidence missing (evidence + execute loops need validators declared).
  if (!stopReason && (spec.id === "evidence" || spec.id === "execute")) {
    if (wo && wo.validators.length === 0) {
      stopReason = "Required evidence is missing: the work order declares no validators."
      blockers.push(stopReason)
    }
  }

  // Max iterations reached.
  if (!stopReason && iteration > maxIterations) {
    stopReason = `Max iterations reached (${maxIterations}).`
    blockers.push(stopReason)
  }

  const permitted = stopReason === null

  /* ---- What the loop would do when permitted ---------------------- */

  if (permitted) {
    switch (spec.id) {
      case "read":
        actionsTaken.push("Read current state of target", "Summarized status")
        evidenceCollected.push("State snapshot captured (read-only)")
        findings.push("Current state recorded; no anomalies asserted.")
        break
      case "verify":
        actionsTaken.push("Ran declared validators (read-only)", "Compared against acceptance criteria")
        if (wo) {
          evidenceCollected.push(...wo.validators.map((v) => `validator: ${v}`))
          findings.push(
            wo.acceptanceCriteria.length > 0
              ? `${wo.acceptanceCriteria.length} acceptance criteria checked.`
              : "No acceptance criteria declared to check against.",
          )
        }
        break
      case "plan":
        actionsTaken.push("Produced sequencing / risk register for target", "Drafted next work order outline")
        findings.push("Plan produced. No mutation performed.")
        break
      case "evidence":
        actionsTaken.push("Collected and normalized evidence", "Wrote evidence record (evidence files only)")
        if (wo) evidenceCollected.push(...wo.validators.map((v) => `evidence for: ${v}`))
        break
      case "watch":
        actionsTaken.push("Checked target for condition changes")
        findings.push("No tracked condition changed since last iteration.")
        break
      case "execute":
        actionsTaken.push(
          `Recorded governed execution iteration under ${wo?.authorityGranted}`,
          "Scoped to allowed files; blocked files untouched",
        )
        evidenceCollected.push("Execution iteration logged for operator review")
        findings.push(
          "Governed execution iteration recorded. The engine does not perform repo mutation itself — act under granted authority and attach evidence.",
        )
        break
    }
  }

  const nextValidMove = stopReason
    ? blockers.length > 0
      ? `Resolve: ${blockers[0]}`
      : "Hold until the blocking condition clears."
    : spec.mutating
      ? "Perform the scoped change under granted authority, then record an evidence record."
      : spec.id === "plan"
        ? "Convert the plan into a draft work order."
        : "Review findings; escalate to a work order if action is needed."

  return {
    loopType: spec.id,
    target: input.target,
    authority: input.authority,
    iteration,
    maxIterations,
    mode: spec.mutating ? "EXECUTE" : "VERIFY",
    actionsTaken,
    evidenceCollected,
    findings,
    blockers,
    stopReason,
    nextValidMove,
    permitted,
  }
}
