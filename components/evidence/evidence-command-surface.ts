import type { VerificationFlowStep } from "@/components/shell/verification-flow-grid"
import { LOCAL_OMEN_PHASE_ROLLUP } from "@/components/shell/shell-woe-resume-surface"

export type EvidenceCategory = {
  label: string
  status: string
  description: string
  href: string
}

export type EvidenceClarityLink = {
  label: string
  workOrder: string
  evidence: string
  destination: string
  href: string
}

export type EvidenceCommandSurface = {
  title: string
  eyebrow: string
  description: string
  operatorPosture: string
  verificationFlow: VerificationFlowStep[]
  proofSequence: EvidenceCategory[]
  workOrderLinks: EvidenceClarityLink[]
  productionVerificationSummary: EvidenceCategory[]
  reviewProofContext: EvidenceCategory[]
  blockedExpansion: EvidenceCategory[]
  categories: EvidenceCategory[]
  nextRecommendedWo: {
    label: string
    reason: string
  }
  safety: {
    readOnly: true
    mutatesEvidence: false
    autoIngests: false
    activatesExternalConnectors: false
    executesWork: false
    deploys: false
    grantsAuthority: false
    changesSchema: false
    activatesHermes: false
    activatesMcp: false
    enablesAutonomy: false
    writesProduction: false
  }
}

