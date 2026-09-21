import type { ApplicationVisibleWorkspaceProject } from "@/lib/projects/workspace-project-key"

export type ApplicationRuntimeState = "starting" | "running" | "stopped" | "unavailable" | "mismatch" | "failed"

export type ApplicationRuntimeView = Readonly<{
  state: ApplicationRuntimeState
  previewAvailable: boolean
  runtimeBuildSha: string
  runtimeBuiltAt: string | null
  activeProjectHead: string
  detail: string | null
}>

export type ApplicationManifestView = Readonly<{
  displayName: string
  writablePaths: readonly string[]
  validationCommand: string
  manifestDigest: string | null
  head: string | null
}>

export type ApplicationProgressEntry = Readonly<{ stage: string; detail: string; at: string }>

export type ApplicationProviderExecution = Readonly<{
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

export type ApplicationProposalView = Readonly<{
  schemaVersion: 1 | 2 | 3 | 4
  proposalId: string
  applicationId?: string
  manifestDigest?: string
  repositoryDigest?: string
  writablePaths?: readonly string[]
  status: "READY_FOR_REVIEW" | "APPLY_IN_PROGRESS" | "APPLIED" | "REJECT_IN_PROGRESS" | "REJECTED" | "QUARANTINED_ROLLBACK_FAILED"
  requestedBy: string
  requestText?: string
  requestSha256?: string
  executionNode?: string
  executionRoute?: string
  executionProvider?: string
  progress?: readonly ApplicationProgressEntry[]
  createdAt: string
  appliedAt: string | null
  appliedCommit?: string | null
  applyStartedAt?: string | null
  rejectStartedAt?: string
  rejectedAt?: string | null
  rejectionReason?: string | null
  baseSha: string
  proposalCommit?: string
  candidateSha?: string
  baseRef?: string
  branch: string
  model: string
  threadId: string
  turnId: string
  patchSha256: string
  changedPaths: readonly string[]
  validation: Readonly<{ status: string; command: string; output?: string }>
  reviewPatch: string | null
  quarantinedAt?: string | null
  quarantineReason?: string | null
  providerExecution?: ApplicationProviderExecution | null
}>

const SHA = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/
const SHA256 = /^[0-9a-f]{64}$/
const IMAGE_ID = /^sha256:[0-9a-f]{64}$/
const CONTAINER_ID = /^[0-9a-f]{64}$/
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const TURN_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/
const HEAD_REF = /^refs\/heads\/[A-Za-z0-9][A-Za-z0-9._\/-]{0,239}$/
const APPLICATION_ID = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/
const GENERIC_STATUSES = new Set(["READY_FOR_REVIEW", "APPLY_IN_PROGRESS", "APPLIED", "REJECTED", "QUARANTINED_ROLLBACK_FAILED"])
const GENERIC_ROUTE_EVIDENCE = Object.freeze({
  "hermes-local": Object.freeze({ provider: "hermes-local", model: "williamos-qwen3-4b:64k", node: "hermes-node" }),
  "cerebras-gpt-oss-120b": Object.freeze({ provider: "cerebras", model: "gpt-oss-120b", node: "cerebras-api" }),
  "cerebras-qwen-3-8-27b": Object.freeze({ provider: "cerebras", model: "qwen-3.8-27b", node: "cerebras-api" }),
} as const)
const GENERIC_PROGRESS = [
  ["accepted", "Request accepted"],
  ["workspace_ready", "Isolated application workspace ready"],
  ["resident_started", "HERMES AI is editing the isolated application workspace"],
  ["resident_finished", "HERMES AI editing finished"],
  ["validation_started", "Contained application validation started"],
  ["ready_for_review", "Application proposal ready for review"],
] as const
const GENERIC_EXTERNAL_PROGRESS = [
  ["accepted", "Request accepted"],
  ["workspace_ready", "Isolated application workspace ready"],
  ["resident_started", "HERMES sent the bounded application request to Cerebras"],
  ["resident_finished", "Cerebras returned a bounded application change"],
  ["validation_started", "Contained application validation started"],
  ["ready_for_review", "Application proposal ready for review"],
] as const
const LEGACY_PROGRESS = [
  ["accepted", "Request accepted"],
  ["workspace_ready", "Isolated workspace ready"],
  ["resident_started", "HERMES is editing the isolated workspace"],
  ["resident_finished", "HERMES editing finished"],
  ["validation_started", "Contained validation started"],
  ["ready_for_review", "Proposal ready for review"],
] as const
const LEGACY_EXTERNAL_PROGRESS = [
  ["accepted", "Request accepted"],
  ["workspace_ready", "Isolated workspace ready"],
  ["resident_started", "HERMES sent the bounded request to Cerebras"],
  ["resident_finished", "Cerebras returned a bounded change"],
  ["validation_started", "Contained validation started"],
  ["ready_for_review", "Proposal ready for review"],
] as const

function record(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value)
}

