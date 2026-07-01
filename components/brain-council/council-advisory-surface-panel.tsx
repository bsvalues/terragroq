import { BrainCircuit, LockKeyhole, Route } from "lucide-react"
import { getCouncilAdvisorySurface } from "@/components/brain-council/council-advisory-surface"
import { StatusBadge } from "@/components/status-badge"

export function CouncilAdvisorySurfacePanel() {
  const surface = getCouncilAdvisorySurface()

  return (
    <section className="overflow-hidden rounded-xl border border-border bg-card">
      <div className="border-b border-border bg-muted/30 px-4 py-3">
        <div className="flex flex-wrap items-center gap-2">
          <BrainCircuit className="h-4 w-4 text-primary" aria-hidden={true} />
          <p className="font-mono text-[11px] uppercase tracking-[0.22em] text-muted-foreground">
            Advisory overview
          </p>
        </div>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <h2 className="text-lg font-semibold tracking-tight">{surface.title}</h2>
          <StatusBadge value="pass" label="overview only" />
          <StatusBadge value="neutral" label="Primary review" />
          <StatusBadge value="pass" label="no execution" />
        </div>
        <p className="mt-1 max-w-3xl text-sm leading-relaxed text-muted-foreground">
          {surface.summary}
        </p>
      </div>

      <div className="border-b border-border p-4">
        <p className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
          Current question
        </p>
        <p className="mt-2 max-w-4xl text-sm leading-relaxed">{surface.currentQuestion}</p>
      </div>

      <div className="grid gap-3 border-b border-border p-4 lg:grid-cols-3">
        {surface.operatingLoop.map((item) => (
          <div key={item.label} className="rounded-lg border border-border bg-background p-3">
            <div className="flex items-center gap-2">
              <Route className="h-3.5 w-3.5 text-primary" aria-hidden={true} />
              <p className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
                {item.label}
              </p>
            </div>
            <p className="mt-2 text-sm font-semibold">{item.value}</p>
            <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
              {item.description}
            </p>
          </div>
        ))}
      </div>

      <div className="grid gap-3 border-b border-border bg-muted/10 p-4 md:grid-cols-4">
        {surface.reviewReadiness.map((item) => (
          <div key={item.label} className="rounded-lg border border-border bg-background p-3">
            <p className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
              {item.label}
            </p>
            <p className="mt-2 text-xl font-semibold">{item.value}</p>
            <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
              {item.description}
            </p>
          </div>
        ))}
      </div>

      <div className="grid gap-3 border-b border-border p-4 lg:grid-cols-[1fr_1.2fr]">
        <div className="rounded-lg border border-border bg-background p-3">
          <p className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
            Next safe move
          </p>
          <p className="mt-2 text-sm leading-relaxed">{surface.nextSafeMove}</p>
        </div>
        <div className="rounded-lg border border-destructive/25 bg-destructive/10 p-3">
          <div className="flex items-center gap-2">
            <LockKeyhole className="h-3.5 w-3.5 text-destructive" aria-hidden={true} />
            <p className="font-mono text-[10px] uppercase tracking-wider text-destructive">
              Blocked powers
            </p>
          </div>
          <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
            {surface.blockedPowers.join(", ")}
          </p>
        </div>
      </div>

      <div className="px-4 py-3">
        <p className="text-xs leading-relaxed text-muted-foreground">
          Council overview cannot execute, create Work Orders, grant authority, activate tools,
          or write production data.
        </p>
      </div>
    </section>
  )
}
