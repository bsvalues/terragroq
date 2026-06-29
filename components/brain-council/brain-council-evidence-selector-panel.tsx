"use client"

import { useState } from "react"
import { FolderSearch, LockKeyhole } from "lucide-react"
import {
  buildBrainCouncilEvidenceSelectionPreview,
  getBrainCouncilSelectableEvidence,
} from "@/components/brain-council/brain-council-evidence-selector"
import { StatusBadge } from "@/components/status-badge"

export function BrainCouncilEvidenceSelectorPanel() {
  const defaultEvidence = getBrainCouncilSelectableEvidence()
  const [selectedIds, setSelectedIds] = useState(() =>
    defaultEvidence.filter((item) => item.selectedByDefault).map((item) => item.id),
  )
  const preview = buildBrainCouncilEvidenceSelectionPreview(selectedIds)

  function toggleEvidence(id: string) {
    setSelectedIds((current) =>
      current.includes(id) ? current.filter((item) => item !== id) : [...current, id],
    )
  }

  return (
    <section className="rounded-2xl border border-border bg-card p-4">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex items-start gap-3">
          <FolderSearch className="mt-0.5 h-5 w-5 text-primary" aria-hidden />
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-sm font-medium">Evidence selector</h2>
              <StatusBadge value={preview.readyForReasoning ? "pass" : "partial"} label={`${preview.selectedCount} selected`} />
              <StatusBadge value="neutral" label="local preview" />
            </div>
            <p className="mt-1 text-sm leading-relaxed text-muted-foreground">
              Choose which existing evidence signals should feed the reasoning packet.
              Selection is local UI state only: no ingestion, search, database write, or export occurs.
            </p>
          </div>
        </div>
      </div>

      <div className="mt-4 grid gap-3">
        {preview.evidence.map((item) => {
          const selected = preview.selectedIds.includes(item.id)
          return (
            <button
              key={item.id}
              type="button"
              aria-pressed={selected}
              onClick={() => toggleEvidence(item.id)}
              className={`rounded-xl border p-4 text-left transition-colors ${
                selected
                  ? "border-primary/40 bg-primary/10"
                  : "border-border bg-background/50 hover:border-primary/30"
              }`}
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h3 className="text-sm font-medium">{item.label}</h3>
                <span className="font-mono text-[10px] text-muted-foreground">{item.source}</span>
              </div>
              <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{item.summary}</p>
            </button>
          )
        })}
      </div>

      <div className="mt-4 flex items-start gap-2 rounded-lg border border-warning/30 bg-warning/10 p-3">
        <LockKeyhole className="mt-0.5 h-4 w-4 shrink-0 text-warning" aria-hidden />
        <p className="text-sm leading-relaxed text-muted-foreground">
          Evidence selection does not create evidence, mutate storage, call retrieval,
          or change the decision packet. It only previews which existing signals
          would be carried forward.
        </p>
      </div>
    </section>
  )
}
