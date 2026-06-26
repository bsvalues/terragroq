"use client"

import { useState } from "react"
import { Menu } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogTitle, DialogTrigger } from "@/components/ui/dialog"
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
      <DialogContent className="left-0 top-0 h-svh max-w-64 translate-x-0 translate-y-0 gap-0 rounded-none border-y-0 border-l-0 p-0 sm:max-w-64 data-[state=closed]:slide-out-to-left data-[state=open]:slide-in-from-left">
        <DialogTitle className="border-b border-border px-4 py-4 font-mono text-sm">WilliamOS</DialogTitle>
        <div onClick={() => setOpen(false)} className="flex flex-1 flex-col overflow-hidden">
          <SidebarNav />
        </div>
      </DialogContent>
    </Dialog>
  )
}
