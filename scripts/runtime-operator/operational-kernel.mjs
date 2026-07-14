import crypto from "node:crypto"
import fs from "node:fs"
import path from "node:path"

const TERMINAL_STATES = new Set(["COMPLETED"])
const ALLOWED_RISKS = new Set(["R0", "R1"])
const ALLOWED_VALIDATION = new Set(["diff-check", "lint", "test", "build"])
const FORBIDDEN_PATH = /^(?:\.github\/workflows\/|app\/api\/auth\/|app\/api\/setup\/|lib\/auth|db\/|drizzle\/|migrations\/|package\.json$|pnpm-lock\.yaml$|package-lock\.json$|vercel\.json$|\.env|WilliamOS\/.*PACS|.*TerraFusion.*production)/i
const SECRET_VALUE = /(?:-----BEGIN [A-Z ]*PRIVATE KEY-----|\bsk-[A-Za-z0-9_-]{20,}\b|\bgh[oprsu]_[A-Za-z0-9]{20,}\b|(?:postgres(?:ql)?|mysql|mongodb(?:\+srv)?):\/\/[^\s]+|(?:password|token|api[_ -]?key|client[_ -]?secret)\s*[:=]\s*["']?[^\s"']{12,})/i
const MAX_CHANGED_FILES = 20
const MAX_PATCH_BYTES = 262_144

function atomicWrite(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  const temporary = `${file}.${process.pid}.tmp`
  fs.writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, { encoding: "utf8", flag: "wx" })
  fs.renameSync(temporary, file)
}

function readJson(file) {
  if (!fs.existsSync(file)) return null
  const value = JSON.parse(fs.readFileSync(file, "utf8"))
  assertSafeRecord(value, "CHECKPOINT")
  return value
}

function assertSafeRecord(value, name) {
  if (typeof value === "string") {
    const normalizedWall = /^(?:[A-Z][A-Z0-9_]*_WALL)(?::(?:[A-Za-z0-9_.-]+|[A-Z][A-Z0-9_]*_WALL))*$/
    if (!normalizedWall.test(value) && SECRET_VALUE.test(value)) {
      throw new Error(`${name}_SECRET_FIELD_WALL`)
    }
    return
  }
  if (!value || typeof value !== "object") return
  for (const [key, child] of Object.entries(value)) {
    if (/(?:token|secret|password|cookie|session|prompt|unifiedPatch)/i.test(key)) throw new Error(`${name}_SECRET_FIELD_WALL`)
    assertSafeRecord(child, name)
  }
}

function writeCheckpoint(root, checkpoint) {
  assertSafeRecord(checkpoint, "CHECKPOINT")
  atomicWrite(path.join(root, "state", "kernel-checkpoint.json"), { schemaVersion: 1, ...checkpoint })
}

function appendAudit(root, state, fields) {
  assertSafeRecord(fields, "AUDIT")
  const file = path.join(root, "audit", "kernel-events.jsonl")
  fs.mkdirSync(path.dirname(file), { recursive: true })
  const previous = fs.existsSync(file)
    ? fs.readFileSync(file, "utf8").trim().split(/\r?\n/).filter(Boolean).at(-1)
    : null
  const previousHash = previous ? JSON.parse(previous).hash : "GENESIS"
  const record = { schemaVersion: 1, at: new Date().toISOString(), state, previousHash, fields }
  const hash = crypto.createHash("sha256").update(JSON.stringify(record)).digest("hex")
  fs.appendFileSync(file, `${JSON.stringify({ ...record, hash })}\n`, "utf8")
}

function transition(root, checkpoint, state, fields = {}) {
  const next = { ...checkpoint, ...fields, state, updatedAt: new Date().toISOString() }
  writeCheckpoint(root, next)
  appendAudit(root, state, {
    workOrderId: next.workOrderId,
    issueNumber: next.issueNumber,
    attempt: next.attempt,
    remediationAttempts: next.remediationAttempts,
    pr: next.pr,
  })
  return next
}

function validateAuthorityRecord(record) {
  if (!record || record.authority !== "APPROVED") throw new Error("AUTHORITY_REGISTRATION_WALL")
  if (!ALLOWED_RISKS.has(record.riskClass)) throw new Error("AUTHORITY_RISK_WALL")
  if (record.ownerGateRequired || record.protectedScope) throw new Error("AUTHORITY_OWNER_GATE_WALL")
  if (record.baseBranch !== "main" || record.mergeMode !== "AUTO_ELIGIBLE") throw new Error("AUTHORITY_MERGE_WALL")
  if (!Array.isArray(record.allowedPaths) || record.allowedPaths.length === 0) throw new Error("AUTHORITY_PATH_WALL")
  if (record.allowedPaths.some((candidate) => typeof candidate !== "string" || candidate.startsWith("/") || candidate.includes("\\") || candidate.split("/").includes("..") || FORBIDDEN_PATH.test(candidate))) throw new Error("AUTHORITY_PATH_WALL")
  if (!Array.isArray(record.requiredValidation) || record.requiredValidation.length === 0 || record.requiredValidation.some((gate) => !ALLOWED_VALIDATION.has(gate))) throw new Error("AUTHORITY_VALIDATION_WALL")
}

export function selectEligibleWorkOrder(registry, queue) {
  if (registry.schemaVersion !== 1 || registry.repository !== "bsvalues/terragroq") throw new Error("AUTHORITY_REGISTRY_WALL")
  const completed = new Set(queue.filter((entry) => entry.state === "COMPLETED").map((entry) => entry.workOrderId))
  return queue
    .filter((entry) => entry.state === "READY" && !completed.has(entry.workOrderId))
    .sort((left, right) => left.createdAt.localeCompare(right.createdAt) || left.issueNumber - right.issueNumber)
    .map((entry) => ({ entry, authority: registry.workOrders.find((record) => record.workOrderId === entry.workOrderId) }))
    .find(({ authority }) => {
      if (!authority) return false
      validateAuthorityRecord(authority)
      return authority.dependencies.every((dependency) => completed.has(dependency))
    }) ?? null
}

function getAuthority(registry, workOrderId) {
  const authority = registry.workOrders.find((record) => record.workOrderId === workOrderId)
  validateAuthorityRecord(authority)
  return authority
}

async function preparePatch({ root, checkpoint, authority, adapters, remediation, feedback = "" }) {
  const allowExistingStaged = remediation && checkpoint.remediationSource === "VALIDATION"
  const result = await adapters.invokeCodex({
    workOrderId: authority.workOrderId,
    workspace: checkpoint.workspace,
    task: authority.task,
    allowedPaths: authority.allowedPaths,
    remediation,
    feedback,
  })
  if (result.result === "AUTHORITY_WALL") return transition(root, checkpoint, "BLOCKED", { failureCode: "CODEX_AUTHORITY_WALL", ownerDecisionRequired: true })
  if (result.result !== "PATCH_READY") throw new Error("CODEX_PATCH_REQUIRED_WALL")
  const diff = await adapters.applyAndInspect({
    workspace: checkpoint.workspace,
    unifiedPatch: result.unifiedPatch,
    allowedPaths: authority.allowedPaths,
    allowExistingStaged,
  })
  if (diff.changedPaths.length === 0 || diff.changedPaths.some((changed) => FORBIDDEN_PATH.test(changed) || !authority.allowedPaths.some((allowed) => allowed.endsWith("/**") ? changed.startsWith(allowed.slice(0, -2)) : changed === allowed))) {
    throw new Error("PATCH_EXACT_PATH_WALL")
  }
  if ((checkpoint.reviewThreadPaths ?? []).some((reviewPath) => reviewPath && !diff.changedPaths.includes(reviewPath))) throw new Error("PATCH_REVIEW_CORRELATION_WALL")
  if (diff.changedPaths.length > MAX_CHANGED_FILES || diff.patchBytes > MAX_PATCH_BYTES) throw new Error("PATCH_BUDGET_WALL")
  checkpoint = transition(root, checkpoint, "PATCH_PREPARED", { changedPaths: diff.changedPaths, patchBytes: diff.patchBytes, remediationSource: null, failureCode: null })
  return validateAndPublish({ root, checkpoint, authority, adapters })
}

async function validateAndPublish({ root, checkpoint, authority, adapters }) {
  if (checkpoint.state !== "VALIDATING") checkpoint = transition(root, checkpoint, "VALIDATING")
  await adapters.validate({ workspace: checkpoint.workspace, requiredValidation: authority.requiredValidation })
  const published = await adapters.publish({
    issueNumber: checkpoint.issueNumber,
    workOrderId: checkpoint.workOrderId,
    workspace: checkpoint.workspace,
    branch: checkpoint.branch,
    existingPr: checkpoint.pr,
    resolvedThreadIds: checkpoint.reviewThreadIds ?? [],
  })
  return transition(root, checkpoint, "PR_OPEN", { branch: published.branch, pr: published.pr, reviewThreadIds: [], reviewThreadPaths: [] })
}

async function mergeAndComplete({ root, checkpoint, registry, adapters }) {
  if (checkpoint.state === "MERGE_READY") {
    const finalGate = await adapters.inspectPullRequest(checkpoint.pr)
    if (finalGate.decision !== "MERGE") throw new Error("MERGE_GATE_RECHECK_WALL")
    const merged = await adapters.merge(checkpoint.pr)
    checkpoint = transition(root, checkpoint, "MERGED", { mergeSha: merged.mergeSha })
  }
  if (checkpoint.state === "MERGED") {
    await adapters.verifyMergedMain(checkpoint.mergeSha)
    checkpoint = transition(root, checkpoint, "MERGED_VERIFIED")
  }
  if (checkpoint.state === "MERGED_VERIFIED") {
    await adapters.complete(checkpoint.issueNumber)
    checkpoint = transition(root, checkpoint, "ISSUE_COMPLETED")
  }
  if (checkpoint.state === "ISSUE_COMPLETED") checkpoint = transition(root, checkpoint, "COMPLETED")
  return completionResult({ checkpoint, registry, adapters })
}

async function completionResult({ checkpoint, registry, adapters }) {
  const refreshedQueue = await adapters.listQueue()
  const next = selectEligibleWorkOrder(registry, refreshedQueue)
  return { ...checkpoint, nextWorkOrderId: next?.authority.workOrderId ?? null }
}

async function runCycle({ root, registry, adapters }) {
  let checkpoint = readJson(path.join(root, "state", "kernel-checkpoint.json"))
  if (checkpoint?.state === "BLOCKED" || checkpoint?.state === "FAILED_TERMINAL") return checkpoint
  if (checkpoint?.state === "FAILED_RECOVERABLE" && Date.parse(checkpoint.nextAttemptAt) > Date.now()) {
    return { ...checkpoint, ownerDecisionRequired: false }
  }
  await adapters.assertRuntime()

  if (!checkpoint || TERMINAL_STATES.has(checkpoint.state)) {
    const queue = await adapters.listQueue()
    const selected = selectEligibleWorkOrder(registry, queue)
    if (!selected) return { state: "READY", workOrderId: null, nextWorkOrderId: null }
    const { entry, authority } = selected
    const baseSha = await adapters.resolveBaseSha(authority.baseBranch)
    checkpoint = transition(root, {
      repository: registry.repository,
      goal: "GOAL-RUNTIME-OPERATOR-LOCAL-IDENTITY-001",
      loop: "LOOP-RUNTIME-OPERATOR-LOCAL-IDENTITY-001",
      workOrderId: authority.workOrderId,
      issueNumber: entry.issueNumber,
      baseSha,
      branch: null,
      pr: null,
      attempt: 1,
      remediationAttempts: 0,
      queueLeased: false,
    }, "LEASED")
    await adapters.lease(entry.issueNumber)
    checkpoint = { ...checkpoint, queueLeased: true }
    writeCheckpoint(root, checkpoint)
    const workspace = await adapters.prepareWorkspace({ workOrderId: authority.workOrderId, baseSha })
    checkpoint = { ...checkpoint, workspace }
    writeCheckpoint(root, checkpoint)
    if (adapters.inspectExistingPatch) {
      const existing = await adapters.inspectExistingPatch({ workspace, allowedPaths: authority.allowedPaths })
      if (existing) {
        checkpoint = transition(root, checkpoint, "PATCH_PREPARED", existing)
        return validateAndPublish({ root, checkpoint, authority, adapters })
      }
    }
    return preparePatch({ root, checkpoint, authority, adapters, remediation: false })
  }

  const authority = getAuthority(registry, checkpoint.workOrderId)
  if (checkpoint.state === "FAILED_RECOVERABLE") {
    checkpoint = transition(root, checkpoint, checkpoint.resumeState, { nextAttemptAt: null, resumeState: null })
  }
  if (checkpoint.state === "COMPLETED") return completionResult({ checkpoint, registry, adapters })
  if (checkpoint.state === "LEASED") {
    if (!checkpoint.queueLeased) {
      await adapters.lease(checkpoint.issueNumber)
      checkpoint = { ...checkpoint, queueLeased: true }
      writeCheckpoint(root, checkpoint)
    }
    if (!checkpoint.workspace) {
      checkpoint = { ...checkpoint, workspace: await adapters.prepareWorkspace({ workOrderId: authority.workOrderId, baseSha: checkpoint.baseSha }) }
      writeCheckpoint(root, checkpoint)
    }
    if (adapters.inspectExistingPatch) {
      const existing = await adapters.inspectExistingPatch({ workspace: checkpoint.workspace, allowedPaths: authority.allowedPaths })
      if (existing) {
        checkpoint = transition(root, checkpoint, "PATCH_PREPARED", existing)
        return validateAndPublish({ root, checkpoint, authority, adapters })
      }
    }
    return preparePatch({ root, checkpoint, authority, adapters, remediation: false })
  }
  if (checkpoint.state === "REVIEW_REMEDIATION") {
    if (checkpoint.remediationSource === "VALIDATION") {
      return preparePatch({ root, checkpoint, authority, adapters, remediation: true, feedback: checkpoint.failureCode })
    }
    if (adapters.inspectExistingPatch) {
      const existing = await adapters.inspectExistingPatch({ workspace: checkpoint.workspace, allowedPaths: authority.allowedPaths })
      if (existing) {
        checkpoint = transition(root, checkpoint, "PATCH_PREPARED", existing)
        return validateAndPublish({ root, checkpoint, authority, adapters })
      }
    }
    const gate = await adapters.inspectPullRequest(checkpoint.pr)
    if (gate.decision !== "REMEDIATE") throw new Error("REMEDIATION_RECONCILIATION_WALL")
    return preparePatch({ root, checkpoint, authority, adapters, remediation: true, feedback: gate.feedback })
  }
  if (checkpoint.state === "PATCH_PREPARED" || checkpoint.state === "VALIDATING") {
    return validateAndPublish({ root, checkpoint, authority, adapters })
  }
  if (["MERGE_READY", "MERGED", "MERGED_VERIFIED", "ISSUE_COMPLETED"].includes(checkpoint.state)) return mergeAndComplete({ root, checkpoint, registry, adapters })
  if (checkpoint.state !== "PR_OPEN") throw new Error(`CHECKPOINT_RECONCILIATION_WALL:${checkpoint.state}`)
  const gate = await adapters.inspectPullRequest(checkpoint.pr)
  if (gate.decision === "WAIT") return checkpoint
  if (gate.decision === "REMEDIATE") {
    if (checkpoint.remediationAttempts >= 2) return transition(root, checkpoint, "FAILED_TERMINAL")
    checkpoint = transition(root, checkpoint, "REVIEW_REMEDIATION", {
      remediationAttempts: checkpoint.remediationAttempts + 1,
      remediationSource: "PR",
      reviewThreadIds: gate.threadIds ?? [],
      reviewThreadPaths: gate.threadPaths ?? [],
    })
    return preparePatch({ root, checkpoint, authority, adapters, remediation: true, feedback: gate.feedback })
  }
  if (gate.decision !== "MERGE") throw new Error("PR_GATE_WALL")
  checkpoint = transition(root, checkpoint, "MERGE_READY")
  return mergeAndComplete({ root, checkpoint, registry, adapters })
}

function isRecoverableFailure(message) {
  return /CODEX_(?:NETWORK|RATE_LIMIT)_WALL|PROCESS_WALL:(?:gh|git)/.test(message)
}

function isOwnerWall(message) {
  return /(?:AUTHORITY_(?:ACTIVATION|OWNER_GATE)_WALL|CODEX_AUTHORITY_WALL|GITHUB_AUTHORITY_WALL|RUNTIME_READINESS_WALL)/.test(message)
}

export async function runOperationalKernelCycle({ root, registry, adapters }) {
  try {
    return await runCycle({ root, registry, adapters })
  } catch (error) {
    const message = String(error?.message ?? error)
    const checkpointFile = path.join(root, "state", "kernel-checkpoint.json")
    const checkpoint = readJson(checkpointFile)
    if (!checkpoint) throw error
    if (isRecoverableFailure(message)) {
      const attempt = (checkpoint.attempt ?? 1) + 1
      if (attempt > 3) return transition(root, checkpoint, "FAILED_TERMINAL", { failureCode: message, ownerDecisionRequired: false })
      const backoffSeconds = Math.min(15 * (2 ** (attempt - 2)), 900)
      const nextAttemptAt = new Date(Date.now() + backoffSeconds * 1000).toISOString()
      return transition(root, checkpoint, "FAILED_RECOVERABLE", {
        attempt,
        resumeState: checkpoint.state,
        nextAttemptAt,
        failureCode: message,
        ownerDecisionRequired: false,
      })
    }
    if (/^VALIDATION_[A-Z0-9_]+_WALL$/.test(message)) {
      const remediationAttempts = checkpoint.remediationAttempts ?? 0
      if (remediationAttempts >= 2) return transition(root, checkpoint, "FAILED_TERMINAL", { failureCode: message, ownerDecisionRequired: false })
      return transition(root, checkpoint, "REVIEW_REMEDIATION", {
        remediationAttempts: remediationAttempts + 1,
        remediationSource: "VALIDATION",
        failureCode: message,
        ownerDecisionRequired: false,
      })
    }
    if (isOwnerWall(message)) return transition(root, checkpoint, "BLOCKED", { failureCode: message, ownerDecisionRequired: true })
    return transition(root, checkpoint, "FAILED_TERMINAL", { failureCode: message, ownerDecisionRequired: false })
  }
}
