import Link from "next/link"
import { ArrowRight } from "lucide-react"

export type VerificationFlowStep = {
  label: string
  value: string
  description: string
  href: string
}

export function VerificationFlowGrid({ steps }: { steps: VerificationFlowStep[] }) {
  return (
    <div className="grid gap-3 border-b border-border p-4 md:grid-cols-4">
      {steps.map((step, index) => (
        <Link
          key={step.label}
          href={step.href}
          className="group rounded-lg border border-border bg-background p-3 transition-colors hover:border-primary/40"
        >
          <div className="flex items-center justify-between gap-3">
            <p className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
              {String(index + 1).padStart(2, "0")} · {step.label}
            </p>
            <ArrowRight
              className="h-3.5 w-3.5 text-primary transition-transform group-hover:translate-x-0.5"
              aria-hidden={true}
            />
          </div>
          <p className="mt-2 text-sm font-semibold">{step.value}</p>
          <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
            {step.description}
          </p>
        </Link>
      ))}
    </div>
  )
}
