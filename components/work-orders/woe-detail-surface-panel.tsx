import Link from "next/link"
import { ClipboardList, ShieldCheck } from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { getWoeDetailSurface } from "@/components/work-orders/woe-detail-surface"

export function WoeDetailSurfacePanel() {
  const surface = getWoeDetailSurface()

  return (
    <section className="overflow-hidden rounded-xl border border-border bg-card">
      <div className="border-b border-border bg-muted/30 px-4 py-3">
        <div className="flex flex-wrap items-center gap-2">
          <ClipboardList className="h-4 w-4 text-primary" aria-hidden />
          <p className="font-mono text-[11px] uppercase tracking-[0.22em] text-muted-foreground">
            WilliamOS WOE Detail
          </p>
        </div>
        <h2 className="mt-2 text-lg font-semibold tracking-tight">{surface.title}</h2>
        <p className="mt-1 max-w-3xl text-sm leading-relaxed text-muted-foreground">
          {surface.description}
        </p>
      </div>

      <div className="grid gap-3 p-4 lg:grid-cols-3">
        <DetailCard title="Goal" value={surface.goal.label} body={surface.goal.purpose} />
        <DetailCard title="Batch" value={surface.batch.name} body={surface.batch.nextRecommendedBatch} />
        <DetailCard title="Work Order" value={surface.workOrder.id} body={surface.workOrder.goal} />
      </div>

      <div className="grid gap-3 border-t border-border p-4 lg:grid-cols-2">
        <div className="rounded-lg border border-border bg-background p-3">
          <p className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
            Blocked decision
          </p>
          <p className="mt-2 text-sm font-semibold">{surface.blockedDecision.blocker}</p>
          <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
            {surface.blockedDecision.whyBlocked}
          </p>
          <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
            Safe next: {surface.blockedDecision.safeNextAction}
          </p>
        </div>
        <div className="rounded-lg border border-border bg-background p-3">
          <p className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
            Completion report fields
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            {surface.reportFields.map((field) => (
              <Badge key={field} variant="outline">{field}</Badge>
            ))}
          </div>
        </div>
      </div>

      <div className="grid gap-3 border-t border-border p-4 lg:grid-cols-2">
        <div className="rounded-lg border border-border bg-background p-3">
          <p className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
            Evidence links
          </p>
          <div className="mt-3 grid gap-2">
            {surface.workOrder.evidence.map((item) => (
              <Link
                key={item.label}
                href={item.href}
                className="rounded-md border border-border bg-card px-3 py-2 transition-colors hover:border-primary/40"
              >
                <p className="text-xs font-medium">{item.label}</p>
                <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{item.description}</p>
              </Link>
            ))}
          </div>
        </div>
        <div className="rounded-lg border border-border bg-background p-3">
          <p className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
            Safety posture
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            {surface.safetyBadges.map((badge) => (
              <Badge key={badge} variant="secondary">{badge}</Badge>
            ))}
          </div>
        </div>
      </div>

      <div className="grid gap-3 border-t border-border p-4 md:grid-cols-4">
        {surface.navigation.map((item) => (
          <Link
            key={item.label}
            href={item.href}
            className="rounded-lg border border-border bg-background p-3 transition-colors hover:border-primary/40"
          >
            <p className="text-sm font-semibold">{item.label}</p>
            <p className="mt-2 text-xs leading-relaxed text-muted-foreground">{item.description}</p>
          </Link>
        ))}
      </div>

      <div className="flex items-center gap-2 border-t border-border px-4 py-3 text-xs text-muted-foreground">
        <ShieldCheck className="h-3.5 w-3.5 text-primary" aria-hidden />
        Read-only WOE detail surface. No run buttons, execution, GitHub writes, Codex automation,
        metadata expansion, scheduler, persistence, LAN exposure, or autonomy.
      </div>
    </section>
  )
}

function DetailCard({ title, value, body }: { title: string; value: string; body: string }) {
  return (
    <div className="rounded-lg border border-border bg-background p-3">
      <p className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
        {title}
      </p>
      <p className="mt-2 text-sm font-semibold">{value}</p>
      <p className="mt-2 text-xs leading-relaxed text-muted-foreground">{body}</p>
    </div>
  )
}
