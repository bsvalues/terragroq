"use client"

import { FormEvent, useEffect, useRef, useState } from "react"
import { Bot, Check, ShieldCheck } from "lucide-react"

import styles from "./hello-application-assistant.module.css"

type ProgressEntry = Readonly<{
  stage: string
  detail: string
  at: string
}>

type Proposal = Readonly<{
  schemaVersion?: 1 | 2
  proposalId: string
  status: "READY_FOR_REVIEW" | "APPLIED" | string
  requestText?: string
  executionNode?: string
  progress?: readonly ProgressEntry[]
  model: string
  threadId: string
  turnId: string
  patchSha256: string
  changedPaths: readonly string[]
  validation: Readonly<{ status: string; command: string; output?: string }>
  reviewPatch: string
  appliedCommit?: string | null
}>

type StreamTerminal =
  | Readonly<{ type: "proposal"; proposal: Proposal }>
  | Readonly<{ type: "error"; error: string }>

const MAX_REQUEST_LENGTH = 2_000

function record(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value)
}

function nonempty(value: unknown): value is string {
  return typeof value === "string" && value.length > 0
}

function progressEntry(value: unknown): value is ProgressEntry {
  return record(value) && nonempty(value.stage) && nonempty(value.detail) && nonempty(value.at)
}

function proposalRecord(value: unknown): value is Proposal {
  if (!record(value)) return false
  if (value.schemaVersion !== undefined && value.schemaVersion !== 1 && value.schemaVersion !== 2) return false
  if (!nonempty(value.proposalId) || !nonempty(value.status) || !nonempty(value.model)
    || !nonempty(value.threadId) || !nonempty(value.turnId) || !nonempty(value.patchSha256)
    || typeof value.reviewPatch !== "string") return false
  if (!Array.isArray(value.changedPaths) || value.changedPaths.length === 0
    || value.changedPaths.some((item) => !nonempty(item))) return false
  if (!record(value.validation) || !nonempty(value.validation.status)
    || !nonempty(value.validation.command)
    || (value.validation.output !== undefined && typeof value.validation.output !== "string")) return false
  if (value.schemaVersion === 2 && (!nonempty(value.requestText) || !nonempty(value.executionNode)
    || !Array.isArray(value.progress) || value.progress.some((entry) => !progressEntry(entry)))) return false
  if (value.requestText !== undefined && typeof value.requestText !== "string") return false
  if (value.executionNode !== undefined && typeof value.executionNode !== "string") return false
  if (value.progress !== undefined && (!Array.isArray(value.progress) || value.progress.some((entry) => !progressEntry(entry)))) return false
  return true
}

function failureMessage(cause: unknown, fallback: string): string {
  return cause instanceof Error && cause.message ? cause.message : fallback
}

async function responseJson(response: Response): Promise<unknown> {
  let payload: unknown
  try {
    payload = await response.json()
  } catch {
    throw new Error(response.ok ? "HELLO_PROPOSAL_RESPONSE_INVALID" : `HELLO_PROPOSAL_HTTP_${response.status}`)
  }
  if (!response.ok) {
    const code = record(payload) && nonempty(payload.error) ? payload.error : `HELLO_PROPOSAL_HTTP_${response.status}`
    throw new Error(code)
  }
  return payload
}

function parseStreamLine(line: string, terminal: StreamTerminal | null): StreamTerminal | ProgressEntry {
  let value: unknown
  try {
    value = JSON.parse(line)
  } catch {
    throw new Error("HERMES stream failed: malformed record.")
  }
  if (!record(value) || typeof value.type !== "string") {
    throw new Error("HERMES stream failed: malformed record.")
  }
  if (!(["progress", "proposal", "error"] as const).includes(value.type as "progress" | "proposal" | "error")) {
    throw new Error("HERMES stream failed: unknown record type.")
  }
  if (terminal) {
    if (value.type === "proposal" || value.type === "error") {
      throw new Error("HERMES stream failed: duplicate terminal record.")
    }
    throw new Error("HERMES stream failed: record after terminal.")
  }
  if (value.type === "progress") {
    if (!progressEntry(value)) throw new Error("HERMES stream failed: malformed progress record.")
    return { stage: value.stage, detail: value.detail, at: value.at }
  }
  if (value.type === "proposal") {
    if (!proposalRecord(value.proposal)) throw new Error("HERMES stream failed: malformed proposal record.")
    return { type: "proposal", proposal: value.proposal }
  }
  if (!nonempty(value.error)) throw new Error("HERMES stream failed: malformed error record.")
  return { type: "error", error: value.error }
}

