import { BrainCircuit, GitBranch, ScrollText, ClipboardList } from "lucide-react"

const layers = [
  { icon: BrainCircuit, label: "Memory", note: "Durable, embedded facts" },
  { icon: GitBranch, label: "Decisions", note: "ADR-style register" },
  { icon: ScrollText, label: "Doctrine", note: "Operating principles" },
  { icon: ClipboardList, label: "Work Orders", note: "Governed execution" },
]

export function AuthAside() {
  return (
    <div className="hidden lg:flex flex-col justify-between bg-sidebar border-r border-sidebar-border p-10">
      <div className="flex items-center gap-2">
        <div className="flex h-8 w-8 items-center justify-center rounded-md bg-primary text-primary-foreground font-mono text-sm font-bold">
          W
        </div>
        <span className="font-mono text-sm tracking-wide text-sidebar-foreground">
          WilliamOS
        </span>
      </div>

      <div className="flex flex-col gap-6">
        <h2 className="text-2xl font-semibold text-balance text-sidebar-foreground leading-tight">
          A governed second brain for serious operators.
        </h2>
        <p className="text-muted-foreground text-pretty leading-relaxed max-w-sm">
          Every fact, decision, and action is captured, embedded, and auditable.
          The AI answers from your corpus — with citations, not vibes.
        </p>

        <div className="grid grid-cols-2 gap-3 max-w-sm">
          {layers.map((l) => (
            <div
              key={l.label}
              className="rounded-lg border border-sidebar-border bg-card/40 p-3"
            >
              <l.icon className="h-4 w-4 text-primary mb-2" />
              <div className="text-sm font-medium text-sidebar-foreground">{l.label}</div>
              <div className="text-xs text-muted-foreground">{l.note}</div>
            </div>
          ))}
        </div>
      </div>

      <div className="font-mono text-xs text-muted-foreground">
        provenance-forward · local-first · RAG-grounded
      </div>
    </div>
  )
}
