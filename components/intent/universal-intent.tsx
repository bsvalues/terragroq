"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import Link from "next/link"
import { ArrowRight, CornerDownLeft, Loader2, Search } from "lucide-react"
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

// The four cockpit primaries — discoverable navigation from the always-available
// command surface. These are plain Links (user-initiated), never programmatic
// navigation: the intent surface routes and hands off, it never auto-executes.
const GO_TO = [
  { label: "Home", href: "/" },
  { label: "Projects", href: "/projects" },
  { label: "Activity", href: "/activity" },
  { label: "System", href: "/system" },
] as const

const TRY = [
  "Explain recent activity",
  "Research access grants",
  "Draft an outcome",
  "Convene the Council",
] as const

export function UniversalIntent() {
  const [open, setOpen] = useState(false)
  const [input, setInput] = useState("")
  const [result, setResult] = useState<UniversalIntentRoute | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  // Monotonic request token. Bumped whenever the surface resets, so a late
  // /api/intent response can never populate a stale result after close.
  const requestRef = useRef(0)
  const openRef = useRef(open)
  openRef.current = open

  const reset = useCallback(() => {
    requestRef.current += 1
    setInput("")
    setResult(null)
    setError(null)
    setLoading(false)
  }, [])

  // Single reset-aware close path — every way of dismissing the surface
  // (Escape, overlay, ⌘K, a Link click) flows through here.
  const handleOpenChange = useCallback(
    (next: boolean) => {
      setOpen(next)
      if (!next) reset()
    },
    [reset],
  )

  // ⌘K / Ctrl-K toggles the command surface from anywhere — always available.
  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault()
        handleOpenChange(!openRef.current)
      }
    }
    document.addEventListener("keydown", onKey)
    return () => document.removeEventListener("keydown", onKey)
  }, [handleOpenChange])

  async function submit(event: React.FormEvent) {
    event.preventDefault()
    if (!input.trim() || loading) return
    const token = (requestRef.current += 1)
    setLoading(true)
    setError(null)
    setResult(null)
    try {
      const response = await fetch("/api/intent", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ intent: input }),
      })
      if (requestRef.current !== token) return
      if (!response.ok) throw new Error("WilliamOS could not classify that intent.")
      setResult((await response.json()) as UniversalIntentRoute)
    } catch (caught) {
      if (requestRef.current !== token) return
      setError(caught instanceof Error ? caught.message : "Intent routing failed.")
    } finally {
      if (requestRef.current === token) setLoading(false)
    }
  }

  const destinationHref = result?.destination?.href ?? null
  const showSuggestions = !result && !error && !loading

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          className="gap-2"
          aria-label="Open universal intent (Command K or Control K)"
        >
          <Search className="h-4 w-4" aria-hidden={true} />
          <span className="hidden sm:inline">Intent</span>
          <kbd className="ml-1 hidden rounded border border-border bg-muted px-1.5 font-mono text-[10px] text-muted-foreground sm:inline">
            ⌘K
          </kbd>
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
            placeholder="Explain activity, research access, open Projects…"
            aria-label="Intent"
          />
          <Button type="submit" size="icon" disabled={loading || !input.trim()} aria-label="Route intent">
            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <ArrowRight className="h-4 w-4" />}
          </Button>
        </form>

        {showSuggestions ? (
          <div className="flex flex-col gap-4">
            <div className="flex flex-col gap-2">
              <p className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">Go to</p>
              <div className="flex flex-wrap gap-2">
                {GO_TO.map((item) => (
                  <Link
                    key={item.href}
                    href={item.href}
                    onClick={() => handleOpenChange(false)}
                    className="rounded-md border border-border bg-muted/30 px-2.5 py-1 text-sm transition-colors hover:bg-muted"
                  >
                    {item.label}
                  </Link>
                ))}
              </div>
            </div>
            <div className="flex flex-col gap-2">
              <p className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">Try</p>
              <div className="flex flex-col gap-1">
                {TRY.map((example) => (
                  <button
                    key={example}
                    type="button"
                    onClick={() => setInput(example)}
                    className="flex items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm text-muted-foreground transition-colors hover:bg-muted/50 hover:text-foreground"
                  >
                    <Search className="h-3.5 w-3.5 shrink-0" aria-hidden={true} />
                    {example}
                  </button>
                ))}
              </div>
            </div>
          </div>
        ) : null}

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
                    handleOpenChange(false)
                  }}
                >
                  Open governed destination <ArrowRight className="ml-2 h-3.5 w-3.5" />
                </Link>
              </Button>
            ) : null}
          </div>
        ) : null}

        <p className="flex items-center gap-1.5 border-t border-border pt-3 text-xs text-muted-foreground">
          <CornerDownLeft className="h-3 w-3" aria-hidden={true} />
          Enter routes · ⌘K / Ctrl-K toggles · routing is deterministic and never executes
        </p>
      </DialogContent>
    </Dialog>
  )
}
