import { Link2, ShieldCheck } from "lucide-react"
import { getCouncilTraceEvidenceModel } from "@/components/brain-council/council-trace-evidence-link-model"
import { StatusBadge } from "@/components/status-badge"

export function CouncilTraceEvidenceLinkPanel() {
  const model = getCouncilTraceEvidenceModel()

  return (
    <section className="overflow-hidden rounded-xl border border-border bg-card">
      <div className="border-b border-border bg-muted/30 px-4 py-3">
        <div className="flex flex-wrap items-center gap-2">
          <Link2 className="h-4 w-4 text-primary" aria-hidden={true} />
          <p className="font-mono text-[11px] uppercase tracking-[0.22em] text-muted-foreground">
            Trace and evidence links
          </p>
        </div>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <h2 className="text-lg font-semibold tracking-tight">{model.title}</h2>
          <StatusBadge value="pass" label="model only" />
          <StatusBadge value="neutral" label="evidence-linked" />
          <StatusBadge value="pass" label="no ledger write" />
        </div>
        <p className="mt-1 max-w-3xl text-sm leading-relaxed text-muted-foreground">
          {model.summary}
        </p>
      </div>

      <div className="grid gap-3 p-4 md:grid-cols-2 xl:grid-cols-5">
        {model.requiredLinkTypes.map((type) => (
          <div key={type} className="rounded-lg border border-border bg-background p-3">
            <p className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
              required link
            </p>
            <p className="mt-2 text-sm font-semibold">{type}</p>
          </div>
        ))}
      </div>

      <div className="grid gap-3 border-t border-border bg-muted/10 p-4 lg:grid-cols-2">
        {model.links.map((link) => (
          <div key={link.id} className="rounded-lg border border-border bg-background p-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <p className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
                  {link.type}
                </p>
                <p className="mt-1 text-sm font-semibold">{link.label}</p>
              </div>
              <StatusBadge value={link.posture === "verified" ? "pass" : "neutral"} label={link.posture} />
            </div>
            <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
              Source: {link.source}
            </p>
            <p className="mt-2 text-sm leading-relaxed">{link.claim}</p>
            <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
              Evidence: {link.evidence}
            </p>
          </div>
        ))}
      </div>

      <div className="flex items-start gap-2 border-t border-border px-4 py-3">
        <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-primary" aria-hidden={true} />
        <p className="text-xs leading-relaxed text-muted-foreground">
          Trace links are read-only references. This model does not write a trace ledger,
          mutate evidence, start verification, grant authority, or write production data.
        </p>
      </div>
    </section>
  )
}