export function getEvidenceCommandSurface(): EvidenceCommandSurface {
  return {
    title: "Primary Evidence",
    eyebrow: "WilliamOS Proof Layer",
    description:
      "Evidence is the Primary Operator proof layer and record of reality: validation, PR outcomes, production verification, safety posture, timestamps, sources, blockers, and confirmed reality. It records what is known; it does not execute or authorize.",
    operatorPosture:
      "Codex may collect and cite proof inside an authorized Work Order, but Evidence itself cannot grant authority, run checks, ingest sources, or change state.",
    verificationFlow: [
      {
        label: "Owner Decision",
        value: "Authority source",
        description: "The reason work was allowed, blocked, redirected, or held for review.",
        href: "/decisions",
      },
      {
        label: "Work Order",
        value: "Scope record",
        description: "The bounded contract that defines what changed and what stayed blocked.",
        href: "/work-orders",
      },
      {
        label: "Evidence",
        value: "Proof layer",
        description: "The test, build, PR, production, source, timestamp, and safety proof for the claim.",
        href: "/audit",
      },
      {
        label: "Verified Result",
        value: "Reality confirmed",
        description: "A completed lane can return to Home only after proof is inspectable.",
        href: "/",
      },
    ],
    proofSequence: [
      {
        label: "1. Scope",
        status: "Bound",
        description: "Evidence starts with the Work Order contract: goal, files, blocked actions, validators, and stop conditions.",
        href: "/work-orders",
      },
      {
        label: "2. Validate",
        status: "Required",
        description: "Focused tests, full tests, diff checks, build output, PR checks, and review state prove the implementation lane.",
        href: "/audit",
      },
      {
        label: "3. Verify",
        status: "Production",
        description: "Health, auth readiness, touched routes, and deployment state prove hosted behavior when access allows inspection.",
        href: "/runtime",
      },
      {
        label: "4. Close",
        status: "Report",
        description: "Completion reports bind result, files changed, safety posture, review state, and next recommended lane.",
        href: "/work-orders",
      },
    ],
    workOrderLinks: [
      {
        label: "Scope to proof",
        workOrder: "WO-WOE-033..035",
        evidence: "Goal and loop contract records bind purpose, scope, validators, and stop conditions.",
        destination: "Goal Console",
        href: "/goal-console",
      },
      {
        label: "Surface to proof",
        workOrder: "WO-WOE-036..043",
        evidence: "Native WOE surfaces expose queue, detail, blockers, completion report, and filters.",
        destination: "Work Orders",
        href: "/work-orders",
      },
      {
        label: "Closure to proof",
        workOrder: "WO-WOE-046..047",
        evidence: "Safety sweep, final validation, PR checks, merge state, and production routes close the lane.",
        destination: "Evidence",
        href: "/audit",
      },
    ],
    productionVerificationSummary: [
      {
        label: "/api/health",
        status: "200",
        description: "Confirms the hosted WilliamOS process responds after merge.",
        href: "/runtime",
      },
      {
        label: "/api/auth/readiness",
        status: "ready",
        description: "Confirms owner-only auth readiness remains healthy.",
        href: "/runtime",
      },
      {
        label: "/work-orders, /goal-console, /audit",
        status: "reachable",
        description: "Confirms WOE and evidence surfaces remain inspectable in production.",
        href: "/work-orders",
      },
    ],
    reviewProofContext: [
      {
        label: "PR state",
        status: "merged",
        description: "The PR number, merge state, and main commit are proof fields, not assumptions.",
        href: "/audit",
      },
      {
        label: "Checks",
        status: "green",
        description: "Focused tests, lint, full suite, build, and hosted checks must be recorded before closure.",
        href: "/audit",
      },
      {
        label: "Review threads",
        status: "0 unresolved",
        description: "Unresolved review feedback blocks completion unless the final report marks it as an owner decision.",
        href: "/audit",
      },
    ],
    categories: [
      {
        label: "Latest Production Verification",
        status: "Confirmed",
        description:
          "Health, readiness, deployment, and security-header checks belong here before production claims are treated as true.",
        href: "/runtime",
      },
      {
        label: "PR / Check / Build / Test Evidence",
        status: "Required",
        description:
          "Pull request checks, focused tests, full-suite results, and build output form the validation proof chain.",
        href: "/audit",
      },
      {
        label: "Work Order Completion Evidence",
        status: "Linked",
        description:
          "Completed work should point back to validation, merged PRs, production verification, and safety posture.",
        href: "/work-orders",
      },
      {
        label: "Local OMEN Phase 1 Evidence",
        status: "Complete",
        description:
          "Local status API, runtime surface, proof route, manual wrapper proof, UX refinement, and safety posture are recorded as a stable read-only subsystem.",
        href: LOCAL_OMEN_PHASE_ROLLUP.href,
      },
      {
        label: "Evidence Spine",
        status: "First-class",
        description:
          "Goals, batches, Work Orders, validation, local proof, production proof, safety proof, blockers, and next-lane decisions are grouped here as read-only evidence.",
        href: "/audit",
      },
      {
        label: "Blocked Decision Evidence",
        status: "Gated",
        description:
          "Blocked choices stay visible with the failed check, blocker, or missing proof required before authority can move forward.",
        href: "/governance",
      },
      {
        label: "Safety Posture Evidence",
        status: "Read-only",
        description:
          "Brain Council and Hermes surfaces remain visible as governed context, not execution authority.",
        href: "/brain-council",
      },
    ],
    blockedExpansion: [
      {
        label: "No auto-ingestion",
        status: "Blocked",
        description: "Evidence remains manually recorded or statically modeled; no background importer or scanner is added.",
        href: "/audit",
      },
      {
        label: "No proof runner",
        status: "Blocked",
        description: "The Evidence surface may list validators, but it does not execute tests, builds, checks, or commands.",
        href: "/audit",
      },
      {
        label: "No authority grant",
        status: "Blocked",
        description: "Evidence can support an owner decision, but it cannot approve, grant, or bypass authority.",
        href: "/governance",
      },
      {
        label: "No production mutation",
        status: "Blocked",
        description: "Production verification is evidence; deployment, settings, DNS, and runtime writes remain outside this surface.",
        href: "/runtime",
      },
    ],
    nextRecommendedWo: {
      label: "WO-SHELL-007 - Systems Status Surface",
      reason:
        "After Work Orders and Evidence are centered in the Primary shell, the next safe lane is Systems Status: read-only health, readiness, and local/runtime posture.",
    },
    safety: {
      readOnly: true,
      mutatesEvidence: false,
      autoIngests: false,
      activatesExternalConnectors: false,
      executesWork: false,
      deploys: false,
      grantsAuthority: false,
      changesSchema: false,
      activatesHermes: false,
      activatesMcp: false,
      enablesAutonomy: false,
      writesProduction: false,
    },
  }
}
