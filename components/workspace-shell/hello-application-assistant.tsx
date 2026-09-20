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
  schemaVersion: 1 | 2
  proposalId: string
  status: "READY_FOR_REVIEW" | "APPLY_IN_PROGRESS" | "APPLIED" | "REJECT_IN_PROGRESS" | "REJECTED" | "QUARANTINED_ROLLBACK_FAILED"
  requestedBy: string
  requestText?: string
  requestSha256?: string
  executionNode?: string
  progress?: readonly ProgressEntry[]
  createdAt: string
  appliedAt: string | null
  appliedCommit?: string | null
  applyStartedAt?: string
  rejectStartedAt?: string
  rejectedAt?: string
  rejectionReason?: string
  baseSha: string
  proposalCommit: string
  branch: string
  model: string
  threadId: string
  turnId: string
  patchSha256: string
  changedPaths: readonly string[]
  validation: Readonly<{ status: string; command: string; output?: string }>
  reviewPatch: string
  quarantinedAt?: string
}>

type StreamTerminal =
  | Readonly<{ type: "proposal"; proposal: Proposal }>
  | Readonly<{ type: "error"; error: string }>

const MAX_REQUEST_LENGTH = 2_000
const MAX_REJECTION_REASON_LENGTH = 500
const MAX_VALIDATION_OUTPUT_LENGTH = 12_000
const PROPOSAL_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const PATCH_SHA256 = /^[0-9a-f]{64}$/
const COMMIT_SHA = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/
const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/
const VALIDATION_COMMAND = "node --test examples/hello-application/test/hello.test.mjs"
const ALLOWED_CHANGED_PATHS = new Set([
  "examples/hello-application/src/app.js",
  "examples/hello-application/src/index.html",
  "examples/hello-application/src/styles.css",
])
const PROGRESS_MILESTONES = [
  ["accepted", "Request accepted"],
  ["workspace_ready", "Isolated workspace ready"],
  ["resident_started", "HERMES is editing the isolated workspace"],
  ["resident_finished", "HERMES editing finished"],
  ["validation_started", "Contained validation started"],
  ["ready_for_review", "Proposal ready for review"],
] as const
const V2_PROPOSAL_KEYS = [
  "schemaVersion",
  "proposalId",
  "status",
  "requestedBy",
  "requestText",
  "requestSha256",
  "executionNode",
  "progress",
  "createdAt",
  "appliedAt",
  "appliedCommit",
  "baseSha",
  "proposalCommit",
  "branch",
  "changedPaths",
  "patchSha256",
  "threadId",
  "turnId",
  "model",
  "validation",
  "reviewPatch",
] as const

function record(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value)
}

function nonempty(value: unknown): value is string {
  return typeof value === "string" && value.length > 0
}

function receiptText(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && value.trim() === value && !/[\0\r\n]/.test(value)
}

function acceptedRejectionReason(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= MAX_REJECTION_REASON_LENGTH
    && value.trim() === value && !/[\u0000-\u001f\u007f\u2028\u2029]/.test(value)
}

function normalizedRejectionReason(value: unknown): string | null {
  if (typeof value !== "string" || /[\u0000-\u001f\u007f\u2028\u2029]/.test(value)) return null
  const trimmed = value.trim()
  return acceptedRejectionReason(trimmed) ? trimmed : null
}

function boundedRequest(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= MAX_REQUEST_LENGTH
    && value.trim() === value && !value.includes("\0")
}

function exactKeys(value: object, expected: readonly string[]): boolean {
  const actual = Object.keys(value).sort()
  const sortedExpected = [...expected].sort()
  return actual.length === sortedExpected.length && actual.every((key, index) => key === sortedExpected[index])
}

function timestamp(value: unknown): value is string {
  if (typeof value !== "string") return false
  const parsed = Date.parse(value)
  return Number.isFinite(parsed) && new Date(parsed).toISOString() === value
}

function progressEntry(value: unknown): value is ProgressEntry {
  return record(value) && nonempty(value.stage) && nonempty(value.detail) && timestamp(value.at)
}

