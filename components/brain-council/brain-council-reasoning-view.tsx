import { ArrowRight, BrainCircuit, FlaskConical, LockKeyhole, ShieldCheck } from "lucide-react"
import { BrainCouncilDecisionPacketExportPanel } from "@/components/brain-council/brain-council-decision-packet-export-panel"
import { BrainCouncilEvidenceSelectorPanel } from "@/components/brain-council/brain-council-evidence-selector-panel"
import { BrainCouncilExperimentDashboard } from "@/components/brain-council/brain-council-experiment-dashboard"
import { BrainCouncilHermesBoundaryPreviewPanel } from "@/components/brain-council/brain-council-hermes-boundary-preview"
import { BrainCouncilHermesCapabilityMapPanel } from "@/components/brain-council/brain-council-hermes-capability-map-panel"
import { BrainCouncilHermesInventoryPanel } from "@/components/brain-council/brain-council-hermes-inventory-panel"
import { BrainCouncilHermesExperimentPlanPanel } from "@/components/brain-council/brain-council-hermes-experiment-plan-panel"
import { BrainCouncilHermesRiskRegisterPanel } from "@/components/brain-council/brain-council-hermes-risk-register-panel"
import { BrainCouncilHypothesisEditorPanel } from "@/components/brain-council/brain-council-hypothesis-editor-panel"
import { BrainCouncilInputComposerPanel } from "@/components/brain-council/brain-council-input-composer-panel"
import { BrainCouncilProcedureCandidateViewer } from "@/components/brain-council/brain-council-procedure-candidate-viewer"
import { BrainCouncilReadinessEvaluator } from "@/components/brain-council/brain-council-readiness-evaluator"
import { BrainCouncilWorkerPacketPreview } from "@/components/brain-council/brain-council-worker-packet-preview"
import { getBrainCouncilReasoningPacket } from "@/components/brain-council/brain-council-reasoning"
import { StatusBadge } from "@/components/status-badge"

