export type HermesSandboxRequirement = {
  id: string
  label: string
  status: "required" | "blocked-until-proven"
  source: string
  acceptance: string
}

export type HermesSandboxRequirementChecklist = {
  posture: "SANDBOX_REQUIREMENTS_PREVIEW_ONLY"
  requirements: HermesSandboxRequirement[]
  nonNegotiables: string[]
  safety: {
    createsSandbox: false
    runsCode: false
    importsOutput: false
    exposesSecrets: false
    mutatesRepo: false
    writesProductionData: false
  }
}

export function getHermesSandboxRequirementChecklist(): HermesSandboxRequirementChecklist {
  return {
    posture: "SANDBOX_REQUIREMENTS_PREVIEW_ONLY",
    requirements: [
      {
        id: "read-only-input",
        label: "Read-only input snapshot",
        status: "required",
        source: "broker/broker-policy.json",
        acceptance: "Sandbox input must be decision packets, read-only repo snapshots, or sanitized context.",
      },
      {
        id: "egress-review",
        label: "Broker egress review",
        status: "required",
        source: "broker/broker-policy.json",
        acceptance: "Evidence reports, worker packet drafts, skill proposals, and summaries require review before import.",
      },
      {
        id: "secret-block",
        label: "Secret and private-data block",
        status: "required",
        source: "broker/broker-policy.json",
        acceptance: "Secrets, tokens, private keys, raw county exports, and secret values remain blocked egress.",
      },
      {
        id: "mutation-proof",
        label: "No mutation proof",
        status: "blocked-until-proven",
        source: ".agents/hermes-profile.readonly.json",
        acceptance: "Sandbox output cannot directly mutate TerraFusion, WilliamOS, git, deployment, release, or data state.",
      },
    ],
    nonNegotiables: [
      "No direct import from sandbox to production context",
      "No repo mutation from sandbox output",
      "No skill invocation from sandbox output",
      "No secret egress",
      "No worker dispatch",
      "No MCP bridge",
    ],
    safety: {
      createsSandbox: false,
      runsCode: false,
      importsOutput: false,
      exposesSecrets: false,
      mutatesRepo: false,
      writesProductionData: false,
    },
  }
}
