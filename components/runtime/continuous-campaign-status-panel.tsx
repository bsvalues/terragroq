import { Activity, ArrowRight, Clock3, TriangleAlert } from "lucide-react"

import { StatusBadge } from "@/components/status-badge"
import type {
  ContinuousCampaignEvidenceStatus,
  ContinuousCampaignStatus,
} from "@/components/runtime/continuous-campaign-status"

function formatTimestamp(value: string | null): string {
  if (value === null) return "not recorded"
  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) return "invalid timestamp"
  return parsed.toISOString().replace("T", " ").replace(".000Z", " UTC")
}

function EvidenceBadge({ status }: { status: ContinuousCampaignEvidenceStatus }) {
  const classes = status === "RECORDED"
    ? "border-success/30 bg-success/10 text-success"
    : status === "PENDING"
      ? "border-border bg-muted text-muted-foreground"
      : status === "MISSING"
        ? "border-warning/30 bg-warning/10 text-warning"
        : "border-destructive/30 bg-destructive/10 text-destructive"

  return (
    <span className={`inline-flex rounded-full border px-2 py-0.5 font-mono text-[10px] ${classes}`}>
      {status}
    </span>
  )
}

function phaseBadgeValue(state: ContinuousCampaignStatus["phase"]["state"]): string {
  if (state === "LIVE") return "active"
  if (state === "SETTLED") return "done"
  if (state === "QUEUED") return "approved"
  return "inactive"
}

export function ContinuousCampaignStatusPanel({
  status,
}: {
  status: ContinuousCampaignStatus
}) {
  return (
    <section
      className="overflow-hidden rounded-lg border border-border bg-card"
      aria-labelledby="continuous-campaign-status-title"
    >
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-border bg-muted/30 px-4 py-3">
        <div className="flex items-start gap-3">
          <Activity className="mt-0.5 h-4 w-4 shrink-0 text-primary" aria-hidden />
          <div>
            <h2 id="continuous-campaign-status-title" className="text-sm font-medium">
              Continuous campaign status
            </h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Live queue acquisition, settlement, and successor continuity. Read-only.
            </p>
          </div>
        </div>
        <StatusBadge value={phaseBadgeValue(status.phase.state)} label={status.phase.label} />
      </div>

      <div className="grid gap-px border-b border-border bg-border md:grid-cols-3">
        <div className="bg-card p-4">
          <div className="flex items-center justify-between gap-2">
            <h3 className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
              Campaign window
            </h3>
            <EvidenceBadge status={status.window.status} />
          </div>
          <p className="mt-2 text-sm font-medium">
            {formatTimestamp(status.window.startedAt)}
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            {status.window.settledAt === null
              ? `Open as observed ${formatTimestamp(status.window.observedAt)}`
              : `Settled ${formatTimestamp(status.window.settledAt)}`}
          </p>
          <p className="mt-2 text-xs text-warning">
            Campaign identity is missing from the exposed queue view.
          </p>
        </div>

        <div className="bg-card p-4">
          <h3 className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
            Automatic successor handoff
          </h3>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <span className="text-xs text-muted-foreground">Successor acquisition</span>
            <EvidenceBadge status={status.handoff.acquisitionStatus} />
          </div>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <span className="text-xs text-muted-foreground">Automation proof</span>
            <EvidenceBadge status={status.handoff.automationStatus} />
          </div>
          {status.handoff.receiptId !== null
            && status.handoff.acquiredAt !== null
            && status.handoff.fencingTokenRange !== null ? (
              <p className="mt-2 font-mono text-[10px] text-muted-foreground">
                Receipt #{status.handoff.receiptId} · {formatTimestamp(status.handoff.acquiredAt)} · fencing {status.handoff.fencingTokenRange.first}–{status.handoff.fencingTokenRange.latest}
              </p>
            ) : null}
          <p className="mt-2 text-xs text-muted-foreground">{status.handoff.detail}</p>
        </div>

        <div className="bg-card p-4">
          <div className="flex items-center justify-between gap-2">
            <h3 className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
              Evidence gaps
            </h3>
            <EvidenceBadge status={status.evidenceStatus} />
          </div>
          <p className="mt-2 text-2xl font-semibold tabular-nums">{status.gaps.length}</p>
          <p className="mt-1 text-xs text-muted-foreground">
            Missing or conflicting durable proof; pending work is not counted as a gap.
          </p>
        </div>
      </div>

      <ol className="grid gap-3 p-4 lg:grid-cols-4">
        {status.steps.map((step, index) => (
          <li key={step.id} className="relative rounded-md border border-border bg-muted/15 p-3">
            {index === status.steps.length - 1 ? null : (
              <ArrowRight
                className="absolute -right-[1.15rem] top-1/2 z-10 hidden h-4 w-4 -translate-y-1/2 text-muted-foreground lg:block"
                aria-hidden
              />
            )}
            <div className="flex items-start justify-between gap-2">
              <div>
                <p className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
                  {step.label.includes("Acquisition") ? "Acquisition" : "Settlement"}
                </p>
                <p className="mt-1 text-xs font-medium">{step.title}</p>
              </div>
              <EvidenceBadge status={step.status} />
            </div>
            <p className="mt-2 flex items-center gap-1 font-mono text-[10px] text-muted-foreground">
              <Clock3 className="h-3 w-3" aria-hidden />
              {formatTimestamp(step.at)}
            </p>
            <p className="mt-2 text-xs leading-relaxed text-muted-foreground">{step.detail}</p>
          </li>
        ))}
      </ol>

      <div className="border-t border-border px-4 py-3">
        <div className="flex items-center gap-2">
          <TriangleAlert className="h-4 w-4 text-warning" aria-hidden />
          <h3 className="text-xs font-medium">Evidence gaps</h3>
        </div>
        {status.handoff.acquisitionStatus === "RECORDED" &&
        status.handoff.automationStatus === "MISSING" ? (
          <p className="mt-1 text-xs text-muted-foreground">
            Automatic-trigger proof is missing, and zero-owner-contact proof is missing from this Runtime read path.
          </p>
        ) : status.handoff.acquisitionStatus === "RECORDED" ? (
          <p className="mt-1 text-xs text-muted-foreground">
            Automation proof remains {status.handoff.automationStatus.toLowerCase()} at this campaign step.
          </p>
        ) : (
          <p className="mt-1 text-xs text-muted-foreground">
            Successor handoff evidence remains {status.handoff.acquisitionStatus.toLowerCase()} at this campaign step;
            automation proof is not evaluated yet.
          </p>
        )}
        {status.gaps.length === 0 ? (
          <p className="mt-2 text-xs text-success">No evidence gaps in the exposed records.</p>
        ) : (
          <ul className="mt-2 grid gap-2 md:grid-cols-2">
            {status.gaps.map((gap) => (
              <li key={gap.code} className="rounded-md border border-border bg-muted/15 p-2.5">
                <div className="flex items-center gap-2">
                  <EvidenceBadge status={gap.status} />
                  <span className="font-mono text-[10px] text-muted-foreground">{gap.code}</span>
                </div>
                <p className="mt-1.5 text-xs text-muted-foreground">{gap.detail}</p>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  )
}