function exactKeys(value: Record<string, unknown>, expected: readonly string[]): boolean {
  const actual = Object.keys(value).sort()
  const sorted = [...expected].sort()
  return actual.length === sorted.length && actual.every((key, index) => key === sorted[index])
}

function timestamp(value: unknown): value is string {
  if (typeof value !== "string") return false
  const parsed = Date.parse(value)
  return Number.isFinite(parsed) && new Date(parsed).toISOString() === value
}

function runtimeTruth(value: unknown): { runtimeBuildSha: string; runtimeBuiltAt: string | null; activeProjectHead: string } | null {
  if (!record(value) || !exactKeys(value, ["runtimeBuild", "activeProjectHead"]) || !record(value.runtimeBuild)
    || !exactKeys(value.runtimeBuild, ["sha", "builtAt"]) || typeof value.runtimeBuild.sha !== "string"
    || !SHA.test(value.runtimeBuild.sha) || (value.runtimeBuild.builtAt !== null && !timestamp(value.runtimeBuild.builtAt))
    || typeof value.activeProjectHead !== "string" || !SHA.test(value.activeProjectHead)) return null
  return {
    runtimeBuildSha: value.runtimeBuild.sha,
    runtimeBuiltAt: value.runtimeBuild.builtAt as string | null,
    activeProjectHead: value.activeProjectHead,
  }
}

function genericGeneration(value: unknown): boolean {
  return value === null || (record(value)
    && exactKeys(value, ["generation", "sourceHead", "manifestDigest", "sourceDigest", "artifactSha256", "imageId", "staticImageId", "containerId", "validated"])
    && typeof value.generation === "string" && SHA256.test(value.generation)
    && typeof value.sourceHead === "string" && SHA.test(value.sourceHead)
    && typeof value.manifestDigest === "string" && SHA256.test(value.manifestDigest)
    && typeof value.sourceDigest === "string" && SHA256.test(value.sourceDigest)
    && typeof value.artifactSha256 === "string" && SHA256.test(value.artifactSha256)
    && (value.imageId === null || typeof value.imageId === "string" && IMAGE_ID.test(value.imageId))
    && (value.staticImageId === null || typeof value.staticImageId === "string" && IMAGE_ID.test(value.staticImageId))
    && (value.containerId === null || typeof value.containerId === "string" && CONTAINER_ID.test(value.containerId))
    && typeof value.validated === "boolean")
}

export function adaptApplicationRuntimePayload(project: ApplicationVisibleWorkspaceProject, value: unknown): ApplicationRuntimeView {
  if (!record(value) || !exactKeys(value, ["runtime", "truth"]) || !record(value.runtime)) {
    throw new Error("APPLICATION_RUNTIME_RESPONSE_INVALID")
  }
  const truth = runtimeTruth(value.truth)
  if (!truth) throw new Error("APPLICATION_RUNTIME_RESPONSE_INVALID")
  if (project.application.contract === "legacy-v1-v3") {
    const runtime = value.runtime
    const keys = Object.keys(runtime)
    if (!keys.every((key) => ["state", "pid", "url", "error"].includes(key))
      || !["stopped", "starting", "running", "failed"].includes(String(runtime.state))
      || (runtime.pid !== null && (!Number.isSafeInteger(runtime.pid) || Number(runtime.pid) <= 0))
      || (runtime.url !== null && typeof runtime.url !== "string")
      || (runtime.error !== undefined && runtime.error !== null && typeof runtime.error !== "string")) {
      throw new Error("APPLICATION_RUNTIME_RESPONSE_INVALID")
    }
    const state = runtime.state as ApplicationRuntimeState
    return { ...truth, state, previewAvailable: state === "running", detail: runtime.error as string | null | undefined ?? null }
  }
  const runtime = value.runtime
  if (!exactKeys(runtime, ["schemaVersion", "applicationId", "desired", "observed", "policyDigest", "recipeDigest", "containerName", "active", "retiring", "updatedAt", "error"])
    || runtime.schemaVersion !== 1 || runtime.applicationId !== project.key
    || !["running", "stopped"].includes(String(runtime.desired))
    || !["starting", "running", "stopped", "unavailable", "mismatch", "failed"].includes(String(runtime.observed))
    || typeof runtime.policyDigest !== "string" || !SHA256.test(runtime.policyDigest)
    || typeof runtime.recipeDigest !== "string" || !SHA256.test(runtime.recipeDigest)
    || runtime.containerName !== `williamos-application-${project.key}`
    || !genericGeneration(runtime.active) || !genericGeneration(runtime.retiring)
    || !timestamp(runtime.updatedAt) || (runtime.error !== null && typeof runtime.error !== "string")) {
    throw new Error("APPLICATION_RUNTIME_RESPONSE_INVALID")
  }
  const state = runtime.observed as ApplicationRuntimeState
  return { ...truth, state, previewAvailable: state === "running", detail: runtime.error as string | null }
}