function schemaTwoProgress(value: unknown, createdAt: string): value is readonly ProgressEntry[] {
  if (!Array.isArray(value) || value.length !== PROGRESS_MILESTONES.length) return false
  let previous = Date.parse(createdAt)
  for (const [index, entry] of value.entries()) {
    const expected = PROGRESS_MILESTONES[index]
    if (!progressEntry(entry) || !exactKeys(entry, ["stage", "detail", "at"])
      || entry.stage !== expected[0] || entry.detail !== expected[1]) return false
    const observedAt = Date.parse(entry.at)
    if (observedAt < previous) return false
    previous = observedAt
  }
  return true
}

function acceptedChangedPaths(value: unknown): value is readonly string[] {
  if (!Array.isArray(value) || value.length === 0 || !value.every(nonempty)) return false
  const paths = value as string[]
  return paths.every((item) => ALLOWED_CHANGED_PATHS.has(item))
    && new Set(paths).size === paths.length
    && paths.every((item, index) => index === 0 || paths[index - 1] < item)
}

function proposalRecord(value: unknown): value is Proposal {
  if (!record(value)) return false
  if (value.schemaVersion !== 1 && value.schemaVersion !== 2) return false
  if (!nonempty(value.proposalId) || !PROPOSAL_ID.test(value.proposalId)
    || !["READY_FOR_REVIEW", "APPLY_IN_PROGRESS", "APPLIED", "REJECT_IN_PROGRESS", "REJECTED", "QUARANTINED_ROLLBACK_FAILED"].includes(String(value.status))
    || !receiptText(value.requestedBy) || !timestamp(value.createdAt)
    || !nonempty(value.baseSha) || !COMMIT_SHA.test(value.baseSha)
    || !nonempty(value.proposalCommit) || !COMMIT_SHA.test(value.proposalCommit)
    || value.branch !== `codex/hermes-hello-${value.proposalId}`
    || !receiptText(value.model) || typeof value.threadId !== "string" || !SAFE_ID.test(value.threadId)
    || typeof value.turnId !== "string" || !SAFE_ID.test(value.turnId)
    || !nonempty(value.patchSha256) || !PATCH_SHA256.test(value.patchSha256)
    || typeof value.reviewPatch !== "string") return false
  if (value.schemaVersion === 2) {
    const keys = value.status === "QUARANTINED_ROLLBACK_FAILED"
      ? [...V2_PROPOSAL_KEYS, "quarantinedAt"]
      : value.status === "APPLY_IN_PROGRESS"
        ? [...V2_PROPOSAL_KEYS, "applyStartedAt"]
        : value.status === "REJECT_IN_PROGRESS"
          ? [...V2_PROPOSAL_KEYS, "rejectStartedAt", "rejectionReason"]
          : value.status === "REJECTED"
            ? [...V2_PROPOSAL_KEYS, "rejectedAt", "rejectionReason"]
            : V2_PROPOSAL_KEYS
    if (!exactKeys(value, keys)) return false
  }
  if (value.status === "READY_FOR_REVIEW" && !nonempty(value.reviewPatch)) return false
  if (!acceptedChangedPaths(value.changedPaths)) return false
  if (!record(value.validation) || value.validation.status !== "passed"
    || value.validation.command !== VALIDATION_COMMAND
    || (value.schemaVersion === 2 && !exactKeys(value.validation, ["status", "command", "output"]))
    || (value.schemaVersion === 2 && typeof value.validation.output !== "string")
    || (value.validation.output !== undefined && (typeof value.validation.output !== "string"
      || value.validation.output.length > MAX_VALIDATION_OUTPUT_LENGTH))) return false
  if (value.schemaVersion === 2 && (!boundedRequest(value.requestText)
    || !nonempty(value.requestSha256) || !PATCH_SHA256.test(value.requestSha256)
    || !receiptText(value.executionNode) || !schemaTwoProgress(value.progress, value.createdAt))) return false
  if (value.status === "APPLIED") {
    if (!timestamp(value.appliedAt) || value.appliedAt < value.createdAt) return false
    if ((value.schemaVersion === 2 || value.appliedCommit !== undefined)
      && (typeof value.appliedCommit !== "string"
        || !COMMIT_SHA.test(value.appliedCommit))) return false
    if (value.schemaVersion === 2 && Array.isArray(value.progress)
      && value.appliedAt < (value.progress[value.progress.length - 1] as ProgressEntry).at) return false
  } else {
    if (value.appliedAt !== null) return false
    if (value.schemaVersion === 2 && value.appliedCommit !== null) return false
  }
  if (value.status === "QUARANTINED_ROLLBACK_FAILED") {
    if (!timestamp(value.quarantinedAt) || value.quarantinedAt < value.createdAt) return false
  } else if (value.quarantinedAt !== undefined) return false
  if (value.status === "APPLY_IN_PROGRESS") {
    if (value.schemaVersion !== 2 || !timestamp(value.applyStartedAt) || value.applyStartedAt < value.createdAt
      || (Array.isArray(value.progress) && value.applyStartedAt < (value.progress[value.progress.length - 1] as ProgressEntry).at)) return false
  } else if (value.applyStartedAt !== undefined) return false
  if (value.status === "REJECT_IN_PROGRESS") {
    if (!timestamp(value.rejectStartedAt) || value.rejectStartedAt < value.createdAt
      || !acceptedRejectionReason(value.rejectionReason)
      || (Array.isArray(value.progress) && value.rejectStartedAt < (value.progress[value.progress.length - 1] as ProgressEntry).at)) return false
  } else if (value.rejectStartedAt !== undefined) return false
  if (value.status === "REJECTED") {
    if (!timestamp(value.rejectedAt) || value.rejectedAt < value.createdAt
      || !acceptedRejectionReason(value.rejectionReason)
      || (Array.isArray(value.progress) && value.rejectedAt < (value.progress[value.progress.length - 1] as ProgressEntry).at)) return false
  } else if (value.rejectedAt !== undefined || (value.status !== "REJECT_IN_PROGRESS" && value.rejectionReason !== undefined)) return false
  if (value.requestText !== undefined && !boundedRequest(value.requestText)) return false
  if (value.requestSha256 !== undefined && (typeof value.requestSha256 !== "string" || !PATCH_SHA256.test(value.requestSha256))) return false
  if (value.executionNode !== undefined && !receiptText(value.executionNode)) return false
  if (value.progress !== undefined && (!Array.isArray(value.progress) || value.progress.some((entry) => !progressEntry(entry)))) return false
  return true
}

