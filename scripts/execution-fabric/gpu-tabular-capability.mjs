/**
 * GPU tabular capability adapter - DAEDALUS cuML/RAPIDS.
 *
 * This adapter is the promotion surface for the measured tabular-acceleration capability. It carries
 * the eight requirements the executable-capability inventory's Promotion Rule names, by implementing
 * the *existing* preventive trust contract (`PREVENTIVE_TRUST_GATE_V2_REF`,
 * control-center/backend/workers.py#validate_preventive_trust_gate_v2) rather than a parallel one:
 *
 *   provider identity            -> providerIdentity() (attributable workerId/provider/surface)
 *   adapter conformance          -> this module + the registry record's adapterRef
 *   exact authority evidence     -> authority.allowedPaths vs scope.allowedPaths (exact match)
 *   path confinement             -> exactPathConfinement + _validExactPaths
 *   preventive trust enforcement -> assertPreventiveTrustGateV2 (fail-closed)
 *   provider-output redaction    -> redactProviderOutput
 *   cancellation                 -> createCancellationToken + assertNotCancelled
 *   independent evidence capture -> captureIndependentEvidence
 *
 * Enforcement stays with the machine registry and its dispatch evaluator
 * (components/operator/multi-agent-capability-registry.ts). This adapter answers one narrower
 * question the registry does not: *for this workload, at this size, on this measured binding* - is the
 * accelerator eligible, and if not, which typed reason sends it to the CPU path? Every missing or
 * invalid input defaults to the CPU path. There is no "assume GPU" branch.
 *
 * No scheduler, registry, queue, or agent framework is introduced here. No county/protected data is
 * read. No cloud provider is contacted.
 */

import { createHash } from "node:crypto"
import fs from "node:fs"

export const GPU_TABULAR_ADAPTER_REF = "scripts/execution-fabric/gpu-tabular-capability.mjs"

/** The exact schema id the measured curve must carry. A different id is not usable evidence. */
export const PLACEMENT_CURVE_SCHEMA = "williamos-gpu-tabular-placement-curve/1"

/** The reviewed provider identity for the measured binding. Not inferred from anything at runtime. */
export const GPU_TABULAR_PROVIDER_IDENTITY = Object.freeze({
  workerId: "daedalus-gpu-tabular",
  provider: "daedalus-cuml-rapids",
  surface: "/home/daedalus/.venvs/cuml-qual",
  attributable: true,
  nodeId: "daedalus",
  runtime: Object.freeze({ cuml: "26.08.00", cudf: "26.08.01", cudaRuntime: "13.4.49" }),
  device: Object.freeze({
    model: "NVIDIA GeForce RTX 3090",
    vramBytes: 25_769_803_776,
    computeCapability: "8.6",
    driver: "595.84",
  }),
})

/**
 * Workload classes -> capability id, and how the placement question is answered for each.
 * `thresholdKey` names the key inside the measured curve's `thresholds` block; nothing here restates a
 * threshold value, so the measured evidence remains the single source of truth.
 */
export const TABULAR_WORKLOAD_CLASSES = Object.freeze({
  regression: Object.freeze({
    capabilityId: "gpu-tabular-ml",
    thresholdKey: "regression",
    authoritative: true,
  }),
  clustering: Object.freeze({
    capabilityId: "gpu-clustering",
    thresholdKey: "clustering",
    authoritative: true,
  }),
  aggregation: Object.freeze({
    capabilityId: "gpu-aggregation",
    thresholdKey: "aggregation",
    authoritative: true,
  }),
  anomaly_detection: Object.freeze({
    capabilityId: "gpu-anomaly-screening",
    thresholdKey: null,
    authoritative: false,
    screeningOnlyReason:
      "measured but not authoritative: the accelerator fails its own parity tolerance at small scale",
  }),
  dimensional_reduction: Object.freeze({
    capabilityId: "gpu-dimensional-reduction",
    thresholdKey: null,
    authoritative: false,
    refusalReason: "the CPU path wins at every measured size, so no GPU binding is authorized",
  }),
})

