"use client"

import { useMemo, useState } from "react"
import Link from "next/link"
import { AlertTriangle, CheckCircle2, KeyRound, RefreshCw, ShieldCheck } from "lucide-react"
import { toast } from "sonner"
import type { AuthReadiness } from "@/lib/auth-readiness"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { DECLARED_PRIMARY_EMAIL } from "@/lib/primary-identity"

type SetupSaveResponse = {
  ok: boolean
  message: string
  restartRequired?: boolean
}

type SetupStatusResponse = {
  ok: boolean
  readiness: AuthReadiness
  processStartedAt: number
  runtimeInstanceId: string
  checkedAt: string
  message?: string
}

type PrimaryCredentialResponse = {
  ok: boolean
  operation?: "provisioning" | "recovery"
  message: string
}

function generateSecret() {
  const bytes = new Uint8Array(32)
  crypto.getRandomValues(bytes)
  const encoded = btoa(String.fromCharCode(...bytes))
  return encoded.replace(/\+/g, "-").replace(/\//g, "_")
}

export function AuthSetupAssistant({
  initialReadiness,
  defaultAuthUrl,
  initialProcessStartedAt,
}: {
  initialReadiness: AuthReadiness
  defaultAuthUrl: string
  initialProcessStartedAt: number
}) {
  const [databaseUrl, setDatabaseUrl] = useState("")
  const [authSecret, setAuthSecret] = useState("")
  const [authUrl, setAuthUrl] = useState(defaultAuthUrl)
  const [saving, setSaving] = useState(false)
  const [statusChecking, setStatusChecking] = useState(false)
  const [saved, setSaved] = useState(false)
  const [statusResult, setStatusResult] = useState<SetupStatusResponse | null>(null)
  const [primaryEmail] = useState(DECLARED_PRIMARY_EMAIL)
  const [primaryName, setPrimaryName] = useState("Primary Operator")
  const [primaryPassword, setPrimaryPassword] = useState("")
  const [primaryPasswordConfirm, setPrimaryPasswordConfirm] = useState("")
  const [credentialSaving, setCredentialSaving] = useState(false)
  const [credentialSaved, setCredentialSaved] = useState(false)

  const effectiveReadiness = statusResult?.readiness ?? initialReadiness
  const restartDetected =
    statusResult != null && statusResult.processStartedAt !== initialProcessStartedAt

  const blockingIssues = useMemo(
    () => effectiveReadiness.issues.filter((issue) => issue.severity === "error"),
    [effectiveReadiness.issues],
  )
  const bootstrapLocked =
    effectiveReadiness.signup.mode === "bootstrap" && !effectiveReadiness.signup.open

  async function checkPostRestartStatus() {
    setStatusChecking(true)
    try {
      const response = await fetch("/api/setup/local-status", {
        method: "GET",
        cache: "no-store",
        headers: { accept: "application/json" },
      })
      const payload = (await response.json()) as Partial<SetupStatusResponse>
      if (!response.ok || !payload.ok) {
        throw new Error(payload.message || "Setup status check failed.")
      }
      if (
        !payload.readiness ||
        typeof payload.processStartedAt !== "number" ||
        typeof payload.runtimeInstanceId !== "string" ||
        typeof payload.checkedAt !== "string"
      ) {
        throw new Error("Setup status endpoint returned an invalid payload.")
      }
      setStatusResult(payload as SetupStatusResponse)
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Setup status check failed.",
      )
    } finally {
      setStatusChecking(false)
    }
  }

  async function onSave(e: React.FormEvent) {
    e.preventDefault()
    setSaving(true)
    try {
      const response = await fetch("/api/setup/local-config", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          databaseUrl,
          authSecret,
          authUrl,
        }),
      })

      const payload = (await response.json()) as SetupSaveResponse
      if (!response.ok || !payload.ok) {
        throw new Error(payload.message || "Setup save failed.")
      }

      setSaved(true)
      setStatusResult(null)
      toast.success(payload.message)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Setup save failed.")
    } finally {
      setSaving(false)
    }
  }

  async function onPrimaryCredentialSave(e: React.FormEvent) {
    e.preventDefault()
    setCredentialSaving(true)
    try {
      const response = await fetch("/api/setup/primary-credential", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          email: primaryEmail,
          name: primaryName,
          password: primaryPassword,
          confirmPassword: primaryPasswordConfirm,
        }),
      })

      const payload = (await response.json()) as PrimaryCredentialResponse
      if (!response.ok || !payload.ok) {
        throw new Error(payload.message || "Primary credential setup failed.")
      }

      setCredentialSaved(true)
      setPrimaryPassword("")
      setPrimaryPasswordConfirm("")
      toast.success(payload.message)
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Primary credential setup failed.",
      )
    } finally {
      setCredentialSaving(false)
    }
  }

  if (effectiveReadiness.ready) {
    return (
      <div className="flex flex-col gap-6 rounded-lg border border-border bg-card p-6">
        <div className="flex items-start gap-3">
          <CheckCircle2 className="mt-0.5 h-5 w-5 text-success" aria-hidden />
          <div className="space-y-2">
            <h2 className="text-lg font-semibold">Authentication is already configured</h2>
            <p className="text-sm text-muted-foreground">
              {saved
                ? "Setup completed successfully. Continue to controlled owner provisioning."
                : "This environment passed auth readiness checks. You can continue to sign in."}
            </p>
            {saved && restartDetected ? (
              <p className="text-xs text-muted-foreground">
                Restart detected ({statusResult?.runtimeInstanceId}). The app is
                now ready for operator provisioning.
              </p>
            ) : null}
            <Button asChild size="sm">
              <Link href="/sign-in">Go to Primary Access</Link>
            </Button>
          </div>
        </div>

        <div className="rounded-lg border border-border bg-muted/20 p-4">
          <div className="space-y-1">
            <h3 className="text-sm font-semibold">Controlled Primary credential</h3>
            <p className="text-sm text-muted-foreground">
              Establish or recover access for the declared Primary Operator identity
              on this local machine.
            </p>
          </div>

          <form onSubmit={onPrimaryCredentialSave} className="mt-4 grid gap-4">
            <div className="grid gap-2">
              <Label htmlFor="primary-name">Primary Operator name</Label>
              <Input
                id="primary-name"
                value={primaryName}
                onChange={(e) => setPrimaryName(e.target.value)}
                autoComplete="name"
              />
            </div>

            <div className="grid gap-2">
              <Label htmlFor="primary-email">Primary email</Label>
              <Input
                id="primary-email"
                type="email"
                value={primaryEmail}
                required
                readOnly
                autoComplete="email"
              />
            </div>

            <div className="grid gap-2">
              <Label htmlFor="primary-password">Primary password</Label>
              <Input
                id="primary-password"
                type="password"
                value={primaryPassword}
                onChange={(e) => setPrimaryPassword(e.target.value)}
                required
                minLength={8}
                maxLength={128}
                autoComplete="new-password"
              />
            </div>

            <div className="grid gap-2">
              <Label htmlFor="primary-password-confirm">Confirm Primary password</Label>
              <Input
                id="primary-password-confirm"
                type="password"
                value={primaryPasswordConfirm}
                onChange={(e) => setPrimaryPasswordConfirm(e.target.value)}
                required
                minLength={8}
                maxLength={128}
                autoComplete="new-password"
              />
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <Button type="submit" disabled={credentialSaving}>
                {credentialSaving ? (
                  <>
                    <RefreshCw className="mr-1.5 h-4 w-4 animate-spin" aria-hidden />
                    Saving Primary credential…
                  </>
                ) : (
                  "Save Primary credential"
                )}
              </Button>
              {credentialSaved ? (
                <Button asChild variant="outline">
                  <Link href="/sign-in">Enter WilliamOS</Link>
                </Button>
              ) : null}
            </div>
          </form>
        </div>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-6 rounded-lg border border-border bg-card p-6">
      <div className="space-y-2">
        <div className="inline-flex items-center gap-2 rounded-full border border-border px-2.5 py-1 text-xs text-muted-foreground">
          <ShieldCheck className="h-3.5 w-3.5" aria-hidden />
          Local setup assistant
        </div>
        <h2 className="text-xl font-semibold">Complete authentication setup</h2>
        <p className="text-sm text-muted-foreground">
          Configure local auth prerequisites directly from the app. This writes a
          <span className="mx-1 font-mono">.env.local</span>
          file for this private WilliamOS instance.
        </p>
      </div>

      {blockingIssues.length > 0 ? (
        <div className="rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-sm">
          <div className="flex items-start gap-2">
            <AlertTriangle className="mt-0.5 h-4 w-4 text-destructive" aria-hidden />
            <div className="space-y-1">
              <p className="font-medium text-destructive">Current blockers</p>
              <ul className="list-disc pl-5 text-destructive">
                {blockingIssues.map((issue, index) => (
                  <li key={`${issue.code}-${index}`}>{issue.message}</li>
                ))}
              </ul>
            </div>
          </div>
        </div>
      ) : null}

      {bootstrapLocked ? (
        <div className="rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">
          {effectiveReadiness.signup.reason ??
            "Bootstrap setup is closed because an operator already exists."}
        </div>
      ) : null}

      <form onSubmit={onSave} className="grid gap-4">
        <div className="grid gap-2">
          <Label htmlFor="database-url">DATABASE_URL</Label>
          <Input
            id="database-url"
            type="password"
            value={databaseUrl}
            onChange={(e) => setDatabaseUrl(e.target.value)}
            placeholder="postgres://USER:PASSWORD@HOST:5432/DB_NAME?sslmode=verify-full"
            required
            autoComplete="off"
          />
        </div>

        <div className="grid gap-2">
          <div className="flex items-center justify-between">
            <Label htmlFor="auth-secret">BETTER_AUTH_SECRET</Label>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-7 px-2 text-xs"
              onClick={() => setAuthSecret(generateSecret())}
            >
              <KeyRound className="mr-1 h-3.5 w-3.5" aria-hidden />
              Generate
            </Button>
          </div>
          <Input
            id="auth-secret"
            type="password"
            value={authSecret}
            onChange={(e) => setAuthSecret(e.target.value)}
            placeholder="32+ byte secret"
            required
            minLength={32}
            autoComplete="off"
          />
        </div>

        <div className="grid gap-2">
          <Label htmlFor="auth-url">BETTER_AUTH_URL</Label>
          <Input
            id="auth-url"
            type="url"
            value={authUrl}
            onChange={(e) => setAuthUrl(e.target.value)}
            required
            autoComplete="off"
          />
        </div>

        <Button type="submit" disabled={saving}>
          {saving ? (
            <>
              <RefreshCw className="mr-1.5 h-4 w-4 animate-spin" aria-hidden />
              Saving setup…
            </>
          ) : (
            "Save local setup"
          )}
        </Button>
      </form>

      <div className="rounded-lg border border-border bg-muted/30 p-3 text-xs text-muted-foreground">
        {saved ? (
          <div className="space-y-2">
            <p>
              Config saved. Restart the app process so Next.js reloads environment
              variables, then check status.
            </p>
            <div className="flex flex-wrap items-center gap-2">
              <Button
                type="button"
                size="sm"
                variant="outline"
                className="h-7 px-2 text-xs"
                onClick={() => void checkPostRestartStatus()}
                disabled={statusChecking}
              >
                {statusChecking ? (
                  <>
                    <RefreshCw className="mr-1 h-3.5 w-3.5 animate-spin" aria-hidden />
                    Checking…
                  </>
                ) : (
                  "I restarted — check status"
                )}
              </Button>
              {statusResult ? (
                <span className="font-mono">
                  instance {statusResult.runtimeInstanceId} ·{" "}
                  {new Date(statusResult.checkedAt).toLocaleTimeString()}
                </span>
              ) : null}
            </div>
            {statusResult && !restartDetected ? (
              <p className="text-warning">
                No process restart detected yet. Restart the app, then check again.
              </p>
            ) : null}
          </div>
        ) : (
          <>
            This assistant is intended for local owner provisioning. In production, platform
            configuration should be managed by deployment administrators and secret
            managers.
          </>
        )}
      </div>

      <div className="flex items-center gap-2">
        <Button asChild size="sm" variant="outline">
          <Link href="/sign-in">Back to Primary Access</Link>
        </Button>
        <Button asChild size="sm" variant="ghost">
          <Link href="/operator">Back to Operator entry</Link>
        </Button>
      </div>
    </div>
  )
}
