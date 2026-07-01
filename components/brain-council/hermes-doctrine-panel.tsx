import { Anchor, LockKeyhole, ShieldCheck } from "lucide-react"
import { getHermesDoctrine } from "@/components/brain-council/hermes-doctrine"
import { StatusBadge } from "@/components/status-badge"

export function HermesDoctrinePanel() {
  const doctrine = getHermesDoctrine()

  return (
    <section className="overflow-hidden rounded-xl border border-border bg-card">
      <div className="border-b border-border bg-muted/30 px-4 py-3">
        <div className="flex flex-wrap items-center gap-2">
          <Anchor className="h-4 w-4 text-primary" aria-hidden={true} />
          <p className="font-mono text-[11px] uppercase tracking-[0.22em] text-muted-foreground">
            {doctrine.eyebrow}
          </p>
        </div>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <h2 className="text-lg font-semibold tracking-tight">{doctrine.title}</h2>
          <StatusBadge value="neutral" label="sidecar only" />
          <StatusBadge value="pass" label="Work Order required" />
          <StatusBadge value="pass" label="no dispatch" />
        </div>
        <p className="mt-1 max-w-3xl text-sm leading-relaxed text-muted-foreground">
          {doctrine.summary}
        </p>
      </div>

      <div className="grid gap-3 border-b border-border p-4 md:grid-cols-4">
        {doctrine.principles.map((principle) => (
          <div key={principle.label} className="rounded-lg border border-border bg-background p-3">
            <p className="text-sm font-semibold">{principle.label}</p>
            <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
              {principle.description}
            </p>
          </div>
        ))}
      </div>

      <div className="grid gap-3 border-b border-border bg-muted/10 p-4 md:grid-cols-4">
        {doctrine.boundaries.map((boundary) => (
          <div key={boundary.label} className="rounded-lg border border-border bg-background p-3">
            <div className="flex items-center gap-2">
              <LockKeyhole className="h-3.5 w-3.5 text-primary" aria-hidden={true} />
              <p className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
                {boundary.state}
              </p>
            </div>
            <p className="mt-2 text-sm font-semibold">{boundary.label}</p>
            <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
              {boundary.description}
            </p>
          </div>
        ))}
      </div>

      <div className="flex items-start gap-2 px-4 py-3">
        <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-primary" aria-hidden={true} />
        <p className="text-xs leading-relaxed text-muted-foreground">
          {doctrine.operatingRule}
        </p>
      </div>
    </section>
  )
}