async function readProposalStream(
  response: Response,
  onProgress: (entry: ProgressEntry) => void,
): Promise<StreamTerminal> {
  if (!response.body) throw new Error("HERMES stream failed: missing terminal record.")
  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ""
  let terminal: StreamTerminal | null = null

  const consume = (rawLine: string) => {
    const line = rawLine.endsWith("\r") ? rawLine.slice(0, -1) : rawLine
    if (!line) throw new Error("HERMES stream failed: malformed record.")
    const parsed = parseStreamLine(line, terminal)
    if ("type" in parsed) terminal = parsed
    else onProgress(parsed)
  }

  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })
    let newline = buffer.indexOf("\n")
    while (newline >= 0) {
      consume(buffer.slice(0, newline))
      buffer = buffer.slice(newline + 1)
      newline = buffer.indexOf("\n")
    }
  }
  buffer += decoder.decode()
  if (buffer) consume(buffer)
  if (!terminal) throw new Error("HERMES stream failed: missing terminal record.")
  return terminal
}

function statusLabel(status: string): string {
  if (status === "READY_FOR_REVIEW") return "Ready for review"
  if (status === "APPLIED") return "Applied"
  if (status === "QUARANTINED_ROLLBACK_FAILED") return "Quarantined"
  return status
}

function ProposalReview({
  proposal,
  applying,
  onApply,
}: Readonly<{
  proposal: Proposal
  applying: boolean
  onApply: () => void
}>) {
  const schemaOne = proposal.schemaVersion === 1
  const request = proposal.requestText || (schemaOne ? "Unavailable in schema v1" : "Unavailable")
  const executionNode = proposal.executionNode || (schemaOne ? "Unavailable in schema v1" : "Unavailable")

  return (
    <section className={styles.proposal} aria-label="HERMES proposal">
      <header className={styles.proposalHeader}>
        <span className={styles.proposalState}><Check size={14} aria-hidden />{statusLabel(proposal.status)}</span>
        <span>Validation {proposal.validation.status}</span>
      </header>

      <details className={styles.reviewBody} open>
        <summary>Review proposal</summary>
        <div className={styles.reviewInner}>
          <dl className={styles.evidence} aria-label="Resident execution evidence">
            <div><dt>Request</dt><dd>{request}</dd></div>
            <div><dt>Execution node (actual)</dt><dd>{executionNode}</dd></div>
            <div><dt>Resident model (actual)</dt><dd>{proposal.model}</dd></div>
            <div><dt>Thread</dt><dd>{proposal.threadId}</dd></div>
            <div><dt>Turn</dt><dd>{proposal.turnId}</dd></div>
          </dl>

          <section className={styles.reviewSection} aria-labelledby={`paths-${proposal.proposalId}`}>
            <h3 id={`paths-${proposal.proposalId}`}>Changed paths</h3>
            <ul className={styles.paths}>
              {proposal.changedPaths.map((changedPath) => <li key={changedPath}>{changedPath}</li>)}
            </ul>
          </section>

          <section className={styles.reviewSection} aria-labelledby={`validation-${proposal.proposalId}`}>
            <h3 id={`validation-${proposal.proposalId}`}>Contained validation</h3>
            <p className={styles.command}><span>Command</span><code>{proposal.validation.command}</code></p>
            <pre className={styles.output} aria-label="Validation output" tabIndex={0}>
              {proposal.validation.output ?? "Validation output unavailable."}
            </pre>
          </section>

          <section className={styles.reviewSection} aria-labelledby={`patch-${proposal.proposalId}`}>
            <h3 id={`patch-${proposal.proposalId}`}>Patch</h3>
            <p className={styles.hash}><span>SHA-256</span><code>{proposal.patchSha256}</code></p>
            {proposal.reviewPatch ? (
              <pre className={styles.patch} aria-label="Proposed patch" tabIndex={0}>{proposal.reviewPatch}</pre>
            ) : (
              <p className={styles.reviewUnavailable}>Patch unavailable — Apply is blocked.</p>
            )}
          </section>
        </div>
      </details>

      {proposal.status === "READY_FOR_REVIEW" ? (
        <div className={styles.applyBar}>
          <span>Canonical source remains unchanged until you apply.</span>
          <button
            type="button"
            className={styles.apply}
            onClick={onApply}
            disabled={applying || !proposal.reviewPatch}
            aria-label="Apply proposal"
          >
            {applying ? "Applying proposal…" : "Apply proposal"}
          </button>
        </div>
      ) : null}
    </section>
  )
}

