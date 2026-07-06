import Link from "next/link"
import { SidebarNav } from "./sidebar-nav"
import { UserMenu } from "./user-menu"
import { MobileNav } from "./mobile-nav"
import { RUNTIME } from "@/lib/ai/config"
import { getAuthReadiness } from "@/lib/auth-readiness"
import { buildRuntimeStatus } from "@/lib/ai/runtime"
import { HealthStatusStrip } from "./health-status-strip"

export async function AppShell({
  user,
  children,
}: {
  user: { name: string; email: string }
  children: React.ReactNode
}) {
  const [readiness, runtime] = await Promise.all([
    getAuthReadiness({ probeDatabase: true }),
    Promise.resolve(buildRuntimeStatus()),
  ])

  return (
    <div className="flex min-h-screen">
      {/* Sidebar */}
      <aside className="hidden lg:flex w-64 shrink-0 flex-col border-r border-sidebar-border bg-sidebar">
        <Link href="/" className="flex items-center gap-2 px-5 h-16 border-b border-sidebar-border">
          <div className="flex h-8 w-8 items-center justify-center rounded-md bg-primary text-primary-foreground font-mono text-sm font-bold">
            W
          </div>
          <div className="flex flex-col leading-tight">
            <span className="font-mono text-sm tracking-wide text-sidebar-foreground">WilliamOS</span>
            <span className="text-[10px] text-muted-foreground">Primary Shell</span>
          </div>
        </Link>
        <div className="flex-1 overflow-y-auto">
          <SidebarNav />
        </div>
        <div className="border-t border-sidebar-border px-4 py-3 font-mono text-[10px] text-muted-foreground">
          <div className="flex items-center gap-1.5">
            <span className="h-1.5 w-1.5 rounded-full bg-success" />
            gateway online
          </div>
          <div className="mt-1 truncate">model: {RUNTIME.chatModel}</div>
        </div>
      </aside>

      {/* Main */}
      <div className="flex flex-1 flex-col min-w-0">
        <header className="flex h-16 items-center justify-between gap-4 border-b border-border bg-background/80 px-4 backdrop-blur-sm sticky top-0 z-10">
          <div className="flex items-center gap-2">
            <MobileNav />
            <span className="font-mono text-sm lg:hidden">WilliamOS Primary Shell</span>
          </div>
          <UserMenu name={user.name} email={user.email} />
        </header>
        <HealthStatusStrip readiness={readiness} runtime={runtime} />
        <main className="flex-1 overflow-y-auto">{children}</main>
      </div>
    </div>
  )
}
