import Link from "next/link"
import { ArrowRight, Compass } from "lucide-react"
import {
  getOperatorStartSteps,
  type DashboardStats,
} from "@/components/dashboard/operator-start"

export function OperatorStartPanel({ stats }: { stats: DashboardStats }) {
  const steps = getOperatorStartSteps(stats)

  return (
    <section className="overflow-hidden rounded-xl border border-border bg-card">
      <div className="border-b border-border bg-muted/30 px-4 py-3">
        <div className="flex items-center gap-2">
          <Compass className="h-4 w-4 text-primary" aria-hidden />
          <h2 className="text-sm font-medium">Operator start path</h2>
        </div>
        <p className="mt-1 text-xs text-muted-foreground">
          Start with governance primitives, then move into work. These actions are
          manual and auditable; nothing runs automatically from this panel.
        </p>
      </div>
      <div className="grid gap-3 p-4 md:grid-cols-3">
        {steps.map((step, index) => (
          <Link
            key={step.title}
            href={step.href}
            className="group flex min-h-36 flex-col justify-between rounded-lg border border-border bg-background p-4 transition-colors hover:border-primary/40"
          >
            <div className="space-y-2">
              <span className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
                Step {index + 1}
              </span>
              <h3 className="text-sm font-semibold">{step.title}</h3>
              <p className="text-xs leading-relaxed text-muted-foreground">
                {step.description}
              </p>
            </div>
            <span className="mt-4 inline-flex items-center gap-1 text-xs font-medium text-primary">
              {step.action}
              <ArrowRight className="h-3.5 w-3.5 transition-transform group-hover:translate-x-0.5" />
            </span>
          </Link>
        ))}
      </div>
    </section>
  )
}
