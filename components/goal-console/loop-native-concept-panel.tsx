import { AlertTriangle, FileCheck2, Radar, ShieldCheck, Workflow } from "lucide-react"

import { getLoopNativeConceptSurface, type LoopNativeConceptStep } from "@/components/goal-console/loop-native-concept"
import { Badge } from "@/components/ui/badge"

function stepIcon(status: LoopNativeConceptStep["status"]) {
  if (status === "verify") return ShieldCheck
  if (status === "report") return FileCheck2
  if (status === "stop") return AlertTriangle
  return Radar
}

export function LoopNativeConceptPanel() {
  const surface = getLoopNativeConceptSurface()

  return (
    <section className="rounded-2xl border border-border bg-card/80 p-5 shadow-sm">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div className="max-w-3xl">
          <p className="font-mono text-[10px] uppercase tracking-[0.24em] text-muted-foreground">{surface.eyebrow}</p>
          <h2 className="mt-2 text-2xl font-semibold tracking-tight">{surface.title}</h2>
          <p className="mt-2 max-w-2xl text-sm leading-relaxed text-muted-foreground">{surface.description}</p>
        </div>
        <Badge variant="outline" className="w-fit border-warning/30 text-warning">
          Controlled, not autonomous
        </Badge>
      </div>

      <div className="mt-5 grid gap-3 lg:grid-cols-4">
        {surface.steps.map((step) => {
          const Icon = stepIcon(step.status)

          return (
            <article key={step.label} className="rounded-xl border border-border bg-background/70 p-4">
              <div className="flex items-center justify-between gap-3">
                <Icon className="h-4 w-4 text-primary" aria-hidden />
                <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
                  {step.status}
                </span>
              </div>
              <h3 className="mt-4 text-sm font-semibold">{step.label}</h3>
              <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{step.description}</p>
            </article>
          )
        })}
      </div>

      <div className="mt-5 rounded-xl border border-dashed border-border bg-background/50 p-4">
        <div className="flex items-center gap-2">
          <Workflow className="h-4 w-4 text-success" aria-hidden />
          <p className="text-sm font-medium">Loop guarantees</p>
        </div>
        <ul className="mt-3 grid gap-2 text-sm text-muted-foreground md:grid-cols-2">
          {surface.guarantees.map((guarantee) => (
            <li key={guarantee}>{guarantee}</li>
          ))}
        </ul>
      </div>
    </section>
  )
}
