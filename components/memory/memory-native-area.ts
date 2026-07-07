export type MemoryContinuityCategory = {
  label: string
  posture: string
  description: string
  exampleRecordType: string
  authorityRequirement: string
  evidenceLinkage: string
  nextSafeStep: string
}

export type MemoryPostureSummaryItem = {
  label: string
  value: string
  description: string
}

export type MemoryAuthorityBoundary = {
  label: string
  state: string
  description: string
}

export type MemoryNativeArea = {
  title: string
  eyebrow: string
  description: string
  shellPlacement: MemoryPostureSummaryItem[]
  postureSummary: MemoryPostureSummaryItem[]
  categories: MemoryContinuityCategory[]
  authorityBoundaries: MemoryAuthorityBoundary[]
  links: {
    label: string
    href: string
    description: string
  }[]
  safety: {
    nativeToWilliamOS: true
    addsWriteBehavior: false
    autoExtracts: false
    autoPromotes: false
    autoDeletesOrArchives: false
    changesRetrieval: false
    activatesBrainCouncilRuntimeReads: false
    activatesHermes: false
    activatesMcp: false
    enablesAutonomy: false
    mutatesSchema: false
  }
}

export function getMemoryNativeArea(): MemoryNativeArea {
  return {
    title: "Memory",
    eyebrow: "Primary Continuity Layer",
    description:
      "Memory is the Primary Operator continuity layer for WilliamOS. It keeps facts, decisions, procedures, patterns, contradictions, stale items, and review queues visible without letting remembered context become authority.",
    shellPlacement: [
      {
        label: "Capture",
        value: "Review first",
        description:
          "New context belongs in review before it can influence Work Orders or operator decisions.",
      },
      {
        label: "Connect",
        value: "Evidence-linked",
        description:
          "Trusted memory stays tied to proof, authority, owner decisions, and current project state.",
      },
      {
        label: "Correct",
        value: "Stale visible",
        description:
          "Outdated or contradicted context remains inspectable so it can be corrected before use.",
      },
      {
        label: "Constrain",
        value: "Not authority",
        description:
          "Memory can guide the Primary shell, but it cannot approve, execute, promote, or expand scope.",
      },
    ],
    postureSummary: [
      {
        label: "Continuity",
        value: "evidence-linked",
        description:
          "Facts and decisions stay connected to source, authority, confidence, and review state.",
      },
      {
        label: "Review",
        value: "Primary aware",
        description:
          "Stale items, contradictions, and unreviewed records stay visible before trust.",
      },
      {
        label: "Learning",
        value: "not automatic",
        description:
          "This surface does not train models, extract, promote, delete, archive, or retrieve memory.",
      },
    ],
    categories: [
      {
        label: "Facts",
        posture: "Inspectable",
        description: "Specific claims that need source, confidence, and authority context.",
        exampleRecordType: "Memory fact with provenance and confidence",
        authorityRequirement: "Review before canon",
        evidenceLinkage: "Source and proof remain attached",
        nextSafeStep: "Review, correct, or mark stale through existing memory controls.",
      },
      {
        label: "Decisions",
        posture: "Evidence-linked",
        description: "Consequential choices that should retain rationale and outcome evidence.",
        exampleRecordType: "Decision record with proof chain",
        authorityRequirement: "Primary review",
        evidenceLinkage: "Linked Work Order, validation, or production verification",
        nextSafeStep: "Compare against Evidence before treating as durable context.",
      },
      {
        label: "Procedures",
        posture: "Provenance-only",
        description: "Repeatable patterns that may become Work Orders or capability proposals later.",
        exampleRecordType: "Procedure candidate with source history",
        authorityRequirement: "Work Order before capability",
        evidenceLinkage: "Validation history and denied actions",
        nextSafeStep: "Keep as reference until Agent Forge or Work Orders ratify scope.",
      },
      {
        label: "Patterns",
        posture: "Review queue",
        description: "Recurring signals that may explain system behavior but still need review.",
        exampleRecordType: "Observed pattern with linked examples",
        authorityRequirement: "Review before canon",
        evidenceLinkage: "Multiple observations or reports",
        nextSafeStep: "Promote only after repeated evidence supports the pattern.",
      },
      {
        label: "Contradictions",
        posture: "Needs resolution",
        description: "Conflicting facts, policies, decisions, or assumptions requiring attention.",
        exampleRecordType: "Conflict between two records",
        authorityRequirement: "Primary decision",
        evidenceLinkage: "Competing records and resolution evidence",
        nextSafeStep: "Route to a decision or research Work Order before trust.",
      },
      {
        label: "Stale / Needs Review",
        posture: "Visible",
        description: "Outdated, uncertain, or unverified memory that should not silently guide work.",
        exampleRecordType: "Stale fact or aged procedure",
        authorityRequirement: "Fresh review before use",
        evidenceLinkage: "Last reviewed timestamp and source",
        nextSafeStep: "Refresh, supersede, archive, or keep blocked from canon.",
      },
      {
        label: "Review Queue",
        posture: "Primary review",
        description: "Incoming memory held for inspection before it can become trusted context.",
        exampleRecordType: "Unreviewed intake record",
        authorityRequirement: "Review before canon",
        evidenceLinkage: "Intake source and reviewer decision",
        nextSafeStep: "Inspect and correct before promotion.",
      },
    ],
    authorityBoundaries: [
      {
        label: "Memory writes",
        state: "Existing controls only",
        description: "This native reframe adds no new memory write, extraction, or intake path.",
      },
      {
        label: "Retrieval",
        state: "Unchanged",
        description: "No new vector search, Brain Council runtime read, or recall behavior is added.",
      },
      {
        label: "Promotion",
        state: "Not automatic",
        description:
          "Memory is not auto-promoted, auto-deleted, auto-archived, or treated as trusted without review.",
      },
    ],
    links: [
      {
        label: "Evidence",
        href: "/audit",
        description: "Verify claims before memory becomes trusted context.",
      },
      {
        label: "Decisions",
        href: "/decisions",
        description: "Resolve contradictions and consequential memory choices.",
      },
      {
        label: "Work Orders",
        href: "/work-orders",
        description: "Turn memory cleanup or procedure work into governed scope.",
      },
      {
        label: "Systems",
        href: "/runtime",
        description: "Check operational posture before trusting runtime-related memory.",
      },
    ],
    safety: {
      nativeToWilliamOS: true,
      addsWriteBehavior: false,
      autoExtracts: false,
      autoPromotes: false,
      autoDeletesOrArchives: false,
      changesRetrieval: false,
      activatesBrainCouncilRuntimeReads: false,
      activatesHermes: false,
      activatesMcp: false,
      enablesAutonomy: false,
      mutatesSchema: false,
    },
  }
}
