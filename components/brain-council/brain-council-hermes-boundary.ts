export type BrainCouncilHermesGate = {
  id: string
  label: string
  status: "not-ready" | "blocked" | "requires-owner"
  reason: string
}

export type BrainCouncilHermesBoundaryPreview = {
  verdict: "HERMES_NOT_READY_PREVIEW_ONLY"
  gates: BrainCouncilHermesGate[]
  missingApprovals: string[]
  blockedCapabilities: string[]
  nextSafeStep: string
  safety: {
    readOnly: true
    hermesRuntimeEnabled: false
    mcpActivation: false
    schedulerEnabled: false
    autonomyEnabled: false
    workerDispatch: false
    skillExecution: false
    productionWrite: false
  }
}

export function getBrainCouncilHermesBoundaryPreview(): BrainCouncilHermesBoundaryPreview {
  const gates: BrainCouncilHermesGate[] = [
    {
      id: "candidate-only",
      label: "Hermes candidate posture",
      status: "not-ready",
      reason: "Procedure candidates are visible but not ratified as executable skills.",
    },
    {
      id: "runtime-absent",
      label: "Runtime absent",
      status: "blocked",
      reason: "No Hermes runner, scheduler, queue worker, or MCP bridge exists in this lane.",
    },
    {
      id: "owner-authority",
      label: "Owner authority missing",
      status: "requires-owner",
      reason: "Runtime activation would require a separate explicit owner decision.",
    },
    {
      id: "production-write",
      label: "Production write denied",
      status: "blocked",
      reason: "No production-write authority exists for Brain Council or Hermes.",
    },
  ]

  return {
    verdict: "HERMES_NOT_READY_PREVIEW_ONLY",
    gates,
    missingApprovals: [
      "Hermes runtime design approval",
      "MCP activation approval",
      "scheduler/autonomy approval",
      "production-write approval, if ever needed",
    ],
    blockedCapabilities: [
      "launch Hermes",
      "execute skills",
      "schedule loops",
      "dispatch workers",
      "activate MCP",
      "write production data",
    ],
    nextSafeStep:
      "Inspect Hermes files only as candidate/boundary documentation before any runtime work is proposed.",
    safety: {
      readOnly: true,
      hermesRuntimeEnabled: false,
      mcpActivation: false,
      schedulerEnabled: false,
      autonomyEnabled: false,
      workerDispatch: false,
      skillExecution: false,
      productionWrite: false,
    },
  }
}
