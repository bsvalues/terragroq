/**
 * GPU tabular dispatch seam — product wiring, not a new control plane.
 *
 * An authorized Work Order describes a tabular compute requirement; this module classifies it,
 * consults the EXISTING machine capability registry (evaluateCapabilityDispatch) and the reviewed
 * adapter (evaluateGpuTabularPlacement), executes on the reviewed binding over the EXISTING fabric
 * SSH transport, guards the run with the EXISTING per-lane lease store and evidence ledger
 * (WO-MAO-021 / WO-MAO-022), and returns the result plus provenance to the SAME Work Order as an
 * evidence_record row — the surface the environment's execution route already projects to the owner.
 *
 * No scheduler (jobs are submitted to this function, not polled from a resident queue), no queue
 * (the outcome queue is untouched), no registry (the capability registry is the only admission
 * source), no new state machine (lease checkpoints use the canonical lifecycle).
 *
 * Duplicate-free recovery is structural, two ways:
 *   - completion ledger: the PROVIDER event id is a deterministic v4-shaped uuid derived from the
 *     job digest; a replay of the same submission finds the event BEFORE any side effect and
 *     returns the recorded outcome instead of executing again;
 *   - lane lease: an active, unexpired lease for the same job lane means a worker may still be
 *     running; the replay refuses to double-execute (LANE_LEASE_ACTIVE_DUPLICATE_GUARD) rather
 *     than racing it. Only an expired lease is reclaimed.
 * A lost SSH channel after the worker finished adopts the remote result file — one effect, one
 * artifact — while cancelled work never writes a result file, so recovery can never adopt output
 * for work that was cancelled.
 *
 * Data boundary: synthetic generation only. The request carries shape + seed; the reviewed
 * generators produce the data on the compute node. There is no data-source field in the protocol,
 * so protected/county data cannot be named by this seam at all.
 */

import crypto from "node:crypto"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { spawn } from "node:child_process"
import { pathToFileURL } from "node:url"

const FABRIC_DIR = process.env.WILLIAMOS_FABRIC_DIR ?? path.join(os.homedir(), ".williamos", "fabric")
const STATE_DIR = process.env.WILLIAMOS_GPU_TABULAR_STATE_DIR
  ?? path.join(os.homedir(), ".williamos", "gpu-tabular")
const LEASE_STORE_PATH = path.join(STATE_DIR, "lane-leases.json")
const LEASE_STORE_ID = "gpu-tabular-dispatch-lanes"
const LEDGER_DIR = path.join(STATE_DIR, "ledger")
const LEDGER_ID = "gpu-tabular-dispatch"
const REMOTE_ROOT = "/home/daedalus/gpu-tabular-bench"
const remotePython = () => process.env.WILLIAMOS_GPU_TABULAR_PYTHON
  ?? "/home/daedalus/.venvs/cuml-qual/bin/python"
// Test-only remote prefix; e.g. CUDA_VISIBLE_DEVICES= to exercise the device-down -> CPU fallback.
const remotePrefix = () => process.env.WILLIAMOS_GPU_TABULAR_REMOTE_PREFIX ?? ""
const CURVE_PATH = path.join(process.cwd(),
  "scripts/execution-fabric/gpu-tabular-bench/evidence/placement-curve.json")
const EVIDENCE_TTL_DAYS = Number(process.env.WILLIAMOS_GPU_TABULAR_EVIDENCE_TTL_DAYS ?? 90)
const TRUST_BOUNDARY = "trusted-work-order-envelope-v1"

const WORKLOAD_TO_CLASS = Object.freeze({
  regression: "regression",
  clustering: "clustering",
  aggregation: "aggregation",
  decomposition: "dimensional_reduction",
  outlier: "anomaly_detection",
})
const CLASS_TO_CAPABILITY = Object.freeze({
  regression: "gpu-tabular-ml",
  clustering: "gpu-clustering",
  aggregation: "gpu-aggregation",
  anomaly_detection: "gpu-anomaly-screening",
  dimensional_reduction: "gpu-dimensional-reduction",
})

const sha256Hex = (value) =>
  crypto.createHash("sha256").update(typeof value === "string" ? value : Buffer.from(value)).digest("hex")