function relativePath(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= 240 && !value.includes("\\")
    && !value.startsWith("/") && !value.split("/").some((segment) => !segment || segment === "." || segment === "..")
}

export function parseApplicationManifestPayload(project: ApplicationVisibleWorkspaceProject, value: unknown): ApplicationManifestView {
  if (project.application.contract === "legacy-v1-v3") {
    if (project.application.manifestUrl !== null || !project.application.writablePaths) throw new Error("APPLICATION_MANIFEST_RESPONSE_INVALID")
    return {
      displayName: project.name,
      writablePaths: project.application.writablePaths,
      validationCommand: project.application.validationCommand,
      manifestDigest: null,
      head: null,
    }
  }
  if (!record(value) || !exactKeys(value, ["manifest", "manifestDigest", "head"]) || !record(value.manifest)) {
    throw new Error("APPLICATION_MANIFEST_RESPONSE_INVALID")
  }
  const manifest = value.manifest
  if (!exactKeys(manifest, ["schemaVersion", "id", "displayName", "adapter", "source", "ai"])
    || manifest.schemaVersion !== 1 || manifest.id !== project.key || manifest.displayName !== project.name
    || manifest.adapter !== "static-web-v1" || !record(manifest.source) || !record(manifest.ai)
    || !exactKeys(manifest.source, ["document", "styles", "script", "test"])
    || !exactKeys(manifest.ai, ["writablePaths"])
    || !Object.values(manifest.source).every(relativePath) || !Array.isArray(manifest.ai.writablePaths)
    || manifest.ai.writablePaths.length !== 3 || !manifest.ai.writablePaths.every(relativePath)
    || new Set(manifest.ai.writablePaths as string[]).size !== 3
    || typeof value.manifestDigest !== "string" || !SHA256.test(value.manifestDigest)
    || typeof value.head !== "string" || !SHA.test(value.head)) throw new Error("APPLICATION_MANIFEST_RESPONSE_INVALID")
  const source = manifest.source as Record<string, string>
  const writablePaths = manifest.ai.writablePaths as string[]
  if (![source.document, source.styles, source.script].every((path) => writablePaths.includes(path))) {
    throw new Error("APPLICATION_MANIFEST_RESPONSE_INVALID")
  }
  return {
    displayName: manifest.displayName as string,
    writablePaths,
    validationCommand: project.application.validationCommand,
    manifestDigest: value.manifestDigest,
    head: value.head,
  }
}

function providerExecution(value: unknown, model: unknown, node: unknown): value is ApplicationProviderExecution {
  return record(value)
    && exactKeys(value, ["route", "provider", "bridgeNode", "inferenceNode", "mode", "requestedModel", "actualModel", "externalEgress", "promptTokens", "completionTokens", "totalTokens", "calculatedCostUsd", "maxCostUsd", "contextDigest", "durationMs"])
    && value.route === "external" && value.provider === "cerebras" && value.bridgeNode === "hermes-node"
    && value.inferenceNode === "cerebras-api" && value.mode === "credential-bridge-one-shot"
    && value.requestedModel === model && value.actualModel === model && node === "cerebras-api" && value.externalEgress === true
    && Number.isSafeInteger(value.promptTokens) && Number(value.promptTokens) >= 0
    && Number.isSafeInteger(value.completionTokens) && Number(value.completionTokens) >= 0
    && value.totalTokens === Number(value.promptTokens) + Number(value.completionTokens)
    && typeof value.calculatedCostUsd === "number" && Number.isFinite(value.calculatedCostUsd) && value.calculatedCostUsd >= 0
    && value.maxCostUsd === .03 && Number(value.calculatedCostUsd) <= .03
    && typeof value.contextDigest === "string" && /^sha256:[0-9a-f]{64}$/.test(value.contextDigest)
    && Number.isSafeInteger(value.durationMs) && Number(value.durationMs) >= 0
}

