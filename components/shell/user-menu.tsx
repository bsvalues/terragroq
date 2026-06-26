"use client"

import { useRouter } from "next/navigation"
import { authClient } from "@/lib/auth-client"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { LogOut, User } from "lucide-react"

export function UserMenu({ name, email }: { name: string; email: string }) {
  const router = useRouter()
  const initials = name
    .split(" ")
    .map((w) => w[0])
    .join("")
    .slice(0, 2)
    .toUpperCase()

  async function handleSignOut() {
    await authClient.signOut()
    router.push("/sign-in")
    router.refresh()
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger className="flex items-center gap-3 rounded-md px-2 py-1.5 hover:bg-accent transition-colors outline-none">
        <div className="flex h-8 w-8 items-center justify-center rounded-md bg-primary text-primary-foreground text-xs font-semibold">
          {initials || <User className="h-4 w-4" />}
        </div>
        <div className="hidden md:flex flex-col items-start leading-tight">
          <span className="text-sm font-medium">{name}</span>
          <span className="text-xs text-muted-foreground">{email}</span>
        </div>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        <DropdownMenuLabel className="flex flex-col">
          <span>{name}</span>
          <span className="text-xs font-normal text-muted-foreground">{email}</span>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={handleSignOut} className="text-destructive focus:text-destructive">
          <LogOut className="h-4 w-4" />
          Sign out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
