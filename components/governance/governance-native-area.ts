export type GovernancePostureSummaryItem = {
  label: string
  value: string
  description: string
}

export type GovernanceControlSection = {
  label: string
  posture: string
  purpose: string
  allowed: string
  blocked: string
  ownerApproval: string
  nextSafeStep: string
}

export type GovernanceAuthorityBoundary = {
  label: string
  state: string
  description: string
}

export type GovernanceNativeArea = {
  title: string
  eyebrow: string
  description: string
  postureSummary: GovernancePostureSummaryItem[]
  sections: GovernanceControlSection[]
  authorityBoundaries: GovernanceAuthorityBoundary[]
  links: {
    label: string
    href: string
    description: string
  }[]
  safety: {
    nativeToWilliamOS: true
    changesAuthBehavior: false
    changesAuthPolicy: false
    activatesAccessGrants: false
    issuesTokens: false
    addsAuditWriter: false
    addsDurableLimiter: false
    changesRuntimeValidation: false
    changesPermissionModel: false
    executesApprovals: false
    autoApproves: false
    mutatesSchema: false
    activatesHermes: false
    activatesMcp: false
    enablesAutonomy: false
    writesProduction: false
  }
}

export function getGovernanceNativeArea(): GovernanceNativeArea {
  return {
    title: "Governance",
    eyebrow: "WilliamOS Authority Layer",
    description:
      "Governance is the native WilliamOS area for Primary authority, safety gates, blocked decisions, access posture, and evidence-backed approval boundaries. It shows what the system may prepare, what it may recommend, and what requires owner approval before anything can act.",
    postureSummary: [
      {
        label: "Primary authority",
        value: "owner-gated",
        description:
          "WilliamOS may prepare recommendations and evidence, but consequential authority remains with the Primary.",
      },
      {
        label: "Safety gates",
        value: "mutation blocked",
        description:
          "Approval, access, runtime, and production changes must pass explicit gates before work can move.",
      },
      {
        label: "Evidence",
        value: "required",
        description:
          "Decisions, releases, grants, and activation reviews need proof before trust expands.",
      },
    ],
    sections: [
      {
        label: "Primary Authority",
        posture: "Owner decision",
        purpose: "Separate intent, approval, and authority so WilliamOS cannot silently expand power.",
        allowed: "Review authority posture and active grants.",
        blocked: "No automatic approval, permission expansion, or grant execution is added here.",
        ownerApproval: "Required before authority can expand beyond the current gate.",
        nextSafeStep: "Keep authority decisions attached to Work Orders and Evidence.",
      },
      {
        label: "Blocked Decisions",
        posture: "Held",
        purpose: "Keep unresolved safety, product, and execution decisions visible until reviewed.",
        allowed: "Show why work is blocked and what evidence would clear the gate.",
        blocked: "No blocked decision may launch work or bypass review.",
        ownerApproval: "Required to resolve decision gates that change risk or authority.",
        nextSafeStep: "Route decisions through /decisions before classifying new goals.",
      },
      {
        label: "Safety Gates",
        posture: "Enforced",
        purpose: "Declare the boundary between preparation and action.",
        allowed: "Inspect gates for deploy, release, auth, DB, access, runtime, and autonomy risk.",
        blocked: "No deploy, release, schema, access, or runtime behavior starts from this reframe.",
        ownerApproval: "Required for any gate that crosses into mutation or production impact.",
        nextSafeStep: "Attach gate status to Work Orders and verification evidence.",
      },
      {
        label: "Access Posture",
        posture: "Disabled until approved",
        purpose: "Make access grant readiness visible without enabling live access behavior.",
        allowed: "Report access grant readiness and fail-closed status.",
        blocked: "No token issuance, runtime validation, limiter activation, or access-link acceptance.",
        ownerApproval: "Required before access grants can become production behavior.",
        nextSafeStep: "Use the access grant authority packet before activation.",
      },
      {
        label: "Activation Reviews",
        posture: "Prepared, not authorized",
        purpose: "Hold Hermes, MCP, skills, and runtime capability reviews behind authority.",
        allowed: "Describe missing approvals, required evidence, and sandbox posture.",
        blocked: "No Hermes, MCP, worker, scheduler, skill execution, or autonomy activation.",
        ownerApproval: "Required before any runtime capability can become active.",
        nextSafeStep: "Keep activation candidates preview-only until review passes.",
      },
      {
        label: "Evidence Required",
        posture: "Proof first",
        purpose: "Make evidence the reason a gate can move, not an after-the-fact note.",
        allowed: "Link validation, production checks, and review evidence to gates.",
        blocked: "No claim can become authority merely because it is stated.",
        ownerApproval: "Required when evidence supports a risk-changing decision.",
        nextSafeStep: "Verify through /audit before changing posture.",
      },
      {
        label: "Permission Boundaries",
        posture: "Explicit",
        purpose: "Show what is allowed, denied, and waiting before a Work Order can proceed.",
        allowed: "Clarify current permission boundaries and denied actions.",
        blocked: "No permission model change, role expansion, or hidden elevation is introduced.",
        ownerApproval: "Required for any new permission boundary or access class.",
        nextSafeStep: "Keep denied actions visible in Work Orders and governance records.",
      },
    ],
    authorityBoundaries: [
      {
        label: "Approval",
        state: "Not execution",
        description:
          "A visible approval gate records owner intent; it does not by itself run work, issue access, or mutate production.",
      },
      {
        label: "Access grants",
        state: "Disabled",
        description:
          "Issue, accept, token, limiter, audit, and runtime validation behavior remain blocked until separate activation authority.",
      },
      {
        label: "Runtime activation",
        state: "Blocked",
        description:
          "Hermes, MCP, schedulers, workers, and skill execution remain inactive without explicit owner authorization.",
      },
    ],
    links: [
      {
        label: "Decisions",
        href: "/decisions",
        description: "Resolve blocked choices before new goals or mutation proceed.",
      },
      {
        label: "Work Orders",
        href: "/work-orders",
        description: "Carry authority, scope, denied actions, and validation into governed work.",
      },
      {
        label: "Evidence",
        href: "/audit",
        description: "Use proof to support gate movement and completion claims.",
      },
      {
        label: "Systems",
        href: "/runtime",
        description: "Check runtime, auth, access posture, and production readiness.",
      },
    ],
    safety: {
      nativeToWilliamOS: true,
      changesAuthBehavior: false,
      changesAuthPolicy: false,
      activatesAccessGrants: false,
      issuesTokens: false,
      addsAuditWriter: false,
      addsDurableLimiter: false,
      changesRuntimeValidation: false,
      changesPermissionModel: false,
      executesApprovals: false,
      autoApproves: false,
      mutatesSchema: false,
      activatesHermes: false,
      activatesMcp: false,
      enablesAutonomy: false,
      writesProduction: false,
    },
  }
}
