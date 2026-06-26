import Link from "next/link"
import { getDashboardData } from "@/app/actions/dashboard"
import { PageHeader } from "@/components/shell/page-header"
import { StatGrid } from "@/components/dashboard/stat-grid"
import { EventFeed } from "@/components/dashboard/event-feed"
import { RUNTIME } from "@/lib/ai/config"
import { MessageSquare, Plus } from "lucide-react"
import { Button } from "@/components/ui/button"

export default async function DashboardPage() {
  const { stats, events } = await getDashboardData()

  return (
    <>
      <PageHeader
        title="Command Overview"
        description="The state of your governed second brain at a glance. Every register is captured, embedded, and auditable."
        action={
          <Button asChild>
            <Link href="/chat">
              <MessageSquare className="h-4 w-4" />
              Operator Chat
            </Link>
          </Button>
        }
      />

      <div className="flex flex-col gap-8 p-6">
        <StatGrid stats={stats} />

        <div className="grid gap-6 lg:grid-cols-3">
          <div className="lg:col-span-2">
            <EventFeed events={events} />
          </div>

          <div className="flex flex-col gap-4">
            <div className="rounded-lg border border-border bg-card p-4">
              <h2 className="text-sm font-medium mb-3">Quick capture</h2>
              <div className="flex flex-col gap-2">
                <QuickLink href="/memory" label="Commit a memory fact" />
                <QuickLink href="/decisions" label="Log a decision" />
                <QuickLink href="/doctrine" label="Ratify doctrine" />
                <QuickLink href="/work-orders" label="Open a work order" />
                <QuickLink href="/corpus" label="Ingest a document" />
              </div>
            </div>

            <div className="rounded-lg border border-border bg-card p-4">
              <h2 className="text-sm font-medium mb-3">Runtime</h2>
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
