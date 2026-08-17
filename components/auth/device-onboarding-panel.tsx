"use client"

import { useState } from "react"
import { Smartphone } from "lucide-react"

import { onboardingSteps } from "@/lib/device-onboarding"
import { Button } from "@/components/ui/button"

/**
 * Adding a phone, without handing the owner a procedure.
 *
 * The desktop shows the address to open and the trust profile to install; the phone does the rest
 * in its own UI. Apple genuinely requires two taps in Settings that no website can perform, so
 * those are shown one line at a time, at the moment they are needed, instead of being written down
 * somewhere for the owner to follow later.
 */
export function DeviceOnboardingPanel({ origin }: { origin: string }) {
  const [platform, setPlatform] = useState<"apple" | "other">("apple")
  const steps = onboardingSteps(platform, origin)

  return (
    <section className="flex flex-col gap-4" aria-label="Add another device">
      <div className="flex items-center gap-2">
        <Smartphone className="h-4 w-4 text-muted-foreground" aria-hidden />
        <h2 className="text-sm font-medium">Add your phone or tablet</h2>
      </div>

      <div className="flex flex-col gap-2 rounded-lg border border-border p-4">
        <p className="text-xs uppercase tracking-wide text-muted-foreground">On the phone, open</p>
        <p className="font-mono text-sm break-all">{origin}</p>
        <p className="text-xs text-muted-foreground">
          Both devices must be on your own network. The address is the cockpit&apos;s own name, not a
          public site.
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Device type">
        <Button type="button" size="sm" variant={platform === "apple" ? "default" : "outline"} onClick={() => setPlatform("apple")}>
          iPhone or iPad
        </Button>
        <Button type="button" size="sm" variant={platform === "other" ? "default" : "outline"} onClick={() => setPlatform("other")}>
          Android or other
        </Button>
      </div>

      <ol className="flex flex-col gap-2">
        {steps.map((step, index) => (
          <li key={step} className="flex gap-3 text-sm">
            <span
              aria-hidden
              className="mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-full border border-border text-[10px] font-medium"
            >
              {index + 1}
            </span>
            <span className="leading-6">{step}</span>
          </li>
        ))}
      </ol>

      {platform === "apple" ? (
        <div className="flex flex-wrap items-center gap-3">
          <Button asChild size="sm" variant="outline">
            <a href="/api/device-onboarding/trust-profile">
              Install trust profile
            </a>
          </Button>
          <p className="text-xs text-muted-foreground">
            Open this link on the phone itself. It contains a public certificate only — no keys, no
            credentials.
          </p>
        </div>
      ) : null}
    </section>
  )
}
