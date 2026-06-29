import { FileSearch, LockKeyhole } from "lucide-react"
import { getHermesFilesInventory } from "@/components/brain-council/brain-council-hermes-inventory"
import { StatusBadge } from "@/components/status-badge"

export function BrainCouncilHermesInventoryPanel() {
  const inventory = getHermesFilesInventory()

  return (
    <section className="rounded-2xl border border-border bg-card p-4">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex items-start gap-3">
          <FileSearch className="mt-0.5 h-5 w-5 text-primary" aria-hidden />
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-sm font-medium">Hermes files inventory</h2>
              <StatusBadge value="neutral" label={inventory.posture.replace(/_/g, " ")} />
              <StatusBadge value="pass" label="read-only reference" />
            </div>
            <p className="mt-1 max-w-3xl text-sm leading-relaxed text-muted-foreground">
              Hermes reference packages are inspectable as design evidence only. This view lists the
              static signals the operator can reason from without installing, running, or activating Hermes.
            </p>
          </div>
        </div>
      </div>

      <div className="mt-4 grid gap-2">
        {inventory.sourceRoots.map((root) => (
          <div key={root} className="rounded-lg border border-border bg-background/50 px-3 py-2 font-mono text-xs text-muted-foreground">
            {root}
          </div>
        ))}
      </div>

      <div className="mt-4 grid gap-3 lg:grid-cols-2">
        {inventory.items.map((item) => (
          <article key={item.id} className="rounded-lg border border-border bg-background/50 p-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h3 className="text-sm font-medium">{item.label}</h3>
              <StatusBadge value="neutral" label={item.kind} />
            </div>
            <p className="mt-1 font-mono text-[10px] text-muted-foreground">{item.sourcePath}</p>
            <p className="mt-3 text-sm leading-relaxed text-muted-foreground">{item.signal}</p>
            <div className="mt-3 flex gap-2 rounded-lg border border-warning/30 bg-warning/10 p-2">
              <LockKeyhole className="mt-0.5 h-3.5 w-3.5 shrink-0 text-warning" aria-hidden />
              <p className="text-xs leading-relaxed text-muted-foreground">{item.boundary}</p>
            </div>
          </article>
        ))}
      </div>
    </section>
  )
}
