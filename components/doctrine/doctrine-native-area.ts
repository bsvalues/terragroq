export type DoctrinePostureSummaryItem = {
  label: string
  value: string
  description: string
}

export type DoctrineLawSection = {
  label: string
  posture: string
  purpose: string
  boundary: string
  evidence: string
  ownerReview: string
  nextSafeStep: string
}

export type DoctrineAuthorityBoundary = {
  label: string
  state: string
  description: string
}

export type DoctrineNativeArea = {
  title: string
  eyebrow: string
  description: string
  postureSummary: DoctrinePostureSummaryItem[]
  sections: DoctrineLawSection[]
  authorityBoundaries: DoctrineAuthorityBoundary[]
  links: {
    label: string
    href: string
    description: string
  }[]
  safety: {
    nativeToWilliamOS: true
    changesAuthBehavior: false
    changesAccessBehavior: false
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

export function getDoctrineNativeArea(): DoctrineNativeArea {
  return {
    title: "Doctrine",
    eyebrow: "WilliamOS Operating Law",
    description:
      "Doctrine is the native WilliamOS area for operating law: principles, safety boundaries, approval gates, evidence rules, and correction paths that govern how the system behaves before action is allowed.",
    postureSummary: [
      {
        label: "Operating law",
        value: "governs behavior",
        description:
          "Doctrine states the rules WilliamOS must respect before goals, loops, Work Orders, or agents can proceed.",
      },
      {
        label: "Primary authority",
        value: "required",
        description:
          "Rules may describe allowed, forbidden, and approval-gated behavior; authority remains with the Primary.",
      },
      {
        label: "Enforcement",
        value: "described, not changed",
        description:
          "This surface explains boundaries and status. It does not add new enforcement, permissions, or runtime behavior.",
      },
    ],
    sections: [
      {
        label: "Principles",
        posture: "Baseline law",
        purpose: "Define the durable beliefs WilliamOS should preserve across work.",
        boundary: "Principles guide decisions; they do not grant permission by themselves.",
        evidence: "Principles should stay linked to decisions, incidents, or governance reports.",
        ownerReview: "Required when a principle changes the way the system may act.",
        nextSafeStep: "Keep principles short, explicit, and attached to the Work Order playbook.",
      },
      {
        label: "Safety Boundaries",
        posture: "Guarded",
        purpose: "State the actions WilliamOS must refuse, hold, or escalate.",
        boundary: "Forbidden actions remain blocked until a later doctrine revision supersedes them.",
        evidence: "Boundary changes need proof, risk review, and a visible replacement rule.",
        ownerReview: "Required for any boundary touching auth, DB, production, access, or runtime authority.",
        nextSafeStep: "Use Governance and Evidence before changing a boundary.",
      },
      {
        label: "Approval Gates",
        posture: "Explicit",
        purpose: "Mark the lanes where preparation is allowed but action requires authority.",
        boundary: "A gate can require approval; it cannot execute approval.",
        evidence: "Approval-gated work needs validation, denied actions, and scope evidence.",
        ownerReview: "Required before mutation, release, deploy, access, or activation gates move.",
        nextSafeStep: "Route approved direction through Work Orders.",
      },
      {
        label: "Advisory Only",
        posture: "No execution",
        purpose: "Keep Brain Council and reasoning outputs separate from authority.",
        boundary: "Recommendations can prepare packets; they cannot activate workers or grant access.",
        evidence: "Advisory outputs need evidence before they influence governed work.",
        ownerReview: "Required before any advisory output becomes a binding decision.",
        nextSafeStep: "Attach recommendations to Decisions and Evidence.",
      },
      {
        label: "Disabled Until Authorized",
        posture: "Fail-closed",
        purpose: "Make inactive capabilities visible without implying they are available.",
        boundary: "Access grants, Hermes, MCP, autonomy, scheduler, and skill execution remain inactive.",
        evidence: "Enablement requires readiness proof, rollback plan, and explicit owner approval.",
        ownerReview: "Required before any disabled capability becomes live behavior.",
        nextSafeStep: "Keep inactive capabilities in preview or readiness review.",
      },
      {
        label: "Correction",
        posture: "Supersede, do not erase",
        purpose: "Preserve lineage when doctrine changes.",
        boundary: "Old operating law should be superseded with evidence rather than silently overwritten.",
        evidence: "Corrections need the reason, replacement rule, and proof trail.",
        ownerReview: "Required when correction changes authority, risk class, or execution posture.",
        nextSafeStep: "Use supersession and evidence links for doctrine changes.",
      },
      {
        label: "Review",
        posture: "Ongoing",
        purpose: "Keep doctrine accurate as WilliamOS evolves.",
        boundary: "Stale doctrine should block confidence, not quietly govern from old assumptions.",
        evidence: "Review should reference incidents, validation, production checks, or owner decisions.",
        ownerReview: "Required when review changes what the system may do.",
        nextSafeStep: "Schedule review through a scoped Work Order when law becomes stale.",
      },
    ],
    authorityBoundaries: [
      {
        label: "Rules",
        state: "Not runtime",
        description:
          "Doctrine explains operating law and current rule posture; this reframe does not add enforcement code.",
      },
      {
        label: "Approval",
        state: "Not execution",
        description:
          "Approval gates can describe required authority, but they do not execute approvals or grant permissions.",
      },
      {
        label: "Activation",
        state: "Blocked",
        description:
          "Hermes, MCP, autonomy, access grants, token behavior, and production writes remain blocked until separate authority.",
      },
    ],
    links: [
      {
        label: "Governance",
        href: "/governance",
        description: "Inspect authority, safety gates, blocked decisions, and access posture.",
      },
      {
        label: "Work Orders",
        href: "/work-orders",
        description: "Carry doctrine into scoped work with validators and denied actions.",
      },
      {
        label: "Evidence",
        href: "/audit",
        description: "Attach proof before accepting, superseding, or relying on doctrine.",
      },
      {
        label: "Decisions",
        href: "/decisions",
        description: "Resolve doctrine-changing questions before new goals proceed.",
      },
    ],
    safety: {
      nativeToWilliamOS: true,
      changesAuthBehavior: false,
      changesAccessBehavior: false,
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
