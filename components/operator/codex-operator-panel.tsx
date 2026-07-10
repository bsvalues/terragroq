import Link from "next/link"
import {
  ArrowRight,
  CheckCircle2,
  CircleDashed,
  FileCheck2,
  LockKeyhole,
  Route,
  ShieldCheck,
} from "lucide-react"

import { getCodexOperatorSurface } from "@/components/operator/codex-operator-surface"
import { Badge } from "@/components/ui/badge"

export function CodexOperatorPanel() {
  const surface = getCodexOperatorSurface()
  const nextWorkOrder = surface.workOrders.find(
    (workOrder) => workOrder.workOrderId === surface.nextAction.workOrderId,
  )

  return (
    <section className="overflow-hidden rounded-xl border border-border bg-card">
      <div className="border-b border-border bg-muted/30 px-5 py-4">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div className="max-w-3xl">
            <p className="font-mono text-[10px] uppercase tracking-[0.22em] text-muted-foreground">
              {surface.eyebrow}
            </p>
            <h2 className="mt-2 text-xl font-semibold">{surface.title}</h2>
            <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{surface.description}</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Badge variant="outline" className="border-success/30 text-success">
              {surface.status.toLowerCase()}
            </Badge>
            <Badge variant="outline">R1 ceiling</Badge>
          </div>
        </div>
      </div>

      <div className="grid gap-px bg-border lg:grid-cols-3">
        <div className="bg-card p-4">
          <div className="flex items-center gap-2">
            <LockKeyhole className="h-4 w-4 text-primary" aria-hidden />
            <p className="text-sm font-medium">{surface.owner.role}</p>
          </div>
          <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
            {surface.owner.responsibility}
          </p>
        </div>
        <div className="bg-card p-4">
          <div className="flex items-center gap-2">
            <Route className="h-4 w-4 text-primary" aria-hidden />
            <p className="text-sm font-medium">{surface.operator.role}</p>
          </div>
          <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
            {surface.operator.responsibility}
          </p>
        </div>
        <div className="bg-card p-4">
          <div className="flex items-center gap-2">
            <FileCheck2 className="h-4 w-4 text-primary" aria-hidden />
            <p className="text-sm font-medium">{surface.progress.label}</p>
          </div>
          <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-muted">
            <div
              className="h-full bg-primary"
              style={{ width: `${(surface.progress.completed / surface.progress.total) * 100}%` }}
            />
          </div>
          <p className="mt-2 text-[11px] text-muted-foreground">
            {surface.provenance.label}. {surface.provenance.caution}
          </p>
        </div>
      </div>

      <div className="grid gap-4 p-4 xl:grid-cols-[1.05fr_0.95fr]">
        <div>
          <p className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
            Current continuation
          </p>
          <div className="mt-3 flex items-start gap-3 rounded-lg border border-primary/25 bg-primary/5 p-4">
            <ArrowRight className="mt-0.5 h-4 w-4 shrink-0 text-primary" aria-hidden />
            <div>
              <p className="text-sm font-semibold">
                {nextWorkOrder?.workOrderId ?? "Goal review"} · {nextWorkOrder?.title ?? "No Work Order remains"}
              </p>
              <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                {nextWorkOrder?.purpose ?? "Completion evidence must be verified before closure."}
              </p>
              <p className="mt-2 font-mono text-[10px] uppercase tracking-wider text-primary">
                {surface.nextAction.decision.replaceAll("_", " ")}
              </p>
            </div>
          </div>

          <div className="mt-4 grid gap-2 sm:grid-cols-2">
            {surface.workOrders.slice(-6).map((workOrder) => (
              <div key={workOrder.workOrderId} className="flex items-start gap-2 border-t border-border py-3">
                {workOrder.status === "COMPLETE" ? (
                  <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-success" aria-hidden />
                ) : (
                  <CircleDashed className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
                )}
                <div>
                  <p className="font-mono text-[10px] text-muted-foreground">{workOrder.workOrderId}</p>
                  <p className="mt-1 text-xs font-medium">{workOrder.title}</p>
                </div>
              </div>
            ))}
          </div>
        </div>

        <div>
          <p className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
            Proof and authority
          </p>
          <div className="mt-3 grid gap-2 sm:grid-cols-2">
            {surface.crossLinks.map((link) => (
              <Link
                key={link.label}
                href={link.href}
                className="border-t border-border py-3 transition-colors hover:text-primary"
              >
                <p className="text-sm font-medium">{link.label}</p>
                <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{link.description}</p>
              </Link>
            ))}
          </div>

          <div className="mt-4 border-t border-border pt-4">
            <div className="flex items-center gap-2">
              <ShieldCheck className="h-4 w-4 text-success" aria-hidden />
              <p className="text-sm font-medium">Static decision model</p>
            </div>
            <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
              No product control is exposed here. Auth, schemas, secrets, production writes,
              runtime activation, memory writes, and TerraFusion/PACS remain owner authority walls.
            </p>
          </div>
        </div>
      </div>
    </section>
  )
}