export function BrainCouncilReasoningView() {
  const packet = getBrainCouncilReasoningPacket()
  const topHypothesis = packet.hypotheses.find((hypothesis) => hypothesis.id === packet.ranking[0])

  return (
    <div className="flex flex-col gap-6 p-6">
      <section className="overflow-hidden rounded-2xl border border-border bg-card">
        <div className="grid gap-0 lg:grid-cols-[1.05fr_0.95fr]">
          <div className="border-b border-border p-5 lg:border-b-0 lg:border-r">
            <div className="flex flex-wrap items-center gap-2">
              <StatusBadge value="pass" label="read-only" />
              <StatusBadge value="neutral" label="reasoning preview" />
              <StatusBadge value="pass" label="autonomy disabled" />
            </div>
            <h2 className="mt-5 max-w-3xl text-balance text-2xl font-semibold leading-tight">
              {packet.question}
            </h2>
            <p className="mt-3 max-w-2xl text-sm leading-relaxed text-muted-foreground">
              Brain Council is now visible. This view makes it useful by showing the
              operator how a question is decomposed into evidence, unknowns,
              hypotheses, confidence, verification, and a bounded decision packet.
            </p>
          </div>

          <div className="bg-muted/25 p-5">
            <div className="flex items-center gap-2">
              <BrainCircuit className="h-4 w-4 text-primary" aria-hidden />
              <h3 className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
                Selected brains
              </h3>
            </div>
            <div className="mt-4 grid gap-2">
              {packet.selectedBrains.map((brain) => (
                <div key={brain} className="rounded-lg border border-border bg-background/60 px-3 py-2 text-sm">
                  {brain}
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      <BrainCouncilInputComposerPanel />

      <BrainCouncilEvidenceSelectorPanel />

      <BrainCouncilHypothesisEditorPanel />

      <div className="grid gap-6 xl:grid-cols-[0.95fr_1.05fr]">
        <section className="rounded-xl border border-border bg-card p-4">
          <div className="flex items-center gap-2">
            <ShieldCheck className="h-4 w-4 text-success" aria-hidden />
            <h2 className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
              Evidence ledger
            </h2>
          </div>
          <div className="mt-4 flex flex-col gap-3">
            {packet.evidence.map((item) => (
              <div key={item.label} className="rounded-lg border border-border bg-background/50 p-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <h3 className="text-sm font-medium">{item.label}</h3>
                  <span className="font-mono text-[10px] text-muted-foreground">{item.source}</span>
                </div>
                <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{item.summary}</p>
              </div>
            ))}
          </div>
        </section>

        <section className="rounded-xl border border-border bg-card p-4">
          <div className="flex items-center gap-2">
            <FlaskConical className="h-4 w-4 text-primary" aria-hidden />
            <h2 className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
              Hypothesis ranking
            </h2>
          </div>
          <div className="mt-4 flex flex-col gap-3">
            {packet.hypotheses.map((hypothesis, index) => (
              <div key={hypothesis.id} className="rounded-lg border border-border bg-background/50 p-3">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <p className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
                      Rank {index + 1}
                    </p>
                    <h3 className="mt-1 text-sm font-medium">{hypothesis.title}</h3>
                  </div>
                  <StatusBadge value="neutral" label={`${Math.round(hypothesis.confidence * 100)}% confidence`} />
                </div>
                <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{hypothesis.claim}</p>
                <p className="mt-2 text-xs leading-relaxed text-muted-foreground">{hypothesis.rationale}</p>
              </div>
            ))}
          </div>
        </section>
      </div>

      <div className="grid gap-6 xl:grid-cols-[0.9fr_1.1fr]">
        <section className="rounded-xl border border-warning/30 bg-warning/10 p-4">
          <div className="flex items-center gap-2">
            <LockKeyhole className="h-4 w-4 text-warning" aria-hidden />
            <h2 className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
              Unknowns before action
            </h2>
          </div>
          <ul className="mt-4 flex flex-col gap-2">
            {packet.unknowns.map((unknown) => (
              <li key={unknown} className="rounded-lg border border-warning/30 bg-background/50 px-3 py-2 text-sm">
                {unknown}
              </li>
            ))}
          </ul>
        </section>

        <section className="rounded-xl border border-primary/25 bg-primary/5 p-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="text-sm font-medium">Decision packet</h2>
              <p className="mt-1 text-sm text-muted-foreground">{packet.decisionPacket.verdict}</p>
            </div>
            <StatusBadge value="pass" label={`${Math.round(packet.confidence * 100)}% confidence`} />
          </div>
          {topHypothesis && (
            <p className="mt-3 rounded-lg border border-border bg-background/50 p-3 text-sm leading-relaxed text-muted-foreground">
              Leading hypothesis: <span className="text-foreground">{topHypothesis.title}</span>
            </p>
          )}
          <div className="mt-4 grid gap-3 md:grid-cols-2">
            <div>
              <h3 className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
                Required verification
              </h3>
              <ul className="mt-2 flex flex-col gap-1.5 text-sm text-muted-foreground">
                {packet.decisionPacket.requiredVerification.map((item) => (
                  <li key={item} className="flex gap-2">
                    <ArrowRight className="mt-0.5 h-3.5 w-3.5 shrink-0 text-primary" aria-hidden />
                    <span>{item}</span>
                  </li>
                ))}
              </ul>
            </div>
            <div>
              <h3 className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
                Blocked actions
              </h3>
              <div className="mt-2 flex flex-wrap gap-1.5">
                {packet.decisionPacket.blockedActions.map((action) => (
                  <span
                    key={action}
                    className="rounded-full border border-destructive/25 bg-destructive/10 px-2 py-1 font-mono text-[10px] text-destructive"
                  >
                    {action}
                  </span>
                ))}
              </div>
            </div>
          </div>
          <p className="mt-4 rounded-lg border border-border bg-background/50 p-3 text-sm leading-relaxed">
            Next action: {packet.decisionPacket.nextAction}
          </p>
        </section>
      </div>

      <section className="rounded-xl border border-border bg-card p-4">
        <h2 className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
          Safety posture
        </h2>
        <div className="mt-3 grid gap-3 md:grid-cols-5">
          <SafetyTile label="Read-only" value={packet.safety.readOnly ? "yes" : "no"} />
          <SafetyTile label="Would execute" value={packet.safety.wouldExecute ? "yes" : "no"} />
          <SafetyTile label="Autonomy" value={packet.safety.autonomyEnabled ? "enabled" : "disabled"} />
          <SafetyTile label="MCP" value={packet.safety.mcpActivation ? "active" : "disabled"} />
          <SafetyTile label="Production write" value={packet.safety.productionWrite ? "enabled" : "disabled"} />
        </div>
      </section>

      <BrainCouncilReadinessEvaluator />

      <BrainCouncilExperimentDashboard />

      <BrainCouncilProcedureCandidateViewer />

      <BrainCouncilWorkerPacketPreview />

      <BrainCouncilDecisionPacketExportPanel />

      <BrainCouncilHermesBoundaryPreviewPanel />

      <BrainCouncilHermesInventoryPanel />

      <BrainCouncilHermesCapabilityMapPanel />

      <BrainCouncilHermesRiskRegisterPanel />

      <BrainCouncilHermesExperimentPlanPanel />
    </div>
  )
}

function SafetyTile({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-border bg-background/50 p-3">
      <div className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
        {label}
      </div>
      <div className="mt-2 text-sm font-medium">{value}</div>
    </div>
  )
}
