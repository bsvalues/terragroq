import Link from "next/link"
import { ArrowRight, BrainCircuit, ShieldCheck } from "lucide-react"
import { getBrainCouncilNativeArea } from "@/components/brain-council/brain-council-native-area"
import { StatusBadge } from "@/components/status-badge"

export function BrainCouncilNativeAreaPanel() {
  const area = getBrainCouncilNativeArea()

  return (
    <section className="overflow-hidden rounded-xl border border-border bg-card">
      <div className="border-b border-border bg-muted/30 px-4 py-3">
        <div className="flex flex-wrap items-center gap-2">
          <BrainCircuit className="h-4 w-4 text-primary" aria-hidden={true} />
          <p className="font-mono text-[11px] uppercase tracking-[0.22em] text-muted-foreground">
            {area.eyebrow}
          </p>
        </div>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <h2 className="text-lg font-semibold tracking-tight">{area.title}</h2>
          <StatusBadge value="pass" label="native area" />
          <StatusBadge value="neutral" label="advisory only" />
          <StatusBadge value="pass" label="read-only" />
        </div>
        <p className="mt-1 max-w-3xl text-sm leading-relaxed text-muted-foreground">
          {area.description}
        </p>
      </div>

      <div className="grid gap-3 border-b border-border p-4 md:grid-cols-3">
        {area.postureSummary.map((item) => (
          <div key={item.label} className="rounded-lg border border-border bg-background p-3">
            <p className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
              {item.label}
            </p>
            <p className="mt-2 text-sm font-semibold">{item.value}</p>
            <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
              {item.description}
            </p>
          </div>
        ))}
      </div>

      <div className="border-b border-border bg-muted/10 p-4">
        <div className="flex flex-wrap items-center gap-2">
          <ArrowRight className="h-4 w-4 text-primary" aria-hidden={true} />
          <p className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
            Advisory loop
          </p>
        </div>
        <div className="mt-3 grid gap-3 md:grid-cols-4">
          {area.advisoryLoop.map((step) => (
            <div key={step.label} className="rounded-lg border border-border bg-card p-3">
              <p className="text-sm font-semibold">{step.label}</p>
              <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
                {step.description}
              </p>
            </div>
          ))}
        </div>
      </div>

      <div className="grid gap-3 p-4 md:grid-cols-2 xl:grid-cols-4">
        {area.links.map((link) => (
          <Link
            key={link.href}
            href={link.href}
            className="rounded-lg border border-border bg-background p-3 transition-colors hover:border-primary/40"
          >
            <p className="text-sm font-semibold">{link.label}</p>
            <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
              {link.description}
            </p>
          </Link>
        ))}
      </div>

      <div className="grid gap-3 border-t border-border bg-muted/10 p-4 md:grid-cols-3">
        {area.authorityBoundaries.map((boundary) => (
          <div key={boundary.label} className="rounded-lg border border-border bg-background p-3">
            <p className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
              {boundary.label}
            </p>
            <p className="mt-2 text-sm font-semibold">{boundary.state}</p>
            <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
              {boundary.description}
            </p>
          </div>
        ))}
      </div>

      <div className="flex items-start gap-2 border-t border-border px-4 py-3">
        <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-primary" aria-hidden={true} />
        <p className="text-xs leading-relaxed text-muted-foreground">
          Brain Council cannot {area.blockedActions.join(", ")}. Recommendations must
          move through Work Orders, Evidence, Systems checks, and authority gates before action.
        </p>
      </div>
    </section>
  )
}