async function sha256Text(value: string): Promise<string | null> {
  try {
    const subtle = globalThis.crypto?.subtle
    if (!subtle || typeof subtle.digest !== "function" || typeof TextEncoder !== "function") return null
    const digest = await subtle.digest("SHA-256", new TextEncoder().encode(value))
    return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("")
  } catch {
    return null
  }
}

async function verifiedProposalRecord(value: unknown): Promise<Proposal | null> {
  if (!proposalRecord(value)) return null
  const patchDigest = await sha256Text(value.reviewPatch)
  if (patchDigest !== value.patchSha256) return null
  if (value.schemaVersion === 2) {
    if (typeof value.requestText !== "string") return null
    const requestDigest = await sha256Text(value.requestText)
    if (requestDigest !== value.requestSha256) return null
  }
  return value
}

function sameStrings(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((item, index) => item === right[index])
}

function sameProgress(left: readonly ProgressEntry[] | undefined, right: readonly ProgressEntry[] | undefined): boolean {
  if (left === undefined || right === undefined) return left === right
  return left.length === right.length && left.every((entry, index) => {
    const other = right[index]
    return entry.stage === other.stage && entry.detail === other.detail && entry.at === other.at
  })
}

function canonicalNextProgress(entry: ProgressEntry, observed: readonly ProgressEntry[]): boolean {
  const expected = PROGRESS_MILESTONES[observed.length]
  if (!expected || entry.stage !== expected[0] || entry.detail !== expected[1]) return false
  const previous = observed.at(-1)
  return !previous || Date.parse(entry.at) >= Date.parse(previous.at)
}

