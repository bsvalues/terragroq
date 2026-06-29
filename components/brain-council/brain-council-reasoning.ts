export type BrainCouncilEvidenceItem = {
  label: string
  source: string
  summary: string
}

export type BrainCouncilHypothesis = {
  id: string
  title: string
  claim: string
  confidence: number
  rationale: string
  verification: string[]
}

export type BrainCouncilDecisionPacket = {
  verdict: string
  recommendation: string
  nextAction: string
  requiredVerification: string[]
  blockedActions: string[]
}

export type BrainCouncilReasoningPacket = {
  question: string
  selectedBrains: string[]
  evidence: BrainCouncilEvidenceItem[]
  unknowns: string[]
  hypotheses: BrainCouncilHypothesis[]
  ranking: string[]
  confidence: number
  decisionPacket: BrainCouncilDecisionPacket
  safety: {
    readOnly: true
    wouldExecute: false
    autonomyEnabled: false
    mcpActivation: false
    productionWrite: false
  }
}

const hypotheses: BrainCouncilHypothesis[] = [
  {
    id: "hypothesis-1",
    title: "Reasoning layer before runtime layer",
    claim:
      "Brain Council should first explain how it reasons about a proposed operator decision before any Hermes runtime surface exists.",
    confidence: 0.82,
    rationale:
      "The current system already exposes Brain Council status, gates, and evidence. The missing step is synthesis: question, evidence, alternatives, confidence, and decision packet.",
    verification: [
      "Confirm the view remains static and read-only.",
      "Confirm no agent runner, scheduler, MCP, or production-write path is introduced.",
    ],
  },
  {
    id: "hypothesis-2",
    title: "More manifest detail is lower leverage",
    claim:
      "Role and skill drilldowns are useful, but they are secondary to showing how Brain Council helps the operator think.",
    confidence: 0.68,
    rationale:
      "Manifest data is already visible enough for readiness. The operator now needs cognition-oriented structure rather than another registry view.",
    verification: [
      "Check whether the reasoning packet links back to existing evidence surfaces.",
      "Keep future manifest drilldowns available as supporting references.",
    ],
  },
  {
    id: "hypothesis-3",
    title: "Worker packets should stay downstream",
    claim:
      "Worker packet preview belongs after reasoning and readiness evaluation, because it should package a decision rather than replace one.",
    confidence: 0.61,
    rationale:
      "A packet for Codex or Claude is only useful after the operator can see the question, evidence, uncertainty, and chosen next action.",
    verification: [
      "Build worker packet preview as a later read-only slice.",
      "Do not add send, execute, or dispatch behavior.",
    ],
  },
]

export function getBrainCouncilReasoningPacket(): BrainCouncilReasoningPacket {
  return {
    question:
      "What is the safest next step after making Brain Council visible in the Operator Console?",
    selectedBrains: [
      "Architect Brain",
      "Safety Brain",
      "Evidence Brain",
      "Operator Experience Brain",
    ],
    evidence: [
      {
        label: "Brain Council visibility chain",
        source: "PR #37-#41",
        summary:
          "Version, manifest, roles, gates, evidence, readiness, and boundaries are now visible without runtime activation.",
      },
      {
        label: "Production readiness",
        source: "/api/health and /api/auth/readiness",
        summary:
          "Production health and auth readiness were verified after the visibility chain merged.",
      },
      {
        label: "Governance boundary",
        source: "Brain Council status and boundary panels",
        summary:
          "MCP, autonomy, scheduler behavior, and production writes remain disabled.",
      },
    ],
    unknowns: [
      "Which reasoning packet fields should become operator-editable later?",
      "Which Brain Council roles should be selected automatically for each question type?",
      "What confidence threshold should require more evidence before a worker packet is prepared?",
    ],
    hypotheses,
    ranking: hypotheses.map((hypothesis) => hypothesis.id),
    confidence: 0.82,
    decisionPacket: {
      verdict: "Proceed with a read-only reasoning view.",
      recommendation:
        "Replace static polish with a cognition-oriented Brain Council surface that shows question, evidence, unknowns, hypotheses, confidence, and next action.",
      nextAction: "Continue to Readiness Evaluator UI after this view is validated and merged.",
      requiredVerification: [
        "Focused reasoning packet tests pass.",
        "Full test suite passes.",
        "Build passes.",
        "Production health and auth readiness pass after merge.",
      ],
      blockedActions: [
        "execute Brain Council",
        "activate MCP",
        "enable autonomy",
        "dispatch workers",
        "write production data",
      ],
    },
    safety: {
      readOnly: true,
      wouldExecute: false,
      autonomyEnabled: false,
      mcpActivation: false,
      productionWrite: false,
    },
  }
}
