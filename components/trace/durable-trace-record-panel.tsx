import { Activity, ShieldCheck } from "lucide-react"

import { durableRecordDomId } from "@/components/outcome-queue/supporting-record-links"
import { Badge } from "@/components/ui/badge"

export type DurableTraceRecordProjection = {
  id: number
  eventType: string
  entityType: string | null
  entityId: string | null
  actor: string | null
  createdAt: Date
}

export function DurableTraceRecordPanel({
  requestedReference,
  record,
}: {
  requestedReference: string | null
  record: DurableTraceRecordProjection | null
}) {
  if (!requestedReference) return null

  return (
    <section
      id={durableRecordDomId("trace", requestedReference)}
      aria-labelledby="linked-trace-record-title"
      className="scroll-mt-6 rounded-lg border border-border bg-card p-4"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <Activity className="h-4 w-4 text-success" aria-hidden />
            <p className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
              Exact durable Trace record
            </p>
          </div>
          <h2 id="linked-trace-record-title" className="mt-2 text-base font-semibold">
            {record ? `trace:${record.id}` : "Trace record unavailable"}
          </h2>
        </div>
        <Badge variant="outline">read-only</Badge>
      </div>

      {record ? (
        <dl className="mt-4 grid gap-x-4 gap-y-3 sm:grid-cols-2 lg:grid-cols-3">
          <TraceField label="Durable ID" value={`trace:${record.id}`} mono />
          <TraceField label="Event type" value={record.eventType} mono />
          <TraceField
            label="Entity"
            value={record.entityType && record.entityId
              ? `${record.entityType}:${record.entityId}`
              : "not recorded"}
            mono
          />
          <TraceField label="Actor" value={record.actor ?? "not recorded"} />
          <TraceField label="Recorded" value={formatTimestamp(record.createdAt)} />
        </dl>
      ) : (
        <div className="mt-4 flex items-start gap-2 rounded-md border border-dashed border-border bg-muted/20 p-3">
          <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
          <div>
            <p className="font-mono text-xs text-foreground">Requested: {requestedReference}</p>
            <p className="mt-1 text-sm text-muted-foreground">
              The requested Trace identifier did not resolve to exactly one supported runtime record
              owned by the current user. No broader or substitute record was displayed.
            </p>
          </div>
        </div>
      )}
    </section>
  )
}

function TraceField({
  label,
  value,
  mono = false,
}: {
  label: string
  value: string
  mono?: boolean
}) {
  return (
    <div className="min-w-0">
      <dt className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">{label}</dt>
      <dd className={`mt-1 break-all text-sm ${mono ? "font-mono text-xs" : ""}`}>{value}</dd>
    </div>
  )
}

function formatTimestamp(value: Date) {
  return new Intl.DateTimeFormat("en", {
    dateStyle: "medium",
    timeStyle: "medium",
    timeZone: "UTC",
  }).format(value)
}