function genericProgress(value: unknown, createdAt: string, external: boolean): value is readonly ApplicationProgressEntry[] {
  const expected = external ? GENERIC_EXTERNAL_PROGRESS : GENERIC_PROGRESS
  if (!Array.isArray(value) || value.length !== expected.length) return false
  let previous = createdAt
  return value.every((entry, index) => {
    if (!record(entry) || !exactKeys(entry, ["stage", "detail", "at"])
      || entry.stage !== expected[index][0] || entry.detail !== expected[index][1]
      || !timestamp(entry.at) || entry.at < previous) return false
    previous = entry.at
    return true
  })
}

function legacyProgress(value: unknown, createdAt: string, external: boolean): value is readonly ApplicationProgressEntry[] {
  const expected = external ? LEGACY_EXTERNAL_PROGRESS : LEGACY_PROGRESS
  if (!Array.isArray(value) || value.length !== expected.length) return false
  let previous = createdAt
  return value.every((entry, index) => {
    if (!record(entry) || !exactKeys(entry, ["stage", "detail", "at"])
      || entry.stage !== expected[index][0] || entry.detail !== expected[index][1]
      || !timestamp(entry.at) || entry.at < previous) return false
    previous = entry.at
    return true
  })
}

const GENERIC_KEYS = [
  "schemaVersion", "proposalId", "applicationId", "manifestDigest", "repositoryDigest", "writablePaths",
  "status", "requestedBy", "requestText", "requestSha256", "executionRoute", "executionProvider", "executionNode",
  "model", "threadId", "turnId", "providerExecution", "progress", "createdAt", "baseSha", "candidateSha", "baseRef",
  "branch", "changedPaths", "patchSha256", "validation", "appliedAt", "appliedCommit", "rejectedAt", "rejectionReason",
  "applyStartedAt", "applyToken", "applyProcessId", "quarantinedAt", "quarantineReason", "reviewPatch",
] as const

