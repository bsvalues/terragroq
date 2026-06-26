"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"
import { cn } from "@/lib/utils"
import {
  LayoutDashboard,
  Brain,
  GitBranch,
  ScrollText,
  ClipboardList,
  FileStack,
  MessagesSquare,
} from "lucide-react"

const groups: {
  label: string
  items: { href: string; label: string; icon: React.ElementType; tag?: string }[]
}[] = [
  {
    label: "Operate",
    items: [
      { href: "/", label: "Overview", icon: LayoutDashboard },
      { href: "/chat", label: "Operator Chat", icon: MessagesSquare, tag: "RAG" },
    ],
  },
  {
    label: "Registers",
    items: [
      { href: "/memory", label: "Memory", icon: Brain },
      { href: "/decisions", label: "Decisions", icon: GitBranch },
      { href: "/doctrine", label: "Doctrine", icon: ScrollText },
      { href: "/work-orders", label: "Work Orders", icon: ClipboardList },
    ],
  },
  {
    label: "Corpus",
    items: [{ href: "/documents", label: "Documents", icon: FileStack }],
  },
]

export function SidebarNav() {
  const pathname = usePathname()

  return (
    <nav className="flex flex-1 flex-col gap-6 overflow-y-auto px-3 py-4">
      {groups.map((group) => (
        <div key={group.label} className="flex flex-col gap-1">
          <p className="px-2 pb-1 font-mono text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
            {group.label}
          </p>
          {group.items.map((item) => {
            const active = item.href === "/" ? pathname === "/" : pathname.startsWith(item.href)
            return (
              <Link
                key={item.href}
                href={item.href}
                className={cn(
                  "group flex items-center gap-2.5 rounded-md px-2 py-2 text-sm transition-colors",
                  active
                    ? "bg-accent text-foreground"
                    : "text-muted-foreground hover:bg-accent/50 hover:text-foreground",
                )}
              >
                <item.icon className={cn("h-4 w-4", active && "text-primary")} />
                <span className="flex-1">{item.label}</span>
                {item.tag && (
                  <span className="rounded bg-primary/15 px-1.5 py-0.5 font-mono text-[10px] text-primary">
                    {item.tag}
                  </span>
                )}
              </Link>
            )
          })}
        </div>
      ))}
    </nav>
  )
}
