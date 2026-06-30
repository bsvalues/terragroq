"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import Link from "next/link"
import { AlertTriangle, CheckCircle2, LockKeyhole, ShieldAlert } from "lucide-react"
import { authClient } from "@/lib/auth-client"
import { getAuthRecoveryCopy, type AuthRecoveryCopy } from "@/lib/auth-error-copy"
import { getAuthUxState } from "@/lib/auth-ux-state"
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
  const [authFailure, setAuthFailure] = useState<AuthRecoveryCopy | null>(null)
  const [runtimeSignup, setRuntimeSignup] = useState<AuthReadinessState["signup"]>(
    readiness?.signup,
  )

  const isSignUp = mode === "sign-up"
  const mergedIssues = [...(readiness?.issues ?? []), ...runtimeIssues]
  const blockingIssues = mergedIssues.filter((issue) => issue.severity === "error")
  const warningIssues = mergedIssues.filter((issue) => issue.severity === "warning")
  const signupOpen = runtimeSignup?.open ?? true
  const uxState = getAuthUxState(mode, {
    ready: readiness?.ready ?? blockingIssues.length === 0,
    issues: mergedIssues,
    signup: runtimeSignup,
  })
  const submitDisabled =
    loading || blockingIssues.length > 0 || (isSignUp && !signupOpen)
  const recoveryClass =
    authFailure?.tone === "blocked"
      ? "border-destructive/30 bg-destructive/10 text-destructive"
      : "border-warning/30 bg-warning/10 text-warning"
  const StateIcon =
    uxState.tone === "blocked"
      ? ShieldAlert
      : uxState.state === "signup-locked" || uxState.state === "signup-disabled"
        ? LockKeyhole
        : CheckCircle2
  const stateClass =
    uxState.tone === "blocked"
      ? "border-destructive/30 bg-destructive/10 text-destructive"
      : uxState.tone === "warning"
        ? "border-warning/30 bg-warning/10 text-warning"
        : "border-border bg-muted/30 text-foreground"

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
    setAuthFailure(null)
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
      const recovery = getAuthRecoveryCopy({
        mode,
        rawMessage: message,
        readiness: {
          ready: readiness?.ready ?? blockingIssues.length === 0,
          issues: mergedIssues,
          signup: runtimeSignup,
        },
      })
      if (/internal server error|network|fetch/i.test(message)) {
        try {
          await refreshReadiness()
        } catch {
          // Keep the original auth error as the primary signal.
        }
      }
      setAuthFailure(recovery)
      toast.error(recovery.title)
    } finally {
      setLoading(false)
    }
  }

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-5">
      <div className={`rounded-lg border p-3 text-sm ${stateClass}`}>
        <div className="flex items-start gap-2">
          <StateIcon className="mt-0.5 h-4 w-4" aria-hidden />
          <div className="space-y-1">
            <p className="text-xs font-medium uppercase tracking-wide">{uxState.label}</p>
            <p className="font-medium">{uxState.title}</p>
            <p className="text-xs opacity-85">{uxState.description}</p>
            {uxState.secondaryAction ? (
              <p className="text-xs">
                <Link
                  href={uxState.secondaryAction.href}
                  className="font-medium text-primary hover:underline"
                >
                  {uxState.secondaryAction.label}
                </Link>
              </p>
            ) : null}
          </div>
        </div>
      </div>

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

      {authFailure ? (
        <div className={`rounded-lg border p-3 text-sm ${recoveryClass}`}>
          <div className="flex items-start gap-2">
            <AlertTriangle className="mt-0.5 h-4 w-4" aria-hidden />
            <div className="space-y-2">
              <div className="space-y-1">
                <p className="font-medium">{authFailure.title}</p>
                <p className="text-xs opacity-85">{authFailure.message}</p>
              </div>
              <ul className="list-disc pl-5 text-xs opacity-85">
                {authFailure.recovery.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
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
        {loading ? "Authenticating…" : uxState.primaryAction}
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
