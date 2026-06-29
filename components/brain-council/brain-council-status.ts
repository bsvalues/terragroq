import gateScoreboard from "@/brain-council/GATE_SCOREBOARD.json"
import version from "@/brain-council/VERSION.json"

type BrainCouncilGate = {
  gate: string
  status: string
  authority: string
}

export type BrainCouncilStatus = {
  version: string
  installed: boolean
  verified: boolean
  governed: boolean
  runtimeActivation: "disabled"
  mcp: "disabled"
  autonomy: "disabled"
  productionWrite: "disabled"
  summary: string
  gates: BrainCouncilGate[]
}

function gateStatus(gates: BrainCouncilGate[], gate: string) {
  return gates.find((entry) => entry.gate === gate)?.status
}

export function getBrainCouncilStatus(): BrainCouncilStatus {
  const gates = gateScoreboard.gates as BrainCouncilGate[]
  const installed = gateStatus(gates, "install_to_william_os") === "PASS"
  const verified = gateStatus(gates, "post_install_verify") === "PASS"
  const mcpDisabled = gateStatus(gates, "mcp_activation") === "NOT_AUTHORIZED"
  const autonomyDisabled = gateStatus(gates, "autonomy") === "NOT_AUTHORIZED"

  return {
    version: version.version,
    installed,
    verified,
    governed: installed && verified && mcpDisabled && autonomyDisabled,
    runtimeActivation: "disabled",
    mcp: "disabled",
    autonomy: "disabled",
    productionWrite: "disabled",
    summary:
      "Brain Council is installed as a governed specification/readiness layer. It is visible to the operator, but it is not an activated autonomous runtime.",
    gates,
  }
}