function genericProposal(project: ApplicationVisibleWorkspaceProject, value: unknown): ApplicationProposalView | null {
  if (!record(value) || !exactKeys(value, GENERIC_KEYS) || value.schemaVersion !== 4
    || typeof value.proposalId !== "string" || !UUID.test(value.proposalId) || value.applicationId !== project.key
    || typeof value.manifestDigest !== "string" || !SHA256.test(value.manifestDigest)
    || typeof value.repositoryDigest !== "string" || !SHA256.test(value.repositoryDigest)
    || !Array.isArray(value.writablePaths) || value.writablePaths.length !== 3 || !value.writablePaths.every(relativePath)
    || new Set(value.writablePaths).size !== 3 || !GENERIC_STATUSES.has(String(value.status))
    || typeof value.requestedBy !== "string" || !value.requestedBy || typeof value.requestText !== "string"
    || !value.requestText || value.requestText.length > 2_000 || value.requestText.trim() !== value.requestText
    || typeof value.requestSha256 !== "string" || !SHA256.test(value.requestSha256)
    || !["hermes-local", "cerebras-gpt-oss-120b", "cerebras-qwen-3-8-27b"].includes(String(value.executionRoute))
    || !["hermes-local", "cerebras"].includes(String(value.executionProvider))
    || typeof value.executionNode !== "string" || !value.executionNode || typeof value.model !== "string" || !value.model
    || typeof value.threadId !== "string" || !TURN_ID.test(value.threadId) || typeof value.turnId !== "string" || !TURN_ID.test(value.turnId)
    || !timestamp(value.createdAt) || typeof value.baseSha !== "string" || !SHA.test(value.baseSha)
    || typeof value.candidateSha !== "string" || !SHA.test(value.candidateSha) || typeof value.baseRef !== "string" || !HEAD_REF.test(value.baseRef)
    || value.branch !== `codex/williamos-app-${project.key}-${value.proposalId}`
    || !Array.isArray(value.changedPaths) || value.changedPaths.length === 0 || !value.changedPaths.every(relativePath)
    || JSON.stringify(value.changedPaths) !== JSON.stringify([...new Set(value.changedPaths as string[])].sort())
    || (value.changedPaths as string[]).some((path) => !(value.writablePaths as string[]).includes(path))
    || typeof value.patchSha256 !== "string" || !SHA256.test(value.patchSha256)
    || !record(value.validation) || !exactKeys(value.validation, ["status", "command", "output"])
    || value.validation.status !== "passed" || value.validation.command !== project.application.validationCommand
    || typeof value.validation.output !== "string" || value.validation.output.length > 12_000
    || (value.reviewPatch !== null && typeof value.reviewPatch !== "string")) return null
  const external = value.executionProvider === "cerebras"
  const routeEvidence = GENERIC_ROUTE_EVIDENCE[value.executionRoute as keyof typeof GENERIC_ROUTE_EVIDENCE]
  if (!routeEvidence || value.executionProvider !== routeEvidence.provider || value.model !== routeEvidence.model
    || value.executionNode !== routeEvidence.node || !genericProgress(value.progress, value.createdAt, external)
    || (external ? !providerExecution(value.providerExecution, value.model, value.executionNode) : value.providerExecution !== null)) return null
  const status = value.status as ApplicationProposalView["status"]
  const nullValue = (field: string) => value[field] === null
  if (status === "READY_FOR_REVIEW" && (!value.reviewPatch || !["appliedAt", "appliedCommit", "rejectedAt", "rejectionReason", "applyStartedAt", "applyToken", "applyProcessId", "quarantinedAt", "quarantineReason"].every(nullValue))) return null
  if (status === "APPLY_IN_PROGRESS" && (!timestamp(value.applyStartedAt) || typeof value.applyToken !== "string" || !UUID.test(value.applyToken)
    || !Number.isSafeInteger(value.applyProcessId) || !["appliedAt", "appliedCommit", "rejectedAt", "rejectionReason", "quarantinedAt", "quarantineReason"].every(nullValue))) return null
  if (status === "APPLIED" && (!timestamp(value.appliedAt) || value.appliedCommit !== value.candidateSha
    || !["rejectedAt", "rejectionReason", "applyStartedAt", "applyToken", "applyProcessId", "quarantinedAt", "quarantineReason"].every(nullValue))) return null
  if (status === "REJECTED" && (!timestamp(value.rejectedAt) || typeof value.rejectionReason !== "string" || !value.rejectionReason
    || !["appliedAt", "appliedCommit", "applyStartedAt", "applyToken", "applyProcessId", "quarantinedAt", "quarantineReason"].every(nullValue))) return null
  if (status === "QUARANTINED_ROLLBACK_FAILED" && (!timestamp(value.quarantinedAt) || typeof value.quarantineReason !== "string"
    || !/^APPLICATION_PROPOSAL_[A-Z0-9_]{3,80}$/.test(value.quarantineReason)
    || !["appliedAt", "appliedCommit", "rejectedAt", "rejectionReason", "applyStartedAt", "applyToken", "applyProcessId"].every(nullValue))) return null
  if (["APPLIED", "REJECTED", "QUARANTINED_ROLLBACK_FAILED"].includes(status) && value.reviewPatch !== null) return null
  return value as unknown as ApplicationProposalView
}

const LEGACY_V2_KEYS = [
  "schemaVersion", "proposalId", "status", "requestedBy", "requestText", "requestSha256", "executionNode", "progress",
  "createdAt", "appliedAt", "appliedCommit", "baseSha", "proposalCommit", "branch", "changedPaths", "patchSha256",
  "threadId", "turnId", "model", "validation", "reviewPatch",
] as const

