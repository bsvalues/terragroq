import type { EventLog } from "@/lib/db/schema"
import {
  createOwnerOperationEvidencePlaceholder,
  evaluateOwnerOperationEvidence,
  type OwnerOperationCounters,
  type OwnerOperationEvidenceModel,
} from "@/lib/governance/owner-operation-evidence"

export type EvidenceRollupOwnerOperationInput = {
  counters: OwnerOperationCounters
  workOrderId: string
  action: string
}

export type EvidenceRollupCard = {
  label: string
  value: string
  description: string
}

export type EvidenceProofState = {
  label: string
  status: "missing" | "present" | "required" | "thread-gated" | "false-flags-required"
  description: string
}

export type EvidenceRollupSurface = {
  title: string
  description: string
  cards: EvidenceRollupCard[]
  recentSignals: string[]
  proofStates: EvidenceProofState[]
  ownerOperationEvidence: OwnerOperationEvidenceModel
  safety: {
    readOnly: true
    recordsEvidence: false
    mutatesEvents: false
    autoIngests: false
    writesProduction: false
  }
}

function countByRegister(events: EventLog[], register: string) {
  return events.filter((event) => event.register === register).length
}

function countByType(events: EventLog[], fragment: string) {
  return events.filter((event) => event.type.includes(fragment)).length
}

function countProductionProof(events: EventLog[]) {
  return events.filter((event) => {
    const text = `${event.type} ${event.summary}`.toLowerCase()
    return (
      text.includes("production") ||
      text.includes("/api/health") ||
      text.includes("/api/auth/readiness") ||
      text.includes("/work-orders") ||
      text.includes("/goal-console") ||
      text.includes("/audit")
    )
  }).length
}

export function getEvidenceRollupSurface(
  events: EventLog[],
  ownerOperations?: EvidenceRollupOwnerOperationInput,
): EvidenceRollupSurface {
  const workOrderEvents = countByRegister(events, "work-orders")
  const decisionEvents = countByRegister(events, "decisions")
  const evidenceEvents = countByType(events, "evidence")
  const authorityEvents = countByRegister(events, "authority")
  const productionProofEvents = countProductionProof(events)
  const ownerOperationEvidence = ownerOperations
    ? evaluateOwnerOperationEvidence(ownerOperations.counters, {
        surface: "evidence",
        programId: null,
        goalId: null,
        loopId: null,
        workOrderId: ownerOperations.workOrderId,
        decisionId: null,
        action: ownerOperations.action,
      })
    : createOwnerOperationEvidencePlaceholder({
        surface: "evidence",
        programId: null,
        goalId: null,
        loopId: null,
        workOrderId: null,
        decisionId: null,
        action: null,
      })

  return {
    title: "Evidence Rollup",
    description:
      "The rollup summarizes recent proof signals across Work Orders, Decisions, authority, and validation events. It reads the event log; it does not create evidence.",
    cards: [
      {
        label: "Work Order Signals",
        value: String(workOrderEvents),
        description: "Recent scope, transition, result, and validation events tied to governed work.",
      },
      {
        label: "Decision Signals",
        value: String(decisionEvents),
        description: "Recent authority calls, status changes, and decision context updates.",
      },
      {
        label: "Evidence Events",
        value: String(evidenceEvents),
        description: "Events explicitly recorded as validation or proof artifacts.",
      },
      {
        label: "Authority Signals",
        value: String(authorityEvents),
        description: "Recent grants, gates, and authority posture events.",
      },
    ],
    recentSignals: events.slice(0, 5).map((event) => `${event.type}: ${event.summary}`),
    ownerOperationEvidence,
    proofStates: [
      {
        label: "Validation proof",
        status: evidenceEvents > 0 ? "present" : "missing",
        description: "Focused tests, full tests, diff checks, build output, and PR checks must be cited before closure.",
      },
      {
        label: "Production proof",
        status: productionProofEvents > 0 ? "present" : "required",
        description: "Health, auth readiness, and touched production routes must appear as events before production proof is treated as verified.",
      },
      {
        label: "Review proof",
        status: "thread-gated",
        description: "Unresolved review threads remain blockers until remediated or returned as owner decisions.",
      },
      {
        label: "Safety proof",
        status: "false-flags-required",
        description: "Command runner, autonomy, background worker, production write, ingestion, and secrets flags must stay false.",
      },
    ],
    safety: {
      readOnly: true,
      recordsEvidence: false,
      mutatesEvents: false,
      autoIngests: false,
      writesProduction: false,
    },
  }
}
