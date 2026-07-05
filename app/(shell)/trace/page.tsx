import { PageHeader } from "@/components/shell/page-header"
import { TraceLedgerPanel } from "@/components/trace/trace-ledger-panel"

export default function TraceLedgerPage() {
  return (
    <>
      <PageHeader
        title="Trace Ledger"
        description="Static reasoning records for goals, loops, Work Orders, evidence, memory, decisions, authority gates, and failure-to-eval proposals. Read-only — no runtime tracing or eval execution."
      />
      <div className="flex flex-col gap-6 p-6">
        <TraceLedgerPanel />
      </div>
    </>
  )
}
