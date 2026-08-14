"use client"

import { usePathname } from "next/navigation"

type LegacyEntry = { label: string; message: string }

// Surfaces whose displayed content is known stale or static (see WILLIAMOS_UI_TRUTH_AUDIT, P0).
// A control plane must never present these as current operational truth, so each is labelled
// until it is rebuilt on a live projection. Keyed by exact pathname.
const LEGACY_ROUTES: Record<string, LegacyEntry> = {
  "/hermes": {
    label: "Legacy / design reference",
    message:
      "This page reports Hermes as inactive, but the Hermes runtime is live. It is stale doctrine, not current status.",
  },
  "/projects": {
    label: "Legacy / design reference",
    message:
      "These projects are hard-coded design placeholders, not live project data.",
  },
  "/brain-council": {
    label: "Legacy / design reference",
    message:
      "This Council reasoning is a static example, not live advisory output.",
  },
  "/agent-forge": {
    label: "Legacy / design reference",
    message:
      "This Forge registry is static design intent; it does not reflect live capabilities.",
  },
  "/runtime": {
    label: "Partially legacy",
    message:
      "Live runtime data appears alongside a static “systems ready” summary that is design reference, not current node truth.",
  },
}

export function LegacyRouteBanner() {
  const pathname = usePathname()
  const entry = pathname ? LEGACY_ROUTES[pathname] : undefined
  if (!entry) return null

  return (
    <div
      role="status"
      aria-live="polite"
      className="mx-6 mt-4 flex flex-wrap items-center gap-x-3 gap-y-1 rounded-md border border-amber-500/50 bg-amber-500/10 px-4 py-2.5 text-sm"
    >
      <span className="rounded bg-amber-500/20 px-2 py-0.5 font-mono text-xs font-semibold uppercase tracking-wide text-amber-700 dark:text-amber-300">
        {entry.label}
      </span>
      <span className="text-amber-800 dark:text-amber-200/90">{entry.message}</span>
    </div>
  )
}
