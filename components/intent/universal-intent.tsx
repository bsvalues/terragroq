"use client"

import { useState } from "react"
import Link from "next/link"
import { ArrowRight, Loader2, Search } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import type { UniversalIntentRoute } from "@/lib/intent/router"
import { storeIntentHandoff } from "@/components/intent/intent-handoff"

export function UniversalIntent() {
  const [input, setInput] = useState("")
  const [result, setResult] = useState<UniversalIntentRoute | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  async function submit(event: React.FormEvent) {
    event.preventDefault()
    if (!input.trim() || loading) return
    setLoading(true)
    setError(null)
    setResult(null)
    try {
      const response = await fetch("/api/intent", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ intent: input }),
      })
      if (!response.ok) throw new Error("WilliamOS could not classify that intent.")
      setResult((await response.json()) as UniversalIntentRoute)
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Intent routing failed.")
    } finally {
      setLoading(false)
    }
  }

  const destinationHref = result?.destination?.href ?? null

  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm" className="gap-2" aria-label="Open universal intent">
          <Search className="h-4 w-4" aria-hidden={true} />
          <span className="hidden sm:inline">Intent</span>
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Universal intent</DialogTitle>
          <DialogDescription>
            State what you need. WilliamOS will route it to an answer, research, Council, outcome,
            execution request, or cockpit destination without granting execution authority.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={submit} className="flex gap-2">
          <Input
            value={input}
            onChange={(event) => {
              setInput(event.target.value)
              setResult(null)
              setError(null)
            }}
            maxLength={2000}
            autoFocus
            placeholder="Explain activity, research access, open Projects..."
            aria-label="Intent"
          />
          <Button type="submit" size="icon" disabled={loading || !input.trim()} aria-label="Route intent">
            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <ArrowRight className="h-4 w-4" />}
          </Button>
        </form>

        {error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}
        {result ? (
          <div role="status" aria-live="polite" className="rounded-lg border border-border bg-muted/30 p-3 text-sm">
            <p className="font-medium">
              {result.state === "authority_required"
                ? "Execution remains gated"
                : result.state === "clarification_required"
                  ? "Clarification required"
                  : `Route to ${result.intent}`}
            </p>
            <p className="mt-1 text-muted-foreground">{result.reason}</p>
            {result.state === "authority_required" ? (
              <p className="mt-2 text-xs text-muted-foreground">
                This creates no authority and performs no action. Open the governed destination to prepare a request.
              </p>
            ) : null}
            {result.destination && destinationHref ? (
              <Button asChild size="sm" className="mt-3">
                <Link
                  href={destinationHref}
                  onClick={() => {
                    if (result.intent !== "navigation") {
                      storeIntentHandoff(result.destination!.href, input)
                    }
                  }}
                >
                  Open governed destination <ArrowRight className="ml-2 h-3.5 w-3.5" />
                </Link>
              </Button>
            ) : null}
          </div>
        ) : null}
      </DialogContent>
    </Dialog>
  )
}
