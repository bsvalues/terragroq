import Link from "next/link"
import { GitBranch, ShieldCheck } from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { getOwnerDecisionQueueSurface } from "@/components/decisions/owner-decision-queue"

function LinkColumn({
  title,
  links,
}: {
  title: string
  links: {
    label: string
    decisionId: string
    relatedItem: string
    description: string
  }[]
}) {
  return (
    <div>
      <p className="text-sm font-medium">{title}</p>
      <div className="mt-3 grid gap-2">
        {links.map((link) => (
          <div key={`${link.decisionId}-${link.label}`} className="rounded-lg border border-border bg-background p-3">
            <p className="text-sm font-semibold">{link.label}</p>
            <p className="mt-1 font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
              {link.decisionId}
            </p>
            <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
              {link.description}
            </p>
            <p className="mt-2 text-xs text-muted-foreground">{link.relatedItem}</p>
          </div>
        ))}
      </div>
    </div>
  )
}

export function OwnerDecisionQueuePanel() {
  const queue = getOwnerDecisionQueueSurface()
  const detail = queue.detailDecision

  return (
    <section className="overflow-hidden rounded-xl border border-border bg-card">
      <div className="border-b border-border bg-muted/30 px-4 py-3">
        <div className="flex flex-wrap items-center gap-2">
          <GitBranch className="h-4 w-4 text-primary" aria-hidden />
          <p className="font-mono text-[11px] uppercase tracking-[0.22em] text-muted-foreground">
            Owner Decision Queue
          </p>
        </div>
        <h2 className="mt-2 text-lg font-semibold tracking-tight">
          {queue.doctrine.title}
        </h2>
        <p className="mt-1 max-w-3xl text-sm leading-relaxed text-muted-foreground">
          Read-only queue for decisions only the Primary can make. A queued
          decision is not approval, authorization, denial, or execution.
        </p>
      </div>

      <div className="grid gap-3 p-4 lg:grid-cols-[0.85fr_1.15fr]">
        <div className="rounded-lg border border-border bg-background p-4">
          <p className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
            Doctrine
          </p>
          <ul className="mt-3 grid gap-2 text-sm text-muted-foreground">
            {queue.doctrine.statements.map((statement) => (
              <li key={statement} className="rounded-md border border-border bg-card px-3 py-2">
                {statement}
              </li>
            ))}
          </ul>
        </div>

        <div className="rounded-lg border border-border bg-background p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
              Decision Detail
            </p>
            <Badge variant="outline">{detail.status}</Badge>
          </div>
          <h3 className="mt-2 text-base font-semibold">{detail.title}</h3>
          <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
            {detail.whyBlocked}
          </p>
          <div className="mt-4 grid gap-3 md:grid-cols-2">
            <DetailField label="Authority required" value={detail.authorityRequired} />
            <DetailField label="Risk" value={detail.riskLevel} />
            <DetailField label="Safe default" value={detail.safeDefault} />
            <DetailField label="Next valid action" value={detail.nextValidAction} />
          </div>
          <div className="mt-4">
            <p className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
              Evidence required
            </p>
            <div className="mt-2 flex flex-wrap gap-2">
              {detail.evidenceRequired.map((item) => (
                <Badge key={item} variant="secondary">{item}</Badge>
              ))}
            </div>
          </div>
        </div>
      </div>

      <div className="border-t border-border p-4">
        <p className="text-sm font-medium">Pending decisions</p>
        <div className="mt-3 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {queue.pendingDecisions.map((decision) => (
            <article key={decision.decisionId} className="rounded-lg border border-border bg-background p-3">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <p className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
                    {decision.category}
                  </p>
                  <h3 className="mt-1 text-sm font-semibold">{decision.title}</h3>
                </div>
                <Badge variant="outline">{decision.status}</Badge>
              </div>
              <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
                {decision.whyBlocked}
              </p>
              <div className="mt-3 grid gap-2 text-xs text-muted-foreground">
                <p><span className="font-medium text-foreground">Authority:</span> {decision.authorityRequired}</p>
                <p><span className="font-medium text-foreground">Safe default:</span> {decision.safeDefault}</p>
                <p><span className="font-medium text-foreground">Next:</span> {decision.nextValidAction}</p>
              </div>
            </article>
          ))}
        </div>
      </div>

      <div className="grid gap-4 border-t border-border p-4 lg:grid-cols-2">
        <div>
          <p className="text-sm font-medium">Decision categories</p>
          <div className="mt-3 grid gap-2">
            {queue.categories.map((category) => (
              <div key={category.category} className="rounded-lg border border-border bg-background p-3">
                <p className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
                  {category.category}
                </p>
                <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
                  {category.description}
                </p>
              </div>
            ))}
          </div>
        </div>
        <div>
          <p className="text-sm font-medium">Visible states</p>
          <div className="mt-3 grid gap-2">
            {queue.states.map((state) => (
              <div key={state.state} className="rounded-lg border border-border bg-background p-3">
                <p className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
                  {state.state}
                </p>
                <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
                  {state.description}
                </p>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="border-t border-border p-4">
        <p className="text-sm font-medium">{queue.blockedDecisionUx.title}</p>
        <div className="mt-3 grid gap-2 md:grid-cols-2 xl:grid-cols-4">
          {queue.blockedDecisionUx.statements.map((statement) => (
            <div key={statement} className="rounded-lg border border-border bg-background p-3 text-sm text-muted-foreground">
              {statement}
            </div>
          ))}
        </div>
      </div>

      <div className="grid gap-4 border-t border-border p-4 lg:grid-cols-3">
        <LinkColumn title="Authority to decisions" links={queue.authorityDecisionLinks} />
        <LinkColumn title="Evidence to decisions" links={queue.evidenceDecisionLinks} />
        <LinkColumn title="Work Orders to decisions" links={queue.workOrderDecisionLinks} />
      </div>

      <div className="border-t border-border p-4">
        <p className="text-sm font-medium">Decision safety proof</p>
        <div className="mt-3 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          {queue.safetyProofCards.map((card) => (
            <div key={card.label} className="rounded-lg border border-border bg-background p-3">
              <p className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
                {card.label}
              </p>
              <p className="mt-2 text-sm font-semibold">{card.value}</p>
              <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
                {card.description}
              </p>
            </div>
          ))}
        </div>
      </div>

      <div className="grid gap-3 border-t border-border p-4 md:grid-cols-4">
        {queue.navigation.map((item) => (
          <Link
            key={item.href}
            href={item.href}
            className="rounded-lg border border-border bg-background p-3 transition-colors hover:border-primary/40"
          >
            <p className="text-sm font-semibold">{item.label}</p>
            <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
              {item.description}
            </p>
          </Link>
        ))}
      </div>

      <div className="flex flex-col gap-3 border-t border-border px-4 py-3 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <p className="text-sm font-medium">{queue.nextLaneDecision.recommendedBatch}</p>
          <p className="mt-1 max-w-3xl text-xs leading-relaxed text-muted-foreground">
            {queue.nextLaneDecision.reason}
          </p>
        </div>
        <div className="inline-flex items-center gap-2 rounded-full border border-border bg-background px-3 py-1.5 text-xs text-muted-foreground">
          <ShieldCheck className="h-3.5 w-3.5 text-primary" aria-hidden />
          Read-only queue. No approve, deny, authorize, execute, mutate, ingest, or escalate.
        </div>
      </div>
    </section>
  )
}

function DetailField({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
        {label}
      </p>
      <p className="mt-1 text-sm">{value}</p>
    </div>
  )
}
