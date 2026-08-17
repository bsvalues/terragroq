import { AgentThread } from "@/components/loom/agent-thread"
import { LiveConsole } from "@/components/loom/live-console"
import { Workspace } from "@/components/loom/workspace"

export const dynamic = "force-dynamic"

export default function LoomPage() {
  return (
    <main className="flex h-[calc(100vh-4rem)] flex-col gap-3 p-4">
      <header className="flex flex-col gap-1">
        <h1 className="text-lg font-semibold tracking-tight">Workroom</h1>
        <p className="text-xs text-muted-foreground">
          Your files, your agent, and this machine — in one place. Everything here is the real
          checkout, live.
        </p>
      </header>

      {/* Files and the agent side by side: you can watch it edit the file you are looking at. */}
      <div className="grid min-h-0 flex-1 gap-3 xl:grid-cols-[3fr_2fr]">
        <Workspace />
        <div className="flex min-h-0 flex-col gap-3">
          <AgentThread />
          <LiveConsole />
        </div>
      </div>
    </main>
  )
}
