import { AgentThread } from "@/components/loom/agent-thread"
import { LiveConsole } from "@/components/loom/live-console"

export const dynamic = "force-dynamic"

export default function LoomPage() {
  return (
    <main className="flex h-[calc(100vh-4rem)] flex-col gap-4 p-6">
      <header className="flex flex-col gap-1">
        <h1 className="text-xl font-semibold tracking-tight">Workroom</h1>
        <p className="text-sm text-muted-foreground">
          Say what you want and watch it happen against the real checkout. The terminal below is the
          same machine, live.
        </p>
      </header>

      <div className="grid min-h-0 flex-1 gap-4 lg:grid-cols-2">
        <AgentThread />
        <LiveConsole />
      </div>
    </main>
  )
}
