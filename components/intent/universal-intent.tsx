"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import type { FC } from "react"
import Link from "next/link"
import { ArrowRight, CornerDownLeft, Loader2, Search } from "lucide-react"

import { startWorkbenchOutcome } from "@/app/actions/start-workbench-outcome"
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
import { MAX_OBJECTIVE_LENGTH } from "@/lib/objective/intake"
import type { StartWorkbenchOutcomeResult } from "@/lib/workbench/outcome-start"
import { isIssue911ReliabilityOutcomeIntent } from "@/lib/workbench/registered-outcome-intent"

/**
 * Submit an ordinary-language objective (#891, #871 boundary 1).
 *
 * This composer used to end at a destination. It asked /api/intent to classify the text and rendered a
 * page to open, so an objective the classifier did not recognise had nowhere to go -- two of #871's
 * four never matched a pattern at all -- and the one it did recognise ("Determine what the recovered
 * OMEN Benton database is...") became a link to /chat rather than work. Either way nothing was
 * recorded, which is how the same investigation was rediscovered and nearly redone.
 *
 * The deterministic router selects navigation and pre-registered outcome starts. Everything else is
 * submitted to /api/objective, including when the route comes back as clarification_required and when
 * /api/intent is unreachable. Recognition therefore cannot become a prerequisite for ordinary work.
 *
 * Admission is not authorisation. What comes back is a draft carrying the operator's own text and a
 * reference to find it by, and the panel says in the response's own words that nothing was permitted.
 */

/**
 * A selected Project scopes only a deterministically routed outcome. Ordinary objective admission
 * remains operator-scoped and lets its API resolve the durable work-order Thread.
 */
type ShellContext = {
  selectedProject?: { id: number; name: string } | null
  onOpenThread?: (target: { projectId: number; threadId: string }) => void
}

type AdmittedObjective = {
  status: string
  title: string
  workOrder: string | null
  thread: string | null
  threadError?: string
  authority?: { granted: boolean; note?: string }
}

type AdmissionFailure = { error?: string; detail?: string }

const ADMISSION_FAILURES: Readonly<Record<string, string>> = {
  UNAUTHENTICATED: "Sign in before submitting an objective.",
  BAD_REQUEST: "WilliamOS could not read that objective.",
  OBJECTIVE_EMPTY: "An objective is required.",
  OBJECTIVE_TOO_LONG: `An objective may be at most ${MAX_OBJECTIVE_LENGTH} characters.`,
}

const ADMISSION_UNAVAILABLE = "WilliamOS could not admit that objective."

/** Routes navigation and registered outcomes; failure still falls through to ordinary admission. */
async function deterministicRoute(intent: string): Promise<UniversalIntentRoute | null> {
  try {
    const response = await fetch("/api/intent", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ intent }),
    })
    if (!response.ok) return null
    return (await response.json()) as UniversalIntentRoute
  } catch {
    // An unreachable classifier must not decide whether an objective can be submitted.
    return null
  }
}

async function admitObjective(objective: string): Promise<AdmittedObjective> {
  const response = await fetch("/api/objective", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ objective }),
  })
  const payload = (await response.json().catch(() => null)) as
    | (AdmittedObjective & AdmissionFailure)
    | null
  if (!response.ok || !payload) {
    const named = payload?.error ? ADMISSION_FAILURES[payload.error] : undefined
    throw new Error(named ?? payload?.detail ?? ADMISSION_UNAVAILABLE)
  }
  return payload
}

