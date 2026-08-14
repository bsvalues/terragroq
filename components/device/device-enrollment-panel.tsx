"use client"

import { useEffect, useState } from "react"
import { cockpitInvoke, devicePost, isNativeCockpit } from "./tauri-device"

type Challenge = { challengeId: string; challenge: string; proof: string }

export function DeviceEnrollmentPanel() {
  const [status, setStatus] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [devices, setDevices] = useState<Array<{ id: string; label: string; lastUsedAt: string | null; revokedAt: string | null }>>([])
  async function refresh() {
    const response = await fetch("/api/device/credentials", { credentials: "same-origin", cache: "no-store" })
    if (response.ok) setDevices((await response.json()).devices)
  }
  useEffect(() => { void refresh() }, [])
  async function enroll() {
    setBusy(true); setStatus("Enrolling this Cockpit…")
    try {
      const key = await cockpitInvoke<{ publicKeySpki: string }>("device_generate_key")
      const challenge = await devicePost<Challenge>("/api/device/enrollment/challenge")
      const signed = await cockpitInvoke<{ signature: string }>("device_sign", { proof: challenge.proof })
      const device = await devicePost<{ credentialId: string; recovered: boolean; reenrolled: boolean }>("/api/device/enrollment/complete", { challengeId: challenge.challengeId, challenge: challenge.challenge, publicKeySpki: key.publicKeySpki, signature: signed.signature, label: "WilliamOS Cockpit" })
      await cockpitInvoke("device_bind_credential", { credentialId: device.credentialId })
      setStatus(device.reenrolled
        ? "This revoked Cockpit was safely re-enrolled. Previous sessions remain invalid."
        : device.recovered
          ? "This Cockpit enrollment was recovered and bound locally."
          : "This Cockpit is enrolled. Future launches use device authentication.")
      await refresh()
    } catch { setStatus("Enrollment failed safely. No device session was created; browser recovery is unchanged.") }
    finally { setBusy(false) }
  }
  async function revoke(credentialId: string) {
    setBusy(true)
    try {
      await devicePost(`/api/device/credentials/${encodeURIComponent(credentialId)}/revoke`)
      setStatus("Device access revoked. Its active device sessions are invalid.")
      await refresh()
    } catch { setStatus("Device revocation failed safely.") }
    finally { setBusy(false) }
  }
  const native = isNativeCockpit()
  return <section className="rounded-lg border border-border bg-card p-4" aria-labelledby="device-enrollment-title"><h2 id="device-enrollment-title" className="text-sm font-medium">Authorized devices</h2><p className="mt-1 text-sm text-muted-foreground">Enroll this native Cockpit with a private key held by the operating system credential store. Browser sign-in remains the recovery path.</p>{native ? <button className="mt-3 rounded-md border px-3 py-2 text-sm" type="button" disabled={busy} onClick={() => void enroll()}>{busy ? "Enrolling…" : "Enroll this Cockpit"}</button> : <p className="mt-3 text-xs text-muted-foreground">Open this page in the installed Cockpit to enroll a device.</p>}<ul className="mt-4 space-y-2">{devices.map((device) => <li key={device.id} className="flex items-center justify-between gap-3 rounded-md border p-3 text-sm"><span><span className="block font-medium">{device.label}</span><span className="text-xs text-muted-foreground">{device.revokedAt ? "Revoked" : device.lastUsedAt ? `Last used ${new Date(device.lastUsedAt).toLocaleString()}` : "Not used yet"}</span></span>{!device.revokedAt ? <button type="button" className="rounded-md border px-2 py-1 text-xs" disabled={busy} onClick={() => void revoke(device.id)}>Revoke</button> : null}</li>)}</ul>{status ? <p role="status" aria-live="polite" className="mt-3 text-sm">{status}</p> : null}</section>
}
