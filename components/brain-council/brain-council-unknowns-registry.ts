export type BrainCouncilUnknownRecord = {
  id: string
  unknown: string
  priority: "low" | "medium" | "high"
  owner: string
  linkedQuestion: string
  researchNeeded: string
  status: "open" | "researching" | "blocked"
}

export type BrainCouncilUnknownsRegistry = {
  posture: "UNKNOWNS_REGISTRY_READ_ONLY"
  unknowns: BrainCouncilUnknownRecord[]
  safety: {
    assignsOwner: false
    startsResearch: false
    schedulesWork: false
    writesData: false
  }
}

export function getBrainCouncilUnknownsRegistry(): BrainCouncilUnknownsRegistry {
  return {
    posture: "UNKNOWNS_REGISTRY_READ_ONLY",
    unknowns: [
      {
        id: "UNK-001",
        unknown: "How much does the readiness evaluator reduce unsafe recommendations over repeated cases?",
        priority: "high",
        owner: "operator review",
        linkedQuestion: "Q-001",
        researchNeeded: "Run more paper-only readiness comparisons against completed PRs.",
        status: "researching",
      },
      {
        id: "UNK-002",
        unknown: "What sandbox proof is enough before Hermes output can be imported?",
        priority: "high",
        owner: "Forge boundary review",
        linkedQuestion: "Q-002",
        researchNeeded: "Define egress review evidence, secret scan proof, and mutation block proof.",
        status: "blocked",
      },
      {
        id: "UNK-003",
        unknown: "Which procedure candidates repeatedly improve operator workflow quality?",
        priority: "medium",
        owner: "Brain Council research",
        linkedQuestion: "Q-003",
        researchNeeded: "Compare procedure candidates against observed operator outcomes.",
        status: "open",
      },
      {
        id: "UNK-004",
        unknown: "When is activation authority meaningfully separate from ratification?",
        priority: "medium",
        owner: "governance review",
        linkedQuestion: "Q-004",
        researchNeeded: "Review activation ledger examples and identify owner-only decision points.",
        status: "blocked",
      },
    ],
    safety: {
      assignsOwner: false,
      startsResearch: false,
      schedulesWork: false,
      writesData: false,
    },
  }
}
