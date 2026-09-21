"use client"

import { FormEvent, useEffect, useRef, useState } from "react"
import { Bot, Check, ShieldCheck } from "lucide-react"

import { isApplicationProposalErrorCode, type ApplicationProposalErrorCode } from "@/lib/applications/application-proposal-error-codes"
import type { ApplicationVisibleWorkspaceProject } from "@/lib/projects/workspace-project-key"
import { HELLO_APPLICATION_WORKSPACE_PROJECT } from "@/lib/projects/workspace-project-key"
import {
  adaptApplicationProposal,
  parseApplicationManifestPayload,
  type ApplicationActivationResult,
  type ApplicationManifestView,
  type ApplicationProgressEntry,
  type ApplicationProposalView,
} from "./application-ui-contract"
import styles from "./hello-application-assistant.module.css"

type ProgressEntry = Readonly<{
  stage: string
  detail: string
  at: string
}>

type ProviderExecution = Readonly<{
  route: "external"
  provider: "cerebras"
  bridgeNode: "hermes-node"
  inferenceNode: "cerebras-api"
  mode: "credential-bridge-one-shot"
  requestedModel: string
  actualModel: string
  externalEgress: true
  promptTokens: number
  completionTokens: number
  totalTokens: number
  calculatedCostUsd: number
  maxCostUsd: 0.03
  contextDigest: string
  durationMs: number
}>

type ExecutionRoute = Readonly<{
  id: string
  label: string
  provider: "hermes-local" | "cerebras"
  model: string
  external: boolean
  metered: boolean
  available: boolean
}>

