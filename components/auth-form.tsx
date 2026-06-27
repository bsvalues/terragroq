"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import Link from "next/link"
import { AlertTriangle } from "lucide-react"
import { authClient } from "@/lib/auth-client"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { toast } from "sonner"

export type AuthIssue = {
  code: string
  severity: "error" | "warning"
  message: string
}

export type AuthReadinessState = {
  ready: boolean
  issues: AuthIssue[]
  signup?: {
    mode: "open" | "bootstrap" | "closed"
    open: boolean
    reason?: string
  }
}

export function AuthForm({
  mode,
  readiness,
}: {
  mode: "sign-in" | "sign-up"
  readiness?: AuthReadinessState
}) {
  const router = useRouter()
  const [loading, setLoading] = useState(false)
  const [name, setName] = useState("")
  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [runtimeIssues, setRuntimeIssues] = useState<AuthIssue[]>([])
  const [runtimeSignup, setRuntimeSignup] = useState<AuthReadinessState["signup"]>(
    readiness?.signup,
  )

  const isSignUp = mode === "sign-up"
  const mergedIssues = [...(readiness?.issues ?? []), ...runtimeIssues]
  const blockingIssues = mergedIssues.filter((issue) => issue.severity === "error")
  const warningIssues = mergedIssues.filter((issue) => issue.severity === "warning")
  const signupOpen = runtimeSignup?.open ?? true
  const submitDisabled =
    loading || blockingIssues.length > 0 || (isSignUp && !signupOpen)

  async function refreshReadiness() {
    const res = await fetch("/api/auth/readiness", {
      method: "GET",
      cache: "no-store",
      headers: { accept: "application/json" },
    })
    if (!res.ok && res.status !== 503) return

    const payload = (await res.json()) as {
      issues?: unknown
      signup?: unknown
    }
    if (!Array.isArray(payload.issues)) return
    const hydratedIssues = payload.issues.filter((item): item is AuthIssue => {
      if (!item || typeof item !== "object") return false
      if (!("code" in item) || !("severity" in item) || !("message" in item)) return false
      const severity = (item as { severity: unknown }).severity
      return severity === "error" || severity === "warning"
    })
    setRuntimeIssues(hydratedIssues)
    if (payload.signup && typeof payload.signup === "object") {
      const mode = (payload.signup as { mode?: unknown }).mode
      const open = (payload.signup as { open?: unknown }).open
      const reason = (payload.signup as { reason?: unknown }).reason
      if (
        (mode === "open" || mode === "bootstrap" || mode === "closed") &&
        typeof open === "boolean"
      ) {
        setRuntimeSignup({
          mode,
          open,
          reason: typeof reason === "string" ? reason : undefined,
        })
      }
    }
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (submitDisabled) return
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
      const message = err instanceof Error ? err.message : "Authentication failed"
      if (/internal server error|network|fetch/i.test(message)) {
        try {
          await refreshReadiness()
        } catch {
          // Keep the original auth error as the primary signal.
        }
      }
      toast.error(message)
    } finally {
      setLoading(false)
    }
  }

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-5">
      {mergedIssues.length > 0 ? (
        <div className="rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-sm">
          <div className="flex items-start gap-2">
            <AlertTriangle className="mt-0.5 h-4 w-4 text-destructive" aria-hidden />
            <div className="space-y-1">
              <p className="font-medium text-destructive">
                Authentication is not fully configured
              </p>
              {blockingIssues.length > 0 ? (
                <ul className="list-disc pl-5 text-destructive">
                  {blockingIssues.map((issue, index) => (
                    <li key={`${issue.code}-${index}`}>{issue.message}</li>
                  ))}
                </ul>
              ) : null}
              {warningIssues.length > 0 ? (
                <ul className="list-disc pl-5 text-muted-foreground">
                  {warningIssues.map((issue, index) => (
                    <li key={`${issue.code}-${index}`}>{issue.message}</li>
                  ))}
                </ul>
              ) : null}
              {isSignUp && !signupOpen ? (
                <p className="text-xs text-destructive">
                  {runtimeSignup?.reason ??
                    "Operator sign-up is currently disabled by policy."}
                </p>
              ) : null}
              <p className="text-xs text-muted-foreground">
                Readiness endpoint: <span className="font-mono">GET /api/auth/readiness</span>
              </p>
              {blockingIssues.length > 0 ? (
                <p className="text-xs">
                  <Link href="/setup" className="font-medium text-primary hover:underline">
                    Open setup assistant
                  </Link>
                </p>
              ) : null}
            </div>
          </div>
        </div>
      ) : null}

      {isSignUp && (
        <div className="flex flex-col gap-2">
          <Label htmlFor="name">Operator name</Label>
          <Input
            id="name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Jane Operator"
            required
            autoComplete="name"
          />
        </div>
      )}
      <div className="flex flex-col gap-2">
        <Label htmlFor="email">Email</Label>
        <Input
          id="email"
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="you@command.io"
          required
          autoComplete="email"
        />
      </div>
      <div className="flex flex-col gap-2">
        <Label htmlFor="password">Password</Label>
        <Input
          id="password"
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="••••••••"
          required
          minLength={8}
          autoComplete={isSignUp ? "new-password" : "current-password"}
        />
      </div>

      <Button type="submit" disabled={submitDisabled} className="mt-1">
        {loading ? "Authenticating…" : isSignUp ? "Provision operator" : "Enter the shell"}
      </Button>

      <p className="text-sm text-muted-foreground text-center">
        {isSignUp ? "Already provisioned? " : "No operator yet? "}
        <Link
          href={isSignUp ? "/sign-in" : "/sign-up"}
          className="text-primary hover:underline font-medium"
        >
          {isSignUp ? "Sign in" : "Create account"}
        </Link>
      </p>
    </form>
  )
}
