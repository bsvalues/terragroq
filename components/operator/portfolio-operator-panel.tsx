import { ArrowRight, CheckCircle2, FileCheck2, GitBranch, LockKeyhole, Route, ShieldAlert } from "lucide-react"

import { getPortfolioOperatorSurface } from "@/components/operator/portfolio-operator-surface"
import type { OwnerOutcomeSource } from "@/components/operator/owner-outcome-delivery"
import { Badge } from "@/components/ui/badge"

export function PortfolioOperatorPanel({ outcomes = [] }: { outcomes?: OwnerOutcomeSource[] }) {
  const surface = getPortfolioOperatorSurface(undefined, outcomes)

  return (
    <section className="overflow-hidden rounded-lg border border-border bg-card">
      <div className="border-b border-border bg-muted/30 px-5 py-4">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
          <div className="max-w-3xl">
            <p className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">{surface.eyebrow}</p>
            <h2 className="mt-2 text-xl font-semibold">{surface.title}</h2>
            <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{surface.description}</p>
          </div>
          <Badge variant="outline" className={surface.selectedProgram ? "border-success/30 text-success" : undefined}>
            {surface.selectedProgram ? "bounded outcome selected" : "standing intake ready"}
          </Badge>
        </div>
      </div>

      <div className="grid gap-px bg-border lg:grid-cols-3">
        <div className="bg-card p-4">
          <div className="flex items-center gap-2"><Route className="h-4 w-4 text-primary" aria-hidden /><p className="text-sm font-medium">Selected program</p></div>
          <p className="mt-2 text-sm font-semibold">{surface.selectedProgram?.title ?? "Owner decision required"}</p>
          <p className="mt-1 font-mono text-[10px] text-muted-foreground">{surface.selectedProgram?.programId ?? surface.selection.reasonCode}</p>
          {surface.selectedOwnerOutcome && (
            <p className="mt-1 font-mono text-[10px] text-muted-foreground">Outcome {surface.selection.ownerOutcomeRef}</p>
          )}
        </div>
        <div className="bg-card p-4">
          <div className="flex items-center gap-2"><ArrowRight className="h-4 w-4 text-primary" aria-hidden /><p className="text-sm font-medium">Active Work Order</p></div>
          <p className="mt-2 text-sm font-semibold">{surface.activeWorkOrder?.title ?? "No Work Order activated"}</p>
          <p className="mt-1 font-mono text-[10px] text-muted-foreground">{surface.activeWorkOrder?.workOrderId ?? "AUTHORITY WALL"}</p>
        </div>
        <div className="bg-card p-4">
          <div className="flex items-center gap-2"><LockKeyhole className="h-4 w-4 text-primary" aria-hidden /><p className="text-sm font-medium">Authority posture</p></div>
          <p className="mt-2 text-xs leading-relaxed text-muted-foreground">R0/R1 static and read-only work continues. Protected programs remain owner-gated.</p>
        </div>
      </div>

      <div className="grid gap-px border-t border-border bg-border lg:grid-cols-[1.1fr_1fr]">
        <div className="bg-card p-4">
          <div className="flex items-center gap-2">
            <GitBranch className="h-4 w-4 text-primary" aria-hidden />
            <p className="text-sm font-medium">Active lane proof</p>
          </div>
          <div className="mt-3 grid gap-2 sm:grid-cols-3">
            <div>
              <p className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">Complete</p>
              <p className="mt-1 text-lg font-semibold">{surface.statusCounts.complete}/{surface.statusCounts.total}</p>
            </div>
            <div>
              <p className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">Ready</p>
              <p className="mt-1 text-lg font-semibold">{surface.readyWorkOrders.join(", ") || "none"}</p>
            </div>
            <div>
              <p className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">Deferred</p>
              <p className="mt-1 text-lg font-semibold">{surface.deferredWorkOrders.join(", ") || "none"}</p>
            </div>
          </div>
          {surface.activeDependencyState && (
            <div className="mt-4">
              <p className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
                Dependencies satisfied {surface.activeDependencyState.satisfied}/{surface.activeDependencyState.total}
              </p>
              <div className="mt-2 flex flex-wrap gap-2">
                {surface.activeDependencyState.dependencies.map((dependency) => (
                  <Badge key={dependency.workOrderId} variant={dependency.satisfied ? "default" : "secondary"}>
                    {dependency.workOrderId} {dependency.status.toLowerCase()}
                  </Badge>
                ))}
              </div>
            </div>
          )}
          {surface.activeReservation && (
            <div className="mt-4 grid gap-3 border-t border-border pt-3 md:grid-cols-2">
              <div>
                <p className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">Reservation</p>
                <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                  {surface.activeReservation.scope.join(" / ")}
                </p>
              </div>
              <div>
                <p className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">Boundary</p>
                <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                  {surface.activeReservation.discoveryBoundary.join(" / ")}
                </p>
              </div>
              <div className="md:col-span-2">
                <p className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">Rollback</p>
                <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{surface.activeReservation.rollback}</p>
              </div>
            </div>
          )}
        </div>

        <div className="bg-card p-4">
          <div className="flex items-center gap-2">
            <FileCheck2 className="h-4 w-4 text-primary" aria-hidden />
            <p className="text-sm font-medium">Evidence trail</p>
          </div>
          <div className="mt-3 space-y-2">
            {surface.evidenceChain.map((entry) => (
              <div key={entry.workOrderId} className="border-t border-border pt-2 first:border-t-0 first:pt-0">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="text-sm font-medium">{entry.workOrderId}</p>
                  <Badge variant="outline">{entry.status.toLowerCase()}</Badge>
                </div>
                <p className="mt-1 truncate font-mono text-[10px] text-muted-foreground">{entry.evidencePath}</p>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="grid gap-px border-t border-border bg-border lg:grid-cols-2">
        <div className="bg-card p-4">
          <div className="flex items-center gap-2">
            <ShieldAlert className="h-4 w-4 text-primary" aria-hidden />
            <p className="text-sm font-medium">Genuine authority walls</p>
          </div>
          <div className="mt-3 space-y-2">
            {surface.ownerAuthorityWalls.slice(0, 5).map((wall) => (
              <div key={wall.programId} className="border-t border-border pt-2 first:border-t-0 first:pt-0">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="text-sm font-medium">{wall.title}</p>
                  <Badge variant="secondary">{wall.state.toLowerCase()}</Badge>
                </div>
                <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{wall.reason}</p>
              </div>
            ))}
          </div>
        </div>

        <div className="bg-card p-4">
          <div className="flex items-center gap-2">
            <LockKeyhole className="h-4 w-4 text-primary" aria-hidden />
            <p className="text-sm font-medium">Provider posture</p>
          </div>
          <div className="mt-3 space-y-2">
            {surface.providerPosture.map((provider) => (
              <div key={provider.label} className="border-t border-border pt-2 first:border-t-0 first:pt-0">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="text-sm font-medium">{provider.label}</p>
                  <Badge variant={provider.status === "available" ? "default" : "secondary"}>{provider.status}</Badge>
                </div>
                <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{provider.summary}</p>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="p-4">
        <p className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">Ratified program backlog</p>
        <div className="mt-3 grid gap-2 md:grid-cols-2 xl:grid-cols-3">
          {surface.backlog.map((program) => (
            <div key={program.programId} className="border-t border-border py-3">
              <div className="flex items-start justify-between gap-2">
                <p className="text-sm font-medium">{program.title}</p>
                {program.state === "SELECTED" && <CheckCircle2 className="h-4 w-4 shrink-0 text-success" aria-hidden />}
              </div>
              <p className="mt-1 text-xs text-muted-foreground">{program.state.toLowerCase()} · score {program.priorityScore} · {program.riskClass}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}
