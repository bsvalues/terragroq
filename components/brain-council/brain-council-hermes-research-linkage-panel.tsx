import { Network } from "lucide-react"
import { getBrainCouncilHermesResearchLinkage } from "@/components/brain-council/brain-council-hermes-research-linkage"
import { StatusBadge } from "@/components/status-badge"

export function BrainCouncilHermesResearchLinkagePanel() {
  const linkage = getBrainCouncilHermesResearchLinkage()

  return (
    <section className="rounded-2xl border border-border bg-card p-4">
      <div className="flex items-start gap-3">
        <Network className="mt-0.5 h-5 w-5 text-primary" aria-hidden />
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-sm font-medium">Hermes research candidate linkage</h2>
            <StatusBadge value="neutral" label={linkage.posture.replace(/_/g, " ")} />
            <StatusBadge value="pass" label="activation: not active" />
          </div>
          <p className="mt-1 max-w-3xl text-sm leading-relaxed text-muted-foreground">
            Candidate Hermes procedures are linked to experiments, risks, and sandbox requirements for review.
            Hermes remains inspectable only; this view does not install, activate, or dispatch it.
          </p>
        </div>
      </div>

      <div className="mt-4 grid gap-3 xl:grid-cols-3">
        {linkage.links.map((link) => (
          <article key={link.candidateProcedure} className="rounded-lg border border-border bg-background/60 p-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h3 className="text-sm font-medium">{link.candidateProcedure}</h3>
              <StatusBadge value="pass" label={link.activationStatus} />
            </div>
            <dl className="mt-3 grid gap-2 text-sm">
              <Field label="Experiment" value={link.linkedExperiment} />
              <Field label="Risk" value={link.linkedRisk} />
              <Field label="Sandbox requirement" value={link.linkedSandboxRequirement} />
            </dl>
          </article>
        ))}
      </div>
    </section>
  )
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">{label}</dt>
      <dd className="mt-1 leading-relaxed text-muted-foreground">{value}</dd>
    </div>
  )
}
