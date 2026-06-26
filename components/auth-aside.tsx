import { Brain, GitBranch, ScrollText, ClipboardList, ShieldCheck } from "lucide-react"

const layers = [
  { icon: Brain, label: "Memory", desc: "Durable facts, embedded for semantic recall" },
  { icon: GitBranch, label: "Decisions", desc: "An auditable register of what you chose and why" },
  { icon: ScrollText, label: "Doctrine", desc: "Standing principles that govern every response" },
  { icon: ClipboardList, label: "Work Orders", desc: "Actionable items derived from decisions" },
]

export function AuthAside() {
  return (
    <aside className="relative hidden flex-col justify-between border-l border-border bg-sidebar p-10 lg:flex">
      <div className="flex items-center gap-2 font-mono text-xs text-muted-foreground">
        <ShieldCheck className="h-4 w-4 text-primary" />
        <span>GOVERNED · PROVENANCE-FORWARD · LOCAL-FIRST</span>
      </div>

      <div className="max-w-md">
        <h2 className="text-balance text-2xl font-semibold leading-tight tracking-tight">
          A second brain that shows its work.
        </h2>
        <p className="mt-3 text-pretty text-sm leading-relaxed text-muted-foreground">
          WilliamOS keeps your knowledge in governed registers and grounds every answer in your own memory and
          documents — with citations you can trace.
        </p>

        <div className="mt-8 flex flex-col gap-3">
          {layers.map((l) => (
            <div key={l.label} className="flex items-start gap-3 rounded-lg border border-border bg-card p-3">
              <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-primary/15 text-primary">
                <l.icon className="h-4 w-4" />
              </div>
              <div>
                <p className="text-sm font-medium">{l.label}</p>
                <p className="text-xs text-muted-foreground">{l.desc}</p>
              </div>
            </div>
          ))}
        </div>
      </div>

      <p className="font-mono text-xs text-muted-foreground">runtime · vercel ai gateway · pgvector rag</p>
    </aside>
  )
}
