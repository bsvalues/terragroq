import { AgentForgePanel } from "@/components/agent-forge/agent-forge-panel"
import { PageHeader } from "@/components/shell/page-header"

export default function AgentForgePage() {
  return (
    <>
      <PageHeader
        title="Agent Forge"
        description="WilliamOS capability preparation layer for skill definitions, worker packets, evidence contracts, and execution proposals. Proposal-only — no skills run here."
      />
      <div className="p-6">
        <AgentForgePanel />
      </div>
    </>
  )
}
