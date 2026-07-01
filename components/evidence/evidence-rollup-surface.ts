import type { EventLog } from "@/lib/db/schema"

export type EvidenceRollupCard = {
  label: string
  value: string
  description: string
}

export type EvidenceRollupSurface = {
  title: string
  description: string
  cards: EvidenceRollupCard[]
  recentSignals: string[]
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

export function getEvidenceRollupSurface(events: EventLog[]): EvidenceRollupSurface {
  const workOrderEvents = countByRegister(events, "work-orders")
  const decisionEvents = countByRegister(events, "decisions")
  const evidenceEvents = countByType(events, "evidence")
  const authorityEvents = countByRegister(events, "authority")

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
    safety: {
      readOnly: true,
      recordsEvidence: false,
      mutatesEvents: false,
      autoIngests: false,
      writesProduction: false,
    },
  }
}
