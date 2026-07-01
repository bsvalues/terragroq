export type MemoryContinuitySection = {
  title: string
  purpose: string
  currentPosture: string
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

export type MemoryWorkspace = {
  title: string
  eyebrow: string
  description: string
  postureSummary: MemoryPostureSummaryItem[]
  sections: MemoryContinuitySection[]
  reviewQueue: {
    label: string
    posture: string
    description: string
  }
  safety: {
    readOnlyFrame: true
    writesMemory: false
    extractsAutomatically: false
    promotesAutomatically: false
    deletesAutomatically: false
    retrievesForCouncil: false
    activatesHermes: false
    activatesMcp: false
    enablesAutonomy: false
    mutatesSchema: false
  }
}

export function getMemoryWorkspace(): MemoryWorkspace {
  return {
    title: "Memory",
    eyebrow: "Governed Continuity",
    description:
      "Memory is the WilliamOS continuity layer for facts, decisions, procedures, patterns, contradictions, stale items, and review queues. It is inspectable, correctable, evidence-linked, and authority-aware; it is not chat history or autonomous learning.",
    postureSummary: [
      {
        label: "Continuity",
        value: "preserved",
        description:
          "Durable context stays visible so the Primary can see what WilliamOS believes, questions, or needs reviewed.",
      },
      {
        label: "Authority",
        value: "Primary gated",
        description:
          "Records require review before they become trusted continuity for future work.",
      },
      {
        label: "Evidence",
        value: "linked",
        description:
          "Memory should point back to source, proof, work order evidence, or a decision packet when available.",
      },
    ],
    sections: [
      {
        title: "Facts",
        purpose: "Preserve stable operating facts and known system state.",
        currentPosture: "Inspectable records with confidence and authority state.",
        exampleRecordType: "Production /api/health returned 200 ok after a merged work order.",
        authorityRequirement: "Primary review before a fact becomes trusted continuity.",
        evidenceLinkage: "Health probe, PR evidence, or work order completion report.",
        nextSafeStep: "Keep facts in the review queue until source proof is clear.",
      },
      {
        title: "Decisions",
        purpose: "Preserve consequential calls, approvals, and blocked gates.",
        currentPosture: "Authority-aware records that distinguish recommendation from approval.",
        exampleRecordType: "Owner authorized UI/copy/tests only; deploy action remains blocked.",
        authorityRequirement: "Explicit Primary decision for merge, deploy, schema, auth, or autonomy gates.",
        evidenceLinkage: "Decision packet, PR comment, or completion report.",
        nextSafeStep: "Surface decisions next to Work Orders and Evidence before action.",
      },
      {
        title: "Procedures",
        purpose: "Preserve repeatable steps that should be followed consistently.",
        currentPosture: "Correctable instructions, not executable skills.",
        exampleRecordType: "Run focused tests, full suite, npm run build, then production probes.",
        authorityRequirement: "Procedure review before it is reused as operating guidance.",
        evidenceLinkage: "Runbook, validation transcript, or governance document.",
        nextSafeStep: "Keep procedure-to-skill activation blocked until Agent Forge review.",
      },
      {
        title: "Patterns",
        purpose: "Preserve recurring product, repo, or governance signals.",
        currentPosture: "Pattern records support awareness without claiming certainty.",
        exampleRecordType: "WilliamOS surfaces should avoid generic SaaS language.",
        authorityRequirement: "Primary review before a pattern shapes future copy or shell decisions.",
        evidenceLinkage: "Doctrine, repeated work orders, or reviewed design guidance.",
        nextSafeStep: "Treat patterns as advisory until they are tied to evidence.",
      },
      {
        title: "Contradictions",
        purpose: "Preserve conflicts between records, evidence, or assumptions.",
        currentPosture: "Needs review before either side is trusted.",
        exampleRecordType: "A completion report claims production healthy while a probe returns degraded.",
        authorityRequirement: "Primary review resolves or scopes the next investigation.",
        evidenceLinkage: "Conflicting probe, report, commit, or PR check.",
        nextSafeStep: "Route contradictions to review queue before continuing implementation.",
      },
      {
        title: "Stale / Needs Review",
        purpose: "Preserve items that may be outdated, superseded, or unsafe to rely on.",
        currentPosture: "Stale items remain visible instead of silently disappearing.",
        exampleRecordType: "An old origin/main commit is superseded by a newer merged work order.",
        authorityRequirement: "Primary review before clearing stale state or using the record again.",
        evidenceLinkage: "Newer merge commit, production probe, or updated governance packet.",
        nextSafeStep: "Review stale items before they influence new Work Orders.",
      },
      {
        title: "Review Queue",
        purpose: "Collect continuity records that require Primary attention.",
        currentPosture: "Unreviewed records are visible but not authoritative.",
        exampleRecordType: "A new fact, decision, procedure, pattern, contradiction, or stale item.",
        authorityRequirement: "Primary review is required before promotion.",
        evidenceLinkage: "Every queued record should identify a source when possible.",
        nextSafeStep: "Inspect, correct, mark stale, or leave blocked without automatic promotion.",
      },
    ],
    reviewQueue: {
      label: "Primary Review Queue",
      posture: "attention required before trust",
      description:
        "The queue is where WilliamOS shows what it knows, what it is unsure about, and what needs correction before authority changes.",
    },
    safety: {
      readOnlyFrame: true,
      writesMemory: false,
      extractsAutomatically: false,
      promotesAutomatically: false,
      deletesAutomatically: false,
      retrievesForCouncil: false,
      activatesHermes: false,
      activatesMcp: false,
      enablesAutonomy: false,
      mutatesSchema: false,
    },
  }
}
