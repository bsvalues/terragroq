"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"

import { MobileNav } from "./mobile-nav"
import { navItems } from "./nav-items"
import { SidebarNav } from "./sidebar-nav"
import { UserMenu } from "./user-menu"
import { cn } from "@/lib/utils"

const HOME_RAIL_DESTINATIONS = ["/", "/work-orders", "/projects", "/audit", "/runtime"] as const

export function AppShellFrame({
  user,
  modelName,
  healthStrip,
  children,
}: {
  user: { name: string; email: string }
  modelName: string
  healthStrip: React.ReactNode
  children: React.ReactNode
}) {
  const pathname = usePathname()
  const compactHome = pathname === "/"

  if (compactHome) {
    const railItems = navItems.filter((item) => HOME_RAIL_DESTINATIONS.includes(
      item.href as (typeof HOME_RAIL_DESTINATIONS)[number],
    ))

    return (
      <div className="flex min-h-screen bg-[#0c0f10]">
        <aside className="hidden w-[4.75rem] shrink-0 flex-col border-r border-[#2a3232] bg-[#0c0f10] lg:flex">
          <Link href="/" className="grid h-14 place-items-center border-b border-[#2a3232]" aria-label="WilliamOS Home">
            <span className="grid size-7 place-items-center bg-[#edf1ed] font-mono text-xs font-bold text-[#0c0f10]">W</span>
          </Link>
          <nav aria-label="Primary navigation" className="flex flex-1 flex-col items-center gap-2 py-5">
            {railItems.map((item) => {
              const active = item.href === "/"
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  aria-current={active ? "page" : undefined}
                  aria-label={item.label}
                  title={item.label}
                  className={cn(
                    "flex h-12 w-14 flex-col items-center justify-center gap-1 border-l-2 border-transparent text-[#626c68] hover:text-[#edf1ed] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#59b8df]",
                    active && "border-l-[#54e0a3] text-[#54e0a3]",
                  )}
                >
                  <item.icon className="size-4" aria-hidden />
                  <span className="text-[9px]">{item.label}</span>
                </Link>
              )
            })}
          </nav>
        </aside>

        <div className="flex min-w-0 flex-1 flex-col">
          <header className="flex h-14 shrink-0 items-center justify-between border-b border-[#2a3232] bg-[#0c0f10] px-4 lg:px-5">
            <div className="flex items-center gap-3">
              <MobileNav />
              <Link href="/" className="flex items-center gap-2 font-semibold lg:hidden">
                <span className="grid size-7 place-items-center bg-[#edf1ed] font-mono text-xs font-bold text-[#0c0f10]">W</span>
                WilliamOS
              </Link>
              <span className="hidden text-sm font-semibold lg:inline">WilliamOS</span>
            </div>
            <UserMenu name={user.name} email={user.email} />
          </header>
          <main className="min-w-0 flex-1 overflow-y-auto">{children}</main>
        </div>
      </div>
    )
  }

  return (
    <div className="flex min-h-screen">
      <aside className="hidden w-64 shrink-0 flex-col border-r border-sidebar-border bg-sidebar lg:flex">
        <Link href="/" className="flex h-16 items-center gap-2 border-b border-sidebar-border px-5">
          <div className="flex size-8 items-center justify-center rounded-md bg-primary font-mono text-sm font-bold text-primary-foreground">
            W
          </div>
          <div className="flex flex-col leading-tight">
            <span className="font-mono text-sm text-sidebar-foreground">WilliamOS</span>
            <span className="text-[10px] text-muted-foreground">Primary Shell</span>
          </div>
        </Link>
        <div className="flex-1 overflow-y-auto">
          <SidebarNav />
        </div>
        <div className="border-t border-sidebar-border px-4 py-3 font-mono text-[10px] text-muted-foreground">
          <div className="flex items-center gap-1.5">
            <span className="size-1.5 rounded-full bg-success" />
            gateway online
          </div>
          <div className="mt-1 truncate">model: {modelName}</div>
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-10 flex h-16 items-center justify-between gap-4 border-b border-border bg-background/80 px-4 backdrop-blur-sm">
          <div className="flex items-center gap-2">
            <MobileNav />
            <span className="font-mono text-sm lg:hidden">WilliamOS Primary Shell</span>
          </div>
          <UserMenu name={user.name} email={user.email} />
        </header>
        {healthStrip}
        <main className="flex-1 overflow-y-auto">{children}</main>
      </div>
    </div>
  )
}
