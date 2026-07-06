import { AgentForgePanel } from "@/components/agent-forge/agent-forge-panel"
import { PageHeader } from "@/components/shell/page-header"

export default function AgentForgePage() {
  return (
    <>
      <PageHeader
        title="Agent Forge"
        description="WilliamOS skill governance layer for proposals, risk, quarantine, permissions, review packets, and safety proof. Read-only; no skills run here."
      />
      <div className="p-6">
        <AgentForgePanel />
      </div>
    </>
  )
}
