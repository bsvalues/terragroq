"use client"

import { useState } from "react"
import { PenLine, RotateCcw } from "lucide-react"
import {
  AVAILABLE_BRAIN_CHOICES,
  buildBrainCouncilInputComposerPreview,
  getDefaultBrainCouncilInputDraft,
  type BrainCouncilInputDraft,
} from "@/components/brain-council/brain-council-input-composer"
import { StatusBadge } from "@/components/status-badge"
import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"

export function BrainCouncilInputComposerPanel() {
  const [draft, setDraft] = useState<BrainCouncilInputDraft>(() => getDefaultBrainCouncilInputDraft())
  const preview = buildBrainCouncilInputComposerPreview(draft)

  function updateDraft(patch: Partial<BrainCouncilInputDraft>) {
    setDraft((current) => ({ ...current, ...patch }))
  }

  function toggleBrain(brain: string) {
    setDraft((current) => ({
      ...current,
      selectedBrains: current.selectedBrains.includes(brain)
        ? current.selectedBrains.filter((item) => item !== brain)
        : [...current.selectedBrains, brain],
    }))
  }

  return (
    <section className="rounded-2xl border border-border bg-card p-4">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex items-start gap-3">
          <PenLine className="mt-0.5 h-5 w-5 text-primary" aria-hidden />
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-sm font-medium">Reasoning input composer</h2>
              <StatusBadge value={preview.readyForReasoningPreview ? "pass" : "partial"} label={preview.readyForReasoningPreview ? "preview ready" : "needs input"} />
              <StatusBadge value="neutral" label={preview.packetMode} />
            </div>
            <p className="mt-1 text-sm leading-relaxed text-muted-foreground">
              Shape the question Brain Council should reason about. This composer
              is local preview state only: it does not save, send, execute, dispatch,
              or create a work order.
            </p>
          </div>
        </div>
        <Button variant="outline" size="sm" onClick={() => setDraft(getDefaultBrainCouncilInputDraft())}>
          <RotateCcw className="h-3.5 w-3.5" />
          Reset preview
        </Button>
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-[1fr_0.85fr]">
        <div className="flex flex-col gap-4">
          <Field id="brain-council-question" label="Question">
            <Textarea
              id="brain-council-question"
              value={draft.question}
              onChange={(event) => updateDraft({ question: event.target.value })}
              rows={3}
            />
          </Field>
          <Field id="brain-council-context" label="Context">
            <Textarea
              id="brain-council-context"
              value={draft.context}
              onChange={(event) => updateDraft({ context: event.target.value })}
              rows={3}
            />
          </Field>
          <Field id="brain-council-desired-output" label="Desired output">
            <Textarea
              id="brain-council-desired-output"
              value={draft.desiredOutput}
              onChange={(event) => updateDraft({ desiredOutput: event.target.value })}
              rows={2}
            />
          </Field>
        </div>

        <div className="rounded-xl border border-border bg-background/50 p-3">
          <h3 className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
            Selected brains
          </h3>
          <div className="mt-3 flex flex-col gap-2">
            {AVAILABLE_BRAIN_CHOICES.map((brain) => {
              const selected = draft.selectedBrains.includes(brain)
              return (
                <button
                  key={brain}
                  type="button"
                  aria-pressed={selected}
                  onClick={() => toggleBrain(brain)}
                  className={`rounded-lg border px-3 py-2 text-left text-sm transition-colors ${
                    selected
                      ? "border-primary/40 bg-primary/10 text-foreground"
                      : "border-border bg-card text-muted-foreground hover:border-primary/30"
                  }`}
                >
                  {brain}
                </button>
              )
            })}
          </div>

          <div className="mt-4 rounded-lg border border-warning/30 bg-warning/10 p-3">
            <h3 className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
              Safety
            </h3>
            <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
              Read-only {String(preview.safety.readOnly)} · execute {String(preview.safety.wouldExecute)}
              · persist {String(preview.safety.persistenceEnabled)} · dispatch {String(preview.safety.workerDispatch)}
            </p>
          </div>
        </div>
      </div>
    </section>
  )
}

function Field({ id, label, children }: { id: string; label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-2">
      <Label htmlFor={id}>{label}</Label>
      {children}
    </div>
  )
}
