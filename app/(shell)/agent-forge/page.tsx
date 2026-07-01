import { AgentForgePanel } from "@/components/agent-forge/agent-forge-panel"
import { PageHeader } from "@/components/shell/page-header"

export default function AgentForgePage() {
  return (
    <>
      <PageHeader
        title="Agent Forge"
        description="WilliamOS capability forge for skill proposals, worker packet drafts, quarantine review, and evidence contracts. Prepared, not active — no skills run here."
      />
      <div className="p-6">
        <AgentForgePanel />
      </div>
    </>
  )
}
