"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import Link from "next/link"
import { authClient } from "@/lib/auth-client"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { toast } from "sonner"
import { Loader2, Terminal } from "lucide-react"

export function AuthForm({ mode }: { mode: "sign-in" | "sign-up" }) {
  const router = useRouter()
  const [loading, setLoading] = useState(false)
  const [name, setName] = useState("")
  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")

  const isSignUp = mode === "sign-up"

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    try {
      if (isSignUp) {
        const { error } = await authClient.signUp.email({ email, password, name })
        if (error) throw new Error(error.message)
      } else {
        const { error } = await authClient.signIn.email({ email, password })
        if (error) throw new Error(error.message)
      }
      router.push("/")
      router.refresh()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Authentication failed")
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="w-full max-w-sm">
      <div className="mb-8 flex items-center gap-2.5">
        <div className="flex h-9 w-9 items-center justify-center rounded-md bg-primary/15 text-primary">
          <Terminal className="h-5 w-5" />
        </div>
        <div>
          <p className="font-mono text-sm font-semibold tracking-tight">WilliamOS</p>
          <p className="font-mono text-xs text-muted-foreground">operator shell</p>
        </div>
      </div>

      <h1 className="text-balance text-xl font-semibold tracking-tight">
        {isSignUp ? "Provision operator access" : "Authenticate operator"}
      </h1>
      <p className="mt-1 text-sm text-muted-foreground text-pretty">
        {isSignUp
          ? "Create an account to begin governing your second brain."
          : "Sign in to resume your governed session."}
      </p>

      <form onSubmit={onSubmit} className="mt-6 flex flex-col gap-4">
        {isSignUp && (
          <div className="flex flex-col gap-2">
            <Label htmlFor="name">Name</Label>
            <Input id="name" value={name} onChange={(e) => setName(e.target.value)} required placeholder="Ada Lovelace" />
          </div>
        )}
        <div className="flex flex-col gap-2">
          <Label htmlFor="email">Email</Label>
          <Input
            id="email"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            placeholder="operator@williamos.dev"
          />
        </div>
        <div className="flex flex-col gap-2">
          <Label htmlFor="password">Password</Label>
          <Input
            id="password"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            minLength={8}
            placeholder="••••••••"
          />
        </div>
        <Button type="submit" disabled={loading} className="mt-2">
          {loading && <Loader2 className="h-4 w-4 animate-spin" />}
          {isSignUp ? "Create account" : "Sign in"}
        </Button>
      </form>

      <p className="mt-6 text-center text-sm text-muted-foreground">
        {isSignUp ? "Already provisioned? " : "Need access? "}
        <Link href={isSignUp ? "/sign-in" : "/sign-up"} className="text-primary hover:underline">
          {isSignUp ? "Sign in" : "Create an account"}
        </Link>
      </p>
    </div>
  )
}
