import { ShieldCheck } from "lucide-react"
import { StatusBadge } from "@/components/status-badge"
import { getReadinessNativeArea } from "@/components/runtime/readiness-native-area"

const stateValue: Record<string, string> = {
  verified: "pass",
  configured: "pass",
  disabled: "inactive",
  "requires authority": "requires_approval",
  "no action taken": "informational",
  unchanged: "informational",
  blocked: "blocked",
}

export function ReadinessNativeAreaPanel() {
  const area = getReadinessNativeArea()

  return (
    <section className="overflow-hidden rounded-xl border border-border bg-card">
      <div className="border-b border-border bg-muted/30 px-4 py-3">
        <div className="flex flex-wrap items-center gap-2">
          <ShieldCheck className="h-4 w-4 text-primary" aria-hidden={true} />
          <p className="font-mono text-[11px] uppercase tracking-[0.22em] text-muted-foreground">
            {area.eyebrow}
          </p>
        </div>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <h2 className="text-lg font-semibold tracking-tight">{area.title}</h2>
          <StatusBadge value="pass" label="pre-action safety" />
          <StatusBadge value="requires_approval" label="authority required" />
          <StatusBadge value="inactive" label="no action taken" />
        </div>
        <p className="mt-1 max-w-3xl text-sm leading-relaxed text-muted-foreground">
          {area.description}
        </p>
      </div>

      <div className="grid gap-3 border-b border-border p-4 md:grid-cols-2 xl:grid-cols-3">
        {area.signals.map((signal) => (
          <div key={signal.label} className="rounded-lg border border-border bg-background p-3">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <p className="text-sm font-semibold">{signal.label}</p>
              <StatusBadge value={stateValue[signal.state] ?? "informational"} label={signal.state} />
            </div>
            <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
              {signal.description}
            </p>
          </div>
        ))}
      </div>

      <div className="grid gap-3 border-b border-border bg-muted/10 p-4 md:grid-cols-3">
        {area.boundaries.map((boundary) => (
          <div key={boundary.label} className="rounded-lg border border-border bg-card p-3">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <p className="text-sm font-semibold">{boundary.label}</p>
              <StatusBadge value={stateValue[boundary.blocked] ?? "informational"} label={boundary.blocked} />
            </div>
            <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
              {boundary.description}
            </p>
          </div>
        ))}
      </div>

      <div className="px-4 py-3 text-xs leading-relaxed text-muted-foreground">
        Readiness reports safe-to-proceed posture, blocked states, configured services,
        disabled capabilities, production health, security headers, and authority requirements.
        It does not change readiness endpoints, auth behavior, production checks, DB/schema,
        env, packages, Vercel settings, deploy, release, tag, Hermes, MCP, autonomy, or
        production-write behavior.
      </div>
    </section>
  )
}
