"use client"

import { useEffect, useState } from "react"
import Link from "next/link"
import { cockpitInvoke, devicePost, isNativeCockpit } from "./tauri-device"

type Challenge = { challengeId: string; challenge: string; proof: string }

export function DeviceBootstrap() {
  const [status, setStatus] = useState("Checking this device…")
  useEffect(() => {
    let active = true
    async function authenticate() {
      if (!isNativeCockpit()) { if (active) setStatus("Native device authentication is unavailable in this browser."); return }
      try {
        const credential = await cockpitInvoke<{ credentialId: string } | null>("device_credential")
        if (!credential) { window.location.replace("/sign-in"); return }
        const challenge = await devicePost<Challenge>("/api/device/session/challenge", { credentialId: credential.credentialId })
        const signed = await cockpitInvoke<{ signature: string }>("device_sign", { proof: challenge.proof })
        await devicePost("/api/device/session/complete", { challengeId: challenge.challengeId, challenge: challenge.challenge, signature: signed.signature })
        window.location.replace("/")
      } catch {
        if (active) setStatus("Device authentication could not be completed. Browser recovery remains available.")
      }
    }
    void authenticate()
    return () => { active = false }
  }, [])
  return <main className="mx-auto flex min-h-screen max-w-lg flex-col justify-center gap-4 p-6"><h1 className="text-xl font-semibold">WilliamOS Cockpit</h1><p role="status" aria-live="polite" className="text-sm text-muted-foreground">{status}</p><Link className="text-sm underline" href="/sign-in">Open browser recovery sign-in</Link></main>
}
