"use client"

import Link from "next/link"
import { useEffect } from "react"
import { AlertTriangle } from "lucide-react"
import { Button } from "@/components/ui/button"

export default function ShellError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  useEffect(() => {
    console.error("Shell route error boundary caught an error:", error)
  }, [error])

  return (
    <div className="p-6">
      <div className="max-w-2xl rounded-lg border border-destructive/40 bg-destructive/10 p-4">
        <div className="flex items-start gap-3">
          <AlertTriangle className="mt-0.5 h-5 w-5 text-destructive" aria-hidden />
          <div className="flex flex-col gap-3">
            <h2 className="text-base font-semibold">Shell route failed to load</h2>
            <p className="text-sm text-muted-foreground">
              This route encountered an unexpected error. Retry the route or navigate back to the dashboard.
            </p>
            <div className="flex items-center gap-2">
              <Button size="sm" onClick={reset}>
                Retry route
              </Button>
              <Button asChild size="sm" variant="outline">
                <Link href="/">Dashboard</Link>
              </Button>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
