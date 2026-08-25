/**
 * Rules for what a capability measurement is allowed to conclude (#905).
 *
 * Kept in its own module with no side effects, so the rules can be tested without running a
 * measurement. The instrument that performs one is a script: importing it starts work.
 */

/**
 * What a failed dispatch is allowed to mean.
 *
 * `MEASURED_INCAPABLE` is a claim about a model, and it may only be made when the model actually ran
 * and returned something inadequate. The first measurement of `hermes-local` nearly recorded that
 * verdict twice for failures outside the model boundary:
 *
 *   PROCESS_WALL:pwsh   the invoker crashed because the inference upstream was unreachable -- the
 *                       `ollama` container sat on the default bridge network instead of the one its
 *                       own compose stack declares. The model was never asked a question.
 *   PATCH_EMPTY_WALL    the model had already written a correct function, and collection looked for
 *                       it with `git diff --cached` in a tree where the change was unstaged.
 *
 * A contaminated verdict is worse than no verdict, because the next model comparison inherits it and
 * starts from a lie. Matching is anchored deliberately: a model that echoes a wall name in its own
 * output must not be able to talk its way out of an incapable verdict.
 */
export function classifyDispatchFailure(message) {
  const text = String(message ?? "")
  if (/^VALIDATION_REQUIRED_WALL$/.test(text)) {
    return { verdict: "BLOCKED_VALIDATION_REQUIRED", aboutTheModel: false }
  }
  if (/^ACCELERATOR_SAME_RUN_EVIDENCE_WALL$/.test(text)) {
    return { verdict: "BLOCKED_ACCELERATOR_EVIDENCE", aboutTheModel: false }
  }
  if (/^VALIDATION_INSTALL_WALL$/.test(text)) {
    return { verdict: "BLOCKED_VALIDATION_INFRASTRUCTURE", aboutTheModel: false }
  }
  if (/^TASK_BASELINE_DRIFT_WALL:/.test(text)) {
    return { verdict: "BLOCKED_TASK_BASELINE_DRIFT", aboutTheModel: false }
  }
  if (/^PROVIDER_WORKSPACE_RECONCILIATION_WALL$/.test(text)) {
    return { verdict: "BLOCKED_WORKSPACE_RECONCILIATION", aboutTheModel: false }
  }
  const provider = /^PROVIDER_LANE_([A-Z_]+)/.exec(text)
  if (provider) return { verdict: `BLOCKED_${provider[1]}`, aboutTheModel: false }
  if (/^PROCESS_WALL:/.test(text)) return { verdict: "BLOCKED_INVOKER_PROCESS_FAILED", aboutTheModel: false }
  // Collection defects are ours. An empty patch is a statement about the lane only once the collection
  // is known to have looked in the tree the provider actually edits.
  if (/^PATCH_(?:EMPTY|COLLECTION)_WALL$/.test(text)) {
    return { verdict: "BLOCKED_PATCH_COLLECTION", aboutTheModel: false }
  }
  return { verdict: "MEASURED_INCAPABLE", aboutTheModel: true }
}

/**
 * Observe the accelerator only while the provider invocation for this measurement is pending.
 * The caller places this around the exact invoker call after base/target preflight, so a prior probe
 * or an idle readiness check cannot be carried into promotion evidence.
 */
export async function observeSameRunAccelerator({
  runId,
  node,
  targetAccelerator,
  attempt,
  sampleAccelerators,
  pollIntervalMs = 1_000,
  wait = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)),
  now = () => new Date().toISOString(),
}) {
  const startedAt = now()
  let outcome
  let settle
  const settled = new Promise((resolve) => { settle = resolve })
  let invoked
  try { invoked = attempt() } catch (error) { invoked = Promise.reject(error) }
  const pending = Promise.resolve(invoked).then(
    (value) => {
      outcome = { ok: true, value, completedAt: now() }
      settle()
    },
    (error) => {
      outcome = { ok: false, error, completedAt: now() }
      settle()
    },
  )
  let observed
  while (!outcome) {
    const sampleStartedAt = now()
    const controller = new AbortController()
    const sampled = Promise.resolve()
      .then(() => sampleAccelerators({ signal: controller.signal }))
      .then(
        (accelerators) => ({ kind: "sample", accelerators }),
        () => ({ kind: "sample", accelerators: [] }),
      )
    const first = await Promise.race([
      sampled,
      settled.then(() => ({ kind: "settled", accelerators: [] })),
    ])
    if (first.kind === "settled") {
      controller.abort()
      break
    }
    const sampleCompletedAt = now()
    if (outcome) continue
    const accelerators = first.accelerators
    for (const accelerator of accelerators) {
      if (String(accelerator?.uuid ?? "") === targetAccelerator?.uuid
        && String(accelerator?.processName ?? "").toLowerCase() === String(targetAccelerator?.processName ?? "").toLowerCase()
        && /\bP40\b/i.test(String(accelerator?.model ?? ""))
        && Number(accelerator?.vramUsedMiB) > 0
        && Number(accelerator?.utilizationPercent) > 0
        && Number(accelerator?.processVramMiB) > 0) {
        observed = { ...accelerator, sampleStartedAt, sampleCompletedAt }
      }
    }
    if (!outcome) await Promise.race([settled, wait(pollIntervalMs)])
  }
  await pending
  if (!outcome.ok) throw outcome.error
  return {
    value: outcome.value,
    acceleratorEvidence: observed ? {
      runId,
      startedAt,
      sampleStartedAt: observed.sampleStartedAt,
      sampleCompletedAt: observed.sampleCompletedAt,
      completedAt: outcome.completedAt,
      node,
      uuid: observed.uuid,
      model: observed.model,
      vramUsedMiB: observed.vramUsedMiB,
      utilizationPercent: observed.utilizationPercent,
      processName: observed.processName,
      processVramMiB: observed.processVramMiB,
    } : null,
  }
}