export const UniversalIntent: FC<ShellContext> = ({ selectedProject = null, onOpenThread }) => {
  const [open, setOpen] = useState(false)
  const [input, setInput] = useState("")
  const [routeResult, setRouteResult] = useState<UniversalIntentRoute | null>(null)
  const [admitted, setAdmitted] = useState<AdmittedObjective | null>(null)
  const [startedOutcome, setStartedOutcome] = useState<StartWorkbenchOutcomeResult | null>(null)
  const [outcomeSettlementUnknown, setOutcomeSettlementUnknown] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const requestRef = useRef(0)
  const openRef = useRef(open)
  const admittedTextRef = useRef<string | null>(null)
  const outcomeAttemptRef = useRef<{ signature: string; idempotencyKey: string } | null>(null)
  openRef.current = open

  const clearResult = useCallback(() => {
    admittedTextRef.current = null
    setRouteResult(null)
    setAdmitted(null)
    setStartedOutcome(null)
    setOutcomeSettlementUnknown(false)
    setError(null)
  }, [])

  const close = useCallback(() => {
    requestRef.current += 1
    setOpen(false)
    setInput("")
    clearResult()
    setSubmitting(false)
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
    outcomeAttemptRef.current = null
    clearResult()
    setSubmitting(false)
  }

  async function submitIntent(event?: React.FormEvent) {
    event?.preventDefault()
    const intent = input.trim()
    if (!intent || submitting) return
    // The seam carries no request identity, so a second Enter on an objective already admitted would
    // record it a second time. Editing the draft clears this, because then it is a different ask.
    if (admittedTextRef.current === intent) {
      setOpen(true)
      return
    }
    setOpen(true)
    const token = (requestRef.current += 1)
    let startingOutcome = false
    setSubmitting(true)
    clearResult()
    try {
      const routed = await deterministicRoute(intent)
      if (requestRef.current !== token) return
      if (routed?.intent === "navigation" && routed.destination?.href) {
        setRouteResult(routed)
        return
      }
      if (routed?.destination?.action === "start_outcome"
        && selectedProject
        && isIssue911ReliabilityOutcomeIntent(intent)) {
        startingOutcome = true
        const signature = `${selectedProject.id}:${intent}`
        const attempt = outcomeAttemptRef.current?.signature === signature
          ? outcomeAttemptRef.current
          : {
              signature,
              idempotencyKey: `workbench-outcome:${globalThis.crypto.randomUUID()}`,
            }
        outcomeAttemptRef.current = attempt
        const outcome = await startWorkbenchOutcome({
          projectId: selectedProject.id,
          intent,
          idempotencyKey: attempt.idempotencyKey,
        })
        if (requestRef.current !== token) return
        setStartedOutcome(outcome)
        return
      }
      const objective = await admitObjective(intent)
      if (requestRef.current !== token) return
      admittedTextRef.current = intent
      setAdmitted(objective)
    } catch (caught) {
      if (requestRef.current !== token) return
      if (startingOutcome) setOutcomeSettlementUnknown(true)
      else setError(caught instanceof Error ? caught.message : ADMISSION_UNAVAILABLE)
    } finally {
      if (requestRef.current === token) setSubmitting(false)
    }
  }

  const matchingActions = findWorkbenchActions(input)
  const suggestedActions = matchingActions.length > 0 ? matchingActions : workbenchActionRegistry

  return (
    <>
      <form onSubmit={submitIntent} className="flex min-w-0 flex-1 items-center sm:max-w-md" aria-label="Visible universal composer">
        <div className="relative min-w-0 flex-1">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-[var(--workbench-muted)]" aria-hidden />
          <Input
            value={input}
            onChange={(event) => changeInput(event.target.value)}
            aria-label="Ask or do anything"
            maxLength={MAX_OBJECTIVE_LENGTH}
            placeholder="Ask or do anything…"
            className="h-9 w-full pl-8 pr-12 text-xs sm:text-sm"
          />
          <kbd className="pointer-events-none absolute right-2.5 top-1/2 hidden -translate-y-1/2 font-mono text-[9px] text-[var(--workbench-muted)] sm:block">Ctrl K</kbd>
        </div>
        <Button type="submit" size="icon" variant="ghost" className="ml-1 size-9 shrink-0" disabled={!input.trim() || submitting} aria-label="Route visible intent">
          {submitting ? <Loader2 className="size-4 animate-spin" /> : <ArrowRight className="size-4" />}
        </Button>
      </form>

      <Dialog open={open} onOpenChange={handleOpenChange}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Universal intent</DialogTitle>
            <DialogDescription>
              Say what you want in your own words, or open a contextual capability. Submitting records the
              objective; it grants no execution authority.
            </DialogDescription>
          </DialogHeader>

          <form onSubmit={submitIntent} className="flex gap-2">
            <Input
              value={input}
              onChange={(event) => changeInput(event.target.value)}
              maxLength={MAX_OBJECTIVE_LENGTH}
              autoFocus
              placeholder="Ask or do anything…"
              aria-label="Intent palette"
            />
            <Button type="submit" size="icon" disabled={submitting || !input.trim()} aria-label="Route intent">
              {submitting ? <Loader2 className="size-4 animate-spin" /> : <ArrowRight className="size-4" />}
            </Button>
          </form>

          {!routeResult && !admitted && !startedOutcome && !outcomeSettlementUnknown && !error && !submitting ? (
            <nav aria-label="Workbench action registry" className="grid max-h-52 grid-cols-2 gap-1 overflow-y-auto sm:grid-cols-3">
              {suggestedActions.map((action) => (
                <Link key={action.id} href={action.href} onClick={close} className="rounded-md border border-border px-2.5 py-2 text-sm hover:bg-muted">
                  {action.label}
                </Link>
              ))}
            </nav>
          ) : null}

          {submitting ? <p role="status" aria-live="polite" className="text-sm text-muted-foreground">Submitting objective…</p> : null}

          {error ? (
            <div role="alert" aria-live="assertive" className="rounded-md border border-destructive/40 p-3 text-sm">
              <p className="font-medium">Objective was not admitted</p>
              <p className="mt-1 text-xs leading-5 text-muted-foreground">{error}</p>
              <p className="mt-1 text-xs leading-5 text-muted-foreground">Nothing was recorded, and no authority, lease, or execution is claimed.</p>
            </div>
          ) : null}

          {outcomeSettlementUnknown ? (
            <div role="alert" aria-live="assertive" className="rounded-md border border-destructive/40 p-3 text-sm">
              <p className="font-medium">Settlement unknown</p>
              <p className="mt-1 text-xs leading-5 text-muted-foreground">Retry submits the same intake key. No authority, lease, dispatch, or execution is claimed.</p>
            </div>
          ) : null}

          {startedOutcome?.status === "ACCEPTED" || startedOutcome?.status === "ALREADY_ACCEPTED" ? (
            <section role="status" aria-live="polite" aria-label="Started outcome" className="rounded-md border border-border p-3 text-sm">
              <p className="font-medium">Awaiting authority</p>
              <p className="mt-1 text-xs leading-5 text-muted-foreground">The outcome is recorded in {selectedProject?.name}. Nothing was authorized or executed.</p>
              <dl className="mt-2 grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1 text-xs">
                <dt className="text-muted-foreground">Outcome</dt>
                <dd className="truncate font-mono">{startedOutcome.outcomeKey}</dd>
                <dt className="text-muted-foreground">Thread</dt>
                <dd className="truncate font-mono">{startedOutcome.threadId}</dd>
              </dl>
              {onOpenThread ? (
                <Button type="button" size="sm" className="mt-3" onClick={() => onOpenThread({
                  projectId: startedOutcome.projectId,
                  threadId: startedOutcome.threadId,
                })}>Open Thread</Button>
              ) : null}
            </section>
          ) : startedOutcome ? (
            <div role="alert" aria-live="assertive" className="rounded-md border border-destructive/40 p-3 text-sm">
              <p className="font-medium">Outcome was not started</p>
              <p className="mt-1 text-xs leading-5 text-muted-foreground">{("reason" in startedOutcome && startedOutcome.reason) || startedOutcome.status}. Nothing was authorized or executed.</p>
            </div>
          ) : null}

          {admitted ? (
            <section role="status" aria-live="polite" aria-label="Admitted objective" className="rounded-md border border-border p-3 text-sm">
              <p className="font-medium">Admitted as work</p>
              <p className="mt-1 text-xs leading-5 text-muted-foreground">{admitted.title}</p>
              <dl className="mt-2 grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1 text-xs">
                <dt className="text-muted-foreground">Work order</dt>
                <dd className="truncate font-mono">{admitted.workOrder ?? "unavailable"}</dd>
                <dt className="text-muted-foreground">Thread</dt>
                <dd className="truncate font-mono">{admitted.thread ?? "not created"}</dd>
              </dl>
              {admitted.threadError ? (
                <p className="mt-2 text-xs leading-5 text-muted-foreground">The objective is admitted; its thread could not be created ({admitted.threadError}).</p>
              ) : null}
              <p className="mt-2 text-xs leading-5 text-muted-foreground">
                Admission is not authorisation{admitted.authority?.note ? ` — ${admitted.authority.note}` : ". Execution requires a separately recorded authority grant"}.
              </p>
            </section>
          ) : null}

          {routeResult ? (
            <section role="status" aria-live="polite" className="rounded-md border border-border p-3 text-sm">
              <p className="font-medium">Route to {routeResult.intent}</p>
              <p className="mt-1 text-xs text-muted-foreground">{routeResult.reason}</p>
              {routeResult.destination?.href ? (
                <Button asChild size="sm" className="mt-3">
                  <Link href={routeResult.destination.href} onClick={close}>Open destination</Link>
                </Button>
              ) : null}
            </section>
          ) : null}

          <p className="flex items-center gap-1.5 border-t border-border pt-3 text-xs text-muted-foreground">
            <CornerDownLeft className="size-3" aria-hidden /> Enter submits · admission is not authorisation · Ctrl+K toggles
          </p>
        </DialogContent>
      </Dialog>
    </>
  )
}
