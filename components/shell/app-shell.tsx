import Link from "next/link"
import { Terminal } from "lucide-react"
import { SidebarNav } from "./sidebar-nav"
import { UserMenu } from "./user-menu"
import { RUNTIME } from "@/lib/ai/config"
import { MobileNav } from "./mobile-nav"

export function AppShell({
  user,
  children,
}: {
  user: { name: string; email: string }
  children: React.ReactNode
}) {
  return (
    <div className="flex min-h-svh">
      {/* Sidebar */}
      <aside className="sticky top-0 hidden h-svh w-60 shrink-0 flex-col border-r border-border bg-sidebar lg:flex">
        <Link href="/" className="flex items-center gap-2.5 border-b border-border px-4 py-4">
          <div className="flex h-8 w-8 items-center justify-center rounded-md bg-primary/15 text-primary">
            <Terminal className="h-4 w-4" />
          </div>
          <div>
            <p className="font-mono text-sm font-semibold leading-none tracking-tight">WilliamOS</p>
            <p className="mt-0.5 font-mono text-[10px] text-muted-foreground">operator shell</p>
          </div>
        </Link>
        <SidebarNav />
        <div className="border-t border-border px-4 py-3">
          <p className="font-mono text-[10px] leading-relaxed text-muted-foreground">
            <span className="text-success">●</span> runtime online
            <br />
            {RUNTIME.chatModel}
          </p>
        </div>
      </aside>

      {/* Main */}
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-20 flex h-14 items-center justify-between gap-3 border-b border-border bg-background/80 px-4 backdrop-blur sm:px-6">
          <div className="flex items-center gap-2">
            <MobileNav />
            <span className="font-mono text-xs text-muted-foreground">
              williamos / <span className="text-foreground">governed</span>
            </span>
          </div>
          <UserMenu name={user.name} email={user.email} />
        </header>
        <main className="flex-1">{children}</main>
      </div>
    </div>
  )
}
