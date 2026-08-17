import { NodeBoard } from "@/components/fabric/node-board"

export const dynamic = "force-dynamic"

export default function FabricPage() {
  return (
    <main className="flex flex-col gap-6 p-6">
      <header className="flex flex-col gap-2">
        <h1 className="text-xl font-semibold tracking-tight">The lab</h1>
        <p className="text-sm text-muted-foreground">
          Every value below is read from the machine itself when you load this page. Nothing here is
          a summary written earlier or reported by an agent.
        </p>
      </header>
      <NodeBoard />
    </main>
  )
}
