import Link from "next/link"
import { Activity, ServerCog, ShieldCheck } from "lucide-react"
import {
  getSystemsStatusSurface,
  type SystemStatusTone,
} from "@/components/systems/systems-status-surface"

const toneClasses: Record<SystemStatusTone, string> = {
  ready: "border-success/30 bg-success/10 text-success",
  "read-only": "border-primary/30 bg-primary/10 text-primary",
  "preview-only": "border-warning/30 bg-warning/10 text-warning",
  disabled: "border-destructive/30 bg-destructive/10 text-destructive",
  "needs-authority": "border-border bg-muted text-muted-foreground",
}

const toneDotClasses: Record<SystemStatusTone, string> = {
  ready: "bg-success",
  "read-only": "bg-primary",
  "preview-only": "bg-warning",
  disabled: "bg-destructive",
  "needs-authority": "bg-muted-foreground",
}

export function SystemsStatusPanel() {
  const surface = getSystemsStatusSurface()

  return (
    <section className="overflow-hidden rounded-xl border border-border bg-card">
      <div className="border-b border-border bg-muted/30 px-4 py-3">
        <div className="flex flex-wrap items-center gap-2">
          <ServerCog className="h-4 w-4 text-primary" aria-hidden={true} />
          <p className="font-mono text-[11px] uppercase tracking-[0.22em] text-muted-foreground">
            {surface.eyebrow}
          </p>
        </div>
        <h2 className="mt-2 text-lg font-semibold tracking-tight">{surface.title}</h2>
        <p className="mt-1 max-w-3xl text-sm leading-relaxed text-muted-foreground">
          {surface.description}
        </p>
        <p className="mt-3 max-w-3xl text-xs leading-relaxed text-muted-foreground">
          {surface.operatorPosture}
        </p>
      </div>

      <div className="grid gap-3 border-b border-border p-4 md:grid-cols-4">
        {surface.postureSummary.map((item) => (
          <div key={item.label} className="rounded-lg border border-border bg-background p-3">
            <div className="flex items-center justify-between gap-3">
              <p className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
                {item.label}
              </p>
              <span
                className={`h-2 w-2 rounded-full ${toneDotClasses[item.tone]}`}
                aria-hidden={true}
              />
            </div>
            <p className="mt-2 text-lg font-semibold">{item.value}</p>
            <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
              {item.description}
            </p>
          </div>
        ))}
      </div>

      <div className="grid gap-3 border-b border-border p-4 md:grid-cols-2 xl:grid-cols-4">
        {surface.statusSequence.map((item) => (
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

      <div className="grid gap-3 border-b border-border bg-muted/10 p-4 md:grid-cols-3">
        {surface.boundaryRail.map((boundary) => (
          <div key={boundary.label} className="rounded-lg border border-border bg-card p-3">
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

      <div className="grid gap-3 border-b border-border p-4 md:grid-cols-2 xl:grid-cols-4">
        {surface.blockedExpansion.map((item) => (
          <div key={item.label} className="rounded-lg border border-border bg-background p-3">
            <p className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
              {item.state}
            </p>
            <p className="mt-2 text-sm font-semibold">{item.label}</p>
            <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
              {item.description}
            </p>
          </div>
        ))}
      </div>

      <div className="grid gap-3 p-4 md:grid-cols-2 xl:grid-cols-3">
        {surface.categories.map((category) => (
          <Link
            key={category.label}
            href={category.href}
            className="rounded-lg border border-border bg-background p-3 transition-colors hover:border-primary/40"
          >
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-sm font-semibold">{category.label}</p>
              <span
                className={`rounded-full border px-2 py-0.5 font-mono text-[10px] uppercase tracking-wider ${toneClasses[category.tone]}`}
              >
                {category.status}
              </span>
            </div>
            <p className="mt-3 text-xs leading-relaxed text-muted-foreground">
              {category.description}
            </p>
          </Link>
        ))}
      </div>

      <div className="flex flex-col gap-3 border-t border-border px-4 py-3 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <div className="flex items-center gap-2">
            <Activity className="h-4 w-4 text-primary" aria-hidden={true} />
            <p className="text-sm font-medium">Next Recommended WO</p>
          </div>
          <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
            {surface.nextRecommendedWo.label}: {surface.nextRecommendedWo.reason}
          </p>
        </div>
        <div className="inline-flex items-center gap-2 rounded-full border border-border bg-background px-3 py-1.5 text-xs text-muted-foreground">
          <ShieldCheck className="h-3.5 w-3.5 text-primary" aria-hidden={true} />
          No endpoint change, polling, monitoring integration, execution, deploy, authority
          grant, production write, Hermes, MCP, or autonomy activation.
        </div>
      </div>
    </section>
  )
}
