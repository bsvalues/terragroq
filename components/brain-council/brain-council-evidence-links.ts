export type BrainCouncilEvidenceLink = {
  label: string
  href: string
  description: string
}

export function getBrainCouncilEvidenceLinks(): BrainCouncilEvidenceLink[] {
  return [
    {
      label: "Runtime verification",
      href: "/runtime",
      description: "Check live model/runtime provenance and recent verification history.",
    },
    {
      label: "Work-order evidence",
      href: "/work-orders",
      description: "Review governed work packets, validators, and closure evidence.",
    },
    {
      label: "Audit log",
      href: "/audit",
      description: "Inspect recorded operator events and governance trail.",
    },
    {
      label: "Governance gates",
      href: "/governance",
      description: "Stay on this page to inspect authority, locks, claims, and Brain Council gates.",
    },
  ]
}