/** Deterministic UUID in the v4 SHAPE (the ledger requires the v4 pattern), derived from a digest. */
export function digestUuid(seed) {
  const hex = sha256Hex(String(seed)).padEnd(32, "0").slice(0, 32)
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-8${hex.slice(17, 20)}-${hex.slice(20, 32)}`
}

function parseLastJsonLine(text) {
  const lines = String(text ?? "").split(/\r?\n/).map((line) => line.trim()).filter(Boolean)
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    if (lines[index].startsWith("{")) {
      try { return JSON.parse(lines[index]) } catch {}
    }
  }
  return null
}

function sleep(ms) { return new Promise((resolve) => setTimeout(resolve, ms)) }

/**
 * The fabric SSH transport, configured exactly the way the governed fabric helper configures it:
 * pinned key + pinned known_hosts + strict checking + BatchMode. Node destinations resolve from the
 * fabric node registry only — job input can never name a host.
 */
export function fabricSsh(nodeName, { command, stdinText, timeoutMs = 120_000, onChild } = {}) {
  const nodes = JSON.parse(fs.readFileSync(path.join(FABRIC_DIR, "nodes.json"), "utf8"))
  const entry = nodes[nodeName]
  if (!entry || entry.transport !== "ssh") throw new Error(`FABRIC_NODE_NOT_SSH:${nodeName}`)
  const args = [
    "-i", path.join(FABRIC_DIR, "keys", "williamos-fabric"),
    "-o", `UserKnownHostsFile=${path.join(FABRIC_DIR, "known_hosts")}`,
    "-o", "StrictHostKeyChecking=yes", "-o", "BatchMode=yes", "-o", "ConnectTimeout=8",
    `${entry.user}@${entry.host}`, command,
  ]
  // git-bash ssh.exe rewrites POSIX-looking argv unless told not to (same fix as the fabric helper).
  const env = { ...process.env, MSYS_NO_PATHCONV: "1", MSYS2_ARG_CONV_EXCL: "*" }
  return new Promise((resolve) => {
    let child
    try {
      child = spawn("ssh", args, { windowsHide: true, env })
    } catch (error) {
      resolve({ exitCode: -1, stdout: "", stderr: String(error.message ?? error) })
      return
    }
    onChild?.(child)
    let stdout = ""
    let stderr = ""
    const timer = setTimeout(() => { try { child.kill("SIGKILL") } catch {} }, timeoutMs)
    child.stdout.on("data", (chunk) => { stdout += chunk })
    child.stderr.on("data", (chunk) => { stderr += chunk })
    child.on("close", (code) => { clearTimeout(timer); resolve({ exitCode: code, stdout, stderr }) })
    child.on("error", (error) => {
      clearTimeout(timer)
      resolve({ exitCode: -1, stdout, stderr: String(error.message ?? error) })
    })
    if (stdinText !== undefined) { try { child.stdin.end(stdinText) } catch {} }
  })
}

// -------------------------------------------------------------------------------------------- gates

/** Device health probe against the real runtime on the real node. A failed probe is not healthy.
 * The node name is fixed to the reviewed binding; job input can never select a host. */
export async function probeBinding({ ssh = fabricSsh, computeNode = "daedalus", timeoutMs = 25_000 } = {}) {
  let result
  try {
    result = await ssh(computeNode, {
    command: `cd ${REMOTE_ROOT} && ${remotePrefix()}${remotePython()} resident-gpu-tabular-worker.py`,
      stdinText: JSON.stringify({ schemaVersion: 1, action: "health" }),
      timeoutMs,
    })
  } catch (error) {
    return { ok: false, deviceHealthy: false, deviceQuerySucceeded: false,
      probeError: `binding-probe-transport: ${String(error.message ?? error)}` }
  }
  const parsed = parseLastJsonLine(result.stdout)
  if (!parsed || parsed.action !== "health") {
    return { ok: false, deviceHealthy: false, deviceQuerySucceeded: false,
      probeError: `binding-probe-unreachable rc=${result.exitCode}` }
  }
  return parsed
}

/**
 * Full preflight: health probe + registry gate + reviewed adapter placement, in that order.
 * The trust gate binds the ACTUAL work order's allowed files against the ACTUAL grant's actions,
 * so path confinement is checked against real values, and drift between them denies to CPU.
 */
export async function preflightPlacement({ workload, rows, workOrder, grant }, deps) {
  const { registry, adapter, curvePath = CURVE_PATH, now = new Date(), health } = deps
  const workloadClass = WORKLOAD_TO_CLASS[workload]
  if (!workloadClass) {
    return { placement: "CPU", reasonCode: "CPU_DEFAULT_UNKNOWN_WORKLOAD_CLASS",
      capabilityId: null, registryAllowed: false }
  }
  const capabilityId = CLASS_TO_CAPABILITY[workloadClass]
  const registryDecision = registry.evaluateCapabilityDispatch(registry.capability(capabilityId))

  const evidence = adapter.loadPlacementEvidence(curvePath, { now, maxAgeDays: EVIDENCE_TTL_DAYS })
  const identity = adapter.providerIdentity()
  const grantPaths = normalizePaths(grant?.allowedActions ?? [])
  const scopePaths = normalizePaths(workOrder?.allowedFiles ?? [])
  const authority = grant
    ? { grant: { allowed_paths: grantPaths }, scope: { allowed_paths: scopePaths } }
    : null
  const trustGate = {
    schemaVersion: 2,
    workerIdentity: identity,
    rawCredentialInspection: false,
    promptInjectionBoundary: TRUST_BOUNDARY,
    exactPathConfinement: true,
    outputRedaction: true,
    cancellation: { supported: true },
    independentEvidenceCapture: true,
  }

  const decision = adapter.evaluateGpuTabularPlacement(
    { workloadClass, rows },
    {
      evidence,
      bindingHealthy: health?.deviceHealthy === true,
      // Registry denial: accelerator-eligible classes fall to CPU through the adapter's own typed
      // authority-missing path; screening/refusal decisions never consult authority at all.
      authority: registryDecision.allowed ? authority : null,
      trustGate,
    },
  )
  return {
    ...decision,
    capabilityId,
    registryAllowed: registryDecision.allowed,
    registryReasonCode: registryDecision.reasonCode,
  }
}

function normalizePaths(values) {
  return values.filter((value) => typeof value === "string" && value.length > 0)
    .map((value) => value.replace(/\\/g, "/"))
}

// -------------------------------------------------------------------------------------------- job identity

/** Job digest: the complete identity of "the same job". Two identical digests must not run twice. */
export function jobDigest({ workOrderRef, workload, synthetic, devicePolicy }) {
  return sha256Hex(JSON.stringify({ schemaVersion: 1, workOrderRef, workload,
    synthetic: { parcels: synthetic.parcels, transactions: synthetic.transactions ?? null,
      transactionsPerParcel: synthetic.transactionsPerParcel ?? null, seed: synthetic.seed },
    devicePolicy: devicePolicy ?? "auto" }))
}

/**
 * Deterministic identities for one job. Every event id derives from the job digest, so a replay
 * computes the same ids and collides (by design) with the first run's recorded evidence.
 */
export function jobIdentity(digest, attempt = 0) {
  const scratchBase = `${REMOTE_ROOT}/scratch/${digest.slice(0, 32)}`
  const scratch = attempt === 0 ? `${scratchBase}/attempt-0` : `${scratchBase}/attempt-${attempt}`
  return {
    attempt,
    dispatchId: `gpu-tab.${digest.slice(0, 16)}`,
    laneId: attempt === 0 ? `gpu-tab.${digest.slice(0, 24)}` : `gpu-tab.${digest.slice(0, 24)}.a${attempt}`,
    completionEventId: digestUuid(`complete:${digest}`),
    placementEventId: digestUuid(`placed:${digest}:${attempt}`),
    failureEventId: digestUuid(`failure:${digest}:${attempt}`),
    cancelEventId: digestUuid(`cancelled:${digest}:${attempt}`),
    scratchBase,
    scratchDir: scratch,
    cancelFile: `${scratch}/CANCEL`,
    pidFile: `${scratch}/worker.pid`,
    resultFile: `${scratch}/result.json`,
  }
}

/** Shell one-liner: the OLDEST attempt's result for a digest, if any worker wrote one. Emits a
 * marker line naming the attempt dir, then the result JSON (parse both). */
export function orphanScanCommand(scratchBase) {
  return `d=${scratchBase}; [ -d "$d" ] || exit 1; for a in $(ls -v "$d" 2>/dev/null); do f="$d/$a/result.json"; if [ -s "$f" ]; then printf '{"orphanAttempt":"%s"}\\n' "$a"; cat "$f"; exit 0; fi; done; exit 1`
}

export function parseOrphanProbe(stdout) {
  const lines = String(stdout ?? "").split(/\r?\n/).map((l) => l.trim()).filter(Boolean)
  const marker = lines.find((l) => l.startsWith('{"orphanAttempt"'))
  const result = lines.at(-1)
  if (!marker || !result || result === marker) return null
  try {
    const attemptTag = Number(JSON.parse(marker).orphanAttempt?.replace("attempt-", ""))
    const value = JSON.parse(result)
    return Number.isSafeInteger(attemptTag) && ["SUCCEEDED", "FAILED", "INVALID"].includes(value.status)
      ? { attempt: attemptTag, result: value } : null
  } catch { return null }
}

/**
 * Recovery attribution: reuse the lane the dead dispatcher already holds for the attempt that
 * wrote the orphan result. No execution happens on this path, the completion event id is
 * attempt-independent (idempotent collision), and the ledger independently verifies the lane's
 * fencing token + checkpoint hash against the store — attribution cannot be forged from job input.
 */
async function adoptionLease(leaseMod, { workOrderRef, identity }) {
  const inspected = leaseMod.inspectLaneLeaseStore(LEASE_STORE_PATH, LEASE_STORE_ID)
  const lane = (inspected.lanes ?? []).find((entry) => entry.workOrderId === workOrderRef
    && entry.laneId === identity.laneId)
  if (!lane || lane.status !== "ACTIVE" || Date.parse(lane.expiresAt) <= Date.now()) return null
  return { workOrderId: lane.workOrderId, laneId: lane.laneId, workerId: lane.workerId,
    fencingToken: lane.fencingToken, checkpointSequence: lane.checkpointSequence,
    checkpointEvidence: { dispatchKind: "gpu-tabular-compute", lane: lane.laneId } }
}

// -------------------------------------------------------------------------------------------- ledger + lease bindings

export async function loadLedgerBindings() {
  const ledgerMod = await import(pathToFileURL(path.resolve("scripts/multi-agent-operator/evidence-ledger.mjs")).href)
  const lifecycle = await import(pathToFileURL(path.resolve("scripts/multi-agent-operator/lifecycle-state-machine.mjs")).href)
  const canonical = ledgerMod.canonicalEvidenceLedgerJson
  const options = { leaseStorePath: LEASE_STORE_PATH, leaseStoreId: LEASE_STORE_ID }
  return { ledgerMod, lifecycle, canonical, options }
}

function buildLeaseAttribution(bindings, lease, checkpointEvidence) {
  return {
    storeId: LEASE_STORE_ID,
    workOrderId: lease.workOrderId,
    laneId: lease.laneId,
    workerId: lease.workerId,
    fencingToken: lease.fencingToken,
    checkpointSequence: lease.checkpointSequence,
    checkpointEvidenceHash: sha256Hex(bindings.canonical(checkpointEvidence)),
  }
}

function buildTransitionPayload(bindings, lifecycle, { from, to, reasonCode }) {
  const transition = lifecycle.transitionLifecycle({ from, to,
    reasonCode: reasonCode ?? null, failureClass: null,
    authorityGap: { present: false, condition: null, conditionRef: null } })
  return {
    from, to,
    reasonCode: reasonCode ?? null,
    failureClass: null,
    authorityGap: { present: false, condition: null, conditionRef: null },
    transitionContentHash: sha256Hex(bindings.canonical(transition)),
  }
}

function ledgerAppend(bindings, { eventId, eventType, occurredAt, scope, writer, payload, lease,
  checkpointEvidence, sourceRefs = [] }) {
  const input = {
    schemaVersion: 1, artifactType: "MULTI_AGENT_EVIDENCE_APPEND_REQUEST",
    eventId, occurredAt: new Date(occurredAt).toISOString(), eventType,
    scope, writer,
    leaseAttribution: buildLeaseAttribution(bindings, lease, checkpointEvidence),
    payload, sourceRefs,
    sanitized: true, rawAuthMaterialIncluded: false, rawProviderOutputIncluded: false,
    expectedHead: null,
  }
  const result = bindings.ledgerMod.appendEvidenceEvent(LEDGER_DIR, LEDGER_ID, input, bindings.options)
  if (!result.ok) throw new Error(`EVIDENCE_LEDGER_WALL:${result.status}`)
  return { idempotent: result.idempotent === true, event: result.event }
}

export function ledgerLookup(bindings, eventId) {
  const result = bindings.ledgerMod.inspectVerifiedEvidenceEvent(LEDGER_DIR, LEDGER_ID, {
    schemaVersion: 1, artifactType: "MULTI_AGENT_EVIDENCE_EVENT_INSPECT_REQUEST",
    eventId, expectedAnchor: null,
  }, bindings.options)
  if (result.status === "EVIDENCE_LEDGER_NOT_FOUND" || result.status === "EVIDENCE_EVENT_NOT_FOUND_WALL") {
    return null
  }
  if (result.status === "EVIDENCE_LEDGER_IO_WALL") {
    // Directory not created yet is indistinguishable here from unreadable; treat as absent and let
    // the first append surface a real IO problem.
    return null
  }
  if (!result.ok) throw new Error(`EVIDENCE_LEDGER_LOOKUP_WALL:${result.status}`)
  return result.event ?? null
}

export async function loadLeaseBindings() {
  return import(pathToFileURL(path.resolve("scripts/multi-agent-operator/lane-lease-checkpoint.mjs")).href)
}

/**
 * Lease a lane for one dispatch attempt, with duplicate protection as the failure model.
 *
 * The lane store keeps one row per (workOrderRef, laneId) forever, so the job's lane family is
 * `base`, `base.a1`, `base.a2`, ... Each row is one attempt. The rules:
 *   - any family lane ACTIVE and unexpired: a worker may still be running -> REFUSE (no race);
 *   - any family lane ACTIVE past expiry: the previous dispatcher died with an unknown worker
 *     state and an un-collected result -> REFUSE until the orphan scan resolves it (the adoption
 *     guard runs before this; reaching it with an expired-active lane means no result exists and
 *     the worker state is unknowable -> refuse loudly rather than double-execute);
 *   - otherwise: take attempt = (highest existing suffix + 1) on a FRESH lane. A prior attempt that
 *     ended CANCELLED/LOST produced no output, so a new attempt cannot duplicate an effect; the
 *     completion event id is attempt-INDEPENDENT, so even if two attempts somehow completed, only
 *     the first ledger record projects and the second is an idempotent (or reuse-wall) collision.
 *   - attempt count is bounded; beyond it the job needs a changed submission on purpose.
 */
const MAX_JOB_ATTEMPTS = 8

/**
 * Lease the lane for ONE attempt identity, with the duplicate model as the failure modes:
 *  - any family lane ACTIVE and unexpired: a worker may still be running -> refuse (no race);
 *  - any family lane ACTIVE past expiry: the prior dispatcher died with an un-collectable result
 *    -> refuse loudly; the orphan guard runs before this, so reaching it here means the worker
 *    state is unknowable and executing again could double a device effect;
 *  - the exact attempt lane already exists (older attempt settled): the loop in
 *    acquireJobLeaseForAttempt advances to the next slot.
 */
export async function acquireJobLease(leaseMod, { workOrderRef, identity, workerId = "daedalus-gpu-tabular" }) {
  const inspected = leaseMod.inspectLaneLeaseStore(LEASE_STORE_PATH, LEASE_STORE_ID)
  // An absent store is simply "no lanes yet"; any other unreadable state fails closed.
  if (!inspected.ok && inspected.status !== "LANE_LEASE_STORE_NOT_FOUND") {
    return { ok: false, status: `LANE_LEASE_STORE_${inspected.status ?? "UNREADABLE"}` }
  }
  const baseLaneId = jobBaseLaneId(identity)
  const family = (inspected.lanes ?? []).filter((lane) => lane.workOrderId === workOrderRef
    && (lane.laneId === baseLaneId || lane.laneId.startsWith(`${baseLaneId}.a`)))
  const nowMs = Date.now()
  if (family.some((lane) => lane.status === "ACTIVE" && Date.parse(lane.expiresAt) > nowMs)) {
    return { ok: false, status: "LANE_LEASE_ACTIVE_DUPLICATE_GUARD" }
  }
  const zombie = family.find((lane) => lane.status === "ACTIVE")
  if (zombie) {
    // ACTIVE past expiry = a dispatcher died mid-flight. Record the durable expiry (the store's
    // designed settlement) so the NEXT pass sees an EXPIRED lane and advances to a fresh attempt
    // lane; this pass refuses, because the orphan guard already found no collectable result.
    leaseMod.expireLaneLease(LEASE_STORE_PATH, LEASE_STORE_ID, {
      schemaVersion: 1, artifactType: "MULTI_AGENT_LANE_LEASE_EXPIRE_REQUEST",
      workOrderId: workOrderRef, laneId: zombie.laneId, workerId: zombie.workerId,
      idempotencyKey: `expire:${zombie.laneId}:${zombie.fencingToken}`,
      expectedFencingToken: zombie.fencingToken,
    })
    return { ok: false, status: "LANE_LEASE_ZOMBIE_SETTLING_RETRY" }
  }
  const holderToken = crypto.randomBytes(24).toString("hex")
  const checkpointEvidence = { dispatchKind: "gpu-tabular-compute", lane: identity.laneId }
  const result = leaseMod.acquireLaneLease(LEASE_STORE_PATH, LEASE_STORE_ID, {
    schemaVersion: 1, artifactType: "MULTI_AGENT_LANE_LEASE_ACQUIRE_REQUEST",
    workOrderId: workOrderRef, laneId: identity.laneId, workerId,
    idempotencyKey: `acquire:${identity.laneId}`,
    holderToken, leaseDurationMs: 2 * 60 * 60_000, checkpointEvidence,
  })
  if (!result.ok) {
    return { ok: false, status: result.status === "LANE_LEASE_ALREADY_EXISTS"
      ? "LANE_LEASE_LANE_TAKEN" : result.status ?? "LANE_LEASE_WALL" }
  }
  return { ok: true, ...leaseFields(result), holderToken, checkpointEvidence }
}

/** Walk attempt lanes 0..max until one is leasable. Prior settled attempts don't block. */
export async function acquireJobLeaseForAttempt(leaseMod, {
  workOrderRef, digest, maxAttempts = MAX_JOB_ATTEMPTS,
}) {
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    const identity = jobIdentity(digest, attempt)
    const result = await acquireJobLease(leaseMod, { workOrderRef, identity })
    if (result.ok) return { ok: true, attempt, lease: result }
    if (result.status !== "LANE_LEASE_LANE_TAKEN") return { ok: false, status: result.status }
  }
  return { ok: false, status: "LANE_LEASE_ATTEMPT_LIMIT" }
}

function jobBaseLaneId(identity) {
  return identity.laneId.replace(/\.a\d+$/, "")
}

function leaseFields(result) {
  return { workOrderId: result.workOrderId, laneId: result.laneId, workerId: result.workerId,
    fencingToken: result.fencingToken, checkpointSequence: result.checkpointSequence }
}

async function releaseJobLease(leaseMod, lease) {
  return leaseMod.releaseLaneLease(LEASE_STORE_PATH, LEASE_STORE_ID, {
    schemaVersion: 1, artifactType: "MULTI_AGENT_LANE_LEASE_RELEASE_REQUEST",
    workOrderId: lease.workOrderId, laneId: lease.laneId, workerId: lease.workerId,
    idempotencyKey: `release:${lease.laneId}:${lease.fencingToken}`,
    holderToken: lease.holderToken, fencingToken: lease.fencingToken,
  })
}

// -------------------------------------------------------------------------------------------- execution

function buildScope(workOrder, identity) {
  return { programId: "intelligence-fabric",
    goalId: `goal.${String(workOrder.ref).replace(/[^A-Za-z0-9._:-]/g, "-")}`,
    loopId: "compute-dispatch", workOrderId: workOrder.ref, laneId: identity.laneId,
    runId: identity.dispatchId }
}

function buildWriter() {
  return { writerId: "daedalus-gpu-tabular", writerKind: "SYSTEM", role: "compute-dispatcher",
    providerId: null, adapterId: null,
    trustGateEvidenceHash: sha256Hex(`gpu-tabular-trust-gate-v2:${TRUST_BOUNDARY}`) }
}

/**
 * Execute one dispatched job end to end. Dependencies are injectable; defaults are the real
 * fabric, registry, adapter, lease store, evidence ledger, and (when DATABASE_URL is set) pg.
 */
export async function dispatchComputeJob(submission, deps = {}) {
  const {
    registry, adapter,
    ssh = fabricSsh,
    runQuery = null,
    loadWorkOrder,
    loadActiveGrant,
    now = () => new Date(),
    jobTimeoutMs = Number(process.env.WILLIAMOS_GPU_TABULAR_JOB_TIMEOUT_MS ?? 30 * 60_000),
    healthProbe = null,
  } = deps

  const workload = submission.workload
  const workloadClass = WORKLOAD_TO_CLASS[workload]
  if (!workloadClass) throw new Error("COMPUTE_WORKLOAD_UNSUPPORTED")
  const synthetic = submission.synthetic
  if (!synthetic || !Number.isSafeInteger(synthetic.parcels) || synthetic.parcels <= 0
    || !Number.isSafeInteger(synthetic.seed) || synthetic.parcels > 10_000_000) {
    throw new Error("COMPUTE_SYNTHETIC_SPEC_INVALID")
  }
  const digest = jobDigest({ workOrderRef: submission.workOrderRef, workload, synthetic,
    devicePolicy: submission.devicePolicy ?? "auto" })
  const bindings = deps.bindings ?? await loadLedgerBindings()
  const leaseMod = deps.leaseMod ?? await loadLeaseBindings()
  const computeNode = deps.computeNode ?? "daedalus"
  const callSsh = async (node, opts) => {
    try { return await ssh(node, opts) } catch (error) {
      return { exitCode: null, stdout: "", stderr: `transport-error: ${String(error.message ?? error)}` }
    }
  }

  // --- RECOVERY GUARD #1 (before any side effect): completion already in the ledger. The event id
  // is derived from the job digest alone, so ANY replay of this submission finds it.
  const probeIdentity = jobIdentity(digest, 0)
  const prior = ledgerLookup(bindings, probeIdentity.completionEventId)
  if (prior) {
    return { status: prior.payload.state === "SUCCEEDED" ? "SUCCEEDED" : prior.payload.state,
      outcome: "IDEMPOTENT_REPLAY", executed: false, dispatchId: probeIdentity.dispatchId,
      workOrderRef: submission.workOrderRef,
      ledgerEventHash: prior.eventHash, responseContentHash: prior.payload.responseContentHash }
  }

  const workOrder = await loadWorkOrder(submission.workOrderRef)
  if (!workOrder) throw new Error("COMPUTE_WORK_ORDER_NOT_FOUND")
  if (!["approved", "active", "in_progress", "executing"].includes(workOrder.status)) {
    throw new Error("COMPUTE_WORK_ORDER_NOT_ACTIVE")
  }
  const grant = await loadActiveGrant(workOrder.id)

  // --- RECOVERY GUARD #1b: a previous attempt finished writing its result but died (or lost its
  // channel) before completion was recorded. Adopt the OLDEST completed result — never recompute,
  // and never let a second attempt produce a competing output.
  const orphanProbe = await callSsh(computeNode, {
    command: orphanScanCommand(probeIdentity.scratchBase), timeoutMs: 20_000 })
  const orphan = parseOrphanProbe(orphanProbe.stdout)
  if (orphan) {
    const health = healthProbe ?? await probeBinding({ ssh, computeNode })
    const orphanPlacement = await preflightPlacement(
      { workload, rows: synthetic.parcels, workOrder, grant },
      { registry, adapter, now: now(), health, curvePath: deps.curvePath })
    const orphanIdentity = jobIdentity(digest, orphan.attempt)
    let lease = await adoptionLease(leaseMod, { workOrderRef: workOrder.ref, identity: orphanIdentity })
    let releaseLeaseAfter = false
    if (!lease) {
      const fresh = await acquireJobLeaseForAttempt(leaseMod, {
        workOrderRef: workOrder.ref, digest, maxAttempts: deps.maxAttempts })
      if (!fresh.ok) {
        return { status: "REFUSED", outcome: fresh.status, dispatchId: probeIdentity.dispatchId,
          executed: false }
      }
      lease = fresh.lease
      releaseLeaseAfter = true
    }
    return await finalizeCompletion({
      bindings, leaseMod, workOrder, submission, runQuery, now,
      identity: orphanIdentity, lease,
      effective: orphan.result, placement: orphanPlacement,
      device: orphan.result.device, outcome: "RECOVERED_ADOPTED_ORPHAN_RESULT",
      executed: false, started: now(), finished: now(), releaseLeaseAfter })
  }

  const health = healthProbe ?? await probeBinding({ ssh, computeNode })
  const placement = await preflightPlacement(
    { workload, rows: synthetic.parcels, workOrder, grant },
    { registry, adapter, now: now(), health, curvePath: deps.curvePath })

  if (placement.placement === "SCREENING_ONLY") {
    return { status: "REFUSED", outcome: "SCREENING_ONLY_NOT_AUTHORITATIVE",
      reasonCode: placement.reasonCode, dispatchId: probeIdentity.dispatchId, executed: false }
  }

  // --- RECOVERY GUARD #2: lease the next attempt lane. An ACTIVE unexpired lane, or an expired
  // lane whose result was not collectable, both refuse execution (no racing a live worker).
  const attempted = await acquireJobLeaseForAttempt(leaseMod, {
    workOrderRef: workOrder.ref, digest, maxAttempts: deps.maxAttempts })
  if (!attempted.ok) {
    return { status: "REFUSED", outcome: attempted.status, dispatchId: probeIdentity.dispatchId,
      executed: false }
  }
  const identity = jobIdentity(digest, attempted.attempt)
  const lease = attempted.lease

  const scope = buildScope(workOrder, identity)
  const writer = buildWriter()
  const append = (event) => ledgerAppend(bindings, {
    ...event, scope, writer, lease, checkpointEvidence: lease.checkpointEvidence })

  append({ eventId: identity.placementEventId, eventType: "TRANSITION", occurredAt: now(),
    payload: buildTransitionPayload(bindings, bindings.lifecycle, {
      from: "LEASED", to: "PROVIDER_DISPATCHED", reasonCode: placement.reasonCode }) })

  const device = placement.placement === "CUDA_DEVICE" ? "cuda" : "cpu"
  const request = { schemaVersion: 1, action: "run", jobId: identity.dispatchId, workload, device,
    synthetic, scratchDir: identity.scratchDir, cancelFile: identity.cancelFile,
    resultFile: identity.resultFile }

  await callSsh(computeNode, { command: `mkdir -p ${identity.scratchDir}`, timeoutMs: 30_000 })
  const started = now()
  const localChild = { handle: null, killed: false }
  const cancelRequested = () => submission.cancelCheck?.() === true

  const runPromise = callSsh(computeNode, {
    command: `cd ${REMOTE_ROOT} && echo $$ > ${identity.pidFile} && ${remotePrefix()}${remotePython()} resident-gpu-tabular-worker.py; rc=$?; rm -f ${identity.pidFile}; exit $rc`,
    stdinText: JSON.stringify(request),
    timeoutMs: jobTimeoutMs,
    onChild: (handle) => { localChild.handle = handle },
  })

  // Cancellation reaches the ACTUAL executing workload: touch the cancel artifact (the worker
  // checks it at phase boundaries and refuses to emit a result) AND SIGTERM the worker process
  // group (the proven device-release path), then kill our local ssh channel.
  const stopDispatch = async () => {
    if (localChild.killed) return
    localChild.killed = true
    await callSsh(computeNode, {
      command: `touch ${identity.cancelFile}; if [ -f ${identity.pidFile} ]; then kill -TERM -$(cat ${identity.pidFile}) 2>/dev/null || kill -TERM $(cat ${identity.pidFile}) 2>/dev/null; fi; true`,
      timeoutMs: 20_000,
    })
    // Let the channel close naturally so the worker's CANCELLED line is delivered; only force the
    // local ssh down if it lingers (a wedged transport), after a grace period.
    const linger = setTimeout(() => { try { localChild.handle?.kill("SIGTERM") } catch {} }, 10_000)
    linger.unref?.()
  }
  const watcher = setInterval(() => {
    if (cancelRequested()) { stopDispatch().catch(() => {}) }
  }, 250)

  let execution
  try {
    execution = await runPromise
  } finally {
    clearInterval(watcher)
  }

  // Result via the channel; if the channel was lost, adopt the worker's result file (recovery).
  let effective = parseLastJsonLine(execution.stdout)
  let adopted = false
  if (!effective || !["SUCCEEDED", "FAILED", "CANCELLED", "INVALID"].includes(effective.status)) {
    const probe = await callSsh(computeNode, { command: `cat ${identity.resultFile} 2>/dev/null || true`,
      timeoutMs: 20_000 })
    const fileResult = parseLastJsonLine(probe.stdout)
    if (fileResult && ["SUCCEEDED", "FAILED", "INVALID"].includes(fileResult.status)) {
      effective = fileResult
      adopted = true
    }
  }

  if (!effective || !["SUCCEEDED", "FAILED", "CANCELLED", "INVALID"].includes(effective.status)) {
    append({ eventId: identity.failureEventId, eventType: "FAILURE", occurredAt: now(),
      payload: { failureClass: "TRANSIENT_TRANSPORT", reasonCode: "COMPUTE_CHANNEL_LOST",
        lifecycleState: "RETRY_SCHEDULED", attempt: identity.attempt + 1, terminal: false,
        detailContentHash: sha256Hex(execution.stderr ?? "no-stderr") } })
    await releaseJobLease(leaseMod, lease)
    return { status: "DISPATCH_INCOMPLETE", outcome: "COMPUTE_CHANNEL_LOST",
      dispatchId: identity.dispatchId, executed: true, leaseReleased: true }
  }

  if (effective.status === "CANCELLED") {
    // Cleanup guarantee: the worker reported cancelled, but a stray group could still exist if it
    // died between checks — run the stop (idempotent) so the device is provably released.
    if (!localChild.killed) await stopDispatch()
    append({ eventId: identity.cancelEventId, eventType: "WORKER", occurredAt: now(),
      payload: { workerId: "daedalus-gpu-tabular", role: "compute-dispatcher", action: "CANCELLED",
        reasonCode: "CANCELLED" } })
    await releaseJobLease(leaseMod, lease)
    return { status: "CANCELLED", outcome: "CANCELLED", phase: effective.phase ?? null,
      dispatchId: identity.dispatchId, executed: true, projected: false }
  }

  return await finalizeCompletion({
    bindings, leaseMod, workOrder, submission, runQuery, now,
    identity, lease, effective, placement, device,
    outcome: adopted ? "RECOVERED_ADOPTED_RESULT" : "EXECUTED",
    executed: true, started, finished: now(), releaseLeaseAfter: true })
}

/**
 * Record the completion event (attempt-independent id, so two attempts can never both project) and
 * project the owner-facing evidence exactly once.
 */
async function finalizeCompletion({ bindings, leaseMod, workOrder, submission, runQuery, now,
  identity, lease, effective, placement, device, outcome, executed, started, finished,
  releaseLeaseAfter }) {
  const responseHash = sha256Hex(bindings.canonical(effective))
  const scope = buildScope(workOrder, identity)
  const writer = buildWriter()
  const completion = ledgerAppend(bindings, {
    eventId: identity.completionEventId, eventType: "PROVIDER", occurredAt: now(),
    scope, writer, lease, checkpointEvidence: lease.checkpointEvidence,
    payload: { providerId: "daedalus-cuml-rapids", adapterId: "gpu-tabular-capability",
      dispatchId: identity.dispatchId,
      state: effective.status === "SUCCEEDED" ? "SUCCEEDED" : "FAILED",
      reasonCode: effective.status === "SUCCEEDED" ? null : "COMPUTE_WORKLOAD_FAILED",
      responseContentHash: responseHash },
    sourceRefs: [{ artifactType: "GPU_TABULAR_RESULT", artifactId: identity.dispatchId,
      contentHash: responseHash }] })
  if (releaseLeaseAfter) await releaseJobLease(leaseMod, lease)
  if (completion.idempotent) {
    // A concurrent attempt already recorded this job's completion: never project twice.
    return { status: effective.status, outcome: "IDEMPOTENT_REPLAY",
      dispatchId: identity.dispatchId, workOrderRef: workOrder.ref, executed, projected: false }
  }
  let evidenceRef = null
  if (effective.status === "SUCCEEDED" && runQuery) {
    evidenceRef = await projectEvidenceToWorkOrder({ runQuery, workOrder, submission, device,
      placement, effective, responseHash, started, finished })
  }
  return {
    status: effective.status,
    outcome,
    placement: device === "cuda" ? "CUDA_DEVICE" : "CPU",
    reasonCode: placement.reasonCode,
    capabilityId: placement.capabilityId,
    dispatchId: identity.dispatchId,
    workOrderRef: workOrder.ref,
    thresholdRows: placement.thresholdRows ?? null,
    result: effective.value ?? null,
    workloadSeconds: effective.workloadSeconds ?? null,
    bindingObserved: effective.binding ?? null,
    evidenceRef,
    executed,
    syntheticDataOnly: true,
    promoted: false,
  }
}

/** The owner-facing half: an evidence_record row + governance_event + WO evidence ref, same WO. */
export async function projectEvidenceToWorkOrder({ runQuery, workOrder, submission, device,
  placement, effective, responseHash, started, finished }) {
  const receipt = {
    schemaVersion: "williamos-gpu-tabular-dispatch-receipt/1",
    workOrderRef: workOrder.ref,
    workload: submission.workload,
    synthetic: submission.synthetic,
    device,
    placementReasonCode: placement.reasonCode,
    capabilityId: placement.capabilityId,
    thresholdRows: placement.thresholdRows ?? null,
    thresholdIsAtMeasurementFloor: placement.thresholdIsAtMeasurementFloor ?? null,
    registryAllowed: placement.registryAllowed,
    binding: { workerId: "daedalus-gpu-tabular", provider: "daedalus-cuml-rapids",
      runtime: effective.binding?.cumlVersion ?? null, deviceHealthy: effective.binding?.deviceHealthy ?? false },
    value: effective.value ?? null,
    workloadSeconds: effective.workloadSeconds ?? null,
    startedAt: new Date(started).toISOString(),
    finishedAt: new Date(finished).toISOString(),
    resultContentHash: responseHash,
    syntheticDataOnly: true,
    promoted: false,
  }
  const ref = `EV-GPU-${responseHash.slice(0, 12)}`
  const inserted = await runQuery(
    `INSERT INTO evidence_record ("userId", ref, "workOrderId", result, repo, notes, "contentHash")
     VALUES ($1, $2, $3, $4, 'bsvalues/terragroq', $5, $6) RETURNING id, ref`,
    [workOrder.userId, ref, workOrder.id,
      effective.status === "SUCCEEDED" ? "PASS" : "FAIL", JSON.stringify(receipt), `sha256:${responseHash}`],
  )
  const evidenceId = Number(inserted.rows?.[0]?.id)
  if (!Number.isSafeInteger(evidenceId)) throw new Error("EVIDENCE_PROJECTION_FAILED")
  await runQuery(
    `INSERT INTO governance_event
       ("userId", "eventType", "entityType", "entityId", actor, reason, "evidenceId", metadata)
     VALUES ($1, 'GPU_TABULAR_COMPUTE_DISPATCHED', 'work_order', $2, $3, $4, $5, $6::jsonb)`,
    [workOrder.userId, String(workOrder.id), "gpu-tabular-dispatch",
      `${receipt.workload} on ${device} (${receipt.placementReasonCode})`, evidenceId,
      JSON.stringify(receipt)],
  )
  await runQuery(
    `UPDATE work_order SET evidence = array_append(evidence, $2), "updatedAt" = timezone('UTC', now())
     WHERE id = $1`,
    [workOrder.id, ref],
  )
  return { evidenceId, ref, receipt }
}

// -------------------------------------------------------------------------------------------- CLI

export async function loadWorkOrderFromDb(runQuery, ref) {
  const result = await runQuery(
    `SELECT id, ref, status, "userId", "allowedFiles" FROM work_order WHERE ref = $1`, [ref])
  return result.rows?.[0] ?? null
}

export async function loadActiveGrantFromDb(runQuery, workOrderId) {
  const result = await runQuery(
    `SELECT id, ref, status, "allowedActions", "expiresAt" FROM authority_grant
      WHERE "workOrderId" = $1 AND status = 'active'
        AND ("expiresAt" IS NULL OR "expiresAt" > timezone('UTC', now()))
      ORDER BY id LIMIT 1`,
    [workOrderId])
  return result.rows?.[0] ?? null
}

async function mainCli() {
  const argv = process.argv.slice(2)
  const command = argv[0]
  const flags = Object.fromEntries(argv.slice(1)
    .filter((arg) => arg.startsWith("--"))
    .map((arg) => {
      const [key, ...rest] = arg.slice(2).split("=")
      return [key.replace(/-([a-z])/g, (_, c) => c.toUpperCase()), rest.length ? rest.join("=") : true]
    }))
  const positional = argv.slice(1).filter((arg) => !arg.startsWith("--"))

  if (command === "health") {
    const health = await probeBinding({})
    process.stdout.write(JSON.stringify(health, null, 2) + "\n")
    process.exitCode = health.deviceHealthy ? 0 : 4
    return
  }

  const [registry, adapter] = await Promise.all([
    import(pathToFileURL(path.resolve("components/operator/multi-agent-capability-registry.ts")).href),
    import(pathToFileURL(path.resolve("scripts/execution-fabric/gpu-tabular-capability.mjs")).href),
  ])

  if (command === "place") {
    // Read-only placement answer for a hypothetical job; executes nothing, mutates nothing.
    const paths = String(flags.grantPaths ?? "").split(",").filter(Boolean)
    const decision = await preflightPlacement(
      { workload: positional[0], rows: Number(flags.rows),
        workOrder: { allowedFiles: paths }, grant: { allowedActions: paths } },
      { registry, adapter, health: await probeBinding({}), ...(flags.curve ? { curvePath: String(flags.curve) } : {}) })
    process.stdout.write(JSON.stringify(decision, null, 2) + "\n")
    return
  }

  if (command !== "submit" || !positional.length || !flags.wo) {
    process.stdout.write(JSON.stringify({
      usage: {
        health: "probe the reviewed binding",
        place: "<workload> --rows=N --grant-paths=a,b — read-only placement decision",
        submit: "<workload> --wo=WO-REF --parcels=N --seed=N [--transactions=N] [--dry-run]",
      },
    }, null, 2) + "\n")
    process.exitCode = 1
    return
  }

  const synthetic = { parcels: Number(flags.parcels), seed: Number(flags.seed),
    ...(flags.transactions ? { transactions: Number(flags.transactions) } : {}) }
  const submission = { workOrderRef: flags.wo, workload: positional[0], synthetic,
    ...(flags.cancelFile ? { cancelCheck: () => fs.existsSync(String(flags.cancelFile)) } : {}) }
  if (flags.dryRun) {
    const digest = jobDigest({ ...submission, devicePolicy: "auto" })
    process.stdout.write(JSON.stringify({ dryRun: true, ...jobIdentity(digest) }, null, 2) + "\n")
    return
  }

  const databaseUrl = process.env.DATABASE_URL
  if (!databaseUrl) throw new Error("DATABASE_URL_REQUIRED")
  const { Pool } = await import("pg")
  const pool = new Pool({ connectionString: databaseUrl, max: 1 })
  try {
    const runQuery = pool.query.bind(pool)
    const outcome = await dispatchComputeJob(submission, {
      registry, adapter, runQuery,
      loadWorkOrder: (ref) => loadWorkOrderFromDb(runQuery, ref),
      loadActiveGrant: (id) => loadActiveGrantFromDb(runQuery, id),
      ...(flags.curve ? { curvePath: String(flags.curve) } : {}),
    })
    process.stdout.write(JSON.stringify(outcome, null, 2) + "\n")
    process.exitCode = ["SUCCEEDED", "IDEMPOTENT_REPLAY"].includes(outcome.status) ? 0 : 2
  } finally {
    await pool.end()
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  mainCli().catch((error) => {
    process.stderr.write(JSON.stringify({ error: String(error.message ?? error) }) + "\n")
    process.exitCode = 1
  })
}