function sameReviewedEvidence(value: Proposal, reviewed: Proposal): boolean {
  return value.schemaVersion === reviewed.schemaVersion
    && value.proposalId === reviewed.proposalId
    && value.requestedBy === reviewed.requestedBy
    && value.requestText === reviewed.requestText
    && value.requestSha256 === reviewed.requestSha256
    && value.executionNode === reviewed.executionNode
    && value.createdAt === reviewed.createdAt
    && value.baseSha === reviewed.baseSha
    && value.proposalCommit === reviewed.proposalCommit
    && value.branch === reviewed.branch
    && value.model === reviewed.model
    && value.threadId === reviewed.threadId
    && value.turnId === reviewed.turnId
    && value.patchSha256 === reviewed.patchSha256
    && value.reviewPatch === reviewed.reviewPatch
    && sameStrings(value.changedPaths, reviewed.changedPaths)
    && sameProgress(value.progress, reviewed.progress)
}

function sameValidation(left: Proposal["validation"], right: Proposal["validation"]): boolean {
  return left.status === right.status && left.command === right.command && left.output === right.output
}

function appliedProposalRecord(value: unknown, reviewed: Proposal): value is Proposal {
  return proposalRecord(value) && value.status === "APPLIED"
    && typeof value.appliedCommit === "string" && COMMIT_SHA.test(value.appliedCommit)
    && typeof value.validation.output === "string"
    && sameReviewedEvidence(value, reviewed)
}

function readyProposalRecord(value: unknown, reviewed: Proposal): value is Proposal {
  return proposalRecord(value) && value.status === "READY_FOR_REVIEW"
    && sameReviewedEvidence(value, reviewed)
    && sameValidation(value.validation, reviewed.validation)
}

function quarantinedProposalRecord(value: unknown, reviewed: Proposal): value is Proposal {
  return proposalRecord(value) && value.status === "QUARANTINED_ROLLBACK_FAILED"
    && sameReviewedEvidence(value, reviewed)
    && sameValidation(value.validation, reviewed.validation)
}

function applyingProposalRecord(value: unknown, reviewed: Proposal): value is Proposal {
  return proposalRecord(value) && value.status === "APPLY_IN_PROGRESS"
    && sameReviewedEvidence(value, reviewed)
    && sameValidation(value.validation, reviewed.validation)
}

function rejectedProposalRecord(value: unknown, reviewed: Proposal, reason?: string): value is Proposal {
  return proposalRecord(value) && value.status === "REJECTED"
    && sameReviewedEvidence(value, reviewed)
    && sameValidation(value.validation, reviewed.validation)
    && (reason === undefined || value.rejectionReason === reason)
}

function rejectingProposalRecord(value: unknown, reviewed: Proposal, reason?: string): value is Proposal {
  return proposalRecord(value) && value.status === "REJECT_IN_PROGRESS"
    && sameReviewedEvidence(value, reviewed)
    && sameValidation(value.validation, reviewed.validation)
    && (reason === undefined || value.rejectionReason === reason)
}

type ProposalReconciliation = Readonly<{
  state: "applied" | "ready" | "applying" | "rejecting" | "rejected" | "quarantined"
  proposal: Proposal
}>

async function readVerifiedProposalList(): Promise<readonly Proposal[]> {
  const response = await fetch("/api/projects/hello-application/proposals", { cache: "no-store" })
  const payload = await responseJson(response)
  if (!record(payload) || !exactKeys(payload, ["proposals"]) || !Array.isArray(payload.proposals)) {
    throw new Error("HELLO_PROPOSAL_RESPONSE_INVALID")
  }
  const proposals = await Promise.all(payload.proposals.map((candidate) => verifiedProposalRecord(candidate)))
  if (proposals.some((candidate) => !candidate)) throw new Error("HELLO_PROPOSAL_RESPONSE_INVALID")
  const verified = proposals as Proposal[]
  if (new Set(verified.map((candidate) => candidate.proposalId)).size !== verified.length) {
    throw new Error("HELLO_PROPOSAL_RESPONSE_INVALID")
  }
  return verified
}

const PENDING_STATUS_PRIORITY: readonly Proposal["status"][] = [
  "REJECT_IN_PROGRESS",
  "APPLY_IN_PROGRESS",
  "READY_FOR_REVIEW",
  "QUARANTINED_ROLLBACK_FAILED",
]

function pendingProposal(proposals: readonly Proposal[], excludedProposalId?: string): Proposal | null {
  for (const status of PENDING_STATUS_PRIORITY) {
    const proposal = proposals.find((candidate) => candidate.proposalId !== excludedProposalId && candidate.status === status)
    if (proposal) return proposal
  }
  return null
}