export const PLACEMENT_REASON_CODES = Object.freeze([
  "GPU_ELIGIBLE_ABOVE_MEASURED_THRESHOLD",
  "CPU_BELOW_MEASURED_THRESHOLD",
  "CPU_DEFAULT_UNKNOWN_WORKLOAD_CLASS",
  "CPU_DEFAULT_SCALE_UNKNOWN",
  "CPU_DEFAULT_THRESHOLD_EVIDENCE_UNAVAILABLE",
  "CPU_DEFAULT_THRESHOLD_EVIDENCE_STALE",
  "CPU_DEFAULT_BINDING_UNAVAILABLE",
  "CPU_DEFAULT_AUTHORITY_MISSING",
  "CPU_DEFAULT_TRUST_GATE_DENIED",
  "CPU_MEASURED_NO_GPU_BENEFIT",
  "SCREENING_ONLY_NOT_AUTHORITATIVE",
  "CANCELLED",
])

/** Evidence older than this is treated as stale and placement falls to the CPU path. */
export const MAX_EVIDENCE_AGE_DAYS = 90

// ---------------------------------------------------------------------------------------------
// Threshold evidence
// ---------------------------------------------------------------------------------------------

/**
 * Load and validate the measured placement curve. Returns a typed refusal instead of throwing, so a
 * missing or malformed evidence file can only ever produce a CPU placement, never a GPU one.
 */
export function loadPlacementEvidence(curvePath, { now = new Date(), maxAgeDays = MAX_EVIDENCE_AGE_DAYS } = {}) {
  if (!curvePath || !fs.existsSync(curvePath)) {
    return { ok: false, reasonCode: "THRESHOLD_EVIDENCE_MISSING", detail: curvePath ?? "(no path)" }
  }
  let curve
  try {
    curve = JSON.parse(fs.readFileSync(curvePath, "utf8"))
  } catch (error) {
    return { ok: false, reasonCode: "THRESHOLD_EVIDENCE_INVALID", detail: String(error.message ?? error) }
  }
  if (curve?.schemaVersion !== PLACEMENT_CURVE_SCHEMA) {
    return {
      ok: false,
      reasonCode: "THRESHOLD_EVIDENCE_INVALID",
      detail: `unexpected schemaVersion ${JSON.stringify(curve?.schemaVersion)}`,
    }
  }
  if (!Array.isArray(curve.points) || curve.points.length === 0) {
    return { ok: false, reasonCode: "THRESHOLD_EVIDENCE_INVALID", detail: "points missing" }
  }
  const thresholds = curve.thresholds
  if (!thresholds || typeof thresholds !== "object") {
    return { ok: false, reasonCode: "THRESHOLD_EVIDENCE_INVALID", detail: "thresholds block missing" }
  }
  // An artifact must never assert its own promotion: the registry transition is the only source of
  // promotion, so a curve claiming `promoted: true` is not usable as placement evidence.
  if (curve.promoted !== false) {
    return { ok: false, reasonCode: "THRESHOLD_EVIDENCE_INVALID", detail: "promoted must be false" }
  }
  const finishedAt = curve.finishedAt ? new Date(curve.finishedAt) : null
  if (finishedAt && !Number.isNaN(finishedAt.getTime())) {
    const ageDays = (now.getTime() - finishedAt.getTime()) / 86_400_000
    if (ageDays > maxAgeDays) {
      return { ok: false, reasonCode: "THRESHOLD_EVIDENCE_STALE", detail: `age ${ageDays.toFixed(1)}d`, ageDays }
    }
  }
  return {
    ok: true,
    thresholds,
    measuredSizes: curve.points.map((point) => point.parcels).filter((value) => Number.isFinite(value)),
    digest: "sha256:" + createHash("sha256").update(fs.readFileSync(curvePath)).digest("hex"),
    finishedAt: curve.finishedAt ?? null,
  }
}

