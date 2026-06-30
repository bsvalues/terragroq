import Link from "next/link"
import { Hammer, ShieldCheck } from "lucide-react"
import { getAgentForgeSurface, type AgentForgeArea } from "@/components/agent-forge/agent-forge-surface"
import { StatusBadge } from "@/components/status-badge"

const statusValue: Record<AgentForgeArea["status"], "pass" | "neutral" | "partial"> = {
  ready: "pass",
  quarantined: "partial",
  "proposal-only": "neutral",
}

export function AgentForgePanel() {
  const forge = getAgentForgeSurface()

  return (
    <section className="overflow-hidden rounded-xl border border-border bg-card">
      <div className="border-b border-border bg-muted/30 px-4 py-3">
        <div className="flex flex-wrap items-center gap-2">
          <Hammer className="h-4 w-4 text-primary" aria-hidden={true} />
          <p className="font-mono text-[11px] uppercase tracking-[0.22em] text-muted-foreground">
            {forge.eyebrow}
          </p>
        </div>
        <h2 className="mt-2 text-lg font-semibold tracking-tight">{forge.title}</h2>
        <p className="mt-1 max-w-3xl text-sm leading-relaxed text-muted-foreground">
          {forge.description}
        </p>
      </div>

      <div className="grid gap-3 p-4 md:grid-cols-2">
        {forge.areas.map((area) => (
          <div key={area.label} className="rounded-lg border border-border bg-background p-3">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <p className="text-sm font-semibold">{area.label}</p>
              <StatusBadge value={statusValue[area.status]} label={area.status} />
            </div>
            <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
              {area.description}
            </p>
          </div>
        ))}
      </div>

      <div className="grid gap-3 border-t border-border p-4 md:grid-cols-4">
        {forge.links.map((link) => (
          <Link
            key={`${link.label}-${link.href}`}
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

      <div className="flex items-start gap-2 border-t border-border px-4 py-3">
        <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-primary" aria-hidden={true} />
        <p className="text-xs leading-relaxed text-muted-foreground">
          Agent Forge is read-only here. It cannot execute skills, grant authority,
          self-activate, write production, activate Hermes, activate MCP, or enable autonomy.
        </p>
      </div>
    </section>
  )
}