async function reconcileProposalOutcome(reviewed: Proposal, rejectionReason?: string): Promise<ProposalReconciliation> {
  const proposals = await readVerifiedProposalList()
  const matches = proposals.filter((candidate) => candidate.proposalId === reviewed.proposalId)
  if (matches.length !== 1) throw new Error("HELLO_PROPOSAL_RESPONSE_INVALID")
  const verified = matches[0]
  if (appliedProposalRecord(verified, reviewed)) return { state: "applied", proposal: verified }
  if (readyProposalRecord(verified, reviewed)) return { state: "ready", proposal: verified }
  if (applyingProposalRecord(verified, reviewed)) return { state: "applying", proposal: verified }
  if (rejectingProposalRecord(verified, reviewed, rejectionReason)) return { state: "rejecting", proposal: verified }
  if (rejectedProposalRecord(verified, reviewed, rejectionReason)) return { state: "rejected", proposal: verified }
  if (quarantinedProposalRecord(verified, reviewed)) return { state: "quarantined", proposal: verified }
  throw new Error("HELLO_PROPOSAL_RESPONSE_INVALID")
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
    if (!exactKeys(value, ["type", "stage", "detail", "at"]) || !progressEntry(value)) {
      throw new Error("HERMES stream failed: malformed progress record.")
    }
    return { stage: value.stage, detail: value.detail, at: value.at }
  }
  if (value.type === "proposal") {
    if (!exactKeys(value, ["type", "proposal"]) || !proposalRecord(value.proposal)) {
      throw new Error("HERMES stream failed: malformed proposal record.")
    }
    return { type: "proposal", proposal: value.proposal }
  }
  if (!exactKeys(value, ["type", "error"]) || !nonempty(value.error)) {
    throw new Error("HERMES stream failed: malformed error record.")
  }
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
  if (status === "APPLY_IN_PROGRESS") return "Apply in progress"
  if (status === "APPLIED") return "Applied"
  if (status === "REJECT_IN_PROGRESS") return "Reject in progress"
  if (status === "REJECTED") return "Rejected / discarded"
  if (status === "QUARANTINED_ROLLBACK_FAILED") return "Quarantined"
  return status
}

