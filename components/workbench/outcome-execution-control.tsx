"use client"

import { useEffect, useRef, useState } from "react"

import { authorizeWorkbenchOutcomeExecution } from "@/app/actions/authorize-workbench-outcome-execution"
import type { AuthorizeWorkbenchOutcomeExecutionResult } from "@/lib/workbench/outcome-execution-authorization"
import type { WorkbenchExecutionProjection } from "@/lib/workbench/execution-projection"
import { summarizeWorkbenchThreadTrust } from "@/lib/workbench/thread-trust"
import type { WorkbenchExecutionLoadState } from "@/components/workbench/workbench-execution"

type Settlement =
  | { kind: "typed"; result: AuthorizeWorkbenchOutcomeExecutionResult }
  | { kind: "uncertain" }

function newAttemptKey(): string {
  return `workbench-execution:${globalThis.crypto.randomUUID()}`
}

export function OutcomeExecutionControl({
  projectId,
  threadId,
  repositoryEligible,
  projection,
  loadState,
  onRefresh,
}: {
  projectId: number
  threadId: string
  repositoryEligible: boolean
  projection: WorkbenchExecutionProjection | null
  loadState: WorkbenchExecutionLoadState
  onRefresh: () => void
}) {
  const [confirming, setConfirming] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [settlement, setSettlement] = useState<Settlement | null>(null)
  const attemptKeyRef = useRef<string | null>(null)
  const generationRef = useRef(0)

  useEffect(() => {
    generationRef.current += 1
    setConfirming(false)
    setSubmitting(false)
    setSettlement(null)
    attemptKeyRef.current = null
    return () => { generationRef.current += 1 }
  }, [projectId, threadId])

  if (loadState === "loading") {
    return <section aria-label="Selected Thread work status"><p role="status" className="text-xs text-[var(--workbench-muted)]">Checking work status…</p></section>
  }
  if (loadState === "error" || projection === null) {
    return <section aria-label="Selected Thread work status"><p role="alert" className="text-xs text-[var(--workbench-fault)]">Work status unavailable. Thread context was not changed.</p></section>
  }

  const summary = summarizeWorkbenchThreadTrust(projection, repositoryEligible)

  async function submit() {
    if (!summary.canStart || summary.outcomeKey === null || submitting) return
    const generation = generationRef.current
    const key = attemptKeyRef.current ?? newAttemptKey()
    attemptKeyRef.current = key
    setSubmitting(true)
    setSettlement(null)
    try {
      const result = await authorizeWorkbenchOutcomeExecution({
        projectId,
        threadId,
        outcomeKey: summary.outcomeKey,
        idempotencyKey: key,
        confirmation: "START_WORK",
      })
      if (generation !== generationRef.current) return
      if (result.projectId !== projectId || result.threadId !== threadId || result.outcomeKey !== summary.outcomeKey) return
      setSettlement({ kind: "typed", result })
      onRefresh()
    } catch {
      if (generation !== generationRef.current) return
      setSettlement({ kind: "uncertain" })
    } finally {
      if (generation === generationRef.current) setSubmitting(false)
    }
  }

  const typed = settlement?.kind === "typed" ? settlement.result : null
  const authorized = typed?.status === "AUTHORIZED_FOR_ACQUISITION" || typed?.status === "ALREADY_AUTHORIZED"
  const replayProgress = typed?.status === "ALREADY_AUTHORIZED" ? [
    typed.workOrderObserved ? "Work Order" : null,
    typed.leaseObserved ? "lease" : null,
    typed.executionObserved ? "execution evidence" : null,
  ].filter((value): value is string => value !== null) : []

  return (
    <section aria-label="Selected Thread work status" className="mt-4 border-t border-[var(--workbench-hairline)] pt-4">
      <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--workbench-muted)]">Work status</p>
      <p className="mt-2 text-sm font-semibold text-[var(--workbench-text)]">
        {authorized
          ? typed.status === "ALREADY_AUTHORIZED" ? "Already authorized" : "Authorized for acquisition"
          : typed?.status === "CONFLICT" ? "Start work conflict"
            : typed?.status === "UNAVAILABLE" || typed?.status === "INELIGIBLE" ? "Start work unavailable"
              : settlement?.kind === "uncertain" ? "Settlement unknown"
                : summary.label}
      </p>
      <p className="mt-1 text-xs leading-5 text-[var(--workbench-muted)]">
        {typed?.status === "ALREADY_AUTHORIZED"
          ? `Prior authorization was recorded; this replay granted nothing new. ${replayProgress.length > 0 ? `Persisted progress observed: ${replayProgress.join(", ")}. ` : "No downstream work, lease, or execution was observed in the replay snapshot. "}Current selected Thread status: ${summary.label}. Current authority was not evaluated by this replay.`
          : authorized
            ? "This explicit confirmation authorized acquisition only. No Work Order, lease, workspace, process, or dispatch was observed."
          : typed?.status === "CONFLICT"
            ? "The confirmation conflicted with a prior request and was not retried. No execution was observed."
            : typed?.status === "UNAVAILABLE" || typed?.status === "INELIGIBLE"
              ? "The selected outcome is not eligible for this authority boundary. No execution was observed."
              : settlement?.kind === "uncertain"
                ? "The confirmation response was not observed. Retry uses the same request key so settlement remains idempotent."
                : summary.detail}
      </p>

      {settlement?.kind === "uncertain" ? (
        <button type="button" disabled={submitting} onClick={() => void submit()} className="workbench-focus mt-3 border border-[var(--workbench-copper)] px-3 py-2 text-xs text-[var(--workbench-text)]">Retry confirmation</button>
      ) : summary.canStart && settlement === null && !confirming ? (
        <button type="button" onClick={() => setConfirming(true)} className="workbench-focus mt-3 border border-[var(--workbench-copper)] px-3 py-2 text-xs text-[var(--workbench-text)]">Start work</button>
      ) : confirming ? (
        <div className="mt-3 border-l border-[var(--workbench-copper)] pl-3">
          {settlement === null ? <p className="text-xs leading-5 text-[var(--workbench-muted)]">This authorizes acquisition only. HERMES may later acquire the work; this does not create a Work Order, lease, workspace, process, or dispatch.</p> : null}
          <div className="mt-2 flex flex-wrap gap-2">
            <button type="button" disabled={submitting || settlement !== null} onClick={() => void submit()} className="workbench-focus border border-[var(--workbench-copper)] px-3 py-2 text-xs text-[var(--workbench-text)]">{submitting ? "Authorizing…" : "Confirm Start work"}</button>
            {settlement === null ? <button type="button" disabled={submitting} onClick={() => setConfirming(false)} className="workbench-focus px-3 py-2 text-xs text-[var(--workbench-muted)]">Cancel</button> : null}
          </div>
        </div>
      ) : null}
    </section>
  )
}