type Proposal = Readonly<{
  schemaVersion: 1 | 2 | 3
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
  providerExecution?: ProviderExecution
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
const EXTERNAL_PROGRESS_MILESTONES = [
  ["accepted", "Request accepted"],
  ["workspace_ready", "Isolated workspace ready"],
  ["resident_started", "HERMES sent the bounded request to Cerebras"],
  ["resident_finished", "Cerebras returned a bounded change"],
  ["validation_started", "Contained validation started"],
  ["ready_for_review", "Proposal ready for review"],
] as const
const DEFAULT_EXECUTION_ROUTE = "hermes-local"
const LOCAL_EXECUTION_ROUTE: ExecutionRoute = Object.freeze({
  id: DEFAULT_EXECUTION_ROUTE,
  label: "Local HERMES — williamos-qwen3-4b:64k (default)",
  provider: "hermes-local",
  model: "williamos-qwen3-4b:64k",
  external: false,
  metered: false,
  available: true,
})
const EXECUTION_ROUTE_CONTRACT = new Map<string, Omit<ExecutionRoute, "available">>([
  [LOCAL_EXECUTION_ROUTE.id, LOCAL_EXECUTION_ROUTE],
  ["cerebras-gpt-oss-120b", {
    id: "cerebras-gpt-oss-120b",
    label: "Cerebras — gpt-oss-120b (external, metered)",
    provider: "cerebras",
    model: "gpt-oss-120b",
    external: true,
    metered: true,
  }],
  ["cerebras-qwen-3-8-27b", {
    id: "cerebras-qwen-3-8-27b",
    label: "Cerebras — qwen-3.8-27b (external, metered)",
    provider: "cerebras",
    model: "qwen-3.8-27b",
    external: true,
    metered: true,
  }],
])
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

function schemaProgress(value: unknown, createdAt: string, external: boolean): value is readonly ProgressEntry[] {
  const milestones = external ? EXTERNAL_PROGRESS_MILESTONES : PROGRESS_MILESTONES
  if (!Array.isArray(value) || value.length !== milestones.length) return false
  let previous = Date.parse(createdAt)
  for (const [index, entry] of value.entries()) {
    const expected = milestones[index]
    if (!progressEntry(entry) || !exactKeys(entry, ["stage", "detail", "at"])
      || entry.stage !== expected[0] || entry.detail !== expected[1]) return false
    const observedAt = Date.parse(entry.at)
    if (observedAt < previous) return false
    previous = observedAt
  }
  return true
}

function providerExecutionRecord(value: unknown, model: unknown, executionNode: unknown): value is ProviderExecution {
  return record(value)
    && exactKeys(value, ["route", "provider", "bridgeNode", "inferenceNode", "mode", "requestedModel", "actualModel",
      "externalEgress", "promptTokens", "completionTokens", "totalTokens", "calculatedCostUsd", "maxCostUsd",
      "contextDigest", "durationMs"])
    && value.route === "external" && value.provider === "cerebras" && value.bridgeNode === "hermes-node"
    && value.inferenceNode === "cerebras-api" && value.mode === "credential-bridge-one-shot"
    && value.requestedModel === model && value.actualModel === model && executionNode === value.inferenceNode
    && value.externalEgress === true
    && Number.isSafeInteger(value.promptTokens) && Number(value.promptTokens) >= 0
    && Number.isSafeInteger(value.completionTokens) && Number(value.completionTokens) >= 0
    && value.totalTokens === Number(value.promptTokens) + Number(value.completionTokens)
    && typeof value.calculatedCostUsd === "number" && Number.isFinite(value.calculatedCostUsd) && value.calculatedCostUsd >= 0
    && value.maxCostUsd === 0.03 && value.calculatedCostUsd <= value.maxCostUsd
    && typeof value.contextDigest === "string" && /^sha256:[0-9a-f]{64}$/.test(value.contextDigest)
    && Number.isSafeInteger(value.durationMs) && Number(value.durationMs) >= 0
}

function executionRouteRecord(value: unknown): value is ExecutionRoute {
  if (!record(value) || !exactKeys(value, ["id", "label", "provider", "model", "external", "metered", "available"])
    || typeof value.id !== "string" || typeof value.available !== "boolean") return false
  const expected = EXECUTION_ROUTE_CONTRACT.get(value.id)
  return Boolean(expected) && value.label === expected?.label && value.provider === expected?.provider
    && value.model === expected?.model && value.external === expected?.external && value.metered === expected?.metered
}

async function readExecutionRoutes(project: ApplicationVisibleWorkspaceProject): Promise<readonly ExecutionRoute[]> {
  const response = await fetch(project.application.executionRoutesUrl, { cache: "no-store" })
  const payload = await responseJson(response)
  if (!record(payload) || !exactKeys(payload, ["schemaVersion", "defaultRoute", "routes"])
    || payload.schemaVersion !== 1 || payload.defaultRoute !== DEFAULT_EXECUTION_ROUTE || !Array.isArray(payload.routes)
    || payload.routes.length < 1 || payload.routes.length > EXECUTION_ROUTE_CONTRACT.size
    || payload.routes.some((route) => !executionRouteRecord(route))) throw new Error("HELLO_EXECUTION_ROUTES_INVALID")
  const routes = payload.routes as ExecutionRoute[]
  if (new Set(routes.map((route) => route.id)).size !== routes.length
    || routes[0].id !== DEFAULT_EXECUTION_ROUTE || !routes[0].available) throw new Error("HELLO_EXECUTION_ROUTES_INVALID")
  return routes.filter((route) => route.available)
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
  if (value.schemaVersion !== 1 && value.schemaVersion !== 2 && value.schemaVersion !== 3) return false
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
  if (value.schemaVersion >= 2) {
    const baseKeys = value.schemaVersion === 3 ? [...V2_PROPOSAL_KEYS, "providerExecution"] : V2_PROPOSAL_KEYS
    const keys = value.status === "QUARANTINED_ROLLBACK_FAILED"
      ? [...baseKeys, "quarantinedAt"]
      : value.status === "APPLY_IN_PROGRESS"
        ? [...baseKeys, "applyStartedAt"]
        : value.status === "REJECT_IN_PROGRESS"
          ? [...baseKeys, "rejectStartedAt", "rejectionReason"]
          : value.status === "REJECTED"
            ? [...baseKeys, "rejectedAt", "rejectionReason"]
            : baseKeys
    if (!exactKeys(value, keys)) return false
  }
  if (value.schemaVersion !== 3 && value.providerExecution !== undefined) return false
  if (value.status === "READY_FOR_REVIEW" && !nonempty(value.reviewPatch)) return false
  if (!acceptedChangedPaths(value.changedPaths)) return false
  if (!record(value.validation) || value.validation.status !== "passed"
    || value.validation.command !== VALIDATION_COMMAND
    || (value.schemaVersion >= 2 && !exactKeys(value.validation, ["status", "command", "output"]))
    || (value.schemaVersion >= 2 && typeof value.validation.output !== "string")
    || (value.validation.output !== undefined && (typeof value.validation.output !== "string"
      || value.validation.output.length > MAX_VALIDATION_OUTPUT_LENGTH))) return false
  if (value.schemaVersion >= 2 && (!boundedRequest(value.requestText)
    || !nonempty(value.requestSha256) || !PATCH_SHA256.test(value.requestSha256)
    || !receiptText(value.executionNode) || !schemaProgress(value.progress, value.createdAt, value.schemaVersion === 3))) return false
  if (value.schemaVersion === 3 && !providerExecutionRecord(value.providerExecution, value.model, value.executionNode)) return false
  if (value.status === "APPLIED") {
    if (!timestamp(value.appliedAt) || value.appliedAt < value.createdAt) return false
    if ((value.schemaVersion >= 2 || value.appliedCommit !== undefined)
      && (typeof value.appliedCommit !== "string"
        || !COMMIT_SHA.test(value.appliedCommit))) return false
    if (value.schemaVersion >= 2 && Array.isArray(value.progress)
      && value.appliedAt < (value.progress[value.progress.length - 1] as ProgressEntry).at) return false
  } else {
    if (value.appliedAt !== null) return false
    if (value.schemaVersion >= 2 && value.appliedCommit !== null) return false
  }
  if (value.status === "QUARANTINED_ROLLBACK_FAILED") {
    if (!timestamp(value.quarantinedAt) || value.quarantinedAt < value.createdAt) return false
  } else if (value.quarantinedAt !== undefined) return false
  if (value.status === "APPLY_IN_PROGRESS") {
    if (value.schemaVersion < 2 || !timestamp(value.applyStartedAt) || value.applyStartedAt < value.createdAt
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
  if (value.schemaVersion >= 2) {
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

function canonicalNextProgress(entry: ProgressEntry, observed: readonly ProgressEntry[], external: boolean): boolean {
  const expected = (external ? EXTERNAL_PROGRESS_MILESTONES : PROGRESS_MILESTONES)[observed.length]
  if (!expected || entry.stage !== expected[0] || entry.detail !== expected[1]) return false
  const previous = observed.at(-1)
  return !previous || Date.parse(entry.at) >= Date.parse(previous.at)
}

function sameProviderExecution(left: ProviderExecution | undefined, right: ProviderExecution | undefined): boolean {
  if (left === undefined || right === undefined) return left === right
  return left.route === right.route
    && left.provider === right.provider
    && left.bridgeNode === right.bridgeNode
    && left.inferenceNode === right.inferenceNode
    && left.mode === right.mode
    && left.requestedModel === right.requestedModel
    && left.actualModel === right.actualModel
    && left.externalEgress === right.externalEgress
    && left.promptTokens === right.promptTokens
    && left.completionTokens === right.completionTokens
    && left.totalTokens === right.totalTokens
    && left.calculatedCostUsd === right.calculatedCostUsd
    && left.maxCostUsd === right.maxCostUsd
    && left.contextDigest === right.contextDigest
    && left.durationMs === right.durationMs
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
    && sameProviderExecution(value.providerExecution, reviewed.providerExecution)
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

async function readVerifiedProposalList(project: ApplicationVisibleWorkspaceProject): Promise<readonly Proposal[]> {
  const response = await fetch(project.application.proposalsUrl, { cache: "no-store" })
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

async function reconcileProposalOutcome(
  project: ApplicationVisibleWorkspaceProject,
  reviewed: Proposal,
  rejectionReason?: string,
): Promise<ProposalReconciliation> {
  const proposals = await readVerifiedProposalList(project)
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

function formatUsd(value: number): string {
  if (value === 0) return "$0.00"
  if (value >= 0.01) return `$${value.toFixed(2)}`
  return `$${value.toFixed(8).replace(/0+$/, "").replace(/\.$/, "")}`
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
  onReviewNext,
}: Readonly<{
  proposal: Proposal | ApplicationProposalView
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
  onReviewNext: () => void
}>) {
  const schemaOne = proposal.schemaVersion === 1
  const request = proposal.requestText || (schemaOne ? "Unavailable in schema v1" : "Unavailable")
  const executionNode = proposal.executionNode || (schemaOne ? "Unavailable in schema v1" : "Unavailable")
  const externalExecution = proposal.providerExecution ?? undefined
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
          <dl className={styles.evidence} aria-label="Governed execution evidence">
            <div><dt>Proposal receipt</dt><dd>{proposal.proposalId}</dd></div>
            {"applicationId" in proposal && proposal.applicationId ? <div><dt>Application</dt><dd>{proposal.applicationId}</dd></div> : null}
            <div><dt>Request</dt><dd>{request}</dd></div>
            <div><dt>Execution provider</dt><dd>{externalExecution ? "Cerebras (external)" : "HERMES local"}</dd></div>
            <div><dt>Execution node (actual)</dt><dd>{executionNode}</dd></div>
            <div><dt>Executing model</dt><dd>{proposal.model}</dd></div>
            <div><dt>Thread</dt><dd>{proposal.threadId}</dd></div>
            <div><dt>Turn</dt><dd>{proposal.turnId}</dd></div>
            <div><dt>Base commit</dt><dd>{proposal.baseSha}</dd></div>
            <div><dt>Candidate commit</dt><dd>{"candidateSha" in proposal ? proposal.candidateSha : proposal.proposalCommit}</dd></div>
            {externalExecution ? (
              <>
                <div><dt>External egress</dt><dd>Approved</dd></div>
                <div><dt>Usage</dt><dd>{externalExecution.totalTokens.toLocaleString("en-US")} tokens</dd></div>
                <div><dt>Calculated cost</dt><dd>{formatUsd(externalExecution.calculatedCostUsd)}</dd></div>
                <div><dt>Maximum cost</dt><dd>{formatUsd(externalExecution.maxCostUsd)}</dd></div>
                <div><dt>Provider duration</dt><dd>{externalExecution.durationMs.toLocaleString("en-US")} ms</dd></div>
              </>
            ) : null}
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
              <p className={styles.reviewUnavailable}>
                {proposal.status === "READY_FOR_REVIEW"
                  ? "Patch unavailable — Apply is blocked."
                  : "Patch unavailable in this retained receipt."}
              </p>
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

      {proposal.status === "APPLIED" || proposal.status === "REJECTED" || proposal.status === "QUARANTINED_ROLLBACK_FAILED" ? (
        <div className={styles.nextBar}>
          <span>This terminal receipt stays visible until you choose another proposal.</span>
          <button type="button" onClick={onReviewNext} aria-label="Review next proposal">Review next proposal</button>
        </div>
      ) : null}
    </section>
  )
}

function LegacyApplicationAssistant({
  project,
  onPreviewRefresh,
}: Readonly<{
  project: ApplicationVisibleWorkspaceProject
  onPreviewRefresh: () => void
}>) {
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
  const [executionRoutes, setExecutionRoutes] = useState<readonly ExecutionRoute[]>([LOCAL_EXECUTION_ROUTE])
  const [executionRouteId, setExecutionRouteId] = useState(DEFAULT_EXECUTION_ROUTE)
  const [externalEgressApproved, setExternalEgressApproved] = useState(false)
  const [routeOptionsError, setRouteOptionsError] = useState(false)
  const operationInFlight = useRef(false)
  const ownerInteracted = useRef(false)
  const selectedExecutionRoute = executionRoutes.find((route) => route.id === executionRouteId) ?? LOCAL_EXECUTION_ROUTE

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
    setProposal(completed)
    setStatus(terminalMessage)
  }

  async function reviewNextProposal() {
    if (busy || operationInFlight.current) return
    ownerInteracted.current = true
    operationInFlight.current = true
    setAssistantError(null)
    setStatus("Checking for another proposal.")
    try {
      const proposals = await readVerifiedProposalList(project)
      const next = pendingProposal(proposals, proposal?.proposalId)
      if (next) showProposal(next, `Next pending proposal ${statusLabel(next.status).toLowerCase()}.`)
      else setStatus("No other pending proposal is ready for review.")
    } catch (cause) {
      setAssistantError(`HERMES status failed: ${failureMessage(cause, "HELLO_PROPOSAL_UNAVAILABLE")}`)
    } finally {
      operationInFlight.current = false
    }
  }

  useEffect(() => {
    let current = true
    void readExecutionRoutes(project)
      .then((routes) => {
        if (!current) return
        setExecutionRoutes(routes)
        setRouteOptionsError(false)
      })
      .catch(() => {
        if (!current) return
        setExecutionRoutes([LOCAL_EXECUTION_ROUTE])
        setExecutionRouteId(DEFAULT_EXECUTION_ROUTE)
        setExternalEgressApproved(false)
        setRouteOptionsError(true)
      })
    return () => { current = false }
  }, [project])

  useEffect(() => {
    let current = true
    void readVerifiedProposalList(project)
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
  }, [project])

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
    const selectedRoute = selectedExecutionRoute
    if (selectedRoute.external && !externalEgressApproved) {
      setAssistantError("Approve the bounded external egress before asking Cerebras.")
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
      const response = await fetch(project.application.proposalsUrl, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(selectedRoute.external
          ? { requestText, executionRoute: selectedRoute.id, externalEgressApproved: true }
          : { requestText }),
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
        if (!canonicalNextProgress(entry, observed, selectedRoute.external)) {
          throw new Error("HERMES stream failed: milestone sequence mismatch.")
        }
        observed.push(entry)
        setEvents([...observed])
        setStatus(entry.detail)
      })
      if (terminal.type === "error") throw new Error(`HERMES request failed: ${terminal.error}`)
      const expectedSchema = selectedRoute.external ? 3 : 2
      if (terminal.proposal.schemaVersion !== expectedSchema || terminal.proposal.status !== "READY_FOR_REVIEW") {
        throw new Error("HERMES stream failed: invalid proposal terminal.")
      }
      if (selectedRoute.external && (terminal.proposal.model !== selectedRoute.model
        || terminal.proposal.providerExecution?.actualModel !== selectedRoute.model)) {
        throw new Error("HERMES stream failed: execution route mismatch.")
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
      if (selectedRoute.external) setExternalEgressApproved(false)
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
      const response = await fetch(`${project.application.proposalsUrl}/${encodeURIComponent(reviewed.proposalId)}/apply`, {
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
        const reconciled = await reconcileProposalOutcome(project, reviewed)
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
      const response = await fetch(`${project.application.proposalsUrl}/${encodeURIComponent(reviewed.proposalId)}`, {
        method: project.application.rejectMethod,
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
        const reconciled = await reconcileProposalOutcome(project, reviewed, reason)
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
    <section className={styles.assistant} aria-label={`Ask HERMES to develop ${project.name}`}>
      <header className={styles.header}>
        <span className={styles.agent}><Bot size={16} aria-hidden /><strong>HERMES development instrument</strong></span>
        <span className={styles.boundary}>
          <ShieldCheck size={14} aria-hidden />
          {project.application.writablePaths?.length ?? 0} writable files · {project.application.writablePaths?.join(" · ") ?? "unavailable"}
        </span>
      </header>

      <form className={styles.form} onSubmit={(event) => void submit(event)} aria-busy={busy === "proposal"}>
        <div className={styles.routeControl}>
          <label htmlFor={`${project.key}-execution-route`}>AI execution route</label>
          <select
            id={`${project.key}-execution-route`}
            value={selectedExecutionRoute.id}
            aria-describedby={`${project.key}-execution-route-description`}
            disabled={busy !== null}
            onChange={(event) => {
              ownerInteracted.current = true
              setExecutionRouteId(event.target.value)
              setExternalEgressApproved(false)
              setAssistantError(null)
            }}
          >
            {executionRoutes.map((route) => <option key={route.id} value={route.id}>{route.label}</option>)}
          </select>
          <p id={`${project.key}-execution-route-description`} className={styles.routeDisclosure} aria-live="polite">
            {selectedExecutionRoute.external
              ? `External and metered. HERMES sends the governed request and allowlisted ${project.name} source to Cerebras. Canonical source changes only after review and Apply. No local fallback.`
              : "Runs inside HERMES. The request and application source stay in the lab."}
          </p>
          {routeOptionsError ? <p className={styles.routeUnavailable}>External routes are unavailable; local HERMES remains available.</p> : null}
          {selectedExecutionRoute.external ? (
            <label className={styles.egressApproval}>
              <input
                type="checkbox"
                checked={externalEgressApproved}
                disabled={busy !== null}
                onChange={(event) => setExternalEgressApproved(event.target.checked)}
              />
              I confirm this request contains only public or sanitized content and approve sending it with the allowlisted {project.name} source to Cerebras.
            </label>
          ) : null}
        </div>
        <label htmlFor={`${project.key}-hermes-request`}>Ask HERMES to change this application</label>
        <div className={styles.requestRow}>
          <textarea
            id={`${project.key}-hermes-request`}
            value={draft}
            onChange={(event) => {
              ownerInteracted.current = true
              setDraft(event.target.value)
              if (selectedExecutionRoute.external && externalEgressApproved) setExternalEgressApproved(false)
            }}
            rows={2}
            maxLength={MAX_REQUEST_LENGTH}
            disabled={busy !== null}
            placeholder={`Describe one visible change to ${project.name}.`}
          />
          <button
            type="submit"
            className={styles.ask}
            disabled={busy !== null || (selectedExecutionRoute.external && !externalEgressApproved)}
          >
            {selectedExecutionRoute.external ? "Ask HERMES via Cerebras" : "Ask HERMES"}
          </button>
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
          onReviewNext={() => void reviewNextProposal()}
        />
      ) : null}
    </section>
  )
}

type ApplicationStreamTerminal =
  | Readonly<{ type: "proposal"; proposal: ApplicationProposalView }>
  | Readonly<{ type: "error"; error: string }>

const APPLICATION_PROGRESS_MILESTONES = [
  ["accepted", "Request accepted"],
  ["workspace_ready", "Isolated application workspace ready"],
  ["resident_started", "HERMES AI is editing the isolated application workspace"],
  ["resident_finished", "HERMES AI editing finished"],
  ["validation_started", "Contained application validation started"],
  ["ready_for_review", "Application proposal ready for review"],
] as const

const APPLICATION_EXTERNAL_PROGRESS_MILESTONES = [
  ["accepted", "Request accepted"],
  ["workspace_ready", "Isolated application workspace ready"],
  ["resident_started", "HERMES sent the bounded application request to Cerebras"],
  ["resident_finished", "Cerebras returned a bounded application change"],
  ["validation_started", "Contained application validation started"],
  ["ready_for_review", "Application proposal ready for review"],
] as const

const APPLICATION_PROVIDER_FAILURE_MESSAGES: Readonly<Partial<Record<ApplicationProposalErrorCode, string>>> = Object.freeze({
  EXTERNAL_API_AUTH_FAILURE: "WilliamOS could not authenticate the Cerebras request. Check the governed credential bridge, then try again.",
  EXTERNAL_API_COST_EVIDENCE_MISSING: "Cerebras cost evidence was incomplete, so WilliamOS refused the response. Try again after provider evidence is restored.",
  EXTERNAL_API_INCOMPLETE_RESPONSE: "Cerebras returned an incomplete response. No proposal was admitted; try again.",
  EXTERNAL_API_INSUFFICIENT_CREDIT: "The Cerebras account has insufficient credit for this request. Choose local HERMES or restore provider credit.",
  EXTERNAL_API_KEY_MISSING: "Cerebras credentials are unavailable to the governed bridge. Choose local HERMES or restore the credential.",
  EXTERNAL_API_MALFORMED_RESPONSE: "The Cerebras response could not be verified. No proposal was admitted; try again.",
  EXTERNAL_API_OUTAGE: "Cerebras is temporarily unavailable. Choose local HERMES or try the external route again later.",
  EXTERNAL_API_RATE_LIMIT: "The Cerebras rate limit was reached. Choose local HERMES or retry after the limit clears.",
  EXTERNAL_API_TIMEOUT: "The Cerebras request timed out. Choose local HERMES or retry the external route.",
  EXTERNAL_API_UNSUPPORTED_CAPABILITY: "The selected Cerebras model does not support the required application change capability. Choose another route.",
})

function applicationFailureMessage(cause: unknown, fallback: string): string {
  const code = cause instanceof Error ? cause.message : ""
  if (isApplicationProposalErrorCode(code)) {
    const providerMessage = APPLICATION_PROVIDER_FAILURE_MESSAGES[code]
    if (providerMessage) return providerMessage
  } else if (code.startsWith("The HERMES response ")) {
    return code
  } else {
    return fallback
  }
  if (code.includes("EXECUTION_ROUTE_UNAVAILABLE") || code.includes("CEREBRAS_UNAVAILABLE")) {
    return "The selected AI route is unavailable. Choose another available route and try again."
  }
  if (code.includes("CEREBRAS") || code === "EXTERNAL_EGRESS_REFUSED" || code === "SPEND_CAP_EXCEEDS_CEILING") {
    return "The external AI route refused this bounded request. Review the route and approval, then try again or choose local HERMES."
  }
  if (code.includes("STALE_BASE") || code.includes("MANIFEST_DRIFT")) {
    return "The application changed after this proposal was created. Review a fresh proposal."
  }
  if (code.includes("REPOSITORY_BUSY")) return "The application repository is busy. Try again after the current operation finishes."
  if (code.includes("VALIDATION")) return "The contained application validation did not pass. No source change was applied."
  if (code.includes("SECRET_DETECTED")) return "The proposal was refused because it may contain a secret."
  return fallback
}

async function applicationResponseJson(response: Response): Promise<unknown> {
  let payload: unknown
  try { payload = await response.json() }
  catch { throw new Error(response.ok ? "APPLICATION_RESPONSE_INVALID" : `APPLICATION_HTTP_${response.status}`) }
  if (!response.ok) {
    throw new Error(record(payload) && nonempty(payload.error) ? payload.error : `APPLICATION_HTTP_${response.status}`)
  }
  return payload
}

async function verifiedApplicationProposal(
  project: ApplicationVisibleWorkspaceProject,
  manifest: ApplicationManifestView,
  value: unknown,
): Promise<ApplicationProposalView> {
  const proposal = adaptApplicationProposal(project, value)
  if (proposal.applicationId !== project.key || proposal.manifestDigest !== manifest.manifestDigest
    || !proposal.writablePaths || !sameStrings(proposal.writablePaths, manifest.writablePaths)) {
    throw new Error("APPLICATION_PROPOSAL_RESPONSE_INVALID")
  }
  if (proposal.requestText) {
    const requestDigest = await sha256Text(proposal.requestText)
    if (!requestDigest || requestDigest !== proposal.requestSha256) throw new Error("APPLICATION_PROPOSAL_RESPONSE_INVALID")
  }
  if (proposal.reviewPatch !== null) {
    const patchDigest = await sha256Text(proposal.reviewPatch)
    if (!patchDigest || patchDigest !== proposal.patchSha256) throw new Error("APPLICATION_PROPOSAL_RESPONSE_INVALID")
  }
  return proposal
}

function sameApplicationProposalEvidence(left: ApplicationProposalView, right: ApplicationProposalView): boolean {
  return left.schemaVersion === right.schemaVersion
    && left.proposalId === right.proposalId
    && left.applicationId === right.applicationId
    && left.manifestDigest === right.manifestDigest
    && left.repositoryDigest === right.repositoryDigest
    && Boolean(left.writablePaths && right.writablePaths && sameStrings(left.writablePaths, right.writablePaths))
    && left.requestedBy === right.requestedBy
    && left.requestText === right.requestText
    && left.requestSha256 === right.requestSha256
    && left.executionRoute === right.executionRoute
    && left.executionProvider === right.executionProvider
    && left.executionNode === right.executionNode
    && left.createdAt === right.createdAt
    && left.baseSha === right.baseSha
    && left.candidateSha === right.candidateSha
    && left.baseRef === right.baseRef
    && left.branch === right.branch
    && left.model === right.model
    && left.threadId === right.threadId
    && left.turnId === right.turnId
    && left.patchSha256 === right.patchSha256
    && sameStrings(left.changedPaths, right.changedPaths)
    && JSON.stringify(left.validation) === JSON.stringify(right.validation)
    && JSON.stringify(left.progress) === JSON.stringify(right.progress)
    && JSON.stringify(left.providerExecution) === JSON.stringify(right.providerExecution)
}

async function readApplicationManifest(project: ApplicationVisibleWorkspaceProject): Promise<ApplicationManifestView> {
  if (!project.application.manifestUrl) throw new Error("APPLICATION_MANIFEST_UNAVAILABLE")
  const response = await fetch(project.application.manifestUrl, { cache: "no-store" })
  return parseApplicationManifestPayload(project, await applicationResponseJson(response))
}

async function readApplicationExecutionRoutes(project: ApplicationVisibleWorkspaceProject): Promise<readonly ExecutionRoute[]> {
  const response = await fetch(project.application.executionRoutesUrl, { cache: "no-store" })
  const payload = await applicationResponseJson(response)
  if (!record(payload) || !exactKeys(payload, ["schemaVersion", "defaultRoute", "routes"])
    || payload.schemaVersion !== 1 || payload.defaultRoute !== DEFAULT_EXECUTION_ROUTE || !Array.isArray(payload.routes)
    || payload.routes.length < 1 || payload.routes.length > EXECUTION_ROUTE_CONTRACT.size
    || payload.routes.some((route) => !executionRouteRecord(route))) throw new Error("APPLICATION_EXECUTION_ROUTES_INVALID")
  const routes = payload.routes as ExecutionRoute[]
  if (new Set(routes.map((route) => route.id)).size !== routes.length
    || routes[0].id !== DEFAULT_EXECUTION_ROUTE || !routes[0].available) {
    throw new Error("APPLICATION_EXECUTION_ROUTES_INVALID")
  }
  return routes.filter((route) => route.available)
}

async function readApplicationProposalList(
  project: ApplicationVisibleWorkspaceProject,
  manifest: ApplicationManifestView,
): Promise<readonly ApplicationProposalView[]> {
  const response = await fetch(project.application.proposalsUrl, { cache: "no-store" })
  const payload = await applicationResponseJson(response)
  if (!record(payload) || !(exactKeys(payload, ["proposals"])
      || exactKeys(payload, ["proposals", "truncated"]) && payload.truncated === true)
    || !Array.isArray(payload.proposals)) throw new Error("APPLICATION_PROPOSAL_RESPONSE_INVALID")
  const proposals = await Promise.all(payload.proposals.map((value) => verifiedApplicationProposal(project, manifest, value)))
  if (new Set(proposals.map((proposal) => proposal.proposalId)).size !== proposals.length) {
    throw new Error("APPLICATION_PROPOSAL_RESPONSE_INVALID")
  }
  return proposals
}

async function readApplicationProposal(
  project: ApplicationVisibleWorkspaceProject,
  manifest: ApplicationManifestView,
  proposalId: string,
): Promise<ApplicationProposalView> {
  const response = await fetch(`${project.application.proposalsUrl}/${encodeURIComponent(proposalId)}`, { cache: "no-store" })
  const payload = await applicationResponseJson(response)
  if (!record(payload) || !exactKeys(payload, ["proposal"])) throw new Error("APPLICATION_PROPOSAL_RESPONSE_INVALID")
  return verifiedApplicationProposal(project, manifest, payload.proposal)
}

function nextApplicationProgress(
  entry: ApplicationProgressEntry,
  observed: readonly ApplicationProgressEntry[],
  external: boolean,
): boolean {
  const expected = (external ? APPLICATION_EXTERNAL_PROGRESS_MILESTONES : APPLICATION_PROGRESS_MILESTONES)[observed.length]
  if (!expected || entry.stage !== expected[0] || entry.detail !== expected[1] || !timestamp(entry.at)) return false
  const previous = observed.at(-1)
  return !previous || entry.at >= previous.at
}

async function readApplicationProposalStream(
  response: Response,
  project: ApplicationVisibleWorkspaceProject,
  manifest: ApplicationManifestView,
  onProgress: (entry: ApplicationProgressEntry) => void,
): Promise<ApplicationStreamTerminal> {
  if (!response.body) throw new Error("The HERMES response ended before a proposal receipt arrived.")
  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ""
  let terminal: ApplicationStreamTerminal | null = null
  const consume = async (rawLine: string) => {
    const line = rawLine.endsWith("\r") ? rawLine.slice(0, -1) : rawLine
    if (!line) throw new Error("The HERMES response contained an invalid activity record.")
    let value: unknown
    try { value = JSON.parse(line) } catch { throw new Error("The HERMES response contained an invalid activity record.") }
    if (!record(value) || typeof value.type !== "string" || terminal) {
      throw new Error("The HERMES response contained an invalid terminal sequence.")
    }
    if (value.type === "progress") {
      if (!exactKeys(value, ["type", "stage", "detail", "at"])
        || !nonempty(value.stage) || !nonempty(value.detail) || !timestamp(value.at)) {
        throw new Error("The HERMES response contained an invalid activity record.")
      }
      onProgress({ stage: value.stage, detail: value.detail, at: value.at })
      return
    }
    if (value.type === "proposal" && exactKeys(value, ["type", "proposal"])) {
      terminal = { type: "proposal", proposal: await verifiedApplicationProposal(project, manifest, value.proposal) }
      return
    }
    if (value.type === "error" && exactKeys(value, ["type", "error"]) && isApplicationProposalErrorCode(value.error)) {
      terminal = { type: "error", error: value.error }
      return
    }
    throw new Error("The HERMES response contained an invalid terminal record.")
  }
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })
    let newline = buffer.indexOf("\n")
    while (newline >= 0) {
      await consume(buffer.slice(0, newline))
      buffer = buffer.slice(newline + 1)
      newline = buffer.indexOf("\n")
    }
  }
  buffer += decoder.decode()
  if (buffer) await consume(buffer)
  if (!terminal) throw new Error("The HERMES response ended before a proposal receipt arrived.")
  return terminal
}

const APPLICATION_PENDING_PRIORITY: readonly ApplicationProposalView["status"][] = [
  "APPLY_IN_PROGRESS",
  "READY_FOR_REVIEW",
  "QUARANTINED_ROLLBACK_FAILED",
]

function pendingApplicationProposal(
  proposals: readonly ApplicationProposalView[],
  excludedProposalId?: string,
): ApplicationProposalView | null {
  for (const status of APPLICATION_PENDING_PRIORITY) {
    const proposal = proposals.find((candidate) => candidate.proposalId !== excludedProposalId && candidate.status === status)
    if (proposal) return proposal
  }
  return null
}

function GenericApplicationAssistant({
  project,
  onApplied,
}: Readonly<{
  project: ApplicationVisibleWorkspaceProject
  onApplied?: (appliedCommit: string) => Promise<ApplicationActivationResult>
}>) {
  const [manifest, setManifest] = useState<ApplicationManifestView | null>(null)
  const [draft, setDraft] = useState("")
  const [submittedRequest, setSubmittedRequest] = useState<string | null>(null)
  const [events, setEvents] = useState<readonly ApplicationProgressEntry[]>([])
  const [proposal, setProposal] = useState<ApplicationProposalView | null>(null)
  const [applyBlocked, setApplyBlocked] = useState(false)
  const [confirmingReject, setConfirmingReject] = useState(false)
  const [rejectionReason, setRejectionReason] = useState("")
  const [busy, setBusy] = useState<"proposal" | "apply" | "reject" | null>(null)
  const [status, setStatus] = useState(`Loading ${project.name} governance boundary.`)
  const [assistantError, setAssistantError] = useState<string | null>(null)
  const [runtimeActivationError, setRuntimeActivationError] = useState<string | null>(null)
  const [executionRoutes, setExecutionRoutes] = useState<readonly ExecutionRoute[]>([LOCAL_EXECUTION_ROUTE])
  const [executionRouteId, setExecutionRouteId] = useState(DEFAULT_EXECUTION_ROUTE)
  const [externalEgressApproved, setExternalEgressApproved] = useState(false)
  const [routeOptionsError, setRouteOptionsError] = useState(false)
  const operationInFlight = useRef(false)
  const ownerInteracted = useRef(false)
  const selectedExecutionRoute = executionRoutes.find((route) => route.id === executionRouteId) ?? LOCAL_EXECUTION_ROUTE
  const fieldId = `application-${project.key}`

  function showProposal(value: ApplicationProposalView, message: string) {
    setProposal(value)
    setApplyBlocked(false)
    setConfirmingReject(false)
    setRejectionReason("")
    setDraft(value.requestText ?? "")
    setSubmittedRequest(value.requestText ?? null)
    setEvents(value.progress ?? [])
    setStatus(message)
  }

  async function retainAppliedReceipt(applied: ApplicationProposalView) {
    setProposal(applied)
    setAssistantError(null)
    setRuntimeActivationError(null)
    const appliedCommit = applied.appliedCommit
    if (!appliedCommit) {
      setStatus("Proposal applied. Start application to build and open the applied commit.")
      return
    }
    let activation: ApplicationActivationResult
    try {
      activation = onApplied ? await onApplied(appliedCommit) : { outcome: "start-required" }
    } catch {
      activation = {
        outcome: "failed",
        message: "The source change is applied, but the contained runtime could not be rebuilt. Use Start application to retry.",
      }
    }
    if (activation.outcome === "activated") {
      setStatus("Proposal applied. Running application rebuilt from the applied commit.")
      return
    }
    if (activation.outcome === "start-required") {
      setStatus("Proposal applied. Start application to build and open the applied commit.")
      return
    }
    setStatus("Proposal applied. Runtime rebuild needs attention.")
    setRuntimeActivationError(activation.message)
  }

  useEffect(() => {
    let current = true
    ownerInteracted.current = false
    void readApplicationManifest(project).then(async (nextManifest) => {
      if (!current) return
      setManifest(nextManifest)
      const [routesResult, proposalsResult] = await Promise.allSettled([
        readApplicationExecutionRoutes(project),
        readApplicationProposalList(project, nextManifest),
      ])
      if (!current) return
      if (routesResult.status === "fulfilled") {
        setExecutionRoutes(routesResult.value)
        setRouteOptionsError(false)
      } else {
        setExecutionRoutes([LOCAL_EXECUTION_ROUTE])
        setExecutionRouteId(DEFAULT_EXECUTION_ROUTE)
        setRouteOptionsError(true)
      }
      if (proposalsResult.status === "rejected") throw proposalsResult.reason
      if (ownerInteracted.current || operationInFlight.current) return
      const selected = pendingApplicationProposal(proposalsResult.value) ?? proposalsResult.value[0]
      if (selected) showProposal(selected, selected.status === "READY_FOR_REVIEW"
        ? "Pending proposal ready for review."
        : `Saved proposal ${statusLabel(selected.status).toLowerCase()}.`)
      else setStatus(`Ready for a ${project.name} development request.`)
    }).catch((cause) => {
      if (!current || ownerInteracted.current || operationInFlight.current) return
      setStatus("")
      setAssistantError(applicationFailureMessage(cause, `The ${project.name} development instrument is unavailable.`))
    })
    return () => { current = false }
  }, [project])

  async function reviewNextProposal() {
    if (!manifest || busy || operationInFlight.current) return
    ownerInteracted.current = true
    operationInFlight.current = true
    setAssistantError(null)
    setRuntimeActivationError(null)
    setStatus("Checking for another proposal.")
    try {
      const proposals = await readApplicationProposalList(project, manifest)
      const next = pendingApplicationProposal(proposals, proposal?.proposalId)
      if (next) showProposal(next, `Next pending proposal ${statusLabel(next.status).toLowerCase()}.`)
      else setStatus("No other pending proposal is ready for review.")
    } catch (cause) {
      setAssistantError(applicationFailureMessage(cause, "Saved proposals could not be loaded."))
    } finally {
      operationInFlight.current = false
    }
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    ownerInteracted.current = true
    if (!manifest || busy || operationInFlight.current) return
    const requestText = draft.trim()
    if (!requestText) {
      setAssistantError("Enter a request for HERMES.")
      return
    }
    if (requestText.length > MAX_REQUEST_LENGTH || requestText.includes("\0")) {
      setAssistantError("Keep the request to 2,000 characters and remove unsupported control characters.")
      return
    }
    const selectedRoute = selectedExecutionRoute
    if (selectedRoute.external && !externalEgressApproved) {
      setAssistantError("Approve the bounded external egress before asking Cerebras.")
      return
    }
    setDraft(requestText)
    setSubmittedRequest(requestText)
    setEvents([])
    setProposal(null)
    setConfirmingReject(false)
    setRejectionReason("")
    setApplyBlocked(false)
    setAssistantError(null)
    setRuntimeActivationError(null)
    setStatus("Request submitted to HERMES.")
    setBusy("proposal")
    operationInFlight.current = true
    try {
      const response = await fetch(project.application.proposalsUrl, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(selectedRoute.external
          ? { requestText, executionRoute: selectedRoute.id, externalEgressApproved: true }
          : selectedRoute.id === DEFAULT_EXECUTION_ROUTE ? { requestText } : { requestText, executionRoute: selectedRoute.id }),
      })
      if (!response.ok) await applicationResponseJson(response)
      const observed: ApplicationProgressEntry[] = []
      const terminal = await readApplicationProposalStream(response, project, manifest, (entry) => {
        if (!nextApplicationProgress(entry, observed, selectedRoute.external)) {
          throw new Error("The HERMES activity sequence could not be verified.")
        }
        observed.push(entry)
        setEvents([...observed])
        setStatus(entry.detail)
      })
      if (terminal.type === "error") throw new Error(terminal.error)
      const verified = terminal.proposal
      if (verified.status !== "READY_FOR_REVIEW" || verified.executionRoute !== selectedRoute.id
        || verified.model !== selectedRoute.model || JSON.stringify(verified.progress) !== JSON.stringify(observed)
        || verified.requestText !== requestText) throw new Error("APPLICATION_PROPOSAL_RESPONSE_INVALID")
      showProposal(verified, "Proposal ready for review.")
    } catch (cause) {
      setStatus("")
      setAssistantError(applicationFailureMessage(cause, "HERMES could not create a governed proposal."))
    } finally {
      setBusy(null)
      operationInFlight.current = false
      if (selectedRoute.external) setExternalEgressApproved(false)
    }
  }

  async function reconcile(reviewed: ApplicationProposalView): Promise<ApplicationProposalView> {
    if (!manifest) throw new Error("APPLICATION_MANIFEST_UNAVAILABLE")
    const current = await readApplicationProposal(project, manifest, reviewed.proposalId)
    if (!sameApplicationProposalEvidence(current, reviewed)) throw new Error("APPLICATION_PROPOSAL_RESPONSE_INVALID")
    return current
  }

  async function applyProposal() {
    if (!manifest || busy || operationInFlight.current || applyBlocked || !proposal || proposal.status !== "READY_FOR_REVIEW") return
    const reviewed = proposal
    ownerInteracted.current = true
    operationInFlight.current = true
    setBusy("apply")
    setAssistantError(null)
    setRuntimeActivationError(null)
    setStatus("Applying the reviewed proposal.")
    try {
      const response = await fetch(`${project.application.proposalsUrl}/${encodeURIComponent(reviewed.proposalId)}/apply`, { method: "POST" })
      const payload = await applicationResponseJson(response)
      if (!record(payload) || !exactKeys(payload, ["proposal"])) throw new Error("APPLICATION_PROPOSAL_RESPONSE_INVALID")
      const applied = await verifiedApplicationProposal(project, manifest, payload.proposal)
      if (applied.status !== "APPLIED" || !sameApplicationProposalEvidence(applied, reviewed)) {
        throw new Error("APPLICATION_PROPOSAL_RESPONSE_INVALID")
      }
      await retainAppliedReceipt(applied)
    } catch (cause) {
      try {
        const current = await reconcile(reviewed)
        if (current.status === "APPLIED") {
          await retainAppliedReceipt(current)
        } else if (current.status === "READY_FOR_REVIEW") {
          setProposal(current)
          setStatus("Proposal remains ready for review.")
          setAssistantError(applicationFailureMessage(cause, "Apply did not complete."))
        } else {
          setProposal(current)
          setStatus(`Proposal ${statusLabel(current.status).toLowerCase()}.`)
          setAssistantError(null)
        }
      } catch {
        setApplyBlocked(true)
        setStatus("Apply outcome could not be verified. Apply and Reject are blocked.")
        setAssistantError("Refresh after the authoritative proposal state is available.")
      }
    } finally {
      operationInFlight.current = false
      setBusy(null)
    }
  }

  async function rejectProposal() {
    if (!manifest || busy || operationInFlight.current || applyBlocked || !proposal || proposal.status !== "READY_FOR_REVIEW") return
    const reason = normalizedRejectionReason(rejectionReason)
    if (!reason) {
      setAssistantError("Enter a single-line rejection reason of 500 characters or fewer.")
      return
    }
    const reviewed = proposal
    ownerInteracted.current = true
    operationInFlight.current = true
    setBusy("reject")
    setAssistantError(null)
    setStatus("Rejecting and discarding the reviewed proposal.")
    try {
      const response = await fetch(`${project.application.proposalsUrl}/${encodeURIComponent(reviewed.proposalId)}`, {
        method: project.application.rejectMethod,
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ reason }),
      })
      const payload = await applicationResponseJson(response)
      if (!record(payload) || !exactKeys(payload, ["proposal"])) throw new Error("APPLICATION_PROPOSAL_RESPONSE_INVALID")
      const rejected = await verifiedApplicationProposal(project, manifest, payload.proposal)
      if (rejected.status !== "REJECTED" || rejected.rejectionReason !== reason
        || !sameApplicationProposalEvidence(rejected, reviewed)) throw new Error("APPLICATION_PROPOSAL_RESPONSE_INVALID")
      setProposal(rejected)
      setConfirmingReject(false)
      setRejectionReason("")
      setStatus("Proposal rejected and discarded from Apply.")
    } catch (cause) {
      try {
        const current = await reconcile(reviewed)
        setProposal(current)
        if (current.status === "REJECTED") {
          setConfirmingReject(false)
          setRejectionReason("")
          setAssistantError(null)
          setStatus("Proposal rejected and discarded from Apply.")
        } else if (current.status === "READY_FOR_REVIEW") {
          setStatus("Proposal remains ready for review.")
          setAssistantError(applicationFailureMessage(cause, "Reject did not complete."))
        } else {
          setStatus(`Proposal ${statusLabel(current.status).toLowerCase()}.`)
          setAssistantError(null)
        }
      } catch {
        setApplyBlocked(true)
        setStatus("Reject outcome could not be verified. Apply and Reject are blocked.")
        setAssistantError("Refresh after the authoritative proposal state is available.")
      }
    } finally {
      operationInFlight.current = false
      setBusy(null)
    }
  }

  return (
    <section className={styles.assistant} aria-label={`Ask HERMES to develop ${project.name}`}>
      <header className={styles.header}>
        <span className={styles.agent}><Bot size={16} aria-hidden /><strong>HERMES development instrument</strong></span>
        <span className={styles.boundary}>
          <ShieldCheck size={14} aria-hidden />
          {manifest ? `${manifest.writablePaths.length} writable files · ${manifest.writablePaths.join(" · ")}` : "Loading governed path boundary"}
        </span>
      </header>

      <form className={styles.form} onSubmit={(event) => void submit(event)} aria-busy={busy === "proposal"}>
        <div className={styles.routeControl}>
          <label htmlFor={`${fieldId}-execution-route`}>AI execution route</label>
          <select
            id={`${fieldId}-execution-route`}
            value={selectedExecutionRoute.id}
            aria-describedby={`${fieldId}-route-description`}
            disabled={busy !== null || !manifest}
            onChange={(event) => {
              ownerInteracted.current = true
              setExecutionRouteId(event.target.value)
              setExternalEgressApproved(false)
              setAssistantError(null)
            }}
          >
            {executionRoutes.map((route) => <option key={route.id} value={route.id}>{route.label}</option>)}
          </select>
          <p id={`${fieldId}-route-description`} className={styles.routeDisclosure} aria-live="polite">
            {selectedExecutionRoute.external
              ? `External and metered. HERMES sends the governed request and the three allowlisted ${project.name} files to Cerebras. Source changes only after review and Apply. No implicit fallback.`
              : `Runs inside HERMES. The request and ${project.name} source stay in the lab.`}
          </p>
          {routeOptionsError ? <p className={styles.routeUnavailable}>External routes are unavailable; local HERMES remains available.</p> : null}
          {selectedExecutionRoute.external ? (
            <label className={styles.egressApproval}>
              <input
                type="checkbox"
                checked={externalEgressApproved}
                disabled={busy !== null}
                onChange={(event) => setExternalEgressApproved(event.target.checked)}
              />
              I confirm this request contains only public or sanitized content and approve sending it with the allowlisted application source to Cerebras.
            </label>
          ) : null}
        </div>
        <label htmlFor={`${fieldId}-request`}>Ask HERMES to change {project.name}</label>
        <div className={styles.requestRow}>
          <textarea
            id={`${fieldId}-request`}
            value={draft}
            onChange={(event) => {
              ownerInteracted.current = true
              setDraft(event.target.value)
              if (selectedExecutionRoute.external && externalEgressApproved) setExternalEgressApproved(false)
            }}
            rows={2}
            maxLength={MAX_REQUEST_LENGTH}
            disabled={busy !== null || !manifest}
            placeholder={`Describe one visible change to ${project.name}.`}
          />
          <button type="submit" className={styles.ask} disabled={busy !== null || !manifest || (selectedExecutionRoute.external && !externalEgressApproved)}>
            {selectedExecutionRoute.external ? "Ask HERMES via Cerebras" : "Ask HERMES"}
          </button>
        </div>
      </form>

      {submittedRequest ? (
        <section className={styles.transcript} aria-label="Submitted request">
          <span>Submitted request</span><blockquote>{submittedRequest}</blockquote>
        </section>
      ) : null}
      <section className={styles.activity} aria-label="Observed HERMES activity">
        <div className={styles.activityHeader}><span>Observed activity</span><span>{events.length} milestone{events.length === 1 ? "" : "s"}</span></div>
        <ol className={styles.log} role="log" aria-label="HERMES activity" aria-live="polite">
          {events.map((entry, index) => (
            <li key={`${entry.stage}-${entry.at}-${index}`}><span>{entry.detail}</span><time dateTime={entry.at}>{entry.at}</time></li>
          ))}
        </ol>
      </section>
      {status ? <p className={styles.status} role="status" aria-live="polite">{status}</p> : null}
      {assistantError ? <p className={styles.error} role="alert">{assistantError}</p> : null}
      {runtimeActivationError ? <p className={styles.error} role="alert">{runtimeActivationError}</p> : null}
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
          onReviewNext={() => void reviewNextProposal()}
        />
      ) : null}
    </section>
  )
}

export function ApplicationAssistant({
  project,
  onPreviewRefresh,
  onApplied,
}: Readonly<{
  project: ApplicationVisibleWorkspaceProject
  onPreviewRefresh: () => void
  onApplied?: (appliedCommit: string) => Promise<ApplicationActivationResult>
}>) {
  if (project.application.contract === "legacy-v1-v3") {
    return <LegacyApplicationAssistant project={project} onPreviewRefresh={onPreviewRefresh} />
  }
  return <GenericApplicationAssistant project={project} onApplied={onApplied} />
}

export function HelloApplicationAssistant({
  project = HELLO_APPLICATION_WORKSPACE_PROJECT,
  onPreviewRefresh,
}: Readonly<{
  project?: ApplicationVisibleWorkspaceProject
  onPreviewRefresh: () => void
}>) {
  return <ApplicationAssistant project={project} onPreviewRefresh={onPreviewRefresh} />
}
