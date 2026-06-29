import { ScrollText } from "lucide-react"
import { getBrainCouncilHermesActivationChecklistExport } from "@/components/brain-council/brain-council-hermes-activation-checklist-export"
import { StatusBadge } from "@/components/status-badge"

export function BrainCouncilHermesActivationChecklistExportPanel() {
  const checklist = getBrainCouncilHermesActivationChecklistExport()

  return (
    <section className="rounded-2xl border border-border bg-card p-4">
      <div className="flex items-start gap-3">
        <ScrollText className="mt-0.5 h-5 w-5 text-primary" aria-hidden />
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-sm font-medium">Hermes future activation checklist export</h2>
            <StatusBadge value="neutral" label={checklist.posture.replace(/_/g, " ")} />
            <StatusBadge value="pass" label="preview text only" />
          </div>
          <p className="mt-1 max-w-3xl text-sm leading-relaxed text-muted-foreground">
            This packet previews the checklist an owner would review later. It does not write files, grant
            authority, activate Hermes, or dispatch workers.
          </p>
        </div>
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-[0.9fr_1.1fr]">
        <div className="grid gap-2">
          {checklist.items.map((item) => (
            <div key={item.label} className="flex items-center justify-between rounded-lg border border-border bg-background/60 p-3">
              <span className="text-sm">{item.label}</span>
              <StatusBadge value={item.complete ? "pass" : "warning"} label={item.complete ? "complete" : "open"} />
            </div>
          ))}
        </div>
        <pre className="min-h-48 whitespace-pre-wrap rounded-lg border border-border bg-background/70 p-3 font-mono text-xs leading-relaxed text-muted-foreground">
          {checklist.exportText}
        </pre>
      </div>
    </section>
  )
}
