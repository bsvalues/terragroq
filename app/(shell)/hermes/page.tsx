import { HermesBoundaryPanel } from "@/components/hermes/hermes-boundary-panel"
import { PageHeader } from "@/components/shell/page-header"

export default function HermesPage() {
  return (
    <>
      <PageHeader
        title="Hermes Boundary"
        description="Static WilliamOS doctrine surface for Hermes sidecar boundaries, blocked states, activation requirements, worker packet proposals, and safety proof. Read-only; no Hermes activation."
      />
      <div className="flex flex-col gap-6 p-6">
        <HermesBoundaryPanel />
      </div>
    </>
  )
}
