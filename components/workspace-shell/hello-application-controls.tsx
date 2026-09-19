"use client"

import { useCallback, useEffect, useState } from "react"
import { Bot, Check, Play, RotateCw, ShieldCheck, Square } from "lucide-react"

import styles from "./hello-application-controls.module.css"

type RuntimeSnapshot = Readonly<{
  state: "stopped" | "starting" | "running" | "failed"
  pid: number | null
  url: string | null
  error?: string | null
}>

type Proposal = Readonly<{
  proposalId: string
  status: "READY_FOR_REVIEW" | "APPLIED" | string
  model: string
  threadId: string
  turnId: string
  patchSha256: string
  changedPaths: readonly string[]
  validation: Readonly<{ status: string; command: string }>
  reviewPatch: string
}>

async function responseJson<T>(response: Response): Promise<T> {
  const payload = await response.json() as T & { error?: string }
  if (!response.ok) throw new Error(payload.error ?? `HELLO_APPLICATION_${response.status}`)
  return payload
}

function proposalStatus(status: string): string {
  return status === "READY_FOR_REVIEW" ? "Ready for review" : status === "APPLIED" ? "Applied" : status
}

export function HelloApplicationControls({
  onPreviewRefresh,
}: Readonly<{ onPreviewRefresh: () => void }>) {
  const [runtime, setRuntime] = useState<RuntimeSnapshot | null>(null)
  const [proposal, setProposal] = useState<Proposal | null>(null)
  const [busy, setBusy] = useState<"runtime" | "proposal" | "apply" | null>(null)
  const [error, setError] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    setError(null)
    try {
      const [runtimeResponse, proposalsResponse] = await Promise.all([
        fetch("/api/projects/hello-application/runtime", { cache: "no-store" }),
        fetch("/api/projects/hello-application/proposals", { cache: "no-store" }),
      ])
      const runtimePayload = await responseJson<{ runtime: RuntimeSnapshot }>(runtimeResponse)
      const proposalsPayload = await responseJson<{ proposals: readonly Proposal[] }>(proposalsResponse)
      setRuntime(runtimePayload.runtime)
      setProposal(proposalsPayload.proposals[0] ?? null)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "HELLO_APPLICATION_STATUS_UNAVAILABLE")
    }
  }, [])

  useEffect(() => { void refresh() }, [refresh])

  async function changeRuntime(method: "POST" | "DELETE") {
    setBusy("runtime")
    setError(null)
    try {
      const response = await fetch("/api/projects/hello-application/runtime", {
        method,
        headers: { "content-type": "application/json" },
      })
      const payload = await responseJson<{ runtime: RuntimeSnapshot }>(response)
      setRuntime(payload.runtime)
      onPreviewRefresh()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "HELLO_APPLICATION_RUNTIME_FAILED")
    } finally {
      setBusy(null)
    }
  }

  async function prepareProposal() {
    setBusy("proposal")
    setError(null)
    try {
      const response = await fetch("/api/projects/hello-application/proposals", {
        method: "POST",
        headers: { "content-type": "application/json" },
      })
      const payload = await responseJson<{ proposal: Proposal }>(response)
      setProposal(payload.proposal)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "HELLO_PROPOSAL_FAILED")
    } finally {
      setBusy(null)
    }
  }

  async function applyProposal() {
    if (!proposal) return
    setBusy("apply")
    setError(null)
    try {
      const response = await fetch(`/api/projects/hello-application/proposals/${encodeURIComponent(proposal.proposalId)}/apply`, {
        method: "POST",
        headers: { "content-type": "application/json" },
      })
      const payload = await responseJson<{ proposal: Proposal }>(response)
      setProposal(payload.proposal)
      onPreviewRefresh()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "HELLO_PROPOSAL_APPLY_FAILED")
    } finally {
      setBusy(null)
    }
  }

  return (
    <section className={styles.controls} aria-label="Hello Application runtime and HERMES change controls">
      <div className={styles.runtimeStrip}>
        <span className={styles.identity}><span aria-hidden className={styles.signal} />Hello Application</span>
        <span className={styles.runtimeState} data-state={runtime?.state ?? "loading"}>
          Runtime {runtime?.state ?? "checking"}
          {runtime?.pid ? <span> · PID {runtime.pid}</span> : null}
        </span>
        <span className={styles.actions}>
          {runtime?.state === "running" ? (
            <button type="button" onClick={() => void changeRuntime("DELETE")} disabled={busy !== null} aria-label="Stop application">
              <Square size={12} aria-hidden /> Stop
            </button>
          ) : (
            <button type="button" onClick={() => void changeRuntime("POST")} disabled={busy !== null} aria-label="Start application">
              <Play size={12} aria-hidden /> Start
            </button>
          )}
          <button type="button" onClick={onPreviewRefresh} disabled={busy !== null} aria-label="Refresh preview">
            <RotateCw size={12} aria-hidden /> Refresh
          </button>
        </span>
      </div>

      <div className={styles.governanceStrip}>
        <span className={styles.agent}><Bot size={14} aria-hidden /><strong>HERMES resident agent</strong></span>
        <span className={styles.boundary}><ShieldCheck size={13} aria-hidden />3 reserved source files · proposal only</span>
        <button
          type="button"
          className={styles.propose}
          onClick={() => void prepareProposal()}
          disabled={busy !== null}
          aria-label="Prepare governed change"
        >
          {busy === "proposal" ? "HERMES is working…" : "Prepare change"}
        </button>
      </div>

      {proposal ? (
        <div className={styles.receipt} aria-live="polite">
          <div className={styles.receiptHead}>
            <span className={styles.proposalState}><Check size={13} aria-hidden />{proposalStatus(proposal.status)}</span>
            <span>{proposal.model}</span>
            <span>test {proposal.validation.status}</span>
            <span title={proposal.patchSha256}>patch {proposal.patchSha256.slice(0, 12)}</span>
          </div>
          <ul className={styles.paths} aria-label="Proposed changed paths">
            {proposal.changedPaths.map((changedPath) => <li key={changedPath} title={changedPath}>{changedPath.split("/").at(-1)}</li>)}
          </ul>
          {proposal.reviewPatch ? (
            <pre className={styles.review} aria-label="Proposed patch">{proposal.reviewPatch}</pre>
          ) : (
            <p className={styles.reviewUnavailable}>Patch unavailable — apply blocked.</p>
          )}
          {proposal.status === "READY_FOR_REVIEW" ? (
            <button type="button" className={styles.apply} onClick={() => void applyProposal()} disabled={busy !== null || !proposal.reviewPatch} aria-label="Apply proposal">
              {busy === "apply" ? "Applying tested patch…" : "Apply proposal"}
            </button>
          ) : null}
        </div>
      ) : null}
      {error ? <p className={styles.error} role="alert">{error}</p> : null}
    </section>
  )
}
