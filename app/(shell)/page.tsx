import Link from "next/link"
import { getDashboardData } from "@/app/actions/dashboard"
import { PageHeader } from "@/components/shell/page-header"
import { StatGrid } from "@/components/dashboard/stat-grid"
import { EventFeed } from "@/components/dashboard/event-feed"
import { getHomeCommandCenter } from "@/components/dashboard/home-command-center"
import { OperatorStartPanel } from "@/components/dashboard/operator-start-panel"
import { ResearchModeSummaryPanel } from "@/components/dashboard/research-mode-summary-panel"
import { RUNTIME } from "@/lib/ai/config"
import { ArrowRight, Plus, ShieldCheck } from "lucide-react"
import { Button } from "@/components/ui/button"

export default async function DashboardPage() {
  const { stats, events } = await getDashboardData()
  const home = getHomeCommandCenter(stats)

  return (
    <>
      <PageHeader
        title={home.title}
        description={home.description}
        action={
          <Button asChild>
            <Link href={home.primaryAction.href}>
              <ShieldCheck className="h-4 w-4" />
              {home.primaryAction.label}
            </Link>
          </Button>
        }
      />

      <div className="flex flex-col gap-8 p-6">
        <section className="overflow-hidden rounded-2xl border border-border bg-card">
          <div className="border-b border-border bg-muted/30 px-5 py-4">
            <p className="font-mono text-[11px] uppercase tracking-[0.25em] text-muted-foreground">
              {home.eyebrow}
            </p>
            <div className="mt-2 flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
              <div>
                <h2 className="text-2xl font-semibold tracking-tight">
                  Private system briefing
                </h2>
                <p className="mt-1 max-w-2xl text-sm leading-relaxed text-muted-foreground">
                  WilliamOS shows what needs attention, what is stable, what is
                  waiting for authority, and where the Primary Operator should
                  move next.
                </p>
              </div>
              <Button variant="outline" asChild>
                <Link href={home.nextMove.href}>
                  {home.nextMove.label}
                  <ArrowRight className="h-4 w-4" />
                </Link>
              </Button>
            </div>
          </div>

          <div className="grid gap-3 p-4 md:grid-cols-2 xl:grid-cols-4">
            {home.statusCards.map((card) => (
              <Link
                key={card.label}
                href={card.href}
                className="group rounded-xl border border-border bg-background p-4 transition-colors hover:border-primary/40"
              >
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
                      {card.label}
                    </p>
                    <p className="mt-2 text-lg font-semibold">{card.value}</p>
                  </div>
                  <ArrowRight className="h-4 w-4 text-primary opacity-70 transition-transform group-hover:translate-x-0.5" />
                </div>
                <p className="mt-3 text-xs leading-relaxed text-muted-foreground">
                  {card.description}
                </p>
              </Link>
            ))}
          </div>

          <div className="border-t border-border px-5 py-3">
            <p className="text-xs leading-relaxed text-muted-foreground">
              <span className="font-medium text-foreground">Next Move:</span>{" "}
              {home.nextMove.reason}
            </p>
          </div>
        </section>

        <OperatorStartPanel stats={stats} />
        <ResearchModeSummaryPanel />
        <StatGrid stats={stats} />

        <div className="grid gap-6 lg:grid-cols-3">
          <div className="lg:col-span-2">
            <EventFeed events={events} />
          </div>

          <div className="flex flex-col gap-4">
            <div className="rounded-lg border border-border bg-card p-4">
              <h2 className="text-sm font-medium mb-3">Command Center links</h2>
              <div className="flex flex-col gap-2">
                <QuickLink href="/memory" label="Commit a memory fact" />
                <QuickLink href="/decisions" label="Log a decision" />
                <QuickLink href="/doctrine" label="Ratify doctrine" />
                <QuickLink href="/work-orders" label="Open a work order" />
                <QuickLink href="/corpus" label="Ingest a document" />
              </div>
            </div>

            <div className="rounded-lg border border-border bg-card p-4">
              <h2 className="text-sm font-medium mb-3">Systems</h2>
              <dl className="flex flex-col gap-2 font-mono text-xs">
                <Row k="chat" v={RUNTIME.chatModel} />
                <Row k="embeddings" v={RUNTIME.embeddingModel} />
                <Row k="gateway" v={RUNTIME.gateway} />
                <Row k="vector" v="pgvector · cosine · 1536d" />
              </dl>
            </div>
          </div>
        </div>
      </div>
    </>
  )
}

function QuickLink({ href, label }: { href: string; label: string }) {
  return (
    <Link
      href={href}
      className="flex items-center gap-2 rounded-md border border-border px-3 py-2 text-sm text-muted-foreground transition-colors hover:border-primary/40 hover:text-foreground"
    >
      <Plus className="h-3.5 w-3.5" />
      {label}
    </Link>
  )
}

function Row({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex items-center justify-between gap-4">
      <dt className="text-muted-foreground">{k}</dt>
      <dd className="truncate text-foreground">{v}</dd>
    </div>
  )
}
