import crypto from "node:crypto"

// Merge admission adjudication. Slice one of the resident merge-gate P0.
//
// This module answers exactly one question: did every proof required by the contract
// exist, execute, and pass for the bound subject? It deliberately does NOT answer whether
// a proof exercised the correct target, project, or environment -- that is proof-semantic
// adequacy and belongs to a later layer.
//
// Two rules make this different from the checksGreen scalar it replaces:
//   1. Required proof identity is declared locally, never inferred from whatever the
//      provider happened to return. A proof that never reported is MISSING, not invisible.
//   2. Only an observed SUCCESS satisfies a required proof. States that represent
//      non-execution -- SKIPPED, NEUTRAL, CANCELLED, TIMED_OUT, NOT_REPORTED -- are not
//      passes, and no other signal (review, approval, a different check) may be
//      substituted for a proof that did not run.

const PROOF_PENDING = new Set([
  "", "EXPECTED", "IN_PROGRESS", "PENDING", "QUEUED", "REQUESTED", "WAITING",
])
const PROOF_FAILED = new Set([
  "FAILURE", "ERROR", "ACTION_REQUIRED", "STARTUP_FAILURE", "STALE",
])

export const PROOF_STATE = Object.freeze({
  NOT_REPORTED: "NOT_REPORTED",
  PENDING: "PENDING",
  SKIPPED: "SKIPPED",
  NEUTRAL: "NEUTRAL",
  CANCELLED: "CANCELLED",
  TIMED_OUT: "TIMED_OUT",
  FAILED: "FAILED",
  SUCCEEDED: "SUCCEEDED",
  AMBIGUOUS: "AMBIGUOUS",
})

// Only SUCCEEDED satisfies a required proof. Every other state is a refusal, and the
// distinctions between them are preserved so telemetry can say WHY rather than just "not green".
const SATISFYING_STATES = new Set([PROOF_STATE.SUCCEEDED])

export const ADMISSION = Object.freeze({
  ADMISSIBLE: "MERGE_ADMISSIBLE",
  INADMISSIBLE: "MERGE_INADMISSIBLE",
})

export function proofCheckName(check) {
  return String(check?.name ?? check?.context ?? "")
}

export function proofCheckState(check) {
  return String(check?.conclusion ?? check?.state ?? check?.status ?? "").toUpperCase()
}

export function classifyProofState(check) {
  if (check === null || check === undefined) return PROOF_STATE.NOT_REPORTED
  const state = proofCheckState(check)
  if (state === "SUCCESS") return PROOF_STATE.SUCCEEDED
  if (state === "SKIPPED") return PROOF_STATE.SKIPPED
  if (state === "NEUTRAL") return PROOF_STATE.NEUTRAL
  if (state === "CANCELLED" || state === "CANCELED") return PROOF_STATE.CANCELLED
  if (state === "TIMED_OUT") return PROOF_STATE.TIMED_OUT
  if (PROOF_PENDING.has(state)) return PROOF_STATE.PENDING
  if (PROOF_FAILED.has(state)) return PROOF_STATE.FAILED
  // An unrecognised provider state is never assumed benign.
  return PROOF_STATE.FAILED
}

