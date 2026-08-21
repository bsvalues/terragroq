"use client"

import { useEffect, useRef, useState } from "react"
import { useRouter } from "next/navigation"
import { Fingerprint } from "lucide-react"

import { authClient } from "@/lib/auth-client"
import { Button } from "@/components/ui/button"

/**
 * Passkey-first sign-in.
 *
 * This is WebAuthn — the credential lives in the device's TPM or secure enclave and is unlocked by
 * Windows Hello, Touch ID or Face ID. It is deliberately separate from lib/device-auth, which
 * attests the *native cockpit shell* with its own Ed25519 key; the two answer different questions
 * (which device is this, versus which operator is present) and neither replaces the other.
 *
 * When passkeys are unavailable the component says why rather than rendering a button that cannot
 * work, because the usual cause is a fixable configuration fault (an IP origin) and the owner
 * should not be left guessing.
 */
export function PasskeySignIn({
  available,
  unavailableReason,
  returnTo = "/",
}: {
  available: boolean
  unavailableReason?: string | null
  returnTo?: string
}) {
  const router = useRouter()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const autofillStarted = useRef(false)
  const [platformAuthenticator, setPlatformAuthenticator] = useState<boolean | null>(null)

  // Conditional UI: if the browser has a credential for this site it can be offered inline from
  // the email field without the owner pressing anything. Unsupported browsers simply ignore it.
  useEffect(() => {
    if (!available || autofillStarted.current) return
    autofillStarted.current = true
    void (async () => {
      try {
        const result = await authClient.signIn.passkey({ autoFill: true })
        if (result && !result.error) {
          router.push(returnTo)
          router.refresh()
        }
      } catch {
        // Conditional mediation is best-effort; the explicit button remains the reliable path.
      }
    })()
  }, [available, returnTo, router])

  useEffect(() => {
    const api = typeof window === "undefined" ? undefined : window.PublicKeyCredential
    if (!api?.isUserVerifyingPlatformAuthenticatorAvailable) { setPlatformAuthenticator(false); return }
    void api.isUserVerifyingPlatformAuthenticatorAvailable()
      .then((present) => setPlatformAuthenticator(present))
      .catch(() => setPlatformAuthenticator(false))
  }, [])

  if (!available) {
    return unavailableReason ? (
      <div className="rounded-lg border border-border bg-muted/20 p-3 text-sm">
        <p className="font-medium">Device sign-in unavailable</p>
        <p className="mt-1 text-xs text-muted-foreground">{unavailableReason}</p>
      </div>
    ) : null
  }

  async function signInWithDevice() {
    setBusy(true)
    setError(null)
    try {
      const result = await authClient.signIn.passkey()
      if (result?.error) throw new Error(result.error.message ?? "Device sign-in failed.")
      router.push(returnTo)
      router.refresh()
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : "Device sign-in failed."
      // A cancelled prompt is the owner changing their mind, not a fault worth shouting about.
      setError(/NotAllowed|abort|cancel/i.test(message) ? "Device sign-in was cancelled." : message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex flex-col gap-3">
      <Button type="button" onClick={signInWithDevice} disabled={busy} className="w-full gap-2">
        <Fingerprint className="h-4 w-4" aria-hidden />
        {busy ? "Waiting for your device…" : platformAuthenticator === false ? "Sign in with your phone or a key" : "Sign in with this device"}
      </Button>
      {error ? (
        <p role="alert" className="text-xs text-destructive">
          {error}
        </p>
      ) : null}
      <div className="flex items-center gap-3" aria-hidden>
        <span className="h-px flex-1 bg-border" />
        <span className="text-[10px] uppercase tracking-wider text-muted-foreground">or password</span>
        <span className="h-px flex-1 bg-border" />
      </div>
    </div>
  )
}
