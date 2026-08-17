"use client"

import { useState } from "react"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"

/**
 * Trades a one-time code for this device's own identity profile.
 *
 * A plain GET navigation rather than fetch: iOS only offers to install a configuration profile when
 * the browser navigates to it, so the code travels in the URL and the page hands control to Safari.
 */
export function IdentityProfileForm() {
  const [code, setCode] = useState("")
  const ready = code.trim().length >= 8

  return (
    <form action="/api/device-onboarding/identity-profile" method="GET" className="flex flex-col gap-3">
      <div className="flex flex-col gap-2">
        <Label htmlFor="code">Code from your signed-in device</Label>
        <Input
          id="code"
          name="code"
          value={code}
          onChange={(event) => setCode(event.target.value)}
          placeholder="ABCD-2345"
          autoComplete="one-time-code"
          autoCapitalize="characters"
          autoCorrect="off"
          spellCheck={false}
          className="font-mono text-lg tracking-[0.2em]"
        />
      </div>
      <Button type="submit" disabled={!ready}>Install this device&apos;s identity</Button>
      <p className="text-xs text-muted-foreground">
        On the signed-in device open Sign-in devices and choose Show a code. After installing, this
        device opens WilliamOS without a password.
      </p>
    </form>
  )
}
