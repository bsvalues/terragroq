"use client"

import { Route, ShieldCheck } from "lucide-react"
import { useRoutedIntent } from "@/components/intent/use-routed-intent"

export function RoutedIntentContext({
  destination,
}: {
  destination: string
}) {
  const intent = useRoutedIntent(destination)
  if (!intent) return null
  return (
    <section className="rounded-lg border border-primary/30 bg-primary/5 p-4" aria-label="Routed intent">
      <div className="flex items-center gap-2 text-sm font-semibold">
        <Route className="h-4 w-4 text-primary" aria-hidden={true} />
        Routed to {destination === "/brain-council" ? "Brain Council" : "Work Orders"}
      </div>
      <p className="mt-2 text-sm">{intent}</p>
      <p className="mt-2 flex items-center gap-2 text-xs text-muted-foreground">
        <ShieldCheck className="h-3.5 w-3.5" aria-hidden={true} />
        No action has been executed and no authority has been granted.
      </p>
    </section>
  )
}
