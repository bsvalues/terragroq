"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"

/** Types a one-time code and, on success, this device has its own session. */
export function LinkDeviceForm() {
  const router = useRouter()
  const [code, setCode] = useState("")
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function submit(event: React.FormEvent) {
    event.preventDefault()
    if (busy) return
    setBusy(true); setError(null)
    try {
      const response = await fetch("/api/device-link/redeem", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ code }),
      })
      if (!response.ok) {
        // Every failure answers the same way, so a wrong code cannot be told from an expired one.
        throw new Error("That code did not work. Show a new one and try again.")
      }
      router.push("/")
      router.refresh()
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "That code did not work.")
    } finally {
      setBusy(false)
    }
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-4">
      <div className="flex flex-col gap-2">
        <Label htmlFor="code">Code</Label>
        <Input
          id="code"
          value={code}
          onChange={(event) => setCode(event.target.value)}
          placeholder="ABCD-2345"
          autoComplete="one-time-code"
          autoCapitalize="characters"
          autoCorrect="off"
          spellCheck={false}
          inputMode="text"
          required
          className="font-mono text-lg tracking-[0.2em]"
        />
      </div>
      <Button type="submit" disabled={busy || code.trim().length === 0}>
        {busy ? "Checking…" : "Add this device"}
      </Button>
      {error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}
    </form>
  )
}
