import { getUserId } from "@/lib/session"
import { getRecentEvents } from "@/lib/registers/events"
import { getPersistedEvidenceTruth } from "@/app/actions/evidence"
import { getRuntimeExecutionQuery } from "@/app/actions/runtime-executions"
import { PageHeader } from "@/components/shell/page-header"
import { getEventEmptyStateActions } from "@/components/dashboard/event-empty-state"
import { EvidenceCommandPanel } from "@/components/evidence/evidence-command-panel"
import { EvidenceRollupPanel } from "@/components/evidence/evidence-rollup-panel"
import { EvidenceSpinePanel } from "@/components/evidence/evidence-spine-panel"
import { RuntimeEvidencePanel } from "@/components/runtime/runtime-evidence-panel"
import {
  projectRuntimeEvidenceHistory,
  RUNTIME_EVIDENCE_HISTORY_LIMIT,
} from "@/components/runtime/runtime-evidence"
import { Activity } from "lucide-react"
import Link from "next/link"
import { RuntimeExecutionPanel } from "@/components/runtime/runtime-execution-panel"
import {
  DURABLE_RECORD_ANCHORS,
  normalizeDurableRecordReference,
} from "@/components/outcome-queue/supporting-record-links"
import {
  DurableAuditRecordPanel,
  DurableEvidenceRecordPanel,
} from "@/components/evidence/durable-record-panels"
import {
  getDurableAuditRecord,
  getDurableEvidenceRecord,
} from "@/app/(shell)/audit/durable-record-query"

export default async function AuditPage({
  searchParams,
}: {
  searchParams: Promise<{
    evidence?: string | string[]
    audit?: string | string[]
  }>
}) {
  const requested = await searchParams
  const requestedEvidence = normalizeDurableRecordReference("evidence", requested.evidence)
  const requestedAudit = normalizeDurableRecordReference("audit", requested.audit)
  const userId = await getUserId()
  const [persistedEvidence, runtimeTruth, events, durableEvidence, durableAudit] = await Promise.all([
    getPersistedEvidenceTruth(RUNTIME_EVIDENCE_HISTORY_LIMIT + 1),
    getRuntimeExecutionQuery(),
    getRecentEvents(userId, 200),
    requestedEvidence ? getDurableEvidenceRecord(requestedEvidence) : Promise.resolve(null),
    requestedAudit ? getDurableAuditRecord(requestedAudit) : Promise.resolve(null),
  ])
  const evidenceHistory = projectRuntimeEvidenceHistory(persistedEvidence.records)

  return (
    <>
      <PageHeader
        title="Evidence"
        description="User-scoped persisted evidence and Hermes runtime execution truth, followed by retained historical/static Evidence Spine context. Read-only; evidence does not execute or authorize."
      />
      <div className="flex flex-col gap-6 p-6">
        <DurableEvidenceRecordPanel
          requestedReference={requestedEvidence}
          record={durableEvidence}
        />
        <DurableAuditRecordPanel
          requestedReference={requestedAudit}
          record={durableAudit}
        />
        <section aria-labelledby="persisted-evidence-truth-title" className="flex flex-col gap-4">
          <div>
            <p className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
              Current persisted truth
            </p>
            <h2 id="persisted-evidence-truth-title" className="mt-1 text-lg font-semibold">
              User-scoped evidence and runtime execution
            </h2>
            <p className="mt-1 max-w-3xl text-sm leading-relaxed text-muted-foreground">
              Database-backed evidence records and persisted Hermes checkpoints, leases, failure
              evaluations, and provenance for the current user. These panels are read-only and do
              not imply a currently live host process.
            </p>
          </div>
          <RuntimeEvidencePanel {...evidenceHistory} />
          <RuntimeExecutionPanel truth={runtimeTruth} />
        </section>

        <EvidenceCommandPanel />
        <EvidenceRollupPanel events={events} />
        <section aria-labelledby="historical-evidence-spine-title" className="flex flex-col gap-3">
          <div>
            <p className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
              Retained historical/static records
            </p>
            <h2 id="historical-evidence-spine-title" className="text-base font-semibold">
              Evidence Spine archive
            </h2>
            <p className="max-w-3xl text-sm leading-relaxed text-muted-foreground">
              The Evidence Spine below is retained governance context from earlier batches. It is
              not current runtime telemetry and does not override the persisted truth above.
            </p>
          </div>
          <EvidenceSpinePanel />
        </section>
        <section
          id={DURABLE_RECORD_ANCHORS.audit}
          aria-labelledby="audit-event-register-title"
          className="scroll-mt-6 space-y-3"
        >
          <div>
            <p className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
              Durable audit
            </p>
            <h2 id="audit-event-register-title" className="mt-1 text-base font-semibold">
              Audit event register
            </h2>
            <p className="mt-1 max-w-3xl text-sm leading-relaxed text-muted-foreground">
              User-scoped recorded events linked from governed Goal and Work Order activity.
            </p>
          </div>
          {events.length === 0 ? (
            <div className="rounded-lg border border-dashed border-border bg-card p-6">
              <div className="mx-auto flex max-w-2xl flex-col items-center justify-center gap-3 text-center">
                <Activity className="h-8 w-8 text-muted-foreground" />
                <p className="text-sm font-medium">No evidence events recorded yet</p>
                <p className="text-sm leading-relaxed text-muted-foreground">
                  The record of reality fills only after operator actions, validation,
                  reviews, or production checks are captured. Start with a safe
                  governance surface; nothing runs automatically from these links.
                </p>
              </div>
              <div className="mx-auto mt-6 grid max-w-3xl gap-3 md:grid-cols-3">
                {getEventEmptyStateActions().map((action) => (
                  <Link
                    key={action.href}
                    href={action.href}
                    className="rounded-md border border-border bg-background px-4 py-3 transition-colors hover:border-primary/40"
                  >
                    <p className="text-sm font-medium">{action.title}</p>
                    <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                      {action.description}
                    </p>
                  </Link>
                ))}
              </div>
            </div>
          ) : (
            <div className="overflow-hidden rounded-lg border border-border">
              <table className="w-full text-sm">
                <thead className="bg-muted/50">
                  <tr className="border-b border-border text-left font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
                    <th className="px-4 py-2.5 font-medium">Timestamp</th>
                    <th className="px-4 py-2.5 font-medium">Type</th>
                    <th className="px-4 py-2.5 font-medium">Register</th>
                    <th className="px-4 py-2.5 font-medium">Summary</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {events.map((e) => (
                    <tr key={e.id} className="hover:bg-muted/30">
                      <td className="whitespace-nowrap px-4 py-2.5 font-mono text-xs text-muted-foreground">
                        {new Date(e.createdAt).toLocaleString()}
                      </td>
                      <td className="whitespace-nowrap px-4 py-2.5 font-mono text-xs">{e.type}</td>
                      <td className="whitespace-nowrap px-4 py-2.5 text-xs text-muted-foreground">
                        {e.register ?? "—"}
                      </td>
                      <td className="px-4 py-2.5">{e.summary}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </div>
    </>
  )
}
