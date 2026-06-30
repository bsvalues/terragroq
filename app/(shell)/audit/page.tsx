import { getUserId } from "@/lib/session"
import { getRecentEvents } from "@/lib/registers/events"
import { PageHeader } from "@/components/shell/page-header"
import { getEventEmptyStateActions } from "@/components/dashboard/event-empty-state"
import { EvidenceCommandPanel } from "@/components/evidence/evidence-command-panel"
import { Activity } from "lucide-react"
import Link from "next/link"

export default async function AuditPage() {
  const userId = await getUserId()
  const events = await getRecentEvents(userId, 200)

  return (
    <>
      <PageHeader
        title="Evidence"
        description="The proof layer for Work Orders, production verification, safety posture, and governed decisions. Evidence observes; it does not execute."
      />
      <div className="flex flex-col gap-6 p-6">
        <EvidenceCommandPanel />
        {events.length === 0 ? (
          <div className="rounded-lg border border-dashed border-border bg-card p-6">
            <div className="mx-auto flex max-w-2xl flex-col items-center justify-center gap-3 text-center">
              <Activity className="h-8 w-8 text-muted-foreground" />
              <p className="text-sm font-medium">No audit events recorded yet</p>
              <p className="text-sm leading-relaxed text-muted-foreground">
                The audit log fills only after manual operator actions are recorded.
                Start with a safe governance surface; nothing runs automatically from
                these links.
              </p>
            </div>
            <div className="mx-auto mt-6 grid max-w-3xl gap-3 md:grid-cols-3">
              {getEventEmptyStateActions().map((action) => (
                <Link
                  key={action.href}
                  href={action.href}
                  className="rounded-md border border-border bg-background px-4 py-3 transition-colors hover:border-primary/40"
                >
                  <p className="text-sm font-medium">{action.title}</p>
                  <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                    {action.description}
                  </p>
                </Link>
              ))}
            </div>
          </div>
        ) : (
          <div className="overflow-hidden rounded-lg border border-border">
            <table className="w-full text-sm">
              <thead className="bg-muted/50">
                <tr className="border-b border-border text-left font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
                  <th className="px-4 py-2.5 font-medium">Timestamp</th>
                  <th className="px-4 py-2.5 font-medium">Type</th>
                  <th className="px-4 py-2.5 font-medium">Register</th>
                  <th className="px-4 py-2.5 font-medium">Summary</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {events.map((e) => (
                  <tr key={e.id} className="hover:bg-muted/30">
                    <td className="whitespace-nowrap px-4 py-2.5 font-mono text-xs text-muted-foreground">
                      {new Date(e.createdAt).toLocaleString()}
                    </td>
                    <td className="whitespace-nowrap px-4 py-2.5 font-mono text-xs">{e.type}</td>
                    <td className="whitespace-nowrap px-4 py-2.5 text-xs text-muted-foreground">
                      {e.register ?? "—"}
                    </td>
                    <td className="px-4 py-2.5">{e.summary}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </>
  )
}
