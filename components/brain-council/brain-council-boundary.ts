export type BrainCouncilBoundary = {
  operatorConsole: string
  brainCouncil: string
  inactiveRuntime: string
  prohibited: string[]
}

export function getBrainCouncilBoundary(): BrainCouncilBoundary {
  return {
    operatorConsole: "TerraGroq/WilliamOS is the operator console: it presents state, routes attention, and records governed actions.",
    brainCouncil: "Brain Council is the specification/readiness layer: it defines roles, gates, skills, workflows, and verification posture.",
    inactiveRuntime: "Brain Council is not running as an autonomous runtime from this console.",
    prohibited: [
      "MCP activation",
      "autonomous execution",
      "background workers",
      "production data writes",
      "deployment or release authority",
    ],
  }
}
