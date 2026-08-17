"use client"

import { useCallback, useEffect, useState } from "react"
import { Loader2, Smartphone } from "lucide-react"

import { Button } from "@/components/ui/button"

/**
 * Sign another device in without asking the operator to set anything up on it.
 *
 * This device is already trusted, so it can vouch for the next one: it shows a code, the phone
 * types it, the phone gets its own session. No passkey, no platform authenticator, no dependency on
 * what the phone's operating system is willing to do for this origin.
 */
export function DeviceLinkPanel({ entryUrl }: { entryUrl: string }) {
  const [code, setCode] = useState<string | null>(null)
  const [expiresAt, setExpiresAt] = useState<number | null>(null)
  const [remaining, setRemaining] = useState<number>(0)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const mint = useCallback(async () => {
    setBusy(true); setError(null)
    try {
      const response = await fetch("/api/device-link", { method: "POST", cache: "no-store" })
      if (!response.ok) throw new Error(response.status === 401 ? "Sign in again to add a device." : "A code could not be created.")
      const payload = (await response.json()) as { code: string; expiresAt: string }
      setCode(payload.code)
      setExpiresAt(new Date(payload.expiresAt).getTime())
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "A code could not be created.")
      setCode(null); setExpiresAt(null)
    } finally {
      setBusy(false)
    }
  }, [])

  useEffect(() => {
    if (expiresAt === null) return
    const tick = () => setRemaining(Math.max(0, Math.round((expiresAt - Date.now()) / 1000)))
    tick()
    const timer = window.setInterval(tick, 1000)
    return () => window.clearInterval(timer)
  }, [expiresAt])

  const live = code !== null && remaining > 0

  return (
    <section className="flex flex-col gap-4" aria-label="Sign in another device">
      <div className="flex items-center gap-2">
        <Smartphone className="h-4 w-4 text-muted-foreground" aria-hidden />
        <h2 className="text-sm font-medium">Sign in your phone or another computer</h2>
      </div>

      <div className="flex flex-col gap-2 rounded-lg border border-border p-4">
        <p className="text-xs uppercase tracking-wide text-muted-foreground">On the other device, open</p>
        <p className="font-mono text-sm break-all">{entryUrl}</p>
      </div>

      {live ? (
        <div className="flex flex-col gap-2 rounded-lg border border-border bg-muted/20 p-4">
          <p className="text-xs uppercase tracking-wide text-muted-foreground">Then type this code</p>
          <p className="font-mono text-3xl font-semibold tracking-[0.2em]">{code}</p>
          <p className="text-xs text-muted-foreground" role="status" aria-live="polite">
            Expires in {remaining}s. It works once.
          </p>
        </div>
      ) : null}

      <div className="flex flex-wrap items-center gap-3">
        <Button type="button" onClick={mint} disabled={busy} className="gap-2">
          {busy ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : null}
          {code === null ? "Show a code" : live ? "New code" : "Code expired — get another"}
        </Button>
        <p className="text-xs text-muted-foreground">
          The other device needs nothing installed. It just has to reach this address.
        </p>
      </div>

      {error ? <p role="alert" className="text-xs text-destructive">{error}</p> : null}
    </section>
  )
}
