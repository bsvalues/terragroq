import Link from "next/link"
import { ClipboardCheck, FileCheck2, ShieldCheck } from "lucide-react"
import { getEvidenceCommandSurface } from "@/components/evidence/evidence-command-surface"
import { VerificationFlowGrid } from "@/components/shell/verification-flow-grid"

export function EvidenceCommandPanel() {
  const surface = getEvidenceCommandSurface()

  return (
    <section className="overflow-hidden rounded-xl border border-border bg-card">
      <div className="border-b border-border bg-muted/30 px-4 py-3">
        <div className="flex flex-wrap items-center gap-2">
          <FileCheck2 className="h-4 w-4 text-primary" aria-hidden={true} />
          <p className="font-mono text-[11px] uppercase tracking-[0.22em] text-muted-foreground">
            {surface.eyebrow}
          </p>
        </div>
        <h2 className="mt-2 text-lg font-semibold tracking-tight">{surface.title}</h2>
        <p className="mt-1 max-w-3xl text-sm leading-relaxed text-muted-foreground">
          {surface.description}
        </p>
      </div>

      <VerificationFlowGrid steps={surface.verificationFlow} />

      <div className="grid gap-3 p-4 md:grid-cols-2 xl:grid-cols-5">
        {surface.categories.map((category) => (
          <Link
            key={category.label}
            href={category.href}
            className="rounded-lg border border-border bg-background p-3 transition-colors hover:border-primary/40"
          >
            <p className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
              {category.status}
            </p>
            <p className="mt-2 text-sm font-semibold">{category.label}</p>
            <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
              {category.description}
            </p>
          </Link>
        ))}
      </div>

      <div className="flex flex-col gap-3 border-t border-border px-4 py-3 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <div className="flex items-center gap-2">
            <ClipboardCheck className="h-4 w-4 text-primary" aria-hidden={true} />
            <p className="text-sm font-medium">Next Recommended WO</p>
          </div>
          <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
            {surface.nextRecommendedWo.label}: {surface.nextRecommendedWo.reason}
          </p>
        </div>
        <div className="inline-flex items-center gap-2 rounded-full border border-border bg-background px-3 py-1.5 text-xs text-muted-foreground">
          <ShieldCheck className="h-3.5 w-3.5 text-primary" aria-hidden={true} />
          Evidence is read-only. No execution, deploy, authority grant, or production write.
        </div>
      </div>
    </section>
  )
}
