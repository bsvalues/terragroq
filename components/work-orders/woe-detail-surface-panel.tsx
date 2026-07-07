import Link from "next/link"
import { ClipboardList, Compass, FileSearch, Route, Search, ShieldCheck } from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { getWoeDetailSurface } from "@/components/work-orders/woe-detail-surface"

export function WoeDetailSurfacePanel() {
  const surface = getWoeDetailSurface()

  return (
    <section className="overflow-hidden rounded-xl border border-border bg-card">
      <div className="border-b border-border bg-muted/30 px-4 py-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <ClipboardList className="h-4 w-4 text-primary" aria-hidden />
              <p className="font-mono text-[11px] uppercase tracking-[0.22em] text-muted-foreground">
                Primary WOE map
              </p>
            </div>
            <h2 className="mt-2 text-lg font-semibold tracking-tight">{surface.title}</h2>
          </div>
          <Badge variant="secondary">{surface.polish.posture}</Badge>
        </div>
        <p className="mt-1 max-w-3xl text-sm leading-relaxed text-muted-foreground">
          {surface.description}
        </p>
        <p className="mt-2 max-w-3xl text-sm leading-relaxed text-foreground">
          {surface.polish.primarySignal}
        </p>
      </div>

      <div className="grid gap-2 border-b border-border p-4 md:grid-cols-5">
        {surface.polish.operatingMap.map((item) => (
          <div key={item.label} className="rounded-lg border border-border bg-background p-3">
            <div className="flex items-center gap-2">
              <Compass className="h-3.5 w-3.5 text-primary" aria-hidden />
              <p className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">{item.label}</p>
            </div>
            <p className="mt-2 text-sm font-semibold">{item.value}</p>
            <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{item.description}</p>
          </div>
        ))}
      </div>

      <div className="grid gap-3 p-4 lg:grid-cols-3">
        <DetailCard title="Goal" value={`${surface.goal.id} - ${surface.goal.label}`} body={surface.goal.purpose} />
        <DetailCard title="Next lane" value={surface.batch.nextRecommendedBatch} body={surface.goal.nextRecommendedWork} />
        <DetailCard title="Work Order" value={surface.workOrder.id} body={surface.workOrder.goal} />
      </div>

      <div className="border-t border-border p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="flex items-center gap-2">
              <FileSearch className="h-3.5 w-3.5 text-primary" aria-hidden />
              <p className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
                Evidence clarity
              </p>
            </div>
            <p className="mt-2 text-sm font-semibold">{surface.evidenceClarity.batch}</p>
            <p className="mt-1 max-w-3xl text-xs leading-relaxed text-muted-foreground">
              Proof is grouped by Work Order, evidence signal, production verification, review state, safety flag, and missing proof.
            </p>
          </div>
          <Badge variant="secondary">{surface.evidenceClarity.posture}</Badge>
        </div>
        <div className="mt-4 grid gap-3 lg:grid-cols-4">
          {surface.evidenceClarity.proofChain.map((item) => (
            <Link
              key={item.label}
              href={item.href}
              className="rounded-lg border border-border bg-background p-3 transition-colors hover:border-primary/40"
            >
              <p className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
                {item.workOrder}
              </p>
              <p className="mt-2 text-sm font-semibold">{item.label}</p>
              <p className="mt-2 text-xs leading-relaxed text-muted-foreground">{item.evidence}</p>
              <p className="mt-2 text-xs leading-relaxed text-foreground">{item.proofSignal}</p>
            </Link>
          ))}
        </div>
      </div>

      <div className="grid gap-3 border-t border-border p-4 lg:grid-cols-3">
        <SectionCard
          title={surface.goalDetail.label}
          eyebrow={surface.goalDetail.nativeSurface}
          body={surface.goalDetail.purpose}
          records={surface.goalDetail.records}
          blocked={surface.goalDetail.blockedPowers}
        />
        <SectionCard
          title={surface.loopDetail.label}
          eyebrow={surface.loopDetail.nativeSurface}
          body={surface.loopDetail.purpose}
          records={surface.loopDetail.records}
          blocked={surface.loopDetail.blockedPowers}
        />
        <SectionCard
          title={surface.evidenceRollup.label}
          eyebrow={surface.evidenceRollup.nativeSurface}
          body={surface.evidenceRollup.purpose}
          records={surface.evidenceRollup.records}
          blocked={surface.evidenceRollup.blockedPowers}
        />
      </div>

      <div className="grid gap-3 border-t border-border p-4 lg:grid-cols-3">
        <QueueCard
          title={surface.activeQueue.label}
          body={surface.activeQueue.purpose}
          states={surface.activeQueue.includedStates}
          blocked={surface.activeQueue.excludedPowers}
        />
        <QueueCard
          title={surface.blockedQueue.label}
          body={surface.blockedQueue.purpose}
          states={surface.blockedQueue.includedStates}
          blocked={surface.blockedQueue.excludedPowers}
        />
        <SectionCard
          title={surface.completionReport.label}
          eyebrow={surface.completionReport.nativeSurface}
          body={surface.completionReport.purpose}
          records={surface.completionReport.records.slice(0, 8)}
          blocked={surface.completionReport.blockedPowers}
        />
      </div>

      <div className="grid gap-3 border-t border-border p-4 lg:grid-cols-2">
        <div className="rounded-lg border border-border bg-background p-3">
          <p className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
            Blocked authority
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
          <div className="flex items-center gap-2">
            <Search className="h-3.5 w-3.5 text-primary" aria-hidden />
            <p className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
              Search and filter model
            </p>
          </div>
          <p className="mt-2 text-sm font-semibold">{surface.searchFilter.label}</p>
          <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
            {surface.searchFilter.readOnlyBehavior}
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            {surface.searchFilter.fields.map((field) => (
              <Badge key={field} variant="outline">{field}</Badge>
            ))}
          </div>
        </div>
      </div>

      <div className="grid gap-3 border-t border-border p-4 lg:grid-cols-3">
        <div className="rounded-lg border border-border bg-background p-3">
          <p className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
            Production verification
          </p>
          <div className="mt-3 grid gap-2">
            {surface.evidenceClarity.productionVerification.map((item) => (
              <div key={item.route} className="rounded-md border border-border bg-card px-3 py-2">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="font-mono text-xs font-medium">{item.route}</p>
                  <Badge variant="outline">{item.expected}</Badge>
                </div>
                <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{item.proves}</p>
              </div>
            ))}
          </div>
        </div>
        <div className="rounded-lg border border-border bg-background p-3">
          <p className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
            PR / checks / review
          </p>
          <div className="mt-3 grid gap-2">
            {surface.evidenceClarity.prCheckReviewContext.map((item) => (
              <div key={item.label} className="rounded-md border border-border bg-card px-3 py-2">
                <p className="text-xs font-medium">{item.label}: {item.value}</p>
                <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{item.description}</p>
              </div>
            ))}
          </div>
        </div>
        <div className="rounded-lg border border-border bg-background p-3">
          <p className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
            Missing / blocked proof
          </p>
          <div className="mt-3 grid gap-2">
            {surface.evidenceClarity.proofGaps.map((gap) => (
              <div key={gap.label} className="rounded-md border border-border bg-card px-3 py-2">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="text-xs font-medium">{gap.label}</p>
                  <Badge variant="secondary">{gap.status}</Badge>
                </div>
                <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{gap.nextSafeMove}</p>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="grid gap-3 border-t border-border p-4 md:grid-cols-3">
        {surface.polish.readabilityCues.map((cue) => (
          <div key={cue.label} className="rounded-lg border border-border bg-background p-3">
            <p className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
              Readability cue
            </p>
            <p className="mt-2 text-sm font-semibold">{cue.label}</p>
            <p className="mt-2 text-xs leading-relaxed text-muted-foreground">{cue.description}</p>
          </div>
        ))}
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
          <div className="flex items-center gap-2">
            <Route className="h-3.5 w-3.5 text-primary" aria-hidden />
            <p className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
              Registry coverage
            </p>
          </div>
          <div className="mt-3 grid gap-2 sm:grid-cols-2">
            {surface.registryCoverage.map((item) => (
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
          <div className="mt-3 grid gap-2">
            {surface.evidenceClarity.safetyFlagExplanations.map((item) => (
              <div key={item.flag} className="rounded-md border border-border bg-card px-3 py-2">
                <p className="font-mono text-[10px] uppercase tracking-wider text-foreground">{item.flag}</p>
                <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{item.meaning}</p>
              </div>
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
        Read-only WOE map. It clarifies intent, blockers, proof, and next lane; it does not run work,
        mutate authority, start workers, write production, activate Hermes/MCP, ingest memory, or expose secrets.
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

function SectionCard({
  title,
  eyebrow,
  body,
  records,
  blocked,
}: {
  title: string
  eyebrow: string
  body: string
  records: string[]
  blocked: string[]
}) {
  return (
    <div className="rounded-lg border border-border bg-background p-3">
      <p className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">{eyebrow}</p>
      <p className="mt-2 text-sm font-semibold">{title}</p>
      <p className="mt-2 text-xs leading-relaxed text-muted-foreground">{body}</p>
      <BadgeList label="Records" items={records} />
      <BadgeList label="Blocked" items={blocked} variant="secondary" />
    </div>
  )
}

function QueueCard({
  title,
  body,
  states,
  blocked,
}: {
  title: string
  body: string
  states: string[]
  blocked: string[]
}) {
  return (
    <div className="rounded-lg border border-border bg-background p-3">
      <p className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">Queue</p>
      <p className="mt-2 text-sm font-semibold">{title}</p>
      <p className="mt-2 text-xs leading-relaxed text-muted-foreground">{body}</p>
      <BadgeList label="Includes" items={states} />
      <BadgeList label="Excludes" items={blocked} variant="secondary" />
    </div>
  )
}

function BadgeList({
  label,
  items,
  variant = "outline",
}: {
  label: string
  items: string[]
  variant?: "outline" | "secondary"
}) {
  return (
    <div className="mt-3">
      <p className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">{label}</p>
      <div className="mt-2 flex flex-wrap gap-2">
        {items.map((item) => (
          <Badge key={item} variant={variant}>{item}</Badge>
        ))}
      </div>
    </div>
  )
}
