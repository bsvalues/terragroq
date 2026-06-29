"use client"

import { useState } from "react"
import { FlaskConical, LockKeyhole } from "lucide-react"
import {
  buildBrainCouncilHypothesisEditorPreview,
  getDefaultBrainCouncilEditableHypotheses,
  type BrainCouncilEditableHypothesis,
} from "@/components/brain-council/brain-council-hypothesis-editor"
import { StatusBadge } from "@/components/status-badge"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"

export function BrainCouncilHypothesisEditorPanel() {
  const [hypotheses, setHypotheses] = useState<BrainCouncilEditableHypothesis[]>(() =>
    getDefaultBrainCouncilEditableHypotheses(),
  )
  const preview = buildBrainCouncilHypothesisEditorPreview(hypotheses)

  function updateHypothesis(id: string, patch: Partial<BrainCouncilEditableHypothesis>) {
    setHypotheses((current) =>
      current.map((hypothesis) => (hypothesis.id === id ? { ...hypothesis, ...patch } : hypothesis)),
    )
  }

  return (
    <section className="rounded-2xl border border-border bg-card p-4">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex items-start gap-3">
          <FlaskConical className="mt-0.5 h-5 w-5 text-primary" aria-hidden />
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-sm font-medium">Hypothesis editor</h2>
              <StatusBadge value={preview.readyForDecisionPacket ? "pass" : "partial"} label={preview.readyForDecisionPacket ? "decision ready" : "needs ranking"} />
              <StatusBadge value="neutral" label="local preview" />
            </div>
            <p className="mt-1 text-sm leading-relaxed text-muted-foreground">
              Adjust rank, confidence, and wording before a decision packet is prepared.
              These edits are local preview state and do not alter canonical Brain Council data.
            </p>
          </div>
        </div>
      </div>

      <div className="mt-4 grid gap-3">
        {preview.hypotheses.map((hypothesis) => (
          <article key={hypothesis.id} className="rounded-xl border border-border bg-background/50 p-4">
            <div className="grid gap-3 md:grid-cols-[7rem_8rem_1fr]">
              <Field id={`${hypothesis.id}-rank`} label="Rank">
                <Input
                  id={`${hypothesis.id}-rank`}
                  type="number"
                  min={1}
                  value={hypothesis.rank}
                  onChange={(event) => updateHypothesis(hypothesis.id, { rank: Number(event.target.value) })}
                />
              </Field>
              <Field id={`${hypothesis.id}-confidence`} label="Confidence">
                <Input
                  id={`${hypothesis.id}-confidence`}
                  type="number"
                  min={0}
                  max={100}
                  value={hypothesis.confidence}
                  onChange={(event) => updateHypothesis(hypothesis.id, { confidence: Number(event.target.value) })}
                />
              </Field>
              <Field id={`${hypothesis.id}-title`} label="Title">
                <Input
                  id={`${hypothesis.id}-title`}
                  value={hypothesis.title}
                  onChange={(event) => updateHypothesis(hypothesis.id, { title: event.target.value })}
                />
              </Field>
            </div>
            <div className="mt-3">
              <Field id={`${hypothesis.id}-claim`} label="Claim">
                <Textarea
                  id={`${hypothesis.id}-claim`}
                  rows={2}
                  value={hypothesis.claim}
                  onChange={(event) => updateHypothesis(hypothesis.id, { claim: event.target.value })}
                />
              </Field>
            </div>
          </article>
        ))}
      </div>

      <div className="mt-4 flex items-start gap-2 rounded-lg border border-warning/30 bg-warning/10 p-3">
        <LockKeyhole className="mt-0.5 h-4 w-4 shrink-0 text-warning" aria-hidden />
        <p className="text-sm leading-relaxed text-muted-foreground">
          Hypothesis edits are not persisted and do not change the decision packet,
          Brain Council manifests, worker packets, or any execution authority.
        </p>
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
