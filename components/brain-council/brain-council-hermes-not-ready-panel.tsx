import { Ban } from "lucide-react"
import { getBrainCouncilHermesNotReadyExplanation } from "@/components/brain-council/brain-council-hermes-not-ready"
import { StatusBadge } from "@/components/status-badge"

export function BrainCouncilHermesNotReadyPanel() {
  const explanation = getBrainCouncilHermesNotReadyExplanation()

  return (
    <section className="rounded-2xl border border-destructive/25 bg-destructive/5 p-4">
      <div className="flex items-start gap-3">
        <Ban className="mt-0.5 h-5 w-5 text-destructive" aria-hidden />
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-sm font-medium">Hermes not-ready explanation</h2>
            <StatusBadge value="fail" label={explanation.activationRubricResult} />
            <StatusBadge value="neutral" label={explanation.posture.replace(/_/g, " ")} />
          </div>
          <p className="mt-1 max-w-3xl text-sm leading-relaxed text-muted-foreground">
            Hermes remains inactive because required approvals, sandbox proof, and quarantine evidence are missing.
            This explanation is preview-only and does not change approvals or activate runtime behavior.
          </p>
        </div>
      </div>

      <div className="mt-4 grid gap-3 xl:grid-cols-3">
        <ListBlock title="Missing runtime approvals" items={explanation.missingRuntimeApprovals} />
        <ListBlock title="Unresolved risks" items={explanation.unresolvedRisks} />
        <ListBlock title="Sandbox requirements" items={explanation.sandboxRequirements} />
      </div>

      <div className="mt-4 flex flex-wrap gap-2">
        <StatusBadge value="warning" label={`skill quarantine: ${explanation.skillQuarantineStatus}`} />
        <StatusBadge value="fail" label="runtime activation blocked" />
      </div>
    </section>
  )
}

function ListBlock({ title, items }: { title: string; items: string[] }) {
  return (
    <article className="rounded-lg border border-border bg-background/70 p-3">
      <h3 className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">{title}</h3>
      <ul className="mt-2 flex flex-col gap-2 text-sm text-muted-foreground">
        {items.map((item) => (
          <li key={item} className="leading-relaxed">
            {item}
          </li>
        ))}
      </ul>
    </article>
  )
}
