"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"
import { navGroups, navItems } from "./nav-items"
import { cn } from "@/lib/utils"

export function SidebarNav({ onNavigate }: { onNavigate?: () => void }) {
  const pathname = usePathname()

  return (
    <nav aria-label="Primary navigation" className="flex flex-col gap-5 px-3 py-4">
      {navGroups.map((group) => (
        <div key={group.id} className="flex flex-col gap-1">
          <div className="px-3 pb-1">
            <div className="flex items-center justify-between gap-2">
              <div className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
                {group.id}
              </div>
              <div className="rounded-sm border border-sidebar-border px-1.5 py-0.5 font-mono text-[9px] uppercase text-muted-foreground">
                {group.tier}
              </div>
            </div>
            <div className="mt-0.5 text-[11px] leading-snug text-muted-foreground/80">
              {group.description}
            </div>
          </div>
          {navItems
            .filter((item) => item.group === group.id)
            .map((item) => {
              const active =
                item.href === "/"
                  ? pathname === "/"
                  : pathname?.startsWith(item.href) ?? false
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  onClick={onNavigate}
                  aria-current={active ? "page" : undefined}
                  className={cn(
                    "flex items-center gap-3 rounded-md px-3 py-2 text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                    active
                      ? "bg-sidebar-accent text-sidebar-accent-foreground font-medium"
                      : "text-muted-foreground hover:bg-sidebar-accent/50 hover:text-sidebar-foreground",
                  )}
                >
                  <item.icon className="h-4 w-4 shrink-0" />
                  <span className="flex min-w-0 flex-col">
                    <span className="truncate">{item.label}</span>
                    <span className="truncate text-[11px] font-normal opacity-70">
                      {item.description}
                    </span>
                  </span>
                </Link>
              )
            })}
        </div>
      ))}
    </nav>
  )
}