function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`
  if (value && typeof value === "object") {
    const keys = Object.keys(value).sort()
    return `{${keys.map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(",")}}`
  }
  return JSON.stringify(value ?? null)
}

export function contractHash(contract) {
  return crypto.createHash("sha256").update(canonicalJson(contract), "utf8").digest("hex")
}

function normaliseName(value) {
  return String(value ?? "").trim().toLowerCase()
}

function readRequiredProofs(contract) {
  const declared = Array.isArray(contract?.requiredProofs) ? contract.requiredProofs : []
  return declared.map((entry) => ({
    proofId: String(entry?.proofId ?? ""),
    matchName: String(entry?.matchName ?? ""),
  })).filter((entry) => entry.proofId && entry.matchName)
}

/**
 * Adjudicate merge admission for one pull request head.
 *
 * @param {object} input
 * @param {object} input.contract   locally declared required-proof set
 * @param {Array}  input.checks     raw provider check contexts, de-duplicated by the caller
 * @param {string} input.headSha    the exact head the proofs are bound to
 * @param {string} [input.adjudicatedAt] ISO timestamp; injected so receipts are deterministic in tests
 * @returns {object} adjudication receipt
 */
export function adjudicateMergeAdmission({ contract, checks, headSha, adjudicatedAt } = {}) {
  const declaredProofs = readRequiredProofs(contract)
  const observed = Array.isArray(checks) ? checks : []
  const requiredNames = new Set(declaredProofs.map((entry) => normaliseName(entry.matchName)))

  const requiredResults = declaredProofs.map((entry) => {
    const matches = observed.filter((check) => normaliseName(proofCheckName(check)) === normaliseName(entry.matchName))
    if (matches.length === 0) {
      return { ...entry, state: PROOF_STATE.NOT_REPORTED, satisfied: false, observedState: null }
    }
    if (matches.length > 1) {
      // The caller is expected to de-duplicate. Unresolved ambiguity is refused rather than
      // silently resolved, because picking one would be an assertion we cannot evidence.
      return { ...entry, state: PROOF_STATE.AMBIGUOUS, satisfied: false, observedState: null }
    }
    const state = classifyProofState(matches[0])
    return {
      ...entry,
      state,
      satisfied: SATISFYING_STATES.has(state),
      observedState: proofCheckState(matches[0]) || null,
    }
  })

  // Optional assurance is reported but can never affect admissibility.
  const optionalAssurance = observed
    .filter((check) => !requiredNames.has(normaliseName(proofCheckName(check))))
    .map((check) => ({
      name: proofCheckName(check).trim() || "Unnamed check",
      state: classifyProofState(check),
    }))

  const missingProofs = requiredResults.filter((r) => r.state === PROOF_STATE.NOT_REPORTED)
  const ambiguousProofs = requiredResults.filter((r) => r.state === PROOF_STATE.AMBIGUOUS)
  const nonExecutedProofs = requiredResults.filter((r) => [
    PROOF_STATE.SKIPPED, PROOF_STATE.NEUTRAL, PROOF_STATE.CANCELLED, PROOF_STATE.TIMED_OUT,
  ].includes(r.state))
  const pendingProofs = requiredResults.filter((r) => r.state === PROOF_STATE.PENDING)
  const failedProofs = requiredResults.filter((r) => r.state === PROOF_STATE.FAILED)

  const blockingReasons = []
  if (declaredProofs.length === 0) blockingReasons.push("CONTRACT_DECLARES_NO_REQUIRED_PROOFS")
  if (!/^[0-9a-f]{40}$/.test(String(headSha ?? ""))) blockingReasons.push("SUBJECT_HEAD_SHA_UNBOUND")
  missingProofs.forEach((r) => blockingReasons.push(`REQUIRED_PROOF_MISSING:${r.proofId}`))
  ambiguousProofs.forEach((r) => blockingReasons.push(`REQUIRED_PROOF_AMBIGUOUS:${r.proofId}`))
  nonExecutedProofs.forEach((r) => blockingReasons.push(`REQUIRED_PROOF_DID_NOT_EXECUTE:${r.proofId}:${r.state}`))
  pendingProofs.forEach((r) => blockingReasons.push(`REQUIRED_PROOF_PENDING:${r.proofId}`))
  failedProofs.forEach((r) => blockingReasons.push(`REQUIRED_PROOF_FAILED:${r.proofId}`))

  return {
    contractId: String(contract?.contractId ?? ""),
    contractHash: contractHash(contract ?? {}),
    subjectHeadSha: String(headSha ?? ""),
    adjudicatedAt: adjudicatedAt ?? new Date().toISOString(),
    requiredProofs: requiredResults,
    optionalAssurance,
    missingProofs: missingProofs.map((r) => r.proofId),
    ambiguousProofs: ambiguousProofs.map((r) => r.proofId),
    nonExecutedProofs: nonExecutedProofs.map((r) => ({ proofId: r.proofId, state: r.state })),
    pendingProofs: pendingProofs.map((r) => r.proofId),
    failedProofs: failedProofs.map((r) => r.proofId),
    blockingReasons,
    verdict: blockingReasons.length === 0 ? ADMISSION.ADMISSIBLE : ADMISSION.INADMISSIBLE,
  }
}
