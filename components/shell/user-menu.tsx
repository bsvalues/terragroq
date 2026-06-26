"use client"

import { useRouter } from "next/navigation"
import { authClient } from "@/lib/auth-client"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { LogOut } from "lucide-react"

export function UserMenu({ name, email }: { name: string; email: string }) {
  const router = useRouter()
  const initials = name
    .split(" ")
    .map((p) => p[0])
    .slice(0, 2)
    .join("")
    .toUpperCase()

  async function signOut() {
    await authClient.signOut()
    router.push("/sign-in")
    router.refresh()
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" className="h-9 gap-2 px-2">
          <span className="flex h-7 w-7 items-center justify-center rounded-full bg-primary/15 font-mono text-xs text-primary">
            {initials || "OP"}
          </span>
          <span className="hidden text-sm sm:inline">{name}</span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        <DropdownMenuLabel>
          <p className="text-sm font-medium">{name}</p>
          <p className="font-mono text-xs text-muted-foreground">{email}</p>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={signOut}>
          <LogOut className="h-4 w-4" />
          End session
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
