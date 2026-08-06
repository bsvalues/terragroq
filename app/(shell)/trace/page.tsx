import { getRuntimeExecutions } from "@/app/actions/runtime-executions"
import { getDurableTraceRecord } from "@/app/(shell)/trace/durable-trace-query"
import {
  normalizeDurableRecordReference,
} from "@/components/outcome-queue/supporting-record-links"
import { PageHeader } from "@/components/shell/page-header"
import { DurableTraceRecordPanel } from "@/components/trace/durable-trace-record-panel"
import { RuntimeTracePanel } from "@/components/trace/runtime-trace-panel"
import { TraceLedgerPanel } from "@/components/trace/trace-ledger-panel"

export default async function TraceLedgerPage({
  searchParams,
}: {
  searchParams: Promise<{ trace?: string | string[] }>
}) {
  const requested = await searchParams
  const requestedTrace = normalizeDurableRecordReference("trace", requested.trace)
  const [runtimeTruth, durableTrace] = await Promise.all([
    getRuntimeExecutions(),
    requestedTrace ? getDurableTraceRecord(requestedTrace) : Promise.resolve(null),
  ])

  return (
    <>
      <PageHeader
        title="Trace Ledger"
        description="Persisted Hermes runtime execution truth alongside the explicitly historical, static Trace Ledger. Read-only with no eval runner or mutation."
      />
      <div className="flex flex-col gap-6 p-6">
        <DurableTraceRecordPanel
          requestedReference={requestedTrace}
          record={durableTrace}
        />
        <RuntimeTracePanel truth={runtimeTruth} />
        <div>
          <p className="mb-2 font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
            Historical / static Trace Ledger
          </p>
          <p className="mb-3 max-w-3xl text-sm text-muted-foreground">
            The records below remain static governance context. They are not runtime telemetry,
            persisted execution events, or executable evaluations.
          </p>
        </div>
        <TraceLedgerPanel />
      </div>
    </>
  )
}