/** The measured row-count at which the accelerator becomes eligible for this workload class. */
export function thresholdRowsFor(workloadClass, evidence) {
  const spec = TABULAR_WORKLOAD_CLASSES[workloadClass]
  if (!spec || !spec.thresholdKey || !evidence?.ok) return null
  const entry = evidence.thresholds?.[spec.thresholdKey]
  if (!entry || entry.insufficientEvidence) return null
  return Number.isFinite(entry.gpuPreferredAboveRows) ? entry.gpuPreferredAboveRows : null
}

// ---------------------------------------------------------------------------------------------
// The eight requirements
// ---------------------------------------------------------------------------------------------

/** Provider identity: attributable, and bound to the reviewed runtime/device, never inferred. */
export function providerIdentity() {
  return { ...GPU_TABULAR_PROVIDER_IDENTITY }
}

/** Path confinement: unique, relative, traversal-free, wildcard-free (same rule as the trust gate). */
export function validExactPaths(paths) {
  if (!Array.isArray(paths) || paths.length === 0) return false
  if (new Set(paths).size !== paths.length) return false
  return paths.every((value) => (
    typeof value === "string"
    && value.length > 0
    && !value.startsWith("/")
    && !value.includes("..")
    && !value.includes("*")
    && !value.includes("\\")
    && !/^[A-Za-z]:/.test(value)
  ))
}

/**
 * Preventive trust enforcement - the existing contract, fail-closed, same reason codes as
 * workers.py#validate_preventive_trust_gate_v2. Anything missing or false denies.
 */
export function assertPreventiveTrustGateV2(gate, authority) {
  const deny = (reasonCode, reason) => ({ allowed: false, reasonCode, reason })
  if (!gate || typeof gate !== "object") return deny("PREVENTIVE_TRUST_GATE_V2_MISSING", "gate is missing")
  if (gate.schemaVersion !== 2) return deny("TRUST_GATE_SCHEMA_MISMATCH", "schemaVersion must be 2")
  const identity = gate.workerIdentity
  if (!identity || typeof identity !== "object") {
    return deny("WORKER_IDENTITY_MISSING", "attributable identity is missing")
  }
  const matchesSelected = identity.workerId === GPU_TABULAR_PROVIDER_IDENTITY.workerId
    && identity.provider === GPU_TABULAR_PROVIDER_IDENTITY.provider
    && identity.surface === GPU_TABULAR_PROVIDER_IDENTITY.surface
  if (!matchesSelected || identity.attributable !== true) {
    return deny("WORKER_IDENTITY_MISMATCH", "identity does not match the reviewed binding")
  }
  if (gate.rawCredentialInspection !== false) {
    return deny("RAW_CREDENTIAL_INSPECTION_FORBIDDEN", "rawCredentialInspection must be explicitly false")
  }
  if (gate.promptInjectionBoundary !== "provider-stdout-not-instructions") {
    return deny("PROMPT_INJECTION_BOUNDARY_UNRECOGNIZED", "boundary must name the enforced boundary")
  }
  if (gate.exactPathConfinement !== true) {
    return deny("EXACT_PATH_CONFINEMENT_REQUIRED", "exactPathConfinement must be explicitly true")
  }
  if (gate.outputRedaction !== true) {
    return deny("OUTPUT_REDACTION_REQUIRED", "outputRedaction must be explicitly true")
  }
  if (!gate.cancellation || gate.cancellation.supported !== true) {
    return deny("CANCELLATION_REQUIRED", "cancellation support must be explicit")
  }
  if (gate.independentEvidenceCapture !== true) {
    return deny("INDEPENDENT_EVIDENCE_CAPTURE_REQUIRED", "independentEvidenceCapture must be explicitly true")
  }
  if (!authority || typeof authority !== "object") {
    return deny("EXACT_PATH_SCOPE_MISSING", "dispatch scope and execution grant are required")
  }
  const grantPaths = authority.grant?.allowedPaths
  const scopePaths = authority.scope?.allowedPaths
  if (!validExactPaths(grantPaths) || !validExactPaths(scopePaths)) {
    return deny("EXACT_PATH_SCOPE_INVALID", "allowed paths must be unique, relative and traversal-free")
  }
  if ([...grantPaths].sort().join("\n") !== [...scopePaths].sort().join("\n")) {
    return deny("EXACT_PATH_SCOPE_MISMATCH", "grant paths must exactly match scope paths")
  }
  return {
    allowed: true,
    reasonCode: "PREVENTIVE_TRUST_GATE_V2_PASSED",
    evidence: {
      schemaVersion: 2,
      workerId: identity.workerId,
      provider: identity.provider,
      surface: identity.surface,
      promptInjectionBoundary: gate.promptInjectionBoundary,
      allowedPaths: [...scopePaths].sort(),
      rawCredentialInspection: false,
      outputRedaction: true,
      cancellationSupported: true,
      independentEvidenceCapture: true,
    },
  }
}

