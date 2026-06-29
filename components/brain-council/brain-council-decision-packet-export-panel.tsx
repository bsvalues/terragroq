"use client"

import { useState } from "react"
import { Clipboard, FileDown, LockKeyhole } from "lucide-react"
import { getBrainCouncilDecisionPacketExportPreview } from "@/components/brain-council/brain-council-decision-packet-export"
import { StatusBadge } from "@/components/status-badge"
import { Button } from "@/components/ui/button"

export function BrainCouncilDecisionPacketExportPanel() {
  const packet = getBrainCouncilDecisionPacketExportPreview()
  const [copied, setCopied] = useState(false)

  async function copyPreview() {
    if (!navigator.clipboard) return
    await navigator.clipboard.writeText(packet.body)
    setCopied(true)
    window.setTimeout(() => setCopied(false), 1800)
  }

  return (
    <section className="rounded-2xl border border-border bg-card p-4">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex items-start gap-3">
          <FileDown className="mt-0.5 h-5 w-5 text-primary" aria-hidden />
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-sm font-medium">Decision packet export</h2>
              <StatusBadge value="pass" label={packet.format} />
              <StatusBadge value="neutral" label={`${packet.lineCount} lines`} />
            </div>
            <p className="mt-1 text-sm leading-relaxed text-muted-foreground">
              Preview a Markdown packet for handoff. Copying is local clipboard
              output only; this panel does not write files, create issues, send
              network requests, or dispatch workers.
            </p>
          </div>
        </div>
        <Button variant="outline" size="sm" onClick={copyPreview}>
          <Clipboard className="h-3.5 w-3.5" />
          {copied ? "Copied preview" : "Copy preview"}
        </Button>
      </div>

      <pre className="mt-4 max-h-96 overflow-auto rounded-xl border border-border bg-background/60 p-4 text-xs leading-relaxed text-muted-foreground">
        {packet.body}
      </pre>

      <div className="mt-4 flex items-start gap-2 rounded-lg border border-warning/30 bg-warning/10 p-3">
        <LockKeyhole className="mt-0.5 h-4 w-4 shrink-0 text-warning" aria-hidden />
        <p className="text-sm leading-relaxed text-muted-foreground">
          Export preview is not persistence or dispatch. File writes, network
          sends, worker launch, autonomy, and production writes remain disabled.
        </p>
      </div>
    </section>
  )
}
