export type HermesInventoryItem = {
  id: string
  label: string
  sourcePath: string
  kind: "profile" | "policy" | "procedure" | "belief" | "readiness" | "report"
  signal: string
  boundary: string
}

export type HermesFilesInventory = {
  sourceRoots: string[]
  posture: "REFERENCE_ONLY_NOT_INSTALLED"
  items: HermesInventoryItem[]
  safety: {
    readOnly: true
    installedHermes: false
    executedHermes: false
    activatedMcp: false
    enabledAutonomy: false
    productionWrite: false
  }
}

export function getHermesFilesInventory(): HermesFilesInventory {
  return {
    sourceRoots: [
      "C:/Users/bsval/brain_council_superbrain_package_v0_9",
      "C:/Users/bsval/williamos-agent-forge-v1.5-readiness-evaluator",
    ],
    posture: "REFERENCE_ONLY_NOT_INSTALLED",
    items: [
      {
        id: "hermes-readonly-profile",
        label: "Hermes read-only sidecar profile",
        sourcePath: ".agents/hermes-profile.readonly.json",
        kind: "profile",
        signal: "Allowed capabilities are inspection, summarization, classification, packet drafts, reports, and proposals.",
        boundary: "Repo writes, push, merge, release, deploy, secret export, canonization, and memory promotion remain blocked.",
      },
      {
        id: "activation-ledger",
        label: "Activation ledger policy",
        sourcePath: "activation/activation-policy.json",
        kind: "policy",
        signal: "Default activation policy is DENY and ratification alone never activates anything.",
        boundary: "Skill invocation, memory inclusion, repo action execution, exceptions, and policy enforcement require ledger review.",
      },
      {
        id: "broker-egress",
        label: "Forge broker egress/import gate",
        sourcePath: "broker/broker-policy.json",
        kind: "policy",
        signal: "Ingress is limited to decision packets, read-only snapshots, and sanitized context.",
        boundary: "Sandbox output cannot directly mutate TerraFusion or WilliamOS.",
      },
      {
        id: "procedure-first",
        label: "Procedure before skill belief",
        sourcePath: "epistemology/beliefs/BEL-002-procedures-before-skills.json",
        kind: "belief",
        signal: "Hermes should generate procedures first; skills only after repeated success.",
        boundary: "No skill execution or runtime activation is implied by procedure candidates.",
      },
      {
        id: "readiness-sample",
        label: "Readiness evaluator sample",
        sourcePath: "readiness/templates/readiness-input-example.json",
        kind: "readiness",
        signal: "Readiness asks whether a PR or work order is safe to advance using explicit authority fields.",
        boundary: "Merge and release remain false unless explicitly authorized in the input.",
      },
      {
        id: "assurance-report",
        label: "Forge assurance report",
        sourcePath: "reports/assurance-report.json",
        kind: "report",
        signal: "No autonomous repo mutation authority granted; skill promotion remains ratification-gated.",
        boundary: "Carried-forward skills are provenance-only and not invokable.",
      },
    ],
    safety: {
      readOnly: true,
      installedHermes: false,
      executedHermes: false,
      activatedMcp: false,
      enabledAutonomy: false,
      productionWrite: false,
    },
  }
}