/** Provider-output redaction: absolute provider paths, venv paths, and credential-shaped tokens. */
export function redactProviderOutput(text) {
  if (typeof text !== "string") return { text: "", redactions: [] }
  const redactions = []
  let output = text
  const rules = [
    [/(?:\/home\/[A-Za-z0-9._-]+\/[^\s"']*)/g, "<provider-path>", "provider-path"],
    [/(?:\/mnt\/[A-Za-z0-9._\/-]*)/g, "<provider-path>", "provider-path"],
    [/\b(?:sk|pk|ghp|gho|xoxb|AKIA)[A-Za-z0-9_-]{12,}\b/g, "<redacted-token>", "credential-shaped-token"],
    [/\b[A-Fa-f0-9]{40,64}\b/g, "<redacted-hex>", "high-entropy-hex"],
  ]
  for (const [pattern, replacement, label] of rules) {
    const found = output.match(pattern)
    if (found) redactions.push({ kind: label, count: found.length })
    output = output.replace(pattern, replacement)
  }
  return { text: output, redactions }
}

/** Cancellation: an explicit token the dispatcher must honour between phases. */
export function createCancellationToken() {
  const state = { aborted: false, reason: null }
  return {
    get aborted() { return state.aborted },
    get reason() { return state.reason },
    cancel(reason = "cancelled-by-dispatcher") {
      state.aborted = true
      state.reason = reason
      return state
    },
  }
}

export function assertNotCancelled(token) {
  if (token?.aborted) {
    const error = new Error(`GPU tabular work cancelled: ${token.reason}`)
    error.reasonCode = "CANCELLED"
    throw error
  }
}

/**
 * Independent evidence capture. The record is produced by the dispatching fabric from facts it holds
 * (including the evidence digest), not authored by the provider, and it carries no provider paths.
 */
export function captureIndependentEvidence(decision, { evidenceDigest = null, now = new Date() } = {}) {
  return Object.freeze({
    schemaVersion: 1,
    capturedAt: now.toISOString(),
    capturedBy: "execution-fabric",
    capabilityId: decision.capabilityId,
    workloadClass: decision.workloadClass,
    placement: decision.placement,
    reasonCode: decision.reasonCode,
    rows: decision.rows,
    thresholdRows: decision.thresholdRows,
    thresholdIsAtMeasurementFloor: decision.thresholdIsAtMeasurementFloor,
    binding: {
      workerId: GPU_TABULAR_PROVIDER_IDENTITY.workerId,
      provider: GPU_TABULAR_PROVIDER_IDENTITY.provider,
      runtime: GPU_TABULAR_PROVIDER_IDENTITY.runtime,
      device: GPU_TABULAR_PROVIDER_IDENTITY.device,
    },
    thresholdEvidenceDigest: evidenceDigest,
    promoted: false,
  })
}

// ---------------------------------------------------------------------------------------------
// Placement evaluation - the decision the dispatch path consumes
// ---------------------------------------------------------------------------------------------

/**
 * Decide where one tabular workload runs. Order matters: every precondition is checked before any
 * eligibility claim, and each failure names the input that was missing, invalid, or stale.
 */
export function evaluateGpuTabularPlacement(request = {}, context = {}) {
  const { workloadClass, rows } = request
  const { evidence = null, bindingHealthy = true, authority = null, trustGate = null, cancellation = null } = context

  const decide = (placement, reasonCode, extra = {}) => Object.freeze({
    placement,
    reasonCode,
    capabilityId: TABULAR_WORKLOAD_CLASSES[workloadClass]?.capabilityId ?? null,
    workloadClass: workloadClass ?? null,
    rows: Number.isFinite(rows) ? rows : null,
    thresholdRows: null,
    thresholdIsAtMeasurementFloor: null,
    ...extra,
  })

  if (cancellation?.aborted) return decide("CANCELLED", "CANCELLED")

  const spec = TABULAR_WORKLOAD_CLASSES[workloadClass]
  if (!spec) return decide("CPU", "CPU_DEFAULT_UNKNOWN_WORKLOAD_CLASS")

  // A measured refusal is a decision, not a missing input: the CPU path is the authorized answer.
  if (spec.refusalReason) {
    return decide("CPU", "CPU_MEASURED_NO_GPU_BENEFIT", { measuredRefusal: spec.refusalReason })
  }
  // Measured but not authoritative: it may screen, it may not carry an authoritative result.
  if (spec.authoritative === false) {
    return decide("SCREENING_ONLY", "SCREENING_ONLY_NOT_AUTHORITATIVE", {
      screeningOnlyReason: spec.screeningOnlyReason,
    })
  }
  if (!Number.isFinite(rows) || rows <= 0) return decide("CPU", "CPU_DEFAULT_SCALE_UNKNOWN")
  if (!evidence || evidence.ok !== true) {
    const reasonCode = evidence?.reasonCode === "THRESHOLD_EVIDENCE_STALE"
      ? "CPU_DEFAULT_THRESHOLD_EVIDENCE_STALE"
      : "CPU_DEFAULT_THRESHOLD_EVIDENCE_UNAVAILABLE"
    return decide("CPU", reasonCode, { evidenceDetail: evidence?.detail ?? null })
  }
  if (bindingHealthy !== true) return decide("CPU", "CPU_DEFAULT_BINDING_UNAVAILABLE")
  if (!authority) return decide("CPU", "CPU_DEFAULT_AUTHORITY_MISSING")

  const trust = assertPreventiveTrustGateV2(trustGate, authority)
  if (!trust.allowed) {
    return decide("CPU", "CPU_DEFAULT_TRUST_GATE_DENIED", { trustGateReasonCode: trust.reasonCode })
  }

  const thresholdRows = thresholdRowsFor(workloadClass, evidence)
  const thresholdEntry = spec.thresholdKey ? evidence.thresholds?.[spec.thresholdKey] : null
  const atFloor = thresholdEntry?.thresholdIsAtMeasurementFloor ?? null
  if (thresholdRows === null) {
    return decide("CPU", "CPU_DEFAULT_THRESHOLD_EVIDENCE_UNAVAILABLE", {
      evidenceDetail: "no usable threshold for this workload class",
      thresholdIsAtMeasurementFloor: atFloor,
    })
  }
  if (rows < thresholdRows) {
    return decide("CPU", "CPU_BELOW_MEASURED_THRESHOLD", {
      thresholdRows,
      thresholdIsAtMeasurementFloor: atFloor,
    })
  }
  return decide("CUDA_DEVICE", "GPU_ELIGIBLE_ABOVE_MEASURED_THRESHOLD", {
    thresholdRows,
    thresholdIsAtMeasurementFloor: atFloor,
  })
}
