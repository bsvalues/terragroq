import {
  CheckCircle2,
  Scale,
  ShieldAlert,
  XCircle,
} from "lucide-react"

import {
  buildNeedsMyDecisionView,
  type GoalAuthorityDecisionHandler,
} from "@/components/goal-console/active-goal-authority-requests"
import type { GoalTimelineProjection } from "@/components/goal-console/goal-timeline-read-model"
import { StatusBadge } from "@/components/status-badge"
import { Button } from "@/components/ui/button"

export function NeedsMyDecisionPanel({
  timelines,
  decisionPending = false,
  onAuthorityDecision,
}: {
  timelines: Iterable<GoalTimelineProjection>
  decisionPending?: boolean
  onAuthorityDecision: GoalAuthorityDecisionHandler
}) {
  const activeRequests = buildNeedsMyDecisionView(
    timelines,
    onAuthorityDecision,
  )

  return (
    <section
      className="overflow-hidden rounded-lg border border-border bg-card"
      aria-labelledby="needs-my-decision-title"
    >
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-border bg-muted/20 px-4 py-4">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <Scale className="h-4 w-4 shrink-0 text-primary" aria-hidden />
            <h2 id="needs-my-decision-title" className="text-sm font-medium">
              Needs My Decision
            </h2>
          </div>
          <p className="mt-1 text-sm text-muted-foreground">
            Active authority requests that cannot continue inside the current grant.
          </p>
        </div>
        <StatusBadge
          value={activeRequests.length > 0 ? "warning" : "success"}
          label={`${activeRequests.length} active`}
        />
      </div>

      {activeRequests.length === 0 ? (
        <div className="m-4 rounded-lg border border-dashed border-border px-4 py-5 text-center">
          <p className="text-sm font-medium">No active authority requests</p>
          <p className="mt-1 text-sm text-muted-foreground">
            Stale, conflicting, and already-decided requests stay out of this view.
          </p>
        </div>
      ) : (
        <ul className="divide-y divide-border">
          {activeRequests.map((item) => (
            <li key={item.id} className="px-4 py-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <ShieldAlert className="h-4 w-4 shrink-0 text-warning" aria-hidden />
                    <h3 className="text-sm font-medium">{item.title}</h3>
                    <StatusBadge value="warning" label="decision required" />
                  </div>
                  <p className="mt-1 font-mono text-[10px] text-muted-foreground">
                    Goal {item.goalRef} · Outcome {item.outcomeRef} · Work Order{" "}
                    {item.workOrderRef ?? "not recorded"}
                  </p>
                </div>
                <span className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
                  Next: {item.expectedNextState ?? "not recorded"}
                </span>
              </div>

              <dl className="mt-4 grid gap-3 rounded-md border border-warning/30 bg-warning/10 p-3 sm:grid-cols-2">
                <DecisionDetail
                  label="Why this decision is needed"
                  value={item.whyNeeded}
                />
                <DecisionDetail label="Blocked action" value={item.blockedAction} />
              </dl>

              <div className="mt-4">
                <p className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
                  Available choices
                </p>
                <div className="mt-2 grid gap-2 sm:grid-cols-2">
                  {item.choices.map((option) => (
                    <div
                      key={option.choice}
                      className="flex min-w-0 flex-col items-start gap-2 rounded-md border border-border p-3"
                    >
                      <Button
                        type="button"
                        size="sm"
                        variant={option.choice === "APPROVE" ? "default" : "outline"}
                        disabled={decisionPending}
                        onClick={option.select}
                        aria-label={`${option.label} for ${item.goalRef}`}
                      >
                        {option.choice === "APPROVE" ? (
                          <CheckCircle2 aria-hidden />
                        ) : (
                          <XCircle aria-hidden />
                        )}
                        {option.label}
                      </Button>
                      <p className="text-xs leading-relaxed text-muted-foreground">
                        <span className="font-medium text-foreground">Consequence:</span>{" "}
                        {option.consequence ?? "not recorded"}
                      </p>
                    </div>
                  ))}
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

function DecisionDetail({
  label,
  value,
}: {
  label: string
  value: string | null
}) {
  return (
    <div className="min-w-0">
      <dt className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
        {label}
      </dt>
      <dd className="mt-1 break-words text-sm">{value ?? "not recorded"}</dd>
    </div>
  )
}
