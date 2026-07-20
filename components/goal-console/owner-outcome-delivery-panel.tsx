import { ArrowRight, CheckCircle2, CircleDot, FileInput, GitPullRequestArrow, LockKeyhole } from "lucide-react"

import { buildOwnerOutcomeDelivery, type OwnerOutcomeSource } from "@/components/operator/owner-outcome-delivery"
import { Badge } from "@/components/ui/badge"

export function OwnerOutcomeDeliveryPanel({ source }: { source: OwnerOutcomeSource | null }) {
  const delivery = buildOwnerOutcomeDelivery(source)
  const active = delivery.state === "ACTIVE"
  const statusLabel = {
    AWAITING_OUTCOME: "ready for outcome",
    ACTIVE: "standing authority matched",
    OWNER_DECISION_REQUIRED: "owner authority required",
    REFUSED: "outside doctrine",
  }[delivery.state]

  return (
    <section className="overflow-hidden rounded-lg border border-border bg-card" aria-labelledby="owner-outcome-title">
      <div className="grid border-b border-border lg:grid-cols-[minmax(0,1.35fr)_minmax(17rem,0.65fr)]">
        <div className="px-5 py-5">
          <div className="flex flex-wrap items-center gap-2">
            <p className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">Primary outcome intake</p>
            <Badge variant="outline" className={active ? "border-success/30 text-success" : undefined}>{statusLabel}</Badge>
          </div>
          <h2 id="owner-outcome-title" className="mt-2 text-xl font-semibold">Owner Outcome Delivery</h2>
          <p className="mt-2 max-w-3xl text-sm leading-relaxed text-muted-foreground">
            State the result below in normal language. WilliamOS keeps the persisted goal as the source record and derives a bounded delivery chain for the operating Codex session.
          </p>
        </div>
        <div className="border-t border-border bg-muted/20 px-5 py-5 lg:border-l lg:border-t-0">
          <div className="flex items-center gap-2">
            <LockKeyhole className="h-4 w-4 text-primary" aria-hidden />
            <p className="text-sm font-medium">Authority boundary</p>
          </div>
          <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
            Standing authority covers reversible WilliamOS-native R0/R1 work. Protected systems, production, credentials, paid actions, and runtime activation remain owner-gated.
          </p>
        </div>
      </div>

      <div className="px-5 py-5">
        <div className="grid gap-0 md:grid-cols-4">
          {[
            { label: "Outcome", value: delivery.source?.ref ?? "Awaiting Primary", icon: FileInput },
            { label: "Program", value: delivery.programId, icon: CircleDot },
            { label: "Loop", value: delivery.loopId, icon: ArrowRight },
            { label: "Delivery", value: active ? `${delivery.workOrders.length} Work Orders` : "Held at boundary", icon: GitPullRequestArrow },
          ].map((step, index) => {
            const Icon = step.icon
            return (
              <div key={step.label} className="relative border-l border-border pb-5 pl-7 last:pb-0 md:border-l-0 md:border-t md:pb-0 md:pl-0 md:pt-7">
                <span className="absolute left-[-5px] top-0 h-2.5 w-2.5 rounded-full border-2 border-card bg-primary md:left-0 md:top-[-5px]" aria-hidden />
                <div className="flex items-center gap-2 md:pr-5">
                  <Icon className="h-4 w-4 shrink-0 text-primary" aria-hidden />
                  <p className="text-xs font-medium">{step.label}</p>
                </div>
                <p className="mt-1 break-words font-mono text-[10px] leading-relaxed text-muted-foreground md:pr-5">{step.value}</p>
                {index < 3 && <span className="sr-only">then</span>}
              </div>
            )
          })}
        </div>
      </div>

      {active && delivery.handoff ? (
        <div className="grid gap-px border-t border-border bg-border lg:grid-cols-[1.2fr_0.8fr]">
          <div className="bg-card p-5">
            <div className="flex items-center gap-2">
              <CheckCircle2 className="h-4 w-4 text-success" aria-hidden />
              <p className="text-sm font-medium">Next bounded move</p>
            </div>
            <p className="mt-2 text-sm leading-relaxed">{delivery.source?.outcome}</p>
            <p className="mt-2 font-mono text-[10px] text-muted-foreground">{delivery.handoff.nextWorkOrderId}</p>
          </div>
          <div className="bg-card p-5">
            <p className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">Session handoff</p>
            <p className="mt-2 text-xs leading-relaxed text-muted-foreground">{delivery.handoff.continuationRule}</p>
            <p className="mt-2 font-mono text-[10px] text-muted-foreground">{delivery.handoff.evidenceAnchor}</p>
          </div>
        </div>
      ) : delivery.state !== "AWAITING_OUTCOME" ? (
        <div className="border-t border-border px-5 py-4">
          <p className="text-sm font-medium">This outcome was not auto-activated.</p>
          <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
            {delivery.state === "REFUSED"
              ? "Doctrine refused the request as stated. Use the safe alternative on the goal record."
              : `A new owner decision is required before this scope can proceed${delivery.blockedReasons.length ? `: ${delivery.blockedReasons.join(", ")}` : "."}`}
          </p>
        </div>
      ) : null}
    </section>
  )
}
