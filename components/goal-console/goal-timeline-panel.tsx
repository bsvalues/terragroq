import Link from "next/link"
import {
  AlertTriangle,
  Clock3,
  ExternalLink,
  GitCommit,
  GitPullRequestArrow,
  ListTree,
  RefreshCw,
  ShieldAlert,
  CheckCircle2,
  XCircle,
} from "lucide-react"

import type {
  GoalAuthorityDecisionChoice,
  GoalTimelineProjection,
} from "@/components/goal-console/goal-timeline-read-model"
import { Button } from "@/components/ui/button"
import { StatusBadge } from "@/components/status-badge"

function formatTimestamp(value: Date) {
  const date = value instanceof Date ? value : new Date(value)
  if (Number.isNaN(date.getTime())) return "invalid timestamp"
  return new Intl.DateTimeFormat("en", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date)
}

function truthTone(state: GoalTimelineProjection["truth"]["state"]) {
  if (state === "CURRENT") return "success"
  if (state === "CONFLICTING") return "danger"
  return "warning"
}

function terminalTone(state: string | null) {
  if (state === "COMPLETE") return "success"
  if (state === "FAILED_TERMINAL") return "danger"
  return "warning"
}

export type GoalTimelineConnection = {
  state: "current" | "refreshing" | "stale"
  lastSuccessfulObservation: Date | null
}

function ProjectionConnectionStatus({
  connection,
  onRefresh,
}: {
  connection: GoalTimelineConnection
  onRefresh?: () => void
}) {
  const lastObserved = connection.lastSuccessfulObservation
    ? formatTimestamp(connection.lastSuccessfulObservation)
    : "not yet observed"
  const statusCopy = connection.state === "current"
    ? `Projection current. Last successful observation ${lastObserved}.`
    : connection.state === "refreshing"
      ? `Refreshing persisted projection. Last successful observation ${lastObserved}.`
      : `Projection stale and disconnected. Last successful observation ${lastObserved}. The last persisted projection remains visible.`
  const tone = connection.state === "current"
    ? "success"
    : connection.state === "refreshing"
      ? "info"
      : "warning"

  return (
    <div className="grid min-h-14 w-full grid-cols-[minmax(0,1fr)_2.25rem] items-center gap-2 sm:w-auto sm:min-w-[24rem]">
      <div
        role="status"
        aria-live="polite"
        aria-atomic="true"
        aria-busy={connection.state === "refreshing"}
        className="min-w-0"
      >
        <div className="flex flex-wrap items-center gap-2">
          <StatusBadge value={tone} label={connection.state} />
          <span className="text-xs font-medium">Projection connection</span>
        </div>
        <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">
          {statusCopy} Resident host liveness is not inferred.
        </p>
      </div>
      <Button
        type="button"
        variant="outline"
        size="icon"
        className="size-9"
        disabled={connection.state === "refreshing" || !onRefresh}
        onClick={onRefresh}
        aria-label="Refresh persisted Goal projection"
        title="Refresh persisted Goal projection"
      >
        <RefreshCw
          className={connection.state === "refreshing" ? "animate-spin" : undefined}
          aria-hidden
        />
      </Button>
    </div>
  )
}