function ProposalReview({
  proposal,
  applying,
  rejecting,
  applyBlocked,
  confirmingReject,
  rejectionReason,
  onApply,
  onBeginReject,
  onCancelReject,
  onRejectionReasonChange,
  onReject,
}: Readonly<{
  proposal: Proposal
  applying: boolean
  rejecting: boolean
  applyBlocked: boolean
  confirmingReject: boolean
  rejectionReason: string
  onApply: () => void
  onBeginReject: () => void
  onCancelReject: () => void
  onRejectionReasonChange: (value: string) => void
  onReject: () => void
}>) {
  const schemaOne = proposal.schemaVersion === 1
  const request = proposal.requestText || (schemaOne ? "Unavailable in schema v1" : "Unavailable")
  const executionNode = proposal.executionNode || (schemaOne ? "Unavailable in schema v1" : "Unavailable")
  const proposalState = applyBlocked && proposal.status === "READY_FOR_REVIEW"
    ? "Apply state unconfirmed"
    : statusLabel(proposal.status)

  return (
    <section className={styles.proposal} aria-label="HERMES proposal">
      <header className={styles.proposalHeader}>
        <span className={styles.proposalState}><Check size={14} aria-hidden />{proposalState}</span>
        <span>Validation {proposal.validation.status}</span>
      </header>

      <details className={styles.reviewBody} open>
        <summary>Review proposal</summary>
        <div className={styles.reviewInner}>
          <dl className={styles.evidence} aria-label="Resident execution evidence">
            <div><dt>Request</dt><dd>{request}</dd></div>
            <div><dt>Execution node (actual)</dt><dd>{executionNode}</dd></div>
            <div><dt>Resident model alias</dt><dd>{proposal.model}</dd></div>
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

      {proposal.status === "REJECTED" ? (
        <dl className={styles.rejectionAudit} aria-label="Proposal rejection audit">
          <div><dt>Rejected at</dt><dd>{proposal.rejectedAt}</dd></div>
          <div><dt>Reason</dt><dd>{proposal.rejectionReason}</dd></div>
        </dl>
      ) : null}

      {proposal.status === "REJECT_IN_PROGRESS" ? (
        <>
          <dl className={styles.rejectionAudit} aria-label="Proposal rejection in progress">
            <div><dt>Rejection started</dt><dd>{proposal.rejectStartedAt}</dd></div>
            <div><dt>Reason</dt><dd>{proposal.rejectionReason}</dd></div>
          </dl>
          <div className={styles.applyBar}>
            <span>The durable rejection claim is incomplete. Resume it to finish discarding this proposal.</span>
            <button
              type="button"
              className={styles.reject}
              onClick={onReject}
              disabled={rejecting || applyBlocked}
              aria-label="Resume rejection"
            >
              {rejecting ? "Resuming rejection…" : "Resume rejection"}
            </button>
          </div>
        </>
      ) : null}

      {proposal.status === "READY_FOR_REVIEW" ? (
        confirmingReject ? (
          <div className={styles.rejectConfirmation} role="group" aria-label="Confirm proposal rejection">
            <label htmlFor={`hello-rejection-${proposal.proposalId}`}>Rejection reason</label>
            <textarea
              id={`hello-rejection-${proposal.proposalId}`}
              value={rejectionReason}
              onChange={(event) => onRejectionReasonChange(event.target.value)}
              maxLength={MAX_REJECTION_REASON_LENGTH}
              rows={2}
              disabled={rejecting || applyBlocked}
            />
            <span className={styles.rejectActions}>
              <button type="button" onClick={onCancelReject} disabled={rejecting}>Cancel rejection</button>
              <button
                type="button"
                className={styles.reject}
                onClick={onReject}
                disabled={rejecting || applyBlocked || normalizedRejectionReason(rejectionReason) === null}
              >
                {rejecting ? "Rejecting proposal…" : "Confirm rejection"}
              </button>
            </span>
          </div>
        ) : (
          <div className={styles.applyBar}>
            <span>{applyBlocked ? "Apply is blocked until authoritative proposal state is available." : "Canonical source remains unchanged until you apply or reject."}</span>
            <span className={styles.reviewActions}>
              <button
                type="button"
                className={styles.reject}
                onClick={onBeginReject}
                disabled={applying || applyBlocked}
                aria-label="Reject proposal"
              >
                Reject / discard
              </button>
              <button
                type="button"
                className={styles.apply}
                onClick={onApply}
                disabled={applying || applyBlocked || !proposal.reviewPatch}
                aria-label="Apply proposal"
              >
                {applying ? "Applying proposal…" : "Apply proposal"}
              </button>
            </span>
          </div>
        )
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
  const [applyBlocked, setApplyBlocked] = useState(false)
  const [confirmingReject, setConfirmingReject] = useState(false)
  const [rejectionReason, setRejectionReason] = useState("")
  const [busy, setBusy] = useState<"proposal" | "apply" | "reject" | null>(null)
  const [status, setStatus] = useState("Checking saved proposals.")
  const [assistantError, setAssistantError] = useState<string | null>(null)
  const operationInFlight = useRef(false)
  const ownerInteracted = useRef(false)

  function showProposal(value: Proposal, message: string) {
    setProposal(value)
    setApplyBlocked(false)
    setConfirmingReject(false)
    setRejectionReason("")
    setDraft(value.requestText ?? "")
    setSubmittedRequest(value.requestText ?? null)
    setEvents(value.progress ?? [])
    setStatus(message)
  }

  async function advanceAfterTerminal(completed: Proposal, terminalMessage: string) {
    try {
      const proposals = await readVerifiedProposalList()
      const next = pendingProposal(proposals, completed.proposalId)
      if (next) {
        showProposal(next, `Next pending proposal ${statusLabel(next.status).toLowerCase()}.`)
        return
      }
    } catch {
      // The completed receipt remains authoritative. A later page load will retry queue discovery.
    }
    setStatus(terminalMessage)
  }

  useEffect(() => {
    let current = true
    void readVerifiedProposalList()
      .then((proposals) => {
        if (!current || ownerInteracted.current || operationInFlight.current) return
        const selected = pendingProposal(proposals) ?? proposals[0]
        if (!selected) {
          setStatus("Ready for a development request.")
          return
        }
        showProposal(selected, selected.status === "READY_FOR_REVIEW"
          ? "Pending proposal ready for review."
          : `Pending proposal ${statusLabel(selected.status).toLowerCase()}.`)
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
    setApplyBlocked(false)
    setConfirmingReject(false)
    setRejectionReason("")
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
        if (!canonicalNextProgress(entry, observed)) {
          throw new Error("HERMES stream failed: milestone sequence mismatch.")
        }
        observed.push(entry)
        setEvents([...observed])
        setStatus(entry.detail)
      })
      if (terminal.type === "error") throw new Error(`HERMES request failed: ${terminal.error}`)
      if (terminal.proposal.schemaVersion !== 2 || terminal.proposal.status !== "READY_FOR_REVIEW") {
        throw new Error("HERMES stream failed: invalid proposal terminal.")
      }
      if (!sameProgress(observed, terminal.proposal.progress)) {
        throw new Error("HERMES stream failed: milestone sequence mismatch.")
      }
      if (terminal.proposal.requestText !== requestText) {
        throw new Error("HERMES stream failed: proposal request mismatch.")
      }
      const verified = await verifiedProposalRecord(terminal.proposal)
      if (!verified) throw new Error("HERMES stream failed: proposal evidence hash mismatch.")
      setProposal(verified)
      setApplyBlocked(false)
      setStatus(verified.status === "READY_FOR_REVIEW" ? "Proposal ready for review." : statusLabel(verified.status))
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
    if (busy || operationInFlight.current || applyBlocked || !proposal || proposal.status !== "READY_FOR_REVIEW") return
    const reviewed = proposal
    ownerInteracted.current = true
    operationInFlight.current = true
    setBusy("apply")
    setAssistantError(null)
    setStatus("Applying the reviewed proposal.")
    try {
      const response = await fetch(`/api/projects/hello-application/proposals/${encodeURIComponent(reviewed.proposalId)}/apply`, {
        method: "POST",
        headers: { "content-type": "application/json" },
      })
      const payload = await responseJson(response)
      if (!record(payload) || !appliedProposalRecord(payload.proposal, reviewed)) throw new Error("HELLO_PROPOSAL_RESPONSE_INVALID")
      const verified = await verifiedProposalRecord(payload.proposal)
      if (!verified) throw new Error("HELLO_PROPOSAL_RESPONSE_INVALID")
      setProposal(verified)
      setApplyBlocked(false)
      onPreviewRefresh()
      await advanceAfterTerminal(verified, "Proposal applied. Preview refreshed.")
    } catch (cause) {
      const failure = failureMessage(cause, "HELLO_PROPOSAL_APPLY_FAILED")
      try {
        const reconciled = await reconcileProposalOutcome(reviewed)
        setProposal(reconciled.proposal)
        setApplyBlocked(false)
        if (reconciled.state === "applied") {
          setAssistantError(null)
          onPreviewRefresh()
          await advanceAfterTerminal(reconciled.proposal, "Proposal applied. Preview refreshed.")
        } else if (reconciled.state === "ready") {
          setStatus("Proposal remains ready for review.")
          setAssistantError(`Apply failed: ${failure}`)
        } else if (reconciled.state === "applying") {
          setStatus("Proposal apply is in progress. Apply is unavailable.")
          setAssistantError(`Apply response lost: ${failure}`)
        } else if (reconciled.state === "rejecting") {
          setStatus("Proposal rejection is in progress. Resume it to finish discarding the proposal.")
          setAssistantError(null)
        } else if (reconciled.state === "rejected") {
          setAssistantError(null)
          await advanceAfterTerminal(reconciled.proposal, "Proposal rejected and discarded from Apply.")
        } else {
          setStatus("Proposal quarantined. Apply is blocked.")
          setAssistantError(`Apply failed: ${failure}`)
        }
      } catch {
        setProposal(reviewed)
        setApplyBlocked(true)
        setStatus("Apply outcome could not be verified. Apply is blocked.")
        setAssistantError("Apply failed: HELLO_PROPOSAL_OUTCOME_UNVERIFIED")
      }
    } finally {
      operationInFlight.current = false
      setBusy(null)
    }
  }

  async function rejectProposal() {
    if (busy || operationInFlight.current || applyBlocked || !proposal
      || (proposal.status !== "READY_FOR_REVIEW" && proposal.status !== "REJECT_IN_PROGRESS")) return
    const resuming = proposal.status === "REJECT_IN_PROGRESS"
    const reason = normalizedRejectionReason(resuming ? proposal.rejectionReason : rejectionReason)
    if (reason === null) {
      setAssistantError("Enter a single-line rejection reason of 500 characters or fewer.")
      return
    }
    const reviewed = proposal
    ownerInteracted.current = true
    operationInFlight.current = true
    setBusy("reject")
    setAssistantError(null)
    setStatus(resuming ? "Resuming the durable proposal rejection." : "Rejecting the reviewed proposal.")
    try {
      const response = await fetch(`/api/projects/hello-application/proposals/${encodeURIComponent(reviewed.proposalId)}`, {
        method: "DELETE",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ reason }),
      })
      const payload = await responseJson(response)
      if (!record(payload) || !rejectedProposalRecord(payload.proposal, reviewed, reason)) {
        throw new Error("HELLO_PROPOSAL_RESPONSE_INVALID")
      }
      const verified = await verifiedProposalRecord(payload.proposal)
      if (!verified) throw new Error("HELLO_PROPOSAL_RESPONSE_INVALID")
      setProposal(verified)
      setApplyBlocked(false)
      setConfirmingReject(false)
      setRejectionReason("")
      await advanceAfterTerminal(verified, "Proposal rejected and discarded from Apply.")
    } catch (cause) {
      const failure = failureMessage(cause, "HELLO_PROPOSAL_REJECTION_FAILED")
      try {
        const reconciled = await reconcileProposalOutcome(reviewed, reason)
        setProposal(reconciled.proposal)
        setApplyBlocked(false)
        if (reconciled.state === "rejected") {
          setConfirmingReject(false)
          setRejectionReason("")
          setAssistantError(null)
          await advanceAfterTerminal(reconciled.proposal, "Proposal rejected and discarded from Apply.")
        } else if (reconciled.state === "rejecting") {
          setConfirmingReject(false)
          setRejectionReason("")
          setAssistantError(null)
          setStatus("Proposal rejection is in progress. Resume it to finish discarding the proposal.")
        } else if (reconciled.state === "ready") {
          setStatus("Proposal remains ready for review.")
          setAssistantError(`Reject failed: ${failure}`)
        } else if (reconciled.state === "applied") {
          setConfirmingReject(false)
          setRejectionReason("")
          setAssistantError(null)
          onPreviewRefresh()
          await advanceAfterTerminal(reconciled.proposal, "Proposal was applied before rejection completed. Preview refreshed.")
        } else if (reconciled.state === "applying") {
          setConfirmingReject(false)
          setRejectionReason("")
          setStatus("Proposal apply is in progress. Apply and Reject are unavailable.")
          setAssistantError(`Reject response lost: ${failure}`)
        } else {
          setConfirmingReject(false)
          setRejectionReason("")
          setStatus("Proposal quarantined. Apply and Reject are blocked.")
          setAssistantError(`Reject failed: ${failure}`)
        }
      } catch {
        setProposal(reviewed)
        setApplyBlocked(true)
        setStatus("Reject outcome could not be verified. Apply and Reject are blocked.")
        setAssistantError("Reject failed: HELLO_PROPOSAL_OUTCOME_UNVERIFIED")
      }
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

      {proposal ? (
        <ProposalReview
          proposal={proposal}
          applying={busy === "apply"}
          rejecting={busy === "reject"}
          applyBlocked={applyBlocked}
          confirmingReject={confirmingReject}
          rejectionReason={rejectionReason}
          onApply={() => void applyProposal()}
          onBeginReject={() => {
            ownerInteracted.current = true
            setConfirmingReject(true)
            setAssistantError(null)
          }}
          onCancelReject={() => {
            setConfirmingReject(false)
            setRejectionReason("")
          }}
          onRejectionReasonChange={setRejectionReason}
          onReject={() => void rejectProposal()}
        />
      ) : null}
    </section>
  )
}