export function HelloApplicationAssistant({
  onPreviewRefresh,
}: Readonly<{ onPreviewRefresh: () => void }>) {
  const [draft, setDraft] = useState("")
  const [submittedRequest, setSubmittedRequest] = useState<string | null>(null)
  const [events, setEvents] = useState<readonly ProgressEntry[]>([])
  const [proposal, setProposal] = useState<Proposal | null>(null)
  const [busy, setBusy] = useState<"proposal" | "apply" | null>(null)
  const [status, setStatus] = useState("Checking saved proposals.")
  const [assistantError, setAssistantError] = useState<string | null>(null)
  const operationInFlight = useRef(false)
  const ownerInteracted = useRef(false)

  useEffect(() => {
    let current = true
    void fetch("/api/projects/hello-application/proposals", { cache: "no-store" })
      .then(responseJson)
      .then((payload) => {
        if (!current || ownerInteracted.current || operationInFlight.current) return
        if (!record(payload) || !Array.isArray(payload.proposals)) throw new Error("HELLO_PROPOSAL_RESPONSE_INVALID")
        const newest = payload.proposals[0]
        if (newest === undefined) {
          setStatus("Ready for a development request.")
          return
        }
        if (!proposalRecord(newest)) throw new Error("HELLO_PROPOSAL_RESPONSE_INVALID")
        setProposal(newest)
        setDraft(newest.requestText ?? "")
        setSubmittedRequest(newest.requestText ?? null)
        setEvents(newest.progress ?? [])
        setStatus(newest.status === "READY_FOR_REVIEW" ? "Newest proposal ready for review." : `Newest proposal ${statusLabel(newest.status).toLowerCase()}.`)
      })
      .catch((cause) => {
        if (!current || ownerInteracted.current || operationInFlight.current) return
        setStatus("")
        setAssistantError(`HERMES status failed: ${failureMessage(cause, "HELLO_PROPOSAL_UNAVAILABLE")}`)
      })
    return () => { current = false }
  }, [])

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    ownerInteracted.current = true
    if (busy || operationInFlight.current) return
    const requestText = draft.trim()
    if (!requestText) {
      setAssistantError("Enter a request for HERMES.")
      setStatus("")
      return
    }
    if (requestText.length > MAX_REQUEST_LENGTH) {
      setAssistantError("Keep the request to 2,000 characters or fewer.")
      setStatus("")
      return
    }
    if (requestText.includes("\0")) {
      setAssistantError("Remove the NUL character from the request.")
      setStatus("")
      return
    }

    setDraft(requestText)
    setSubmittedRequest(requestText)
    setEvents([])
    setProposal(null)
    setAssistantError(null)
    setStatus("Request submitted to HERMES.")
    operationInFlight.current = true
    setBusy("proposal")
    try {
      const response = await fetch("/api/projects/hello-application/proposals", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ requestText }),
      })
      if (!response.ok) {
        try {
          await responseJson(response)
        } catch (cause) {
          throw new Error(`HERMES request failed: ${failureMessage(cause, `HELLO_PROPOSAL_HTTP_${response.status}`)}`)
        }
      }
      const observed: ProgressEntry[] = []
      const terminal = await readProposalStream(response, (entry) => {
        observed.push(entry)
        setEvents([...observed])
        setStatus(entry.detail)
      })
      if (terminal.type === "error") throw new Error(`HERMES request failed: ${terminal.error}`)
      setProposal(terminal.proposal)
      setStatus(terminal.proposal.status === "READY_FOR_REVIEW" ? "Proposal ready for review." : statusLabel(terminal.proposal.status))
    } catch (cause) {
      setProposal(null)
      setStatus("")
      setAssistantError(failureMessage(cause, "HERMES request failed: HELLO_PROPOSAL_UNAVAILABLE"))
    } finally {
      operationInFlight.current = false
      setBusy(null)
    }
  }

  async function applyProposal() {
    if (busy || operationInFlight.current || !proposal || proposal.status !== "READY_FOR_REVIEW") return
    ownerInteracted.current = true
    operationInFlight.current = true
    setBusy("apply")
    setAssistantError(null)
    setStatus("Applying the reviewed proposal.")
    try {
      const response = await fetch(`/api/projects/hello-application/proposals/${encodeURIComponent(proposal.proposalId)}/apply`, {
        method: "POST",
        headers: { "content-type": "application/json" },
      })
      const payload = await responseJson(response)
      if (!record(payload) || !proposalRecord(payload.proposal)) throw new Error("HELLO_PROPOSAL_RESPONSE_INVALID")
      setProposal(payload.proposal)
      setStatus("Proposal applied. Preview refreshed.")
      onPreviewRefresh()
    } catch (cause) {
      setStatus("Proposal remains ready for review.")
      setAssistantError(`Apply failed: ${failureMessage(cause, "HELLO_PROPOSAL_APPLY_FAILED")}`)
    } finally {
      operationInFlight.current = false
      setBusy(null)
    }
  }

  return (
    <section className={styles.assistant} aria-label="Ask HERMES development assistant">
      <header className={styles.header}>
        <span className={styles.agent}><Bot size={16} aria-hidden /><strong>HERMES development instrument</strong></span>
        <span className={styles.boundary}><ShieldCheck size={14} aria-hidden />3 writable UI files · local model · proposal only</span>
      </header>

      <form className={styles.form} onSubmit={(event) => void submit(event)} aria-busy={busy === "proposal"}>
        <label htmlFor="hello-hermes-request">Ask HERMES to change this application</label>
        <div className={styles.requestRow}>
          <textarea
            id="hello-hermes-request"
            value={draft}
            onChange={(event) => {
              ownerInteracted.current = true
              setDraft(event.target.value)
            }}
            rows={2}
            maxLength={MAX_REQUEST_LENGTH}
            disabled={busy !== null}
            placeholder="Describe one visible change to the Hello Application."
          />
          <button type="submit" className={styles.ask} disabled={busy !== null}>Ask HERMES</button>
        </div>
      </form>

      {submittedRequest ? (
        <section className={styles.transcript} aria-label="Submitted request">
          <span>Submitted request</span>
          <blockquote>{submittedRequest}</blockquote>
        </section>
      ) : null}

      <section className={styles.activity} aria-label="Observed HERMES activity">
        <div className={styles.activityHeader}><span>Observed activity</span><span>{events.length} milestone{events.length === 1 ? "" : "s"}</span></div>
        <ol className={styles.log} role="log" aria-label="HERMES activity" aria-live="polite">
          {events.map((entry, index) => (
            <li key={`${entry.stage}-${entry.at}-${index}`}>
              <span>{entry.detail}</span>
              <time dateTime={entry.at}>{entry.at}</time>
            </li>
          ))}
        </ol>
        {proposal?.schemaVersion === 1 && proposal.progress === undefined ? (
          <p className={styles.unavailable}>Milestones unavailable in schema v1.</p>
        ) : null}
      </section>

      {status ? <p className={styles.status} role="status" aria-live="polite">{status}</p> : null}
      {assistantError ? <p className={styles.error} role="alert">{assistantError}</p> : null}

      {proposal ? <ProposalReview proposal={proposal} applying={busy === "apply"} onApply={() => void applyProposal()} /> : null}
    </section>
  )
}
