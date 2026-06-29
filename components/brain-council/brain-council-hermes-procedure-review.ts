export type HermesCandidateProcedure = {
  id: string
  title: string
  source: string
  ratificationStatus: "proposed" | "not-ratified"
  confidence: number
  reviewFocus: string[]
  blockedUntil: string[]
}

export type HermesCandidateProcedureReview = {
  posture: "PROCEDURE_REVIEW_ONLY"
  procedures: HermesCandidateProcedure[]
  decisionRule: string
  safety: {
    promotesSkill: false
    invokesProcedure: false
    writesMemory: false
    dispatchesWorker: false
    activatesHermes: false
  }
}

export function getHermesCandidateProcedureReview(): HermesCandidateProcedureReview {
  return {
    posture: "PROCEDURE_REVIEW_ONLY",
    decisionRule:
      "A procedure candidate can be reviewed for clarity and evidence quality, but cannot become a skill or runtime action without ratification plus a separate activation ledger.",
    procedures: [
      {
        id: "pr-posture-review",
        title: "PR posture review",
        source: "brain-memory/procedures/pr-posture-review.meta.json",
        ratificationStatus: "proposed",
        confidence: 86,
        reviewFocus: ["scope containment", "checks and review state", "authority boundary"],
        blockedUntil: ["repeated success evidence", "ratification record", "activation ledger entry"],
      },
      {
        id: "readiness-evaluation",
        title: "Readiness evaluation",
        source: "readiness/templates/readiness-input-example.json",
        ratificationStatus: "not-ratified",
        confidence: 74,
        reviewFocus: ["explicit authority flags", "stop conditions", "required evidence"],
        blockedUntil: ["operator calibration", "false-positive review", "owner activation decision"],
      },
      {
        id: "worker-packet-draft",
        title: "Worker packet drafting",
        source: "broker/broker-policy.json",
        ratificationStatus: "not-ratified",
        confidence: 61,
        reviewFocus: ["sanitized context", "egress constraints", "missing evidence"],
        blockedUntil: ["broker review", "secret scan", "import approval"],
      },
    ],
    safety: {
      promotesSkill: false,
      invokesProcedure: false,
      writesMemory: false,
      dispatchesWorker: false,
      activatesHermes: false,
    },
  }
}
