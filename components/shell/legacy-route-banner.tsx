"use client"

import { usePathname } from "next/navigation"

type LegacyEntry = { label: string; message: string }

// Only surfaces whose content is still known to be illustrative remain labelled.
// Projects and Runtime were rebuilt on live projections and must not carry stale warnings.
const LEGACY_ROUTES: Record<string, LegacyEntry> = {
  "/hermes": {
    label: "Reference surface",
    message: "Use the status bar and Runtime for current node truth; this view still includes historical Hermes doctrine.",
  },
  "/brain-council": {
    label: "Reference surface",
    message: "Council output shown here is illustrative until a live advisory run is recorded for the selected context.",
  },
  "/agent-forge": {
    label: "Reference surface",
    message: "Capability definitions shown here are design records, not a live worker reachability probe.",
  },
}

export function LegacyRouteBanner() {
  const pathname = usePathname()
  const entry = pathname ? LEGACY_ROUTES[pathname] : undefined
  if (!entry) return null
  return <div role="status" aria-live="polite" className="mx-6 mt-4 flex flex-wrap items-center gap-x-3 gap-y-1 border-l-2 border-amber-400 bg-amber-500/5 px-3 py-2 text-sm"><span className="font-mono text-[10px] font-semibold uppercase tracking-wide text-amber-300">{entry.label}</span><span className="text-amber-100/80">{entry.message}</span></div>
}
