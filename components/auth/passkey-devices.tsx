"use client"

import { useCallback, useEffect, useState } from "react"
import { Fingerprint, Loader2, Trash2 } from "lucide-react"

import { authClient } from "@/lib/auth-client"
import { Button } from "@/components/ui/button"

type Passkey = {
  id: string
  name?: string | null
  deviceType?: string | null
  backedUp?: boolean | null
  createdAt?: string | Date | null
}

function describe(passkey: Passkey): string {
  const parts: string[] = []
  if (passkey.deviceType === "multiDevice" || passkey.backedUp) parts.push("syncs to your other devices")
  else parts.push("stays on this device")
  if (passkey.createdAt) {
    const when = new Date(passkey.createdAt)
    if (!Number.isNaN(when.getTime())) parts.push(`added ${when.toISOString().slice(0, 10)}`)
  }
  return parts.join(" · ")
}

function defaultLabel(): string {
  if (typeof navigator === "undefined") return "This device"
  const agent = navigator.userAgent
  if (/iPhone/i.test(agent)) return "iPhone"
  if (/iPad/i.test(agent)) return "iPad"
  if (/Android/i.test(agent)) return "Android phone"
  if (/Macintosh/i.test(agent)) return "Mac"
  if (/Windows/i.test(agent)) return "Windows PC"
  return "This device"
}

/**
 * Enrolled devices for the Primary Operator: what can sign in, and how to add or remove one.
 * Enrollment is only reachable from an authenticated session, so a passkey can only ever be
 * added by someone who is already the operator.
 */
export function PasskeyDevices({ available, unavailableReason }: { available: boolean; unavailableReason?: string | null }) {
  const [devices, setDevices] = useState<Passkey[] | null>(null)
  // Whether THIS computer has a built-in authenticator (Windows Hello, Touch ID). A desktop with
  // no fingerprint reader, no camera and no Hello PIN has none, and the browser will then only
  // offer a phone, a security key, or a password manager. Saying "use Windows Hello" on such a
  // machine is a lie the owner discovers halfway through a prompt, so ask the browser instead.
  const [platformAuthenticator, setPlatformAuthenticator] = useState<boolean | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    try {
      const result = await authClient.passkey.listUserPasskeys()
      setDevices((result?.data as Passkey[] | undefined) ?? [])
    } catch {
      setError("Enrolled devices could not be read.")
      setDevices([])
    }
  }, [])

  useEffect(() => {
    if (available) void refresh()
  }, [available, refresh])

  useEffect(() => {
    const api = typeof window === "undefined" ? undefined : window.PublicKeyCredential
    if (!api?.isUserVerifyingPlatformAuthenticatorAvailable) { setPlatformAuthenticator(false); return }
    void api.isUserVerifyingPlatformAuthenticatorAvailable()
      .then((present) => setPlatformAuthenticator(present))
      .catch(() => setPlatformAuthenticator(false))
  }, [])

  if (!available) {
    return (
      <div className="rounded-lg border border-border bg-muted/20 p-4 text-sm">
        <p className="font-medium">Device sign-in unavailable</p>
        <p className="mt-1 text-xs text-muted-foreground">
          {unavailableReason ?? "Passkeys are not configured for this origin."}
        </p>
      </div>
    )
  }

  async function addThisDevice() {
    setBusy(true)
    setError(null)
    setNotice(null)
    try {
      const result = await authClient.passkey.addPasskey({ name: defaultLabel(), authenticatorAttachment: "platform" })
      if (result?.error) throw new Error(result.error.message ?? "This device could not be enrolled.")
      setNotice("This device can now sign you in.")
      await refresh()
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : "This device could not be enrolled."
      setError(/NotAllowed|abort|cancel/i.test(message) ? "Enrollment was cancelled." : message)
    } finally {
      setBusy(false)
    }
  }

  async function remove(id: string) {
    setBusy(true)
    setError(null)
    setNotice(null)
    try {
      const result = await authClient.passkey.deletePasskey({ id })
      if (result?.error) throw new Error(result.error.message ?? "That device could not be removed.")
      await refresh()
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "That device could not be removed.")
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="flex flex-col gap-4" aria-label="Sign-in devices">
      <div className="flex flex-wrap items-center gap-3">
        <Button type="button" onClick={addThisDevice} disabled={busy} className="gap-2">
          {busy ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Fingerprint className="h-4 w-4" aria-hidden />}
          Add this device
        </Button>
        <p className="text-xs text-muted-foreground">
          {platformAuthenticator === false
            ? "This computer has no built-in authenticator, so choose the phone option in the prompt and scan the code with your phone. Nothing secret leaves either device."
            : "Uses this computer's built-in unlock, or choose the phone option to scan with your phone. Nothing secret leaves the device."}
        </p>
      </div>

      {notice ? <p role="status" className="text-xs text-[var(--workbench-live,inherit)]">{notice}</p> : null}
      {error ? <p role="alert" className="text-xs text-destructive">{error}</p> : null}

      {devices === null ? (
        <p role="status" className="text-xs text-muted-foreground">Reading enrolled devices…</p>
      ) : devices.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          No devices are enrolled yet. Add this one, then add your phone from the onboarding panel below.
        </p>
      ) : (
        <ul className="divide-y divide-border rounded-lg border border-border">
          {devices.map((device) => (
            <li key={device.id} className="flex items-center justify-between gap-4 px-4 py-3">
              <span className="min-w-0">
                <span className="block truncate text-sm font-medium">{device.name?.trim() || "Unnamed device"}</span>
                <span className="block truncate text-xs text-muted-foreground">{describe(device)}</span>
              </span>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => remove(device.id)}
                disabled={busy}
                aria-label={`Remove ${device.name?.trim() || "this device"}`}
              >
                <Trash2 className="h-4 w-4" aria-hidden />
              </Button>
            </li>
          ))}
        </ul>
      )}

      {devices !== null && devices.length === 1 ? (
        <p className="text-xs text-muted-foreground">
          Only one device is enrolled. Add a second before turning the password off, so losing this
          one cannot lock you out.
        </p>
      ) : null}
    </section>
  )
}
