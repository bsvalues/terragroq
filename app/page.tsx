import { redirect } from "next/navigation"
import Link from "next/link"
import { getSession } from "@/lib/session"
import { AppShell } from "@/components/shell/app-shell"
import { PageHeader } from "@/components/shell/page-header"
import { getDashboard } from "@/app/actions/dashboard"
import { StatCard } from "@/components/dashboard/stat-card"
import { ActivityFeed } from "@/components/dashboard/activity-feed"
import { Brain, GitBranch, ScrollText, ClipboardList, FileStack, MessagesSquare, ArrowRight } from "lucide-react"
import { Button } from "@/components/ui/button"

export default async function OverviewPage() {
  const session = await getSession()
  if (!session?.user) redirect("/sign-in")

  const data = await getDashboard()

  return (
    <AppShell user={{ name: session.user.name, email: session.user.email }}>
      <PageHeader
        meta="Operator Shell"
        title={`Welcome back, ${session.user.name.split(" ")[0]}`}
        description="Your governed second brain at a glance. Every register is auditable and every answer is grounded."
        action={
          <Button asChild>
            <Link href="/chat">
              <MessagesSquare className="h-4 w-4" />
              Open Operator Chat
            </Link>
          </Button>
        }
      />

      <div className="grid gap-4 p-4 sm:p-6 md:grid-cols-2 xl:grid-cols-3">
        <StatCard
          href="/memory"
          icon={Brain}
          label="Memory Facts"
          value={data.memory}
          hint="embedded for semantic recall"
        />
        <StatCard
          href="/decisions"
          icon={GitBranch}
          label="Decisions"
          value={data.decisions}
          hint={`${data.openDecisions} proposed`}
        />
        <StatCard
          href="/doctrine"
          icon={ScrollText}
          label="Doctrine"
          value={data.doctrine}
          hint={`${data.activeDoctrine} active`}
        />
        <StatCard
          href="/work-orders"
          icon={ClipboardList}
          label="Work Orders"
          value={data.workOrders}
          hint={`${data.openWorkOrders} in progress`}
        />
        <StatCard
          href="/documents"
          icon={FileStack}
          label="Documents"
          value={data.documents}
          hint="indexed in RAG corpus"
        />

        <Link
          href="/chat"
          className="group flex flex-col justify-between rounded-lg border border-primary/30 bg-primary/5 p-5 transition-colors hover:bg-primary/10"
        >
          <div className="flex items-center gap-2 text-primary">
            <MessagesSquare className="h-5 w-5" />
            <span className="font-mono text-xs uppercase tracking-wider">Grounded chat</span>
          </div>
          <div className="mt-6">
            <p className="text-sm font-medium">Ask the operator</p>
            <p className="mt-1 text-sm text-muted-foreground">
              Answers cite your memory and documents with full provenance.
            </p>
            <span className="mt-3 inline-flex items-center gap-1 text-sm text-primary">
              Start a session <ArrowRight className="h-3.5 w-3.5 transition-transform group-hover:translate-x-0.5" />
            </span>
          </div>
        </Link>
      </div>

      <div className="px-4 pb-10 sm:px-6">
        <ActivityFeed events={data.events} />
      </div>
    </AppShell>
  )
}
