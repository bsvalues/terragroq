"use client"

import { useEffect, useState } from "react"
import Link from "next/link"
import { authClient } from "@/lib/auth-client"
import { cockpitInvoke, devicePost, isNativeCockpit } from "./tauri-device"

type Challenge = { challengeId: string; challenge: string; proof: string }
type SessionResult = { data: { user?: unknown } | null }

type BootstrapDependencies = {
  getCredential: () => Promise<{ credentialId: string } | null>
  getSession: () => Promise<SessionResult>
  requestChallenge: (credentialId: string) => Promise<Challenge>
  sign: (proof: string) => Promise<{ signature: string }>
  complete: (body: { challengeId: string; challenge: string; signature: string }) => Promise<unknown>
  replace: (destination: string) => void
}

export async function credentiallessCockpitDestination(
  getSession: () => Promise<SessionResult> = () => authClient.getSession(),
) {
  try {
    const { data } = await getSession()
    return data?.user ? "/runtime?detail=technical" : "/sign-in"
  } catch {
    return "/sign-in"
  }
}

export async function authenticateCockpit(dependencies?: BootstrapDependencies) {
  const deps = dependencies ?? {
    getCredential: () => cockpitInvoke<{ credentialId: string } | null>("device_credential"),
    getSession: () => authClient.getSession(),
    requestChallenge: (credentialId: string) => devicePost<Challenge>("/api/device/session/challenge", { credentialId }),
    sign: (proof: string) => cockpitInvoke<{ signature: string }>("device_sign", { proof }),
    complete: (body: { challengeId: string; challenge: string; signature: string }) => devicePost("/api/device/session/complete", body),
    replace: (destination: string) => window.location.replace(destination),
  }
  const credential = await deps.getCredential()
  if (!credential) {
    deps.replace(await credentiallessCockpitDestination(deps.getSession))
    return
  }
  const challenge = await deps.requestChallenge(credential.credentialId)
  const signed = await deps.sign(challenge.proof)
  await deps.complete({ challengeId: challenge.challengeId, challenge: challenge.challenge, signature: signed.signature })
  deps.replace("/")
}

export function DeviceBootstrap() {
  const [status, setStatus] = useState("Checking this device…")
  useEffect(() => {
    let active = true
    async function authenticate() {
      if (!isNativeCockpit()) { if (active) setStatus("Native device authentication is unavailable in this browser."); return }
      try {
        await authenticateCockpit()
      } catch {
        if (active) setStatus("Device authentication could not be completed. Browser recovery remains available.")
      }
    }
    void authenticate()
    return () => { active = false }
  }, [])
  return <main className="mx-auto flex min-h-screen max-w-lg flex-col justify-center gap-4 p-6"><h1 className="text-xl font-semibold">WilliamOS Cockpit</h1><p role="status" aria-live="polite" className="text-sm text-muted-foreground">{status}</p><Link className="text-sm underline" href="/sign-in">Open browser recovery sign-in</Link></main>
}