/**
 * Put dispatch and patch collection behind one classification/recording boundary.
 *
 * A successful provider return is not a successful measurement until its patch has been collected
 * and inspected. Keeping both operations in one attempt prevents collection walls from escaping as
 * uncaught exceptions and leaving stale capability evidence in place.
 */
function hasSameRunP40Evidence(evidence, measurementRunId, targetAccelerator) {
  const startedAt = Date.parse(evidence?.startedAt)
  const sampleStartedAt = Date.parse(evidence?.sampleStartedAt)
  const sampleCompletedAt = Date.parse(evidence?.sampleCompletedAt)
  const completedAt = Date.parse(evidence?.completedAt)
  return typeof measurementRunId === "string" && measurementRunId !== ""
    && evidence?.runId === measurementRunId
    && String(evidence?.node ?? "").toLowerCase() === String(targetAccelerator?.node ?? "").toLowerCase()
    && evidence?.uuid === targetAccelerator?.uuid
    && typeof evidence?.uuid === "string" && evidence.uuid.trim() !== ""
    && typeof evidence?.model === "string" && /\bP40\b/i.test(evidence.model)
    && Number(evidence?.vramUsedMiB) > 0
    && Number(evidence?.utilizationPercent) > 0
    && String(evidence?.processName ?? "").toLowerCase() === String(targetAccelerator?.processName ?? "").toLowerCase()
    && Number(evidence?.processVramMiB) > 0
    && Number.isFinite(startedAt) && Number.isFinite(sampleStartedAt)
    && Number.isFinite(sampleCompletedAt) && Number.isFinite(completedAt)
    && startedAt <= sampleStartedAt && sampleStartedAt <= sampleCompletedAt && sampleCompletedAt <= completedAt
}

export async function runMeasuredAttempt({
  attempt,
  validate,
  requiredValidation,
  measurementRunId,
  targetAccelerator,
  recordFailure,
}) {
  try {
    const value = await attempt()
    if (typeof validate !== "function"
      || !Array.isArray(requiredValidation)
      || !requiredValidation.includes("diff-check")
      || !requiredValidation.includes("test")) {
      throw new Error("VALIDATION_REQUIRED_WALL")
    }
    const effectiveRunId = typeof measurementRunId === "function" ? measurementRunId() : measurementRunId
    if (!hasSameRunP40Evidence(value?.acceleratorEvidence, effectiveRunId, targetAccelerator)) {
      throw new Error("ACCELERATOR_SAME_RUN_EVIDENCE_WALL")
    }
    await validate({ workspace: value.patchWorkspace, requiredValidation })
    return {
      ok: true,
      value: {
        ...value,
        promotion: {
          verdict: "PROVEN",
          requiredValidation: [...requiredValidation],
          acceleratorEvidence: value.acceleratorEvidence,
        },
      },
    }
  } catch (error) {
    const message = String(error?.message ?? error)
    const classification = classifyDispatchFailure(message)
    await recordFailure({ ...classification, message })
    return { ok: false }
  }
}

/**
 * Authorise one narrow correction of contaminated settled evidence.
 *
 * This is not a generic state editor: it recognises the exact timestamp and evidence of the known
 * contaminated HERMES record, then independently proves its exact task target absent at the exact
 * pinned baseline. A later genuine MEASURED_INCAPABLE record cannot match this one-time fingerprint.
 */
const CONTAMINATED_LEGACY_RECORD = Object.freeze({
  implementation: "MEASURED_INCAPABLE",
  measuredAt: "2026-08-25T17:12:33.397Z",
  evidence: "The lane produced no patch. Wall: PROVIDER_WORKSPACE_RECONCILIATION_WALL. The provider ran and returned without a usable change. Task: the bounded pure-helper task with tests. Model: williamos-qwen3-4b:64k (qwen3 4.0B, num_ctx 65536, temperature 0). Elapsed 0s.",
})
const CONTAMINATED_BASELINE_SHA = "45f90fa59fe47e5f1aa505e9ec710ec2deb37a48"
const CONTAMINATED_TARGET = "scripts/runtime-operator/worker-lanes.mjs"

export function buildStaleBaselineInvalidation({ currentRecord, baselineSha, missingTargetPaths }) {
  if (currentRecord?.implementation !== "MEASURED_INCAPABLE") {
    throw new Error("LANE_CAPABILITY_INVALIDATION_STATE_WALL")
  }
  if (currentRecord.measuredAt !== CONTAMINATED_LEGACY_RECORD.measuredAt
    || currentRecord.evidence !== CONTAMINATED_LEGACY_RECORD.evidence
    || baselineSha !== CONTAMINATED_BASELINE_SHA) {
    throw new Error("LANE_CAPABILITY_INVALIDATION_RECORD_MISMATCH_WALL")
  }
  if (!Array.isArray(missingTargetPaths) || missingTargetPaths.length === 0) {
    throw new Error("LANE_CAPABILITY_INVALIDATION_EVIDENCE_WALL")
  }
  if (missingTargetPaths.length !== 1 || missingTargetPaths[0] !== CONTAMINATED_TARGET) {
    throw new Error("LANE_CAPABILITY_INVALIDATION_RECORD_MISMATCH_WALL")
  }
  return {
    verdict: "BLOCKED_TASK_BASELINE_DRIFT",
    aboutTheModel: false,
    evidence: `Invalidated false MEASURED_INCAPABLE evidence: task target ${missingTargetPaths.join(", ")} ` +
      `is absent at pinned baseline ${baselineSha}. No model was dispatched.`,
  }
}
