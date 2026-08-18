import type { ResourceRecord } from "@/lib/resource/resolve"

/**
 * Does what we declare about a resource agree with what we recorded about it?
 *
 * #871 boundary 3. WilliamOS could say what PACS is, but not whether that belief still held. The real
 * question behind the objective -- has this already been done, and does the record match the evidence
 * -- had no answerer, which is how two wrong public claims were published and a completed 102 GB import
 * came within one command of being repeated.
 *
 * This compares the DECLARED record against RECORDED evidence. It observes nothing: no node is
 * contacted, no filesystem is read. That is boundary 5, and "the filesystem says X therefore X is the
 * architecture" is the original defect. Everything here is textual comparison of things already written
 * down.
 *
 * A disagreement is SURFACED, never smoothed. The tempting move is to edit the record until it matches
 * the newest observation; that destroys the signal the system exists to raise.
 */

/** Agent-claim vocabulary, reused rather than reinvented (lib/governance/agent-claims.ts). */
export type ReconciliationClassification = "EVIDENCE_BACKED" | "CONFLICTING" | "UNSUPPORTED"

export interface Disagreement {
  what: string
  declared: string
  recorded: string
  detail: string
}

export interface ReconciliationVerdict {
  identity: string
  classification: ReconciliationClassification
  agreements: string[]
  disagreements: Disagreement[]
  /** Severity for the existing conflict register; high and critical block transitions. */
  severity: "low" | "medium" | "high" | "critical"
  summary: string
  /** True while the record itself is unratified, so a verdict cannot be read as settled. */
  provisional: boolean
}

/**
 * The node an identity names, by the convention node:path.
 *
 * Returns null rather than guessing when an identity carries no node. A missing prefix means we did
 * not record where this is, and inventing a location from a bare path is exactly the inference this
 * boundary exists to replace.
 */
export function locationOf(identity: string): string | null {
  const separator = identity.indexOf(":")
  if (separator <= 0) return null
  const candidate = identity.slice(0, separator).trim().toLowerCase()
  return /^[a-z0-9-]+$/.test(candidate) ? candidate : null
}

export function reconcileResource(record: ResourceRecord): ReconciliationVerdict {
  const declaredOwner = record.workloadOwner?.identity?.toLowerCase() ?? null
  const evidence = [...record.completionEvidence, ...record.sources]
  const agreements: string[] = []
  const disagreements: Disagreement[] = []

  if (!declaredOwner) {
    return {
      identity: record.identity,
      classification: "UNSUPPORTED",
      agreements: [],
      disagreements: [],
      severity: "medium",
      summary: "No workload owner is declared, so nothing can be reconciled against it.",
      provisional: !record.ratified,
    }
  }

  for (const item of evidence) {
    const location = locationOf(item.identity)
    if (!location) continue
    if (location === declaredOwner) {
      agreements.push(`${item.identity} sits on the declared owner ${declaredOwner}`)
    } else {
      disagreements.push({
        what: item.label || item.identity,
        declared: declaredOwner,
        recorded: location,
        detail: `${item.identity} is recorded on ${location}, but ${declaredOwner} is the declared workload owner`,
      })
    }
  }

  if (disagreements.length === 0 && agreements.length === 0) {
    return {
      identity: record.identity,
      classification: "UNSUPPORTED",
      agreements,
      disagreements,
      severity: "medium",
      summary: `Nothing recorded about ${record.identity} names a location, so the declared owner cannot be corroborated.`,
      provisional: !record.ratified,
    }
  }

  if (disagreements.length === 0) {
    return {
      identity: record.identity,
      classification: "EVIDENCE_BACKED",
      agreements,
      disagreements,
      severity: "low",
      summary: `Every recorded artefact for ${record.identity} sits on the declared owner ${declaredOwner}.`,
      provisional: !record.ratified,
    }
  }

  // Where the workload is declared to live and where its evidence actually sits are the two facts every
  // later decision rests on. Disagreement between them is blocking, because proceeding past it is what
  // produces confident wrong answers.
  const elsewhere = [...new Set(disagreements.map((d) => d.recorded))].sort()
  return {
    identity: record.identity,
    classification: "CONFLICTING",
    agreements,
    disagreements,
    severity: "high",
    summary:
      `${record.identity} is declared to ${declaredOwner}, but ${disagreements.length} recorded artefact(s) ` +
      `sit on ${elsewhere.join(", ")}. Reconcile before acting on either.`,
    provisional: !record.ratified,
  }
}
