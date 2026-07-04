import Link from "next/link"
import { FileCheck2, GitBranch, ShieldCheck } from "lucide-react"

import { getEvidenceSpineSurface } from "@/components/evidence/evidence-spine-surface"

function ProofCard({
  label,
  value,
  description,
}: {
  label: string
  value: string
  description: string
}) {
  return (
    <div className="rounded-lg border border-border bg-background p-3">
      <p className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">{label}</p>
      <p className="mt-2 text-sm font-semibold">{value}</p>
      <p className="mt-2 text-xs leading-relaxed text-muted-foreground">{description}</p>
    </div>
  )
}

export function EvidenceSpinePanel() {
  const surface = getEvidenceSpineSurface()

  return (
    <section className="overflow-hidden rounded-xl border border-border bg-card">
      <div className="border-b border-border bg-muted/30 px-4 py-3">
        <div className="flex flex-wrap items-center gap-2">
          <FileCheck2 className="h-4 w-4 text-primary" aria-hidden={true} />
          <p className="font-mono text-[11px] uppercase tracking-[0.22em] text-muted-foreground">
            Evidence Spine
          </p>
        </div>
        <h2 className="mt-2 text-lg font-semibold tracking-tight">{surface.doctrine.title}</h2>
        <p className="mt-1 max-w-3xl text-sm leading-relaxed text-muted-foreground">
          Evidence is the WilliamOS record of reality. It explains what is proven,
          what remains unproven, and what still needs owner authority.
        </p>
      </div>

      <div className="grid gap-3 p-4 lg:grid-cols-[0.85fr_1.15fr]">
        <div className="rounded-lg border border-border bg-background p-4">
          <p className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
            Doctrine
          </p>
          <ul className="mt-3 grid gap-2 text-sm text-muted-foreground">
            {surface.doctrine.statements.map((statement) => (
              <li key={statement} className="rounded-md border border-border bg-card px-3 py-2">
                {statement}
              </li>
            ))}
          </ul>
        </div>

        <div className="rounded-lg border border-border bg-background p-4">
          <p className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
            Evidence Detail
          </p>
          <h3 className="mt-2 text-base font-semibold">{surface.detailRecord.title}</h3>
          <div className="mt-3 grid gap-3 md:grid-cols-2">
            <div>
              <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                What it proves
              </p>
              <p className="mt-1 text-sm leading-relaxed">{surface.detailRecord.proves}</p>
            </div>
            <div>
              <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                What it does not prove
              </p>
              <p className="mt-1 text-sm leading-relaxed">{surface.detailRecord.doesNotProve}</p>
            </div>
          </div>
          <div className="mt-4 grid gap-2 text-xs text-muted-foreground md:grid-cols-2">
            <p>
              <span className="font-medium text-foreground">Related batch:</span>{" "}
              {surface.detailRecord.relatedBatch}
            </p>
            <p>
              <span className="font-medium text-foreground">Related WO:</span>{" "}
              {surface.detailRecord.relatedWorkOrder}
            </p>
            <p>
              <span className="font-medium text-foreground">PR:</span>{" "}
              {surface.detailRecord.relatedPr}
            </p>
            <p>
              <span className="font-medium text-foreground">Source:</span>{" "}
              {surface.detailRecord.sourcePath}
            </p>
          </div>
        </div>
      </div>

      <div className="border-t border-border p-4">
        <p className="text-sm font-medium">Evidence categories</p>
        <div className="mt-3 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          {surface.categories.map((category) => (
            <div key={category.id} className="rounded-lg border border-border bg-background p-3">
              <p className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
                {category.id}
              </p>
              <p className="mt-2 text-sm font-semibold">{category.label}</p>
              <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
                {category.description}
              </p>
            </div>
          ))}
        </div>
      </div>

      <div className="border-t border-border p-4">
        <p className="text-sm font-medium">Recent evidence records</p>
        <div className="mt-3 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          {surface.recentEvidence.map((record) => (
            <div key={record.evidenceId} className="rounded-lg border border-border bg-background p-3">
              <p className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
                {record.type}
              </p>
              <p className="mt-2 text-sm font-semibold">{record.title}</p>
              <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
                {record.proofSummary}
              </p>
              <p className="mt-3 text-[11px] text-muted-foreground">{record.sourcePath}</p>
            </div>
          ))}
        </div>
      </div>

      <div className="grid gap-4 border-t border-border p-4 xl:grid-cols-2">
        <div>
          <p className="text-sm font-medium">Validation proof</p>
          <div className="mt-3 grid gap-3 md:grid-cols-2">
            {surface.validationProofCards.map((card) => (
              <ProofCard key={card.label} {...card} />
            ))}
          </div>
        </div>
        <div>
          <p className="text-sm font-medium">Local proof</p>
          <div className="mt-3 grid gap-3 md:grid-cols-2">
            {surface.localProofCards.map((card) => (
              <ProofCard key={card.label} {...card} />
            ))}
          </div>
        </div>
        <div>
          <p className="text-sm font-medium">Production proof</p>
          <div className="mt-3 grid gap-3 md:grid-cols-2">
            {surface.productionProofCards.map((card) => (
              <ProofCard key={card.label} {...card} />
            ))}
          </div>
        </div>
        <div>
          <p className="text-sm font-medium">Safety proof</p>
          <div className="mt-3 grid gap-3 md:grid-cols-2">
            {surface.safetyProofCards.map((card) => (
              <ProofCard key={card.label} {...card} />
            ))}
          </div>
        </div>
      </div>

      <div className="grid gap-4 border-t border-border p-4 lg:grid-cols-2">
        <div>
          <p className="text-sm font-medium">Blocked decision evidence</p>
          <div className="mt-3 grid gap-2">
            {surface.blockedDecisionEvidenceLinks.map((link) => (
              <div key={link.blocker} className="rounded-lg border border-border bg-background p-3">
                <p className="text-sm font-semibold">{link.blocker}</p>
                <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                  {link.whyBlocked}
                </p>
                <p className="mt-2 font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
                  Evidence: {link.evidenceId}
                </p>
              </div>
            ))}
          </div>
        </div>

        <div>
          <p className="text-sm font-medium">WOE evidence navigation</p>
          <div className="mt-3 grid gap-2">
            {surface.woeNavigation.map((item) => (
              <Link
                key={item.label}
                href={item.href}
                className="rounded-lg border border-border bg-background p-3 transition-colors hover:border-primary/40"
              >
                <p className="text-sm font-semibold">{item.label}</p>
                <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                  {item.description}
                </p>
              </Link>
            ))}
          </div>
        </div>
      </div>

      <div className="flex flex-col gap-3 border-t border-border px-4 py-3 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <div className="flex items-center gap-2">
            <GitBranch className="h-4 w-4 text-primary" aria-hidden={true} />
            <p className="text-sm font-medium">{surface.nextLaneDecision.recommendedBatch}</p>
          </div>
          <p className="mt-1 max-w-3xl text-xs leading-relaxed text-muted-foreground">
            {surface.nextLaneDecision.reason}
          </p>
        </div>
        <div className="inline-flex items-center gap-2 rounded-full border border-border bg-background px-3 py-1.5 text-xs text-muted-foreground">
          <ShieldCheck className="h-3.5 w-3.5 text-primary" aria-hidden={true} />
          Read-only evidence. No ingestion, scan, command runner, metadata expansion, or runtime control.
        </div>
      </div>
    </section>
  )
}
