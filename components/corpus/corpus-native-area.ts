export type CorpusPostureSummaryItem = {
  label: string
  value: string
  description: string
}

export type CorpusKnowledgeSection = {
  label: string
  posture: string
  purpose: string
  provenance: string
  authorityRequirement: string
  evidenceLinkage: string
  nextSafeStep: string
}

export type CorpusAuthorityBoundary = {
  label: string
  state: string
  description: string
}

export type CorpusNativeArea = {
  title: string
  eyebrow: string
  description: string
  postureSummary: CorpusPostureSummaryItem[]
  sections: CorpusKnowledgeSection[]
  authorityBoundaries: CorpusAuthorityBoundary[]
  links: {
    label: string
    href: string
    description: string
  }[]
  safety: {
    nativeToWilliamOS: true
    changesIngestion: false
    changesUploadBehavior: false
    changesEmbeddingBehavior: false
    changesVectorRetrieval: false
    activatesExternalConnectors: false
    addsCorpusMutation: false
    changesAuthBehavior: false
    activatesAccessGrants: false
    changesTokenHandling: false
    addsAuditWriter: false
    addsDurableLimiter: false
    changesRuntimeValidation: false
    changesPermissionModel: false
    executesApprovals: false
    mutatesSchema: false
    activatesHermes: false
    activatesMcp: false
    enablesAutonomy: false
    writesProduction: false
  }
}

export function getCorpusNativeArea(): CorpusNativeArea {
  return {
    title: "Corpus",
    eyebrow: "WilliamOS Source Body",
    description:
      "Corpus is the native WilliamOS source body for governed knowledge: reviewed sources, references, records, doctrine inputs, memory inputs, citations, provenance, and evidence-linked context.",
    postureSummary: [
      {
        label: "Source body",
        value: "governed knowledge",
        description:
          "Corpus holds source material so WilliamOS can inspect, cite, and connect knowledge to evidence.",
      },
      {
        label: "Provenance",
        value: "required",
        description:
          "Titles, source labels, and citations keep knowledge traceable before it influences work.",
      },
      {
        label: "Retrieval",
        value: "unchanged",
        description:
          "This reframe does not change ingestion, embedding, vector search, connectors, or retrieval behavior.",
      },
    ],
    sections: [
      {
        label: "Reviewed Sources",
        posture: "Inspectable",
        purpose: "Hold source material that has been selected for WilliamOS context.",
        provenance: "Title, source, and content review stay visible before indexing.",
        authorityRequirement: "Primary review before sensitive material enters the corpus.",
        evidenceLinkage: "Can support Evidence, Decisions, Doctrine, and Memory records.",
        nextSafeStep: "Review source text and safety preview before existing ingest controls are used.",
      },
      {
        label: "Evidence Inputs",
        posture: "Proof-linked",
        purpose: "Provide source context for validation reports, production checks, and completion claims.",
        provenance: "Evidence should cite the exact source or record it depends on.",
        authorityRequirement: "Claims need proof before they change status or trust.",
        evidenceLinkage: "Feeds /audit as supporting context, not as authority by itself.",
        nextSafeStep: "Attach source references to Evidence before relying on them.",
      },
      {
        label: "Doctrine Inputs",
        posture: "Review required",
        purpose: "Supply source material that may justify principles, safety boundaries, or approval gates.",
        provenance: "Doctrine-changing sources need source labels and rationale.",
        authorityRequirement: "Owner approval required before doctrine changes behavior.",
        evidenceLinkage: "Connect sources to doctrine supersession and rule review.",
        nextSafeStep: "Route doctrine changes through Governance and Work Orders.",
      },
      {
        label: "Memory Inputs",
        posture: "Correctable",
        purpose: "Provide source material that can support facts, decisions, procedures, and patterns.",
        provenance: "Memory should cite the source body before becoming trusted context.",
        authorityRequirement: "Review before canon or durable continuity.",
        evidenceLinkage: "Links source records to Memory review queues and stale checks.",
        nextSafeStep: "Use Memory review before treating source-derived claims as continuity.",
      },
      {
        label: "Citations",
        posture: "Traceable",
        purpose: "Make source-backed answers inspectable instead of opaque.",
        provenance: "Citations must point back to the source label and chunked context.",
        authorityRequirement: "Citations are proof references, not permission to act.",
        evidenceLinkage: "Supports answer grounding and evidence review.",
        nextSafeStep: "Prefer cited answers over unsupported claims.",
      },
      {
        label: "Stale Sources",
        posture: "Needs review",
        purpose: "Keep outdated or questionable source material from silently guiding work.",
        provenance: "Review age, origin, and replacement source before use.",
        authorityRequirement: "Primary review required when stale sources affect decisions.",
        evidenceLinkage: "Staleness should be visible in Evidence, Memory, or Decisions.",
        nextSafeStep: "Refresh, supersede, or mark source material as not reliable.",
      },
      {
        label: "Contradictions",
        posture: "Resolve before trust",
        purpose: "Expose conflicts between source records, doctrine, memory, or project context.",
        provenance: "Contradictions should preserve both source sides and resolution evidence.",
        authorityRequirement: "Owner decision required when conflict changes action.",
        evidenceLinkage: "Route contradictions to Decisions and Evidence before Work Orders proceed.",
        nextSafeStep: "Hold dependent work until contradiction review is complete.",
      },
    ],
    authorityBoundaries: [
      {
        label: "Ingestion",
        state: "Existing controls only",
        description: "This reframe adds no ingestion pipeline, upload behavior, or corpus mutation path.",
      },
      {
        label: "Retrieval",
        state: "Unchanged",
        description: "Embedding, vector search, chat retrieval, and citation behavior are not changed.",
      },
      {
        label: "Connectors",
        state: "Not activated",
        description:
          "No external connector, background ingestion, Hermes, MCP, or autonomous corpus behavior is enabled.",
      },
    ],
    links: [
      {
        label: "Evidence",
        href: "/audit",
        description: "Use source material as proof before claims become trusted.",
      },
      {
        label: "Memory",
        href: "/memory",
        description: "Connect reviewed source claims to continuity and review queues.",
      },
      {
        label: "Doctrine",
        href: "/doctrine",
        description: "Use cited sources when operating law changes.",
      },
      {
        label: "Work Orders",
        href: "/work-orders",
        description: "Turn corpus cleanup or source-review work into governed scope.",
      },
    ],
    safety: {
      nativeToWilliamOS: true,
      changesIngestion: false,
      changesUploadBehavior: false,
      changesEmbeddingBehavior: false,
      changesVectorRetrieval: false,
      activatesExternalConnectors: false,
      addsCorpusMutation: false,
      changesAuthBehavior: false,
      activatesAccessGrants: false,
      changesTokenHandling: false,
      addsAuditWriter: false,
      addsDurableLimiter: false,
      changesRuntimeValidation: false,
      changesPermissionModel: false,
      executesApprovals: false,
      mutatesSchema: false,
      activatesHermes: false,
      activatesMcp: false,
      enablesAutonomy: false,
      writesProduction: false,
    },
  }
}
