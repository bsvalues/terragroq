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
import {
  CORE_SEVEN_REPOSITORIES,
  type WorkspaceRepositoryMountView,
} from "@/lib/projects/core-seven-repositories"

type SetupSaveResponse = {
  ok: boolean
  message: string
  restartRequired?: boolean
}

type SetupStatusResponse = {
  ok: boolean
  readiness: AuthReadiness
  terraFusionRootConfigured: boolean
  coreSevenRepositories?: readonly WorkspaceRepositoryMountView[]
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
  defaultTerraFusionRoot,
  initialTerraFusionRootConfigured,
  initialCoreSevenRepositories = [],
  initialProcessStartedAt,
}: {
  initialReadiness: AuthReadiness
  defaultAuthUrl: string
  defaultTerraFusionRoot: string
  initialTerraFusionRootConfigured: boolean
  initialCoreSevenRepositories?: readonly WorkspaceRepositoryMountView[]
  initialProcessStartedAt: number
}) {
  const [databaseUrl, setDatabaseUrl] = useState("")
  const [authSecret, setAuthSecret] = useState("")
  const [authUrl, setAuthUrl] = useState(defaultAuthUrl)
  const [terraFusionRoot, setTerraFusionRoot] = useState(defaultTerraFusionRoot)
  const [saving, setSaving] = useState(false)
  const [editingTerraFusionRoot, setEditingTerraFusionRoot] = useState(
    !initialTerraFusionRootConfigured,
  )
  const [statusChecking, setStatusChecking] = useState(false)
  const [saved, setSaved] = useState(false)
  const [statusResult, setStatusResult] = useState<SetupStatusResponse | null>(null)
  const [primaryEmail] = useState(DECLARED_PRIMARY_EMAIL)
  const [primaryName, setPrimaryName] = useState("Primary Operator")
  const [primaryPassword, setPrimaryPassword] = useState("")
  const [primaryPasswordConfirm, setPrimaryPasswordConfirm] = useState("")
  const [credentialSaving, setCredentialSaving] = useState(false)
  const [credentialSaved, setCredentialSaved] = useState(false)
  const [editingRepositoryKey, setEditingRepositoryKey] = useState<string | null>(null)
  const [repositoryRoot, setRepositoryRoot] = useState("")
  const [savingRepositoryKey, setSavingRepositoryKey] = useState<string | null>(null)
  const [pendingRepositoryRestart, setPendingRepositoryRestart] = useState<string | null>(null)

  const effectiveReadiness = statusResult?.readiness ?? initialReadiness
  const terraFusionRootConfigured =
    statusResult?.terraFusionRootConfigured ?? initialTerraFusionRootConfigured
  const coreSevenRepositories =
    statusResult?.coreSevenRepositories ?? initialCoreSevenRepositories
  const secondaryRepositories = CORE_SEVEN_REPOSITORIES.filter(
    (repository) => repository.key !== "os-1",
  )
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
        typeof payload.checkedAt !== "string" ||
        typeof payload.terraFusionRootConfigured !== "boolean"
      ) {
        throw new Error("Setup status endpoint returned an invalid payload.")
      }
      const verifiedStatus = payload as SetupStatusResponse
      setStatusResult(verifiedStatus)
      if (verifiedStatus.processStartedAt !== initialProcessStartedAt) {
        setPendingRepositoryRestart(null)
      }
      if (
        verifiedStatus.terraFusionRootConfigured &&
        verifiedStatus.processStartedAt !== initialProcessStartedAt
      ) {
        setEditingTerraFusionRoot(false)
      }
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
          terraFusionRoot,
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

  async function onTerraFusionRootSave(e: React.FormEvent) {
    e.preventDefault()
    setSaving(true)
    try {
      const response = await fetch("/api/setup/local-config", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          operation: "terrafusion-root",
          terraFusionRoot,
        }),
      })

      const payload = (await response.json()) as SetupSaveResponse
      if (!response.ok || !payload.ok) {
        throw new Error(payload.message || "TerraFusion checkout save failed.")
      }

      setSaved(true)
      setStatusResult(null)
      toast.success(payload.message)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "TerraFusion checkout save failed.")
    } finally {
      setSaving(false)
    }
  }

  async function onRepositoryRootSave(e: React.FormEvent) {
    e.preventDefault()
    if (!editingRepositoryKey) return
    setSavingRepositoryKey(editingRepositoryKey)
    try {
      const response = await fetch("/api/setup/local-config", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          operation: "terrafusion-repository-root",
          repositoryKey: editingRepositoryKey,
          repositoryRoot,
        }),
      })
      const payload = (await response.json()) as SetupSaveResponse
      if (!response.ok || !payload.ok) {
        throw new Error(payload.message || "Repository checkout save failed.")
      }
      setStatusResult(null)
      setPendingRepositoryRestart(
        secondaryRepositories.find((repository) => repository.key === editingRepositoryKey)?.label
          ?? editingRepositoryKey,
      )
      setEditingRepositoryKey(null)
      setRepositoryRoot("")
      toast.success(payload.message)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Repository checkout save failed.")
    } finally {
      setSavingRepositoryKey(null)
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
          {terraFusionRootConfigured && !editingTerraFusionRoot ? (
            <div className="flex items-start gap-2">
              <CheckCircle2 className="mt-0.5 h-4 w-4 text-success" aria-hidden />
              <div className="space-y-1">
                <h3 className="text-sm font-semibold">TerraFusion checkout connected</h3>
                <p className="text-sm text-muted-foreground">
                  WilliamOS has a distinct target checkout for TerraFusion development. If that checkout moved or is no longer correct, replace it here.
                </p>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  className="mt-2"
                  onClick={() => setEditingTerraFusionRoot(true)}
                >
                  Change TerraFusion checkout
                </Button>
              </div>
            </div>
          ) : (
            <>
              <div className="space-y-1">
                <h3 className="text-sm font-semibold">
                  {terraFusionRootConfigured
                    ? "Change the TerraFusion checkout"
                    : "Connect the TerraFusion checkout"}
                </h3>
                <p className="text-sm text-muted-foreground">
                  {terraFusionRootConfigured
                    ? "Replace the configured target when the TerraFusion checkout moved or no longer identifies the repository WilliamOS should develop."
                    : "Authentication is ready, but WilliamOS still needs the real TerraFusion repository it will develop and preview."}
                </p>
              </div>
              <form onSubmit={onTerraFusionRootSave} className="mt-4 grid gap-3">
                <div className="grid gap-2">
                  <Label htmlFor="terra-fusion-root-ready">TerraFusion checkout</Label>
                  <Input
                    id="terra-fusion-root-ready"
                    type="text"
                    value={terraFusionRoot}
                    onChange={(e) => setTerraFusionRoot(e.target.value)}
                    placeholder="C:\\Users\\you\\terrafusion_os_1.0"
                    required
                    autoComplete="off"
                  />
                  <p className="text-xs text-muted-foreground">
                    This updates only the target checkout. It does not reopen or rewrite authentication setup.
                  </p>
                </div>
                <Button type="submit" disabled={saving} className="w-fit">
                  {saving ? (
                    <>
                      <RefreshCw className="mr-1.5 h-4 w-4 animate-spin" aria-hidden />
                      Saving checkout…
                    </>
                  ) : (
                    "Save TerraFusion checkout"
                  )}
                </Button>
                {terraFusionRootConfigured && !saved ? (
                  <Button
                    type="button"
                    variant="ghost"
                    className="w-fit"
                    onClick={() => setEditingTerraFusionRoot(false)}
                  >
                    Keep current checkout
                  </Button>
                ) : null}
                {saved ? (
                  <div className="space-y-2 text-xs text-muted-foreground">
                    <p>Checkout saved. Restart WilliamOS, then verify the target connection.</p>
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      className="h-7 px-2 text-xs"
                      onClick={() => void checkPostRestartStatus()}
                      disabled={statusChecking}
                    >
                      {statusChecking ? "Checking…" : "I restarted — check target"}
                    </Button>
                  </div>
                ) : null}
              </form>
            </>
          )}
        </div>

        <div className="rounded-lg border border-border bg-muted/20 p-4">
          <div className="space-y-1">
            <h3 className="text-sm font-semibold">Core Seven repository mounts</h3>
            <p className="text-sm text-muted-foreground">
              Connect the six supporting repositories without changing their roles or turning
              TerraFusion into a virtual monorepo. Every checkout is verified against the
              server-owned repository catalog before it is saved.
            </p>
          </div>
          <div className="mt-4 grid gap-2">
            {secondaryRepositories.map((repository) => {
              const observed = coreSevenRepositories.find(
                (candidate) => candidate.key === repository.key,
              )
              const connected = observed?.mount.verified === true
              return (
                <div
                  key={repository.key}
                  className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-border/70 bg-background/40 px-3 py-2"
                >
                  <div>
                    <div className="text-sm font-medium">{repository.label}</div>
                    <div className="text-xs text-muted-foreground">
                      {repository.role === "suite-source"
                        ? `${repository.label} suite source`
                        : "Sovereign planning and promotion · non-runnable"}
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className={connected ? "text-xs text-success" : "text-xs text-muted-foreground"}>
                      {connected ? "Verified mount" : observed?.mount.refusal ?? "Not configured"}
                    </span>
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      onClick={() => {
                        setEditingRepositoryKey(repository.key)
                        setRepositoryRoot("")
                      }}
                    >
                      {connected ? `Change ${repository.label}` : `Connect ${repository.label}`}
                    </Button>
                  </div>
                </div>
              )
            })}
          </div>
          {editingRepositoryKey ? (
            <form onSubmit={onRepositoryRootSave} className="mt-4 grid gap-3 rounded-md border border-border p-3">
              <div className="grid gap-2">
                <Label htmlFor="core-seven-repository-root">
                  {secondaryRepositories.find((repository) => repository.key === editingRepositoryKey)?.label} checkout
                </Label>
                <Input
                  id="core-seven-repository-root"
                  type="text"
                  value={repositoryRoot}
                  onChange={(event) => setRepositoryRoot(event.target.value)}
                  placeholder="C:\\Repositories\\terrafusion-atlas"
                  required
                  autoComplete="off"
                />
                <p className="text-xs text-muted-foreground">
                  The repository key, canonical GitHub identity, role, and environment slot come
                  from WilliamOS. This path cannot redefine them.
                </p>
              </div>
              <div className="flex gap-2">
                <Button type="submit" disabled={savingRepositoryKey !== null}>
                  {savingRepositoryKey ? "Verifying checkout…" : "Save repository mount"}
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  onClick={() => {
                    setEditingRepositoryKey(null)
                    setRepositoryRoot("")
                  }}
                >
                  Cancel
                </Button>
              </div>
            </form>
          ) : null}
          {pendingRepositoryRestart ? (
            <div className="mt-4 flex flex-wrap items-center gap-2 rounded-md border border-warning/40 bg-warning/10 p-3 text-xs">
              <span>
                {pendingRepositoryRestart} mount saved. Restart WilliamOS before the workspace can use it.
              </span>
              <Button
                type="button"
                size="sm"
                variant="outline"
                className="h-7 px-2 text-xs"
                onClick={() => void checkPostRestartStatus()}
                disabled={statusChecking}
              >
                {statusChecking ? "Checking…" : "I restarted — check mounts"}
              </Button>
            </div>
          ) : null}
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

        <div className="grid gap-2">
          <Label htmlFor="project-root">TerraFusion checkout</Label>
          <Input
            id="project-root"
            type="text"
            value={terraFusionRoot}
            onChange={(e) => setTerraFusionRoot(e.target.value)}
            placeholder="C:\\Users\\you\\terrafusion_os_1.0"
            required
            autoComplete="off"
          />
          <p className="text-xs text-muted-foreground">
            Absolute path to the real TerraFusion repository WilliamOS will develop and preview.
          </p>
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
