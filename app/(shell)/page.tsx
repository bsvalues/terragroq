import Link from "next/link"
import { getDashboardData } from "@/app/actions/dashboard"
import { getHomeWorkRadarSource } from "@/app/(shell)/home-work-radar-query"
import { PageHeader } from "@/components/shell/page-header"
import { StatGrid } from "@/components/dashboard/stat-grid"
import { EventFeed } from "@/components/dashboard/event-feed"
import { getHomeCommandCenter } from "@/components/dashboard/home-command-center"
import { HomeWorkRadarPanel } from "@/components/dashboard/home-work-radar-panel"
import { OperatorStartPanel } from "@/components/dashboard/operator-start-panel"
import { ResearchModeSummaryPanel } from "@/components/dashboard/research-mode-summary-panel"
import { RUNTIME } from "@/lib/ai/config"
import { ArrowRight, CircleDot, Plus, ShieldCheck } from "lucide-react"
import { Button } from "@/components/ui/button"

export default async function DashboardPage() {
  const [{ stats, events }, radarSource] = await Promise.all([
    getDashboardData(),
    getHomeWorkRadarSource(),
  ])
  const home = getHomeCommandCenter(stats, radarSource)

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
        <HomeWorkRadarPanel radar={home.workRadar} />

        <section className="overflow-hidden rounded-3xl border border-border bg-card">
          <div className="grid lg:grid-cols-[1.15fr_0.85fr]">
            <div className="relative overflow-hidden border-b border-border bg-[radial-gradient(circle_at_top_left,hsl(var(--primary)/0.16),transparent_38%),linear-gradient(135deg,hsl(var(--card)),hsl(var(--muted)/0.32))] p-6 lg:border-b-0 lg:border-r">
              <div className="absolute right-6 top-6 hidden h-28 w-28 rounded-full border border-primary/20 lg:block" />
              <div className="absolute right-12 top-12 hidden h-16 w-16 rounded-full border border-primary/10 lg:block" />
              <p className="font-mono text-[11px] uppercase tracking-[0.28em] text-muted-foreground">
                {home.eyebrow}
              </p>
              <div className="mt-8 max-w-3xl">
                <h2 className="text-3xl font-semibold tracking-tight text-balance md:text-4xl">
                  WilliamOS Command Center
                </h2>
                <p className="mt-4 max-w-2xl text-sm leading-6 text-muted-foreground">
                  {home.thesis}
                </p>
              </div>

              <div className="mt-8 grid gap-3 md:grid-cols-3">
                {home.lanes.map((lane) => (
                  <Link
                    key={lane.label}
                    href={lane.href}
                    className="group rounded-2xl border border-border/80 bg-background/80 p-4 backdrop-blur transition-colors hover:border-primary/40"
                  >
                    <div className="flex items-center justify-between gap-3">
                      <span className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
                        {lane.label}
                      </span>
                      <span
                        className={`h-2 w-2 rounded-full ${
                          lane.tone === "attention"
                            ? "bg-warning"
                            : lane.tone === "stable"
                              ? "bg-success"
                              : "bg-primary"
                        }`}
                      />
                    </div>
                    <p className="mt-3 text-lg font-semibold">{lane.value}</p>
                    <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
                      {lane.description}
                    </p>
                  </Link>
                ))}
              </div>
            </div>

            <div className="flex flex-col justify-between gap-6 p-6">
              <div className="rounded-2xl border border-border bg-background p-5">
                <div className="flex items-start gap-3">
                  <CircleDot className="mt-0.5 h-5 w-5 text-primary" aria-hidden />
                  <div>
                    <p className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
                      Primary Status · {home.briefing.status}
                    </p>
                    <h3 className="mt-2 text-xl font-semibold tracking-tight">
                      {home.briefing.summary}
                    </h3>
                    <p className="mt-2 text-sm leading-6 text-muted-foreground">
                      {home.briefing.detail}
                    </p>
                  </div>
                </div>
              </div>

              <div className="grid gap-3">
                {home.systemPosture.map((item) => (
                  <Link
                    key={item.label}
                    href={item.href}
                    className="group rounded-xl border border-border bg-background px-4 py-3 transition-colors hover:border-primary/40"
                  >
                    <div className="flex items-center justify-between gap-3">
                      <div>
                        <p className="text-sm font-medium">{item.label}</p>
                        <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                          {item.description}
                        </p>
                      </div>
                      <span className="shrink-0 rounded-full border border-border bg-muted/40 px-2 py-1 font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
                        {item.posture}
                      </span>
                    </div>
                  </Link>
                ))}
              </div>

              <div className="rounded-2xl border border-primary/20 bg-primary/5 p-4">
                <p className="font-mono text-[10px] uppercase tracking-wider text-primary">
                  Next Move
                </p>
                <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
                  {home.nextMove.reason}
                </p>
                <Button className="mt-4" variant="outline" asChild>
                  <Link href={home.nextMove.href}>
                    {home.nextMove.label}
                    <ArrowRight className="h-4 w-4" />
                  </Link>
                </Button>
              </div>

              <div className="rounded-2xl border border-border bg-background p-4">
                <p className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
                  {home.authorityPanel.title}
                </p>
                <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
                  {home.authorityPanel.description}
                </p>
                <div className="mt-3 grid gap-2">
                  {home.authorityPanel.blockers.map((blocker) => (
                    <div
                      key={blocker.label}
                      className="rounded-lg border border-border bg-card px-3 py-2"
                    >
                      <div className="flex items-center justify-between gap-3">
                        <p className="text-xs font-medium">{blocker.label}</p>
                        <span className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
                          {blocker.status}
                        </span>
                      </div>
                      <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                        {blocker.description}
                      </p>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </section>

        <section className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          {home.statusCards.map((card) => (
            <Link
              key={card.label}
              href={card.href}
              className="group rounded-xl border border-border bg-card p-4 transition-colors hover:border-primary/40"
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
                <QuickLink href="/memory" label="Review memory context" />
                <QuickLink href="/decisions" label="Review owner decisions" />
                <QuickLink href="/doctrine" label="Review doctrine" />
                <QuickLink href="/work-orders" label="Review work orders" />
                <QuickLink href="/projects" label="Review project systems" />
                <QuickLink href="/agent-forge" label="Inspect Agent Forge" />
                <QuickLink href="/corpus" label="Review corpus" />
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
