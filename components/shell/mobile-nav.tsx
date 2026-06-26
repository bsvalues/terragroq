"use client"

import { useState } from "react"
import { Menu } from "lucide-react"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import { SidebarNav } from "./sidebar-nav"

export function MobileNav() {
  const [open, setOpen] = useState(false)
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="ghost" size="icon" className="lg:hidden" aria-label="Open navigation">
          <Menu className="h-5 w-5" />
        </Button>
      </DialogTrigger>
      <DialogContent className="left-0 top-0 h-full max-w-[280px] translate-x-0 translate-y-0 rounded-none border-r p-0 data-[state=open]:slide-in-from-left data-[state=closed]:slide-out-to-left">
        <DialogTitle className="sr-only">Navigation</DialogTitle>
        <div className="border-b border-border px-5 py-4 font-mono text-sm">WilliamOS</div>
        <SidebarNav onNavigate={() => setOpen(false)} />
      </DialogContent>
    </Dialog>
  )
}
