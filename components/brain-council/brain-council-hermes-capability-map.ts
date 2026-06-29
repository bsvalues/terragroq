export type HermesCapability = {
  id: string
  label: string
  class: "reference" | "proposal" | "blocked-runtime"
  source: string
  operatorMeaning: string
  authority: "inspect-only" | "draft-only" | "denied"
}

export type HermesCandidateCapabilityMap = {
  posture: "CANDIDATE_CAPABILITIES_ONLY"
  capabilities: HermesCapability[]
  activationRule: string
  safety: {
    grantsAuthority: false
    executesCapability: false
    dispatchesWorker: false
    activatesMcp: false
    mutatesRepo: false
    productionWrite: false
  }
}

export function getHermesCandidateCapabilityMap(): HermesCandidateCapabilityMap {
  return {
    posture: "CANDIDATE_CAPABILITIES_ONLY",
    activationRule:
      "Capabilities are visible for operator reasoning only. Any runtime authority would require a separate activation ledger entry and owner authority.",
    capabilities: [
      {
        id: "inspect-repo-state",
        label: "Inspect repository state",
        class: "reference",
        source: ".agents/hermes-profile.readonly.json",
        operatorMeaning: "Hermes may be evaluated as a reader of git status, logs, diffs, and PR metadata.",
        authority: "inspect-only",
      },
      {
        id: "summarize-classify",
        label: "Summarize and classify",
        class: "reference",
        source: ".agents/hermes-profile.readonly.json",
        operatorMeaning: "Hermes may be considered for decision-support summaries and action classification.",
        authority: "inspect-only",
      },
      {
        id: "packet-drafts",
        label: "Draft worker packets and evidence reports",
        class: "proposal",
        source: ".agents/hermes-profile.readonly.json",
        operatorMeaning: "Hermes can be evaluated as a packet drafter, with broker review before import.",
        authority: "draft-only",
      },
      {
        id: "propose-skill",
        label: "Propose skills",
        class: "proposal",
        source: "broker/broker-policy.json",
        operatorMeaning: "Skill proposals require review and ratification; proposals are not invocations.",
        authority: "draft-only",
      },
      {
        id: "repo-mutation",
        label: "Mutate repository or merge PRs",
        class: "blocked-runtime",
        source: ".agents/hermes-profile.readonly.json",
        operatorMeaning: "Repo writes, push, merge, tag, release, and deploy are blocked capabilities.",
        authority: "denied",
      },
      {
        id: "skill-runtime",
        label: "Invoke skills or promote memory",
        class: "blocked-runtime",
        source: "activation/activation-policy.json",
        operatorMeaning: "Skill invocation and memory inclusion are blocked without activation ledger review.",
        authority: "denied",
      },
    ],
    safety: {
      grantsAuthority: false,
      executesCapability: false,
      dispatchesWorker: false,
      activatesMcp: false,
      mutatesRepo: false,
      productionWrite: false,
    },
  }
}
