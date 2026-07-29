import { CircleDot, GitMerge, History, TriangleAlert } from "lucide-react"

import {
  RECENT_OUTCOME_COMPLETION_LIMIT,
  type RecentOutcomeCompletionTimeline,
  type RecentOutcomeCompletionTimelineRow,
} from "@/components/runtime/outcome-completion-timeline"

function formatTimestamp(value: string | null): string {
  if (value === null) return "not recorded"
  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) return "invalid timestamp"
  const iso = parsed.toISOString()
  return `${iso.slice(0, 10)} ${iso.slice(11, 16)} UTC`
}

function MergeEvidence({
  evidence,
}: {
  evidence: RecentOutcomeCompletionTimelineRow["mergeEvidence"]
}) {
  if (evidence.status === "MISSING") {
    return <span>Missing — no merge SHA recorded.</span>
  }
  if (evidence.status === "CONFLICTING") {
    return <span>Conflicting — multiple merge SHA or PR references recorded.</span>
  }
  if (evidence.sha === null) {
    return <span>Recorded state incomplete — merge SHA unavailable.</span>
  }

  return (
    <span className="inline-flex flex-wrap items-center gap-x-2 gap-y-1">
      <span className="text-success">Recorded</span>
      {evidence.prNumber === null ? null : <span>PR #{evidence.prNumber}</span>}
      <span className="font-mono">{evidence.sha.slice(0, 7)}</span>
    </span>
  )
}

function SuccessorEvidence({
  evidence,
}: {
  evidence: RecentOutcomeCompletionTimelineRow["successorEvidence"]
}) {
  if (evidence.status === "MISSING") {
    return <span>Missing — no qualifying dependent acquisition recorded.</span>
  }
  if (evidence.status === "CONFLICTING") {
    return <span>Conflicting — a dependent acquisition predates completion.</span>
  }
  if (
    evidence.outcomeKey === null
    || evidence.title === null
    || evidence.receiptId === null
    || evidence.acquiredAt === null
    || evidence.fencingTokenRange === null
  ) {
    return <span>Recorded state incomplete — successor acquisition evidence unavailable.</span>
  }

  return (
    <div className="space-y-1">
      <div>
        <span className="text-foreground">{evidence.title}</span>
        <span className="ml-2 font-mono text-[11px]">{evidence.outcomeKey}</span>
      </div>
      <div className="flex flex-wrap gap-x-2 gap-y-1 font-mono text-[11px]">
        <span>Receipt #{evidence.receiptId}</span>
        <span>{formatTimestamp(evidence.acquiredAt)}</span>
        <span>
          Fencing {evidence.fencingTokenRange.first}–{evidence.fencingTokenRange.latest}
        </span>
      </div>
    </div>
  )
}

function TimelineRow({
  row,
}: {
  row: RecentOutcomeCompletionTimelineRow
}) {
  return (
    <article className="relative py-4 pl-10 pr-4">
      <span
        className="absolute bottom-0 left-[1.18rem] top-0 w-px bg-border"
        aria-hidden
      />
      <CircleDot
        className="absolute left-3 top-[1.15rem] h-4 w-4 bg-card text-primary"
        aria-hidden
      />
      <dl className="grid gap-2 text-xs">
        <div className="grid gap-1 sm:grid-cols-[8.5rem_minmax(0,1fr)]">
          <dt className="font-mono uppercase tracking-wider text-muted-foreground">Outcome</dt>
          <dd>
            <div className="text-sm font-medium">{row.title}</div>
            <div className="mt-0.5 font-mono text-[11px] text-muted-foreground">
              {row.outcomeKey} · completed {formatTimestamp(row.completedAt)}
            </div>
          </dd>
        </div>
        <div className="grid gap-1 sm:grid-cols-[8.5rem_minmax(0,1fr)]">
          <dt className="font-mono uppercase tracking-wider text-muted-foreground">
            Terminal result
          </dt>
          <dd className="font-mono text-muted-foreground">
            {row.terminalResult ?? "not recorded"}
          </dd>
        </div>
        <div className="grid gap-1 sm:grid-cols-[8.5rem_minmax(0,1fr)]">
          <dt className="font-mono uppercase tracking-wider text-muted-foreground">
            Merge evidence
          </dt>
          <dd className="text-muted-foreground">
            <MergeEvidence evidence={row.mergeEvidence} />
          </dd>
        </div>
        <div className="grid gap-1 sm:grid-cols-[8.5rem_minmax(0,1fr)]">
          <dt className="font-mono uppercase tracking-wider text-muted-foreground">
            Automatic successor
          </dt>
          <dd className="text-muted-foreground">
            <SuccessorEvidence evidence={row.successorEvidence} />
          </dd>
        </div>
      </dl>
    </article>
  )
}

export function OutcomeCompletionTimelinePanel({
  timeline,
}: {
  timeline: RecentOutcomeCompletionTimeline
}) {
  return (
    <section
      className="overflow-hidden rounded-lg border border-border bg-card"
      aria-labelledby="outcome-completion-timeline-title"
    >
      <div className="flex items-start gap-3 border-b border-border bg-muted/30 px-4 py-3">
        <History className="mt-0.5 h-4 w-4 shrink-0 text-primary" aria-hidden />
        <div>
          <h2 id="outcome-completion-timeline-title" className="text-sm font-medium">
            Outcome completion timeline
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Persisted completion, merge, and automatic-successor continuity. Read-only.
          </p>
        </div>
      </div>

      {timeline.truncated ? (
        <div
          className="flex items-start gap-2 border-b border-warning/30 bg-warning/10 px-4 py-3"
          role="status"
        >
          <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0 text-warning" aria-hidden />
          <div>
            <p className="text-xs font-medium">Bounded history window reached</p>
            <p className="mt-1 text-xs text-muted-foreground">
              Only the latest {RECENT_OUTCOME_COMPLETION_LIMIT} completed outcomes are shown.
            </p>
          </div>
        </div>
      ) : null}

      {timeline.rows.length === 0 ? (
        <div className="m-4 rounded-md border border-dashed border-border bg-muted/20 p-4">
          <div className="flex items-center gap-2">
            <GitMerge className="h-4 w-4 text-muted-foreground" aria-hidden />
            <p className="text-sm font-medium">No completed outcomes recorded</p>
          </div>
          <p className="mt-1 text-sm text-muted-foreground">
            Completion continuity appears after a governed outcome reaches its terminal state.
          </p>
        </div>
      ) : (
        <div className="divide-y divide-border">
          {timeline.rows.map((row) => (
            <TimelineRow key={row.outcomeId} row={row} />
          ))}
        </div>
      )}
    </section>
  )
}