function legacyProposal(project: ApplicationVisibleWorkspaceProject, value: unknown): ApplicationProposalView | null {
  if (!record(value) || ![1, 2, 3].includes(Number(value.schemaVersion))
    || typeof value.proposalId !== "string" || !UUID.test(value.proposalId)
    || !["READY_FOR_REVIEW", "APPLY_IN_PROGRESS", "APPLIED", "REJECT_IN_PROGRESS", "REJECTED", "QUARANTINED_ROLLBACK_FAILED"].includes(String(value.status))
    || typeof value.requestedBy !== "string" || !value.requestedBy || !timestamp(value.createdAt)
    || typeof value.baseSha !== "string" || !SHA.test(value.baseSha)
    || typeof value.proposalCommit !== "string" || !SHA.test(value.proposalCommit)
    || value.branch !== `codex/hermes-hello-${value.proposalId}`
    || typeof value.model !== "string" || !value.model
    || typeof value.threadId !== "string" || !TURN_ID.test(value.threadId)
    || typeof value.turnId !== "string" || !TURN_ID.test(value.turnId)
    || typeof value.patchSha256 !== "string" || !SHA256.test(value.patchSha256)
    || typeof value.reviewPatch !== "string" || !Array.isArray(value.changedPaths) || value.changedPaths.length === 0
    || !project.application.writablePaths
    || !(value.changedPaths as unknown[]).every((path) => typeof path === "string" && project.application.writablePaths?.includes(path))
    || new Set(value.changedPaths as string[]).size !== value.changedPaths.length
    || JSON.stringify(value.changedPaths) !== JSON.stringify([...(value.changedPaths as string[])].sort())
    || !record(value.validation) || value.validation.status !== "passed"
    || value.validation.command !== project.application.validationCommand
    || (value.validation.output !== undefined && (typeof value.validation.output !== "string" || value.validation.output.length > 12_000))) return null
  const version = value.schemaVersion as 1 | 2 | 3
  if (version >= 2) {
    const base = version === 3 ? [...LEGACY_V2_KEYS, "providerExecution"] : [...LEGACY_V2_KEYS]
    const keys = value.status === "QUARANTINED_ROLLBACK_FAILED" ? [...base, "quarantinedAt"]
      : value.status === "APPLY_IN_PROGRESS" ? [...base, "applyStartedAt"]
        : value.status === "REJECT_IN_PROGRESS" ? [...base, "rejectStartedAt", "rejectionReason"]
          : value.status === "REJECTED" ? [...base, "rejectedAt", "rejectionReason"] : base
    if (!exactKeys(value, keys)) return null
    if (typeof value.requestText !== "string" || !value.requestText || value.requestText.length > 2_000
      || value.requestText.trim() !== value.requestText || typeof value.requestSha256 !== "string" || !SHA256.test(value.requestSha256)
      || typeof value.executionNode !== "string" || !value.executionNode
      || !legacyProgress(value.progress, value.createdAt, version === 3)
      || !exactKeys(value.validation, ["status", "command", "output"]) || typeof value.validation.output !== "string") return null
  }
  if (version === 3) {
    if (!providerExecution(value.providerExecution, value.model, value.executionNode)) return null
  } else if (value.providerExecution !== undefined) return null
  if (value.status === "READY_FOR_REVIEW" && !value.reviewPatch) return null
  if (value.status === "APPLIED") {
    if (!timestamp(value.appliedAt) || typeof value.appliedCommit !== "string" || !SHA.test(value.appliedCommit)) return null
  } else if (value.appliedAt !== null || version >= 2 && value.appliedCommit !== null) return null
  if (value.status === "APPLY_IN_PROGRESS") {
    if (version < 2 || !timestamp(value.applyStartedAt)) return null
  } else if (value.applyStartedAt !== undefined) return null
  if (value.status === "REJECT_IN_PROGRESS") {
    if (!timestamp(value.rejectStartedAt) || typeof value.rejectionReason !== "string" || !value.rejectionReason) return null
  } else if (value.rejectStartedAt !== undefined) return null
  if (value.status === "REJECTED") {
    if (!timestamp(value.rejectedAt) || typeof value.rejectionReason !== "string" || !value.rejectionReason) return null
  } else if (value.rejectedAt !== undefined || value.status !== "REJECT_IN_PROGRESS" && value.rejectionReason !== undefined) return null
  if (value.status === "QUARANTINED_ROLLBACK_FAILED") {
    if (!timestamp(value.quarantinedAt)) return null
  } else if (value.quarantinedAt !== undefined) return null
  return value as unknown as ApplicationProposalView
}

export function adaptApplicationProposal(project: ApplicationVisibleWorkspaceProject, value: unknown): ApplicationProposalView {
  const proposal = project.application.contract === "generic-v4"
    ? genericProposal(project, value)
    : legacyProposal(project, value)
  if (!proposal) throw new Error("APPLICATION_PROPOSAL_RESPONSE_INVALID")
  return proposal
}

export const applicationUiContract = Object.freeze({
  record,
  exactKeys,
  timestamp,
  genericProgress,
  providerExecution,
})
