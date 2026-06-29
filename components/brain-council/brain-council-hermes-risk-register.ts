export type HermesActivationRisk = {
  id: string
  title: string
  severity: "high" | "critical"
  source: string
  risk: string
  currentControl: string
  requiredBeforeProposal: string[]
}

export type HermesActivationRiskRegister = {
  posture: "ACTIVATION_DENIED_RISK_REGISTER_ONLY"
  risks: HermesActivationRisk[]
  escalationOnly: string[]
  safety: {
    changesPolicy: false
    grantsActivation: false
    createsRuntime: false
    mutatesDatabase: false
    changesEnvironment: false
    productionWrite: false
  }
}

export function getHermesActivationRiskRegister(): HermesActivationRiskRegister {
  return {
    posture: "ACTIVATION_DENIED_RISK_REGISTER_ONLY",
    risks: [
      {
        id: "runtime-without-ledger",
        title: "Runtime activation without ledger evidence",
        severity: "critical",
        source: "activation/activation-policy.json",
        risk: "A ratified item could be mistaken for an executable authority.",
        currentControl: "Default DENY; ratification alone never activates.",
        requiredBeforeProposal: ["activation record", "rollback plan", "expiry/review date", "owner authority"],
      },
      {
        id: "repo-mutation",
        title: "Repository mutation through sidecar",
        severity: "critical",
        source: ".agents/hermes-profile.readonly.json",
        risk: "A read-only sidecar could cross into write, push, merge, tag, release, or deploy authority.",
        currentControl: "write_repo_files, git_push, git_merge, release, and production_deploy are blocked.",
        requiredBeforeProposal: ["explicit mutation class", "diff boundaries", "validator evidence", "human merge gate"],
      },
      {
        id: "broker-egress",
        title: "Unreviewed broker egress",
        severity: "high",
        source: "broker/broker-policy.json",
        risk: "Sandbox output could be imported as trusted instructions without review.",
        currentControl: "Worker packet drafts and skill proposals require review before import.",
        requiredBeforeProposal: ["sanitization proof", "broker review", "blocked-egress scan"],
      },
      {
        id: "skill-invocation",
        title: "Skill invocation before repeated proof",
        severity: "high",
        source: "epistemology/beliefs/BEL-002-procedures-before-skills.json",
        risk: "Procedure candidates could be treated as executable skills too early.",
        currentControl: "Procedures come before skills; skill promotion remains ratification-gated.",
        requiredBeforeProposal: ["repeated successful procedure runs", "risk class", "ratification record"],
      },
    ],
    escalationOnly: [
      "MCP activation",
      "autonomous loop scheduling",
      "worker dispatch",
      "production data write",
      "secret or environment handling",
      "release/deploy authority",
    ],
    safety: {
      changesPolicy: false,
      grantsActivation: false,
      createsRuntime: false,
      mutatesDatabase: false,
      changesEnvironment: false,
      productionWrite: false,
    },
  }
}
