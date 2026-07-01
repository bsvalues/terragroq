import { ClipboardCheck, LockKeyhole, ShieldCheck } from "lucide-react"
import { getProductionOperatingMode } from "@/components/dogfood/production-operating-mode"
import { StatusBadge } from "@/components/status-badge"

export function ProductionOperatingModePanel() {
  const mode = getProductionOperatingMode()

  return (
    <section className="overflow-hidden rounded-xl border border-border bg-card">
      <div className="border-b border-border bg-muted/30 px-4 py-3">
        <div className="flex flex-wrap items-center gap-2">
          <ClipboardCheck className="h-4 w-4 text-primary" aria-hidden={true} />
          <p className="font-mono text-[11px] uppercase tracking-[0.22em] text-muted-foreground">
            {mode.eyebrow}
          </p>
        </div>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <h2 className="text-lg font-semibold tracking-tight">{mode.title}</h2>
          <StatusBadge value="pass" label="production console" />
          <StatusBadge value="neutral" label="reviewable training" />
          <StatusBadge value="pass" label="non-autonomous" />
        </div>
        <p className="mt-1 max-w-3xl text-sm leading-relaxed text-muted-foreground">
          {mode.summary}
        </p>
      </div>

      <div className="grid gap-3 border-b border-border p-4 lg:grid-cols-2">
        <div className="rounded-lg border border-border bg-background p-3">
          <p className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
            Agent may do
          </p>
          <ul className="mt-3 flex flex-col gap-2 text-sm text-muted-foreground">
            {mode.agentMayDo.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </div>
        <div className="rounded-lg border border-border bg-background p-3">
          <p className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
            Agent must not do
          </p>
          <ul className="mt-3 flex flex-col gap-2 text-sm text-muted-foreground">
            {mode.agentMustNotDo.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </div>
      </div>

      <div className="grid gap-3 border-b border-border bg-muted/10 p-4 md:grid-cols-4">
        {mode.trainingMaterial.map((item) => (
          <div key={item.label} className="rounded-lg border border-border bg-background p-3">
            <p className="text-sm font-semibold">{item.label}</p>
            <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
              {item.description}
            </p>
          </div>
        ))}
      </div>

      <div className="grid gap-3 p-4 md:grid-cols-3">
        {mode.reviewGates.map((gate) => (
          <div key={gate.label} className="rounded-lg border border-border bg-background p-3">
            <div className="flex items-center gap-2">
              <LockKeyhole className="h-3.5 w-3.5 text-primary" aria-hidden={true} />
              <p className="text-sm font-semibold">{gate.label}</p>
            </div>
            <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
              {gate.description}
            </p>
          </div>
        ))}
      </div>

      <div className="flex items-start gap-2 border-t border-border px-4 py-3">
        <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-primary" aria-hidden={true} />
        <p className="text-xs leading-relaxed text-muted-foreground">
          Production dogfooding captures review candidates only. It does not write memory,
          train models, execute Hermes, activate access grants, start workers, or change auth.
        </p>
      </div>
    </section>
  )
}
