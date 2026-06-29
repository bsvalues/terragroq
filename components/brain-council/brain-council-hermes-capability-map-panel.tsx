import { Network, ShieldX } from "lucide-react"
import { getHermesCandidateCapabilityMap } from "@/components/brain-council/brain-council-hermes-capability-map"
import { StatusBadge } from "@/components/status-badge"

const badgeByAuthority = {
  "inspect-only": "neutral",
  "draft-only": "partial",
  denied: "fail",
} as const

export function BrainCouncilHermesCapabilityMapPanel() {
  const map = getHermesCandidateCapabilityMap()

  return (
    <section className="rounded-2xl border border-border bg-card p-4">
      <div className="flex items-start gap-3">
        <Network className="mt-0.5 h-5 w-5 text-primary" aria-hidden />
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-sm font-medium">Hermes candidate capability map</h2>
            <StatusBadge value="neutral" label={map.posture.replace(/_/g, " ")} />
          </div>
          <p className="mt-1 max-w-3xl text-sm leading-relaxed text-muted-foreground">
            This map separates inspectable candidate capabilities from denied runtime capabilities.
            It does not grant authority, execute skills, dispatch workers, or activate MCP.
          </p>
        </div>
      </div>

      <div className="mt-4 grid gap-3 lg:grid-cols-3">
        {map.capabilities.map((capability) => (
          <article key={capability.id} className="rounded-lg border border-border bg-background/50 p-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h3 className="text-sm font-medium">{capability.label}</h3>
              <StatusBadge value={badgeByAuthority[capability.authority]} label={capability.authority} />
            </div>
            <p className="mt-1 font-mono text-[10px] text-muted-foreground">{capability.source}</p>
            <p className="mt-3 text-sm leading-relaxed text-muted-foreground">{capability.operatorMeaning}</p>
          </article>
        ))}
      </div>

      <div className="mt-4 flex items-start gap-2 rounded-lg border border-destructive/25 bg-destructive/10 p-3">
        <ShieldX className="mt-0.5 h-4 w-4 shrink-0 text-destructive" aria-hidden />
        <p className="text-sm leading-relaxed text-muted-foreground">{map.activationRule}</p>
      </div>
    </section>
  )
}
