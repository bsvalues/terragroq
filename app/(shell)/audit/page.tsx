import { getUserId } from "@/lib/session"
import { getRecentEvents } from "@/lib/registers/events"
import { PageHeader } from "@/components/shell/page-header"
import { Activity } from "lucide-react"

export default async function AuditPage() {
  const userId = await getUserId()
  const events = await getRecentEvents(userId, 200)

  return (
    <>
      <PageHeader
        title="Audit Log"
        description="An append-only stream of every governed action across the system. Provenance, not vibes."
      />
      <div className="p-6">
        {events.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-3 rounded-lg border border-dashed border-border py-16 text-center">
            <Activity className="h-8 w-8 text-muted-foreground" />
            <p className="text-sm font-medium">No events recorded</p>
            <p className="text-sm text-muted-foreground">Activity across registers will appear here.</p>
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
