"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import Link from "next/link"
import { ArrowRight, CornerDownLeft, Loader2, Search } from "lucide-react"

import { startWorkbenchOutcome } from "@/app/actions/start-workbench-outcome"
import { storeIntentHandoff } from "@/components/intent/intent-handoff"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import {
  findWorkbenchActions,
  workbenchActionRegistry,
} from "@/lib/intent/workbench-action-registry"
import type { UniversalIntentRoute } from "@/lib/intent/router"
import type { StartWorkbenchOutcomeResult } from "@/lib/workbench/outcome-start"

type SelectedProject = Readonly<{ id: number; name: string }>
type Attempt = Readonly<{ projectId: number; intent: string; idempotencyKey: string }>

export function UniversalIntent({
  selectedProject = null,
  onOpenThread = () => undefined,
}: {
  selectedProject?: SelectedProject | null
  onOpenThread?: (target: { projectId: number; threadId: string }) => void
}) {
  const [open, setOpen] = useState(false)
  const [input, setInput] = useState("")
  const [routeResult, setRouteResult] = useState<UniversalIntentRoute | null>(null)
  const [startResult, setStartResult] = useState<StartWorkbenchOutcomeResult | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [routing, setRouting] = useState(false)
  const [starting, setStarting] = useState(false)
  const requestRef = useRef(0)
  const openRef = useRef(open)
  const attemptRef = useRef<Attempt | null>(null)
  openRef.current = open

  const clearResult = useCallback(() => {
    setRouteResult(null)
    setStartResult(null)
    setError(null)
  }, [])

  const close = useCallback(() => {
    requestRef.current += 1
    setOpen(false)
    setInput("")
    clearResult()
    setRouting(false)
    setStarting(false)
  }, [clearResult])

  const handleOpenChange = useCallback((next: boolean) => {
    if (next) setOpen(true)
    else close()
  }, [close])

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.isComposing || event.key.toLowerCase() !== "k" || (!event.metaKey && !event.ctrlKey)) return
      event.preventDefault()
      if (openRef.current) close()
      else setOpen(true)
    }
    document.addEventListener("keydown", onKey)
    return () => document.removeEventListener("keydown", onKey)
  }, [close])

  function changeInput(value: string) {
    requestRef.current += 1
    setInput(value)
    clearResult()
    setRouting(false)
    setStarting(false)
  }

  async function routeIntent(event?: React.FormEvent) {
    event?.preventDefault()
    const intent = input.trim()
    if (!intent || routing || starting) return
    setOpen(true)
    const token = (requestRef.current += 1)
    setRouting(true)
    clearResult()
    try {
      const response = await fetch("/api/intent", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ intent }),
      })
      if (requestRef.current !== token) return
      if (!response.ok) throw new Error("WilliamOS could not route that intent.")
      const routed = (await response.json()) as UniversalIntentRoute
      if (requestRef.current !== token) return
      if (routed.destination?.action === "start_outcome" && selectedProject === null) {
        setError("Select a Project before starting an outcome. WilliamOS will not infer Project context.")
      } else {
        setRouteResult(routed)
      }
    } catch (caught) {
      if (requestRef.current !== token) return
      setError(caught instanceof Error ? caught.message : "Intent routing failed.")
    } finally {
      if (requestRef.current === token) setRouting(false)
    }
  }

  async function startOutcome() {
    const intent = input.trim()
    if (!selectedProject || !intent || starting) return
    const prior = attemptRef.current
    const attempt = prior?.projectId === selectedProject.id && prior.intent === intent
      ? prior
      : { projectId: selectedProject.id, intent, idempotencyKey: crypto.randomUUID() }
    attemptRef.current = attempt
    const token = (requestRef.current += 1)
    setStarting(true)
    setError(null)
    try {
      const result = await startWorkbenchOutcome(attempt)
      if (requestRef.current !== token) return
      setStartResult(result)
      setRouteResult(null)
      attemptRef.current = null
    } catch {
      if (requestRef.current !== token) return
      setError("Acceptance recovery required")
      setRouteResult(null)
    } finally {
      if (requestRef.current === token) setStarting(false)
    }
  }

  const matchingActions = findWorkbenchActions(input)
  const suggestedActions = matchingActions.length > 0 ? matchingActions : workbenchActionRegistry
  const outcomePreview = routeResult?.destination?.action === "start_outcome" && selectedProject !== null

  return (
    <>
      <form onSubmit={routeIntent} className="flex min-w-0 flex-1 items-center sm:max-w-md" aria-label="Visible universal composer">
        <div className="relative min-w-0 flex-1">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-[var(--workbench-muted)]" aria-hidden />
          <Input
            value={input}
            onChange={(event) => changeInput(event.target.value)}
            aria-label="Ask or do anything"
            maxLength={2000}
            placeholder="Ask or do anything…"
            className="h-9 w-full pl-8 pr-12 text-xs sm:text-sm"
          />
          <kbd className="pointer-events-none absolute right-2.5 top-1/2 hidden -translate-y-1/2 font-mono text-[9px] text-[var(--workbench-muted)] sm:block">Ctrl K</kbd>
        </div>
        <Button type="submit" size="icon" variant="ghost" className="ml-1 size-9 shrink-0" disabled={!input.trim() || routing || starting} aria-label="Route visible intent">
          {routing ? <Loader2 className="size-4 animate-spin" /> : <ArrowRight className="size-4" />}
        </Button>
      </form>

      <Dialog open={open} onOpenChange={handleOpenChange}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Universal intent</DialogTitle>
            <DialogDescription>
              Ask, start meaningful work, switch context, or open a contextual capability. Routing grants no execution authority.
            </DialogDescription>
          </DialogHeader>

          <form onSubmit={routeIntent} className="flex gap-2">
            <Input
              value={input}
              onChange={(event) => changeInput(event.target.value)}
              maxLength={2000}
              autoFocus
              placeholder="Ask or do anything…"
              aria-label="Intent palette"
            />
            <Button type="submit" size="icon" disabled={routing || starting || !input.trim()} aria-label="Route intent">
              {routing ? <Loader2 className="size-4 animate-spin" /> : <ArrowRight className="size-4" />}
            </Button>
          </form>

          {!routeResult && !startResult && !error && !routing ? (
            <nav aria-label="Workbench action registry" className="grid max-h-52 grid-cols-2 gap-1 overflow-y-auto sm:grid-cols-3">
              {suggestedActions.map((action) => (
                <Link key={action.id} href={action.href} onClick={close} className="rounded-md border border-border px-2.5 py-2 text-sm hover:bg-muted">
                  {action.label}
                </Link>
              ))}
            </nav>
          ) : null}

          {routing ? <p role="status" aria-live="polite" className="text-sm text-muted-foreground">Routing intent…</p> : null}
          {error ? (
            <div role="alert" aria-live="assertive" className="rounded-md border border-destructive/40 p-3 text-sm">
              <p className="font-medium">{error}</p>
              {error === "Acceptance recovery required" ? <p className="mt-1 text-xs text-muted-foreground">Durable settlement could not be verified. Retry uses the same bounded request identity; no acceptance or execution is claimed.</p> : null}
              {error === "Acceptance recovery required" ? <Button type="button" size="sm" variant="outline" className="mt-3" onClick={startOutcome}>Retry acceptance</Button> : null}
            </div>
          ) : null}

          {outcomePreview ? (
            <section aria-label="Outcome start preview" className="rounded-md border border-border p-3 text-sm">
              <p className="font-medium">Ready to start in {selectedProject.name}</p>
              <p className="mt-1 text-xs leading-5 text-muted-foreground">This will record durable Project and Thread custody. It will not approve, authorize, lease, or execute work.</p>
              <Button type="button" size="sm" className="mt-3" onClick={startOutcome} disabled={starting}>
                {starting ? <Loader2 className="mr-2 size-3.5 animate-spin" /> : null}Start outcome
              </Button>
              {starting ? <p role="status" aria-live="polite" className="mt-2 text-xs text-muted-foreground">Persisting acceptance…</p> : null}
            </section>
          ) : null}

          {startResult?.status === "ACCEPTED" || startResult?.status === "ALREADY_ACCEPTED" ? (
            <section role="status" aria-live="polite" className="rounded-md border border-border p-3 text-sm">
              <p className="font-medium">{startResult.status === "ALREADY_ACCEPTED" ? "Already accepted by WilliamOS" : "Accepted by WilliamOS"}</p>
              <p className="mt-1 text-xs leading-5 text-muted-foreground">Persisted Project and Thread custody.</p>
              <p className="text-xs leading-5 text-muted-foreground">This intake granted no approval, authority, lease, or execution.</p>
              <Button type="button" size="sm" className="mt-3" onClick={() => {
                const target = { projectId: startResult.projectId, threadId: startResult.threadId }
                close()
                onOpenThread(target)
              }}>Open Thread</Button>
            </section>
          ) : null}

          {startResult?.status === "CONFLICT" ? (
            <section role="alert" aria-live="assertive" className="rounded-md border border-destructive/40 p-3 text-sm">
              <p className="font-medium">Request identity conflict</p>
              <p className="mt-1 text-xs leading-5 text-muted-foreground">This request identity is already bound to a different Project or intent. No outcome, Thread, authority, lease, or execution is claimed.</p>
            </section>
          ) : null}

          {startResult?.status === "INVALID_INTENT" || startResult?.status === "PROJECT_NOT_FOUND" ? (
            <section role="alert" aria-live="assertive" className="rounded-md border border-destructive/40 p-3 text-sm">
              <p className="font-medium">{startResult.status === "INVALID_INTENT" ? "Intent was not accepted" : "Project unavailable"}</p>
              <p className="mt-1 text-xs leading-5 text-muted-foreground">No outcome, Thread, authority, lease, or execution is claimed. Select valid Project context and submit an explicit outcome intent.</p>
            </section>
          ) : null}

          {startResult?.status === "REFUSED" ? (
            <section role="status" aria-live="polite" className="rounded-md border border-destructive/40 p-3 text-sm">
              <p className="font-medium">Refused by doctrine</p>
              <p className="mt-1 text-xs leading-5 text-muted-foreground">The refusal was persisted. No outcome, Thread ownership, authority, or execution was created.</p>
            </section>
          ) : null}

          {routeResult && !outcomePreview ? (
            <section role="status" aria-live="polite" className="rounded-md border border-border p-3 text-sm">
              <p className="font-medium">{routeResult.state === "authority_required" ? "Needs a decision" : routeResult.state === "clarification_required" ? "Clarification required" : `Route to ${routeResult.intent}`}</p>
              <p className="mt-1 text-xs text-muted-foreground">{routeResult.reason}</p>
              {routeResult.destination?.href ? <Button asChild size="sm" className="mt-3"><Link href={routeResult.destination.href} onClick={() => {
                if (routeResult.intent !== "navigation") storeIntentHandoff(routeResult.destination!.href!, input)
                close()
              }}>Open destination</Link></Button> : null}
            </section>
          ) : null}

          <p className="flex items-center gap-1.5 border-t border-border pt-3 text-xs text-muted-foreground">
            <CornerDownLeft className="size-3" aria-hidden /> Enter previews · explicit Start accepts · Ctrl+K toggles
          </p>
        </DialogContent>
      </Dialog>
    </>
  )
}
