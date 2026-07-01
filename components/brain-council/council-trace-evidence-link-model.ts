export type CouncilTraceLinkType =
  | "work-order"
  | "test"
  | "build"
  | "production-check"
  | "safety-boundary"

export type CouncilTraceEvidenceLink = {
  id: string
  type: CouncilTraceLinkType
  label: string
  source: string
  claim: string
  evidence: string
  posture: "verified" | "requires-review" | "blocked"
}

export type CouncilTraceEvidenceModel = {
  title: string
  summary: string
  links: CouncilTraceEvidenceLink[]
  requiredLinkTypes: CouncilTraceLinkType[]
  safety: {
    modelOnly: true
    writesTraceLedger: false
    mutatesEvidence: false
    startsVerification: false
    grantsAuthority: false
    writesProduction: false
  }
}

export function getCouncilTraceEvidenceModel(): CouncilTraceEvidenceModel {
  return {
    title: "Council trace and evidence link model",
    summary:
      "A read-only model for connecting Council claims to Work Orders, tests, builds, production checks, and safety boundaries before the Primary trusts a recommendation.",
    requiredLinkTypes: [
      "work-order",
      "test",
      "build",
      "production-check",
      "safety-boundary",
    ],
    links: [
      {
        id: "trace-woe-phase",
        type: "work-order",
        label: "Work Order evidence",
        source: "GOAL-WOE-001",
        claim: "/goal and /loop surfaces are native WilliamOS concepts.",
        evidence: "WO-WOE-001 through WO-WOE-008 merged with validation and production checks.",
        posture: "verified",
      },
      {
        id: "trace-test-suite",
        type: "test",
        label: "Test evidence",
        source: "vitest",
        claim: "Council advisory surfaces remain non-executing.",
        evidence: "Focused Council tests assert false for execution, tool activation, and production write flags.",
        posture: "verified",
      },
      {
        id: "trace-build",
        type: "build",
        label: "Build evidence",
        source: "next build",
        claim: "Council UI/schema additions compile as part of the WilliamOS shell.",
        evidence: "Next.js production build passes before each Council PR merge.",
        posture: "verified",
      },
      {
        id: "trace-production",
        type: "production-check",
        label: "Production evidence",
        source: "/api/health and /api/auth/readiness",
        claim: "Council advisory work does not degrade production health or auth readiness.",
        evidence: "Post-merge checks return 200 ok and ready:true.",
        posture: "verified",
      },
      {
        id: "trace-safety",
        type: "safety-boundary",
        label: "Safety boundary",
        source: "Council blocked powers",
        claim: "Council cannot execute, activate Hermes/MCP, grant access, or write production data.",
        evidence: "Safety flags and blocked action lists remain explicit in Council schema tests.",
        posture: "verified",
      },
    ],
    safety: {
      modelOnly: true,
      writesTraceLedger: false,
      mutatesEvidence: false,
      startsVerification: false,
      grantsAuthority: false,
      writesProduction: false,
    },
  }
}

export function getCouncilTraceLinksByType(type: CouncilTraceLinkType): CouncilTraceEvidenceLink[] {
  return getCouncilTraceEvidenceModel().links.filter((link) => link.type === type)
}
