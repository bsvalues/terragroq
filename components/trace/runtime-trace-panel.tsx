import { Activity, Database, ShieldCheck, TriangleAlert } from "lucide-react"

import {
  RUNTIME_CHECKPOINT_EVENT,
  RUNTIME_FAILURE_EVENT,
  type RuntimeExecutionQueryResult,
  type RuntimeExecutionTruth,
} from "@/components/runtime/runtime-execution-model"
import {
  projectRuntimeExecutionTruth,
  type RuntimeTraceProjection,
} from "@/components/trace/runtime-trace-projection"
import { Badge } from "@/components/ui/badge"

type RuntimeEventType = typeof RUNTIME_CHECKPOINT_EVENT | typeof RUNTIME_FAILURE_EVENT

export function RuntimeTracePanel({
  truth,
}: {
  truth: RuntimeExecutionTruth[] | RuntimeExecutionQueryResult
}) {
  const records = projectRuntimeExecutionTruth(truth)
  const checkpoints = records.filter((record) => record.eventType === RUNTIME_CHECKPOINT_EVENT)
  const failureEvals = records.filter((record) => record.eventType === RUNTIME_FAILURE_EVENT)

  return (
    <section className="overflow-hidden rounded-lg border border-border bg-card">
      <div className="flex flex-col gap-3 border-b border-border bg-muted/30 px-4 py-3 md:flex-row md:items-start md:justify-between">
        <div>
          <div className="flex items-center gap-2">
            <Activity className="h-4 w-4 text-success" aria-hidden />
            <p className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
              Persisted runtime trace
            </p>
          </div>
          <h2 className="mt-2 text-base font-semibold">Hermes execution truth</h2>
          <p className="mt-1 max-w-3xl text-sm leading-relaxed text-muted-foreground">
            Read-only projections from persisted runtime governance events. No evaluator, replay,
            command, or mutation is available from this surface.
          </p>
        </div>
        <Badge variant="outline">read-only persisted truth</Badge>
      </div>

      <div className="grid gap-4 p-4 xl:grid-cols-2">
        <RuntimeEventList
          title="Runtime checkpoints"
          eventType={RUNTIME_CHECKPOINT_EVENT}
          records={checkpoints}
          icon={Database}
          emptyText="No persisted Hermes runtime checkpoints were returned."
        />
        <RuntimeEventList
          title="Failure evaluations"
          eventType={RUNTIME_FAILURE_EVENT}
          records={failureEvals}
          icon={TriangleAlert}
          emptyText="No persisted Hermes runtime failure evaluations were returned."
        />
      </div>

      <div className="flex items-start gap-2 border-t border-border px-4 py-3 text-xs text-muted-foreground">
        <ShieldCheck className="mt-0.5 h-3.5 w-3.5 shrink-0 text-success" aria-hidden />
        Only provenance, sequence, attempt, timestamp, state classification, and validated evidence
        digests are projected. Raw metadata and checkpoint detail are not rendered.
      </div>
    </section>
  )
}

function RuntimeEventList({
  title,
  eventType,
  records,
  icon: Icon,
  emptyText,
}: {
  title: string
  eventType: RuntimeEventType
  records: RuntimeTraceProjection[]
  icon: typeof Database
  emptyText: string
}) {
  return (
    <div>
      <div className="flex items-center gap-2">
        <Icon className="h-4 w-4 text-muted-foreground" aria-hidden />
        <h3 className="text-sm font-medium">{title}</h3>
        <Badge variant="outline">{records.length}</Badge>
      </div>
      <p className="mt-1 font-mono text-[10px] text-muted-foreground">{eventType}</p>

      <div className="mt-3 grid gap-3">
        {records.length === 0 ? (
          <div className="rounded-md border border-dashed border-border bg-muted/20 p-3 text-sm text-muted-foreground">
            {emptyText}
          </div>
        ) : records.map((record) => (
          <article key={`${record.eventType}-${record.id}`} className="rounded-md border border-border bg-background p-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="font-mono text-xs font-medium">{record.id}</p>
              <Badge variant="outline">
                {record.state ?? record.failureClass ?? "recorded"}
              </Badge>
            </div>
            <dl className="mt-3 grid gap-x-4 gap-y-3 sm:grid-cols-2">
              <RuntimeField label="Provenance" value={`${record.provenance.actor} · ${record.provenance.entity}`} />
              <RuntimeField label="Timestamp" value={formatTimestamp(record.timestamp)} />
              <RuntimeField label="Sequence" value={formatNumber(record.sequence)} />
              <RuntimeField label="Attempt" value={formatNumber(record.attempt)} />
              <RuntimeField label="Evidence digest" value={record.evidenceDigest ?? "not recorded"} mono />
              <RuntimeField
                label={record.eventType === RUNTIME_FAILURE_EVENT ? "Disposition" : "Checkpoint state"}
                value={record.disposition ?? record.state ?? "not recorded"}
              />
              {record.provenance.sourceCheckpoint ? (
                <RuntimeField label="Source checkpoint" value={record.provenance.sourceCheckpoint} mono />
              ) : null}
            </dl>
          </article>
        ))}
      </div>
    </div>
  )
}

function RuntimeField({
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
      <dd className={`mt-1 break-all text-xs text-muted-foreground ${mono ? "font-mono" : ""}`}>
        {value}
      </dd>
    </div>
  )
}

function formatNumber(value: number | null) {
  return value === null ? "not recorded" : String(value)
}

function formatTimestamp(value: string | null) {
  if (!value) return "not recorded"
  return new Intl.DateTimeFormat("en", {
    dateStyle: "medium",
    timeStyle: "medium",
    timeZone: "UTC",
  }).format(new Date(value))
}