export function GoalTimelinePanel({
  timeline,
  connection,
  onRefresh,
  onAuthorityDecision,
  decisionPending = false,
}: {
  timeline: GoalTimelineProjection | null
  connection: GoalTimelineConnection
  onRefresh?: () => void
  onAuthorityDecision?: (choice: GoalAuthorityDecisionChoice) => void
  decisionPending?: boolean
}) {
  if (!timeline) {
    return (
      <section className="border-y border-border bg-muted/20 px-4 py-5" aria-labelledby="goal-timeline-title">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex items-center gap-2">
            <ListTree className="h-4 w-4 text-primary" aria-hidden />
            <h2 id="goal-timeline-title" className="text-sm font-medium">Goal delivery timeline</h2>
          </div>
          <ProjectionConnectionStatus connection={connection} onRefresh={onRefresh} />
        </div>
        <p className="mt-2 text-sm text-muted-foreground">
          No persisted Goal projection is available for this selection. WilliamOS is not inferring runtime progress.
        </p>
      </section>
    )
  }

  const runtime = timeline.current.runtime
  const ownerDecisionRequired = timeline.terminal.state === "OWNER_DECISION_REQUIRED"
  const decisionRequest = timeline.decisionRequest
  const decisionActionable = ownerDecisionRequired && decisionRequest.status === "ACTIONABLE"
  const githubBase = "https://github.com/bsvalues/terragroq"

  return (
    <section
      className="overflow-hidden rounded-lg border border-border bg-card"
      aria-labelledby="goal-timeline-title"
    >
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-border bg-muted/20 px-4 py-4">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <ListTree className="h-4 w-4 shrink-0 text-primary" aria-hidden />
            <h2 id="goal-timeline-title" className="text-sm font-medium">Goal delivery timeline</h2>
          </div>
          <p className="mt-1 break-words text-sm text-muted-foreground">
            Persisted execution, validation, delivery, and evidence for {timeline.goal.ref}.
          </p>
        </div>
        <div className="flex w-full flex-col items-end gap-2 xl:w-auto">
          <ProjectionConnectionStatus connection={connection} onRefresh={onRefresh} />
          <StatusBadge
            value={truthTone(timeline.truth.state)}
            label={`${timeline.truth.state.toLowerCase()} truth`}
          />
        </div>
      </div>

      {timeline.truth.issues.length > 0 ? (
        <div className="border-b border-warning/30 bg-warning/10 px-4 py-3">
          <div className="flex items-center gap-2">
            <AlertTriangle className="h-4 w-4 text-warning" aria-hidden />
            <p className="text-sm font-medium">Persisted truth needs attention</p>
          </div>
          <ul className="mt-2 space-y-1.5 text-xs text-muted-foreground">
            {timeline.truth.issues.map((issue) => (
              <li key={`${issue.code}:${issue.references.join(":")}`} className="break-words">
                <span className="font-mono text-foreground">{issue.code}</span>
                {" · "}
                {issue.detail}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      <dl className="grid gap-px border-b border-border bg-border sm:grid-cols-2 lg:grid-cols-4">
        <SummaryCell label="Phase" value={timeline.current.phase} />
        <SummaryCell
          label="Active Work Order"
          value={timeline.current.workOrder?.ref ?? "not projected"}
          mono
        />
        <SummaryCell
          label="Checkpoint"
          value={runtime.checkpointState
            ? `#${runtime.checkpointSequence ?? "?"} · ${runtime.checkpointState}`
            : "not projected"}
        />
        <SummaryCell label="Lease" value={runtime.leaseStatus} />
        <SummaryCell label="Assigned worker" value={runtime.worker ?? "not projected"} />
        <SummaryCell
          label="Validation"
          value={timeline.validationCheckpoints.at(-1)
            ? [
                timeline.validationCheckpoints.at(-1)?.state,
                timeline.validationCheckpoints.at(-1)?.result,
              ].filter(Boolean).join(" · ")
            : "not recorded"}
        />
        <SummaryCell
          label="Pull request"
          value={timeline.delivery.prNumber ? `#${timeline.delivery.prNumber}` : "not recorded"}
          mono
        />
        <SummaryCell
          label="Final revision"
          value={timeline.delivery.finalRevision ?? "not recorded"}
          mono
        />
      </dl>

      {ownerDecisionRequired ? (
        <div className="border-b border-warning/30 bg-warning/10 px-4 py-4">
          <div className="flex flex-wrap items-center gap-2">
            <ShieldAlert className="h-4 w-4 text-warning" aria-hidden />
            <p className="text-sm font-medium">Primary decision required</p>
            <StatusBadge value="warning" label={timeline.resume.state.toLowerCase().replaceAll("_", " ")} />
          </div>
          <p className="mt-2 text-sm">{timeline.terminal.ownerAction}</p>
          <dl className="mt-3 grid gap-2 text-xs sm:grid-cols-2">
            <DecisionDetail label="Blocked action" value={decisionRequest.blockedAction} />
            <DecisionDetail label="Authority boundary" value={decisionRequest.authorityBoundary} />
            <DecisionDetail label="Approve consequence" value={decisionRequest.consequences.approve} />
            <DecisionDetail label="Deny consequence" value={decisionRequest.consequences.deny} />
          </dl>
          <p className="mt-3 font-mono text-[10px] text-muted-foreground">
            Goal {decisionRequest.goalRef} · Outcome {decisionRequest.outcomeRef} · Work Order {decisionRequest.workOrderRef ?? "not recorded"}
            {" · "}terminal {decisionRequest.terminalEventId ?? "not recorded"}
          </p>
          <p className="mt-1 font-mono text-xs text-muted-foreground">
            Resume state: {timeline.resume.governedNextState ?? "not recorded"}
          </p>
          {decisionActionable && onAuthorityDecision ? (
            <div className="mt-4 flex flex-wrap gap-2">
              <Button
                type="button"
                size="sm"
                disabled={decisionPending}
                onClick={() => onAuthorityDecision("APPROVE")}
              >
                <CheckCircle2 aria-hidden />
                Approve resume
              </Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={decisionPending}
                onClick={() => onAuthorityDecision("DENY")}
              >
                <XCircle aria-hidden />
                Deny keep blocked
              </Button>
            </div>
          ) : null}
          {decisionRequest.status === "RECEIPT_RECORDED" ? (
            <p className="mt-3 flex items-center gap-2 text-xs text-muted-foreground">
              {decisionRequest.receipt.choice === "APPROVE" ? (
                <CheckCircle2 className="h-3.5 w-3.5 text-success" aria-hidden />
              ) : (
                <XCircle className="h-3.5 w-3.5 text-warning" aria-hidden />
              )}
              Decision receipt recorded: {decisionRequest.receipt.choice?.toLowerCase() ?? "unknown"}; resume state is {timeline.resume.state.toLowerCase().replaceAll("_", " ")}.
            </p>
          ) : null}
          {decisionRequest.status === "CONFLICTING" ? (
            <p className="mt-3 text-xs text-destructive">
              The persisted decision request is conflicting or incomplete; no authority action is available.
            </p>
          ) : null}
          {decisionRequest.status === "STALE" ? (
            <p className="mt-3 text-xs text-warning">
              The persisted terminal context is stale; no authority action is available until the projection is current.
            </p>
          ) : null}
        </div>
      ) : null}

      <div className="grid border-b border-border lg:grid-cols-[minmax(0,1fr)_minmax(18rem,0.4fr)]">
        <div className="min-w-0 px-4 py-4">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-sm font-medium">Delivery result</h3>
            <StatusBadge
              value={terminalTone(timeline.terminal.state)}
              label={timeline.terminal.state?.toLowerCase().replaceAll("_", " ") ?? "in progress"}
            />
          </div>
          <p className="mt-2 text-sm text-muted-foreground">
            Result: {timeline.terminal.result ?? "not terminal"}
          </p>
          {timeline.terminal.limitations.length > 0 ? (
            <ul className="mt-2 space-y-1 text-xs text-muted-foreground">
              {timeline.terminal.limitations.map((limitation) => (
                <li key={limitation} className="break-words">{limitation}</li>
              ))}
            </ul>
          ) : null}
        </div>
        <div className="border-t border-border px-4 py-4 lg:border-l lg:border-t-0">
          <h3 className="text-sm font-medium">Supporting evidence</h3>
          <div className="mt-3 flex flex-wrap gap-x-3 gap-y-2 text-xs">
            <EvidenceLink href="/trace" label={`Trace ${timeline.references.trace.length}`} />
            <EvidenceLink href="/audit" label={`Audit ${timeline.references.audit.length}`} />
            <EvidenceLink href="/work-orders" label={`Evidence ${timeline.references.evidence.length}`} />
            {timeline.references.decisions.length > 0 ? (
              <EvidenceLink href="/decisions" label={`Decisions ${timeline.references.decisions.length}`} />
            ) : null}
            {timeline.delivery.prNumber ? (
              <a
                href={`${githubBase}/pull/${timeline.delivery.prNumber}`}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1 text-primary hover:underline"
              >
                PR #{timeline.delivery.prNumber}
                <GitPullRequestArrow className="h-3.5 w-3.5" aria-hidden />
              </a>
            ) : null}
            {timeline.delivery.finalRevision ? (
              <a
                href={`${githubBase}/commit/${timeline.delivery.finalRevision}`}
                target="_blank"
                rel="noreferrer"
                className="inline-flex min-w-0 items-center gap-1 text-primary hover:underline"
              >
                <span className="max-w-32 truncate">Revision {timeline.delivery.finalRevision.slice(0, 12)}</span>
                <GitCommit className="h-3.5 w-3.5 shrink-0" aria-hidden />
              </a>
            ) : null}
          </div>
        </div>
      </div>

      <div className="px-4 py-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-sm font-medium">Recorded history</h3>
          <span className="font-mono text-[10px] text-muted-foreground">
            {timeline.entries.length} records
          </span>
        </div>
        <ol className="mt-3 border-l border-border">
          {timeline.entries.map((entry) => (
            <li key={entry.id} className="relative pb-4 pl-5 last:pb-0">
              <span
                className="absolute left-[-4.5px] top-1.5 h-2 w-2 rounded-full border border-card bg-primary"
                aria-hidden
              />
              <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                <span className="text-xs font-medium">{entry.label}</span>
                <span className="font-mono text-[10px] text-muted-foreground">{entry.state}</span>
                <time
                  dateTime={entry.occurredAt.toISOString()}
                  className="inline-flex items-center gap-1 text-[10px] text-muted-foreground"
                >
                  <Clock3 className="h-3 w-3" aria-hidden />
                  {formatTimestamp(entry.occurredAt)}
                </time>
              </div>
              {entry.detail ? (
                <p className="mt-1 break-words text-xs leading-relaxed text-muted-foreground">{entry.detail}</p>
              ) : null}
            </li>
          ))}
        </ol>
      </div>
    </section>
  )
}

function SummaryCell({
  label,
  value,
  mono = false,
}: {
  label: string
  value: string
  mono?: boolean
}) {
  return (
    <div className="min-w-0 bg-card px-4 py-3">
      <dt className="font-mono text-[10px] uppercase text-muted-foreground">{label}</dt>
      <dd className={`mt-1 break-words text-sm ${mono ? "font-mono text-xs" : ""}`}>{value}</dd>
    </div>
  )
}

function DecisionDetail({ label, value }: { label: string; value: string | null }) {
  return (
    <div className="min-w-0">
      <dt className="font-mono uppercase text-muted-foreground">{label}</dt>
      <dd className="mt-0.5 break-words text-foreground">{value ?? "not recorded"}</dd>
    </div>
  )
}

function EvidenceLink({ href, label }: { href: string; label: string }) {
  return (
    <Link href={href} className="inline-flex items-center gap-1 text-primary hover:underline">
      {label}
      <ExternalLink className="h-3.5 w-3.5" aria-hidden />
    </Link>
  )
}
