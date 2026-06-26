import Link from "next/link"
import {
  BrainCircuit,
  GitBranch,
  ScrollText,
  ClipboardList,
  Library,
  type LucideIcon,
} from "lucide-react"

type Stat = {
  label: string
  value: number
  sub?: string
  href: string
  icon: LucideIcon
}

export function StatGrid({
  stats,
}: {
  stats: {
    memory: number
    decisions: number
    openDecisions: number
    doctrines: number
    work: number
    openWork: number
    docs: number
  }
}) {
  const items: Stat[] = [
    { label: "Memory facts", value: stats.memory, href: "/memory", icon: BrainCircuit },
    {
      label: "Decisions",
      value: stats.decisions,
      sub: `${stats.openDecisions} proposed`,
      href: "/decisions",
      icon: GitBranch,
    },
    { label: "Active doctrine", value: stats.doctrines, href: "/doctrine", icon: ScrollText },
    {
      label: "Work orders",
      value: stats.work,
      sub: `${stats.openWork} in progress`,
      href: "/work-orders",
      icon: ClipboardList,
    },
    { label: "Corpus docs", value: stats.docs, href: "/corpus", icon: Library },
  ]

  return (
    <div className="grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-5">
      {items.map((item) => (
        <Link
          key={item.label}
          href={item.href}
          className="group flex flex-col gap-3 rounded-lg border border-border bg-card p-4 transition-colors hover:border-primary/40"
        >
          <div className="flex items-center justify-between">
            <item.icon className="h-4 w-4 text-muted-foreground group-hover:text-primary transition-colors" />
            <span className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
              {item.sub ?? "total"}
            </span>
          </div>
          <div className="flex flex-col">
            <span className="font-mono text-3xl font-semibold tabular-nums">{item.value}</span>
            <span className="text-xs text-muted-foreground">{item.label}</span>
          </div>
        </Link>
      ))}
    </div>
  )
}
