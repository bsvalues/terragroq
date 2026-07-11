import { ArrowRight, CheckCircle2, LockKeyhole, Route } from "lucide-react"

import { getPortfolioOperatorSurface } from "@/components/operator/portfolio-operator-surface"
import { Badge } from "@/components/ui/badge"

export function PortfolioOperatorPanel() {
  const surface = getPortfolioOperatorSurface()

  return (
    <section className="overflow-hidden rounded-lg border border-border bg-card">
      <div className="border-b border-border bg-muted/30 px-5 py-4">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
          <div className="max-w-3xl">
            <p className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">{surface.eyebrow}</p>
            <h2 className="mt-2 text-xl font-semibold">{surface.title}</h2>
            <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{surface.description}</p>
          </div>
          <Badge variant="outline" className="border-success/30 text-success">continuous selection active</Badge>
        </div>
      </div>

      <div className="grid gap-px bg-border lg:grid-cols-3">
        <div className="bg-card p-4">
          <div className="flex items-center gap-2"><Route className="h-4 w-4 text-primary" aria-hidden /><p className="text-sm font-medium">Selected program</p></div>
          <p className="mt-2 text-sm font-semibold">{surface.selectedProgram.title}</p>
          <p className="mt-1 font-mono text-[10px] text-muted-foreground">{surface.selectedProgram.programId}</p>
        </div>
        <div className="bg-card p-4">
          <div className="flex items-center gap-2"><ArrowRight className="h-4 w-4 text-primary" aria-hidden /><p className="text-sm font-medium">Active Work Order</p></div>
          <p className="mt-2 text-sm font-semibold">{surface.activeWorkOrder.title}</p>
          <p className="mt-1 font-mono text-[10px] text-muted-foreground">{surface.activeWorkOrder.workOrderId}</p>
        </div>
        <div className="bg-card p-4">
          <div className="flex items-center gap-2"><LockKeyhole className="h-4 w-4 text-primary" aria-hidden /><p className="text-sm font-medium">Authority posture</p></div>
          <p className="mt-2 text-xs leading-relaxed text-muted-foreground">R0/R1 static and read-only work continues. Protected programs remain owner-gated.</p>
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
