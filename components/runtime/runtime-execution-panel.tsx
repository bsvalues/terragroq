import {
  Activity,
  CheckCircle2,
  CircleSlash2,
  Clock3,
  Database,
  ExternalLink,
  GitCommit,
  ShieldAlert,
} from "lucide-react"

import {
  projectRuntimeExecutionQuery,
  type RuntimeExecutionPanelAttempt,
  type RuntimeExecutionQueryResult,
  type RuntimeExecutionTruth,
} from "@/components/runtime/runtime-execution-model"
import { StatusBadge } from "@/components/status-badge"

type AttemptKind = "active" | "terminal" | "completed"

const KIND_COPY = {
  active: {
    label: "Active attempt",
    empty: "No persisted active attempt",
    icon: Activity,
  },
  terminal: {
    label: "Terminal attempt",
    empty: "No persisted terminal attempt",
    icon: ShieldAlert,
  },
  completed: {
    label: "Completed attempt",
    empty: "No persisted completed attempt",
    icon: CheckCircle2,
  },
} as const

function formatTimestamp(value: Date | null) {
  if (!value) return null
  const date = value instanceof Date ? value : new Date(value)
  if (Number.isNaN(date.getTime())) return null
  return new Intl.DateTimeFormat("en", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date)
}

function isWebLink(value: string) {
  return /^https?:\/\//i.test(value)
}

function unique(values: Array<string | null | undefined>) {
  return [...new Set(values.filter((value): value is string => Boolean(value)))]
}

function attemptsForKind(
  truth: RuntimeExecutionQueryResult,
  kind: AttemptKind,
) {
  if (kind === "active") return truth.activeAttempts
  if (kind === "terminal") return truth.terminalAttempts
  return truth.completedAttempts
}

export function RuntimeExecutionPanel({
  truth,
}: {
  truth: RuntimeExecutionQueryResult | RuntimeExecutionTruth[]
}) {
  const projectedTruth = Array.isArray(truth)
    ? projectRuntimeExecutionQuery(truth)
    : truth

  return (
    <section className="overflow-hidden rounded-lg border border-border bg-card" aria-labelledby="runtime-execution-title">
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-border bg-muted/30 px-4 py-3">
        <div>
          <div className="flex items-center gap-2">
            <Database className="h-4 w-4 text-primary" aria-hidden />
            <h2 id="runtime-execution-title" className="text-sm font-medium">Runtime Execution</h2>
          </div>
          <p className="mt-1 text-sm text-muted-foreground">
            Persisted execution checkpoints and provenance. Read-only.
          </p>
        </div>
        <StatusBadge value="neutral" label="persisted truth" />
      </div>

      <div className="border-b border-border px-4 py-3">
        <div className="flex items-start gap-2">
          <CircleSlash2 className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
          <p className="text-xs leading-relaxed text-muted-foreground">
            This database-backed history is separate from the host-live probe below. A persisted active
            attempt does not by itself prove that a host process is currently running.
          </p>
        </div>
      </div>

      <div className="grid gap-px bg-border lg:grid-cols-3">
        {(["active", "terminal", "completed"] as const).map((kind) => {
          const records = attemptsForKind(projectedTruth, kind)
          const copy = KIND_COPY[kind]
          const Icon = copy.icon
          return (
            <div key={kind} className="bg-card p-4">
              <div className="flex items-center gap-2">
                <Icon className="h-4 w-4 text-muted-foreground" aria-hidden />
                <h3 className="text-sm font-medium">{copy.label}</h3>
                <span className="ml-auto font-mono text-[10px] text-muted-foreground">{records.length}</span>
              </div>
              {records.length > 0 ? (
                <div className="mt-3 space-y-3">
                  {records.map((attempt) => (
                    <AttemptRecord
                      key={`${attempt.workOrderId}:${attempt.attempt}`}
                      attempt={attempt}
                    />
                  ))}
                </div>
              ) : (
                <p className="mt-3 text-xs text-muted-foreground">{copy.empty}</p>
              )}
            </div>
          )
        })}
      </div>
    </section>
  )
}

function AttemptRecord({ attempt }: { attempt: RuntimeExecutionPanelAttempt }) {
  const failure = attempt.failureEvaluation
  const recordedAt = formatTimestamp(attempt.recordedAt)
  const commitEvidence = unique([attempt.commitRef])
  const evidenceLinks = unique([
    ...attempt.evidence,
    ...commitEvidence,
  ]).filter(isWebLink)
  const failureSummary = failure
    ? unique([failure.failureClass, failure.disposition, failure.detail]).join(" · ")
    : "none recorded"

  return (
    <article className="border-t border-border pt-3 first:border-t-0 first:pt-0">
      <div className="flex flex-wrap items-center gap-2">
        <StatusBadge value={attempt.status.toLowerCase()} />
        <span className="font-mono text-xs text-muted-foreground">{attempt.workOrderRef}</span>
      </div>
      <dl className="mt-3 grid gap-2 text-xs">
        <TruthLine label="Attempt / fence" value={String(attempt.attempt)} mono />
        <TruthLine
          label="Checkpoint"
          value={attempt.checkpointSequence !== null && attempt.checkpointState
            ? `#${attempt.checkpointSequence} · ${attempt.checkpointState}`
            : "not recorded"}
        />
        {attempt.checkpointDetail ? <TruthLine label="Detail" value={attempt.checkpointDetail} /> : null}
        <TruthLine label="Lease status" value={attempt.leaseStatus} />
        <TruthLine label="Failure eval" value={failureSummary} />
        {failure?.evidenceDigest ? (
          <TruthLine label="Failure digest" value={failure.evidenceDigest} mono />
        ) : null}
        {commitEvidence.length > 0 ? (
          <TruthLine label="Commit evidence" value={commitEvidence.join(" · ")} mono />
        ) : null}
        {recordedAt ? (
          <div className="flex items-center gap-2 text-muted-foreground">
            <Clock3 className="h-3.5 w-3.5 shrink-0" aria-hidden />
            <dt>Recorded</dt>
            <dd className="ml-auto font-mono">{recordedAt}</dd>
          </div>
        ) : null}
      </dl>
      {evidenceLinks.length > 0 ? (
        <div className="mt-3 flex flex-wrap gap-x-3 gap-y-1">
          {evidenceLinks.map((href) => (
            <a
              key={href}
              href={href}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1 text-xs text-primary hover:underline"
            >
              {commitEvidence.includes(href) ? "Commit" : "Evidence"}
              {commitEvidence.includes(href)
                ? <GitCommit className="h-3 w-3" aria-hidden />
                : <ExternalLink className="h-3 w-3" aria-hidden />}
            </a>
          ))}
        </div>
      ) : null}
    </article>
  )
}

function TruthLine({
  label,
  value,
  mono = false,
}: {
  label: string
  value: string
  mono?: boolean
}) {
  return (
    <div className="grid grid-cols-[7rem_minmax(0,1fr)] gap-2">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className={`break-words text-right text-muted-foreground ${mono ? "font-mono" : ""}`}>{value}</dd>
    </div>
  )
}
