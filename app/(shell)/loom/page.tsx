import { WorkroomSurfaces } from "@/components/loom/workroom-surfaces"

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

      {/* Files and the agent stay bound to one canonical project identity. */}
      <WorkroomSurfaces />
    </main>
  )
}
