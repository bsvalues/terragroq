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

// Admissibility answers "may this merge now". Settlement answers "is this decided yet", which is a
// different question and the one an orchestration loop needs: a required proof that has not reported
// during an actively forming check set is a WAIT, not a refusal, while a required proof that failed
// or demonstrably did not execute is terminal and should stop the loop rather than be polled at.
export const ADMISSION_STATE = Object.freeze({
  ADMISSIBLE: "ADMISSIBLE",
  WAITING: "WAITING",
  REFUSED: "REFUSED",
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

const PROOF_KINDS = new Set(["CheckRun", "StatusContext"])

function checkKind(check) {
  const kind = String(check?.__typename ?? "")
  return PROOF_KINDS.has(kind) ? kind : null
}

function checkWorkflowName(check) {
  return normaliseName(check?.workflowName ?? check?.checkSuite?.workflowRun?.workflow?.name)
}

// Identity is encoded as a JSON tuple, not delimiter concatenation. A check name legitimately
// containing the delimiter would otherwise be able to collide with a different (kind, workflow, name)
// triple -- an identity forgery in the field that exists to prevent substitution.
function encodeIdentity(kind, workflowName, matchName) {
  return JSON.stringify([String(kind), normaliseName(workflowName), normaliseName(matchName)])
}

/**
 * Read a declared contract field, distinguishing ABSENT from WRONG TYPE.
 *
 * String() coercion before validation would give malformed JSON valid-looking semantics: a numeric
 * proofId becomes "123", an array matchName becomes "a,b". Both would then pass every downstream
 * check. A contract is configuration that decides what merge admission means, so a type error in it
 * must fail closed rather than be coerced into something plausible.
 */
function readContractField(entry, key) {
  const raw = entry?.[key]
  if (raw === undefined || raw === null) return { value: "", absent: true, wrongType: false }
  if (typeof raw !== "string") return { value: "", absent: false, wrongType: true }
  return { value: raw.trim(), absent: false, wrongType: false }
}

/**
 * Parse the declared contract, failing CLOSED.
 *
 * A malformed entry must never be silently dropped: filtering it out would let a typo delete a
 * required proof, which is the fail-open case this whole gate exists to prevent. Duplicate proof ids
 * and duplicate identities are refused for the same reason -- two declarations resolving to one
 * check would let a single result satisfy two required proofs.
 *
 * Proof identity is (kind, workflowName, matchName). Display name alone is not identity: a different
 * workflow, or a StatusContext sharing the name, could otherwise substitute for the real proof.
 */
export function parseContract(contract) {
  const declared = Array.isArray(contract?.requiredProofs) ? contract.requiredProofs : []
  const errors = []
  const proofs = []
  const seenIds = new Set()
  const seenIdentities = new Set()

  declared.forEach((entry, index) => {
    const fields = {
      proofId: readContractField(entry, "proofId"),
      matchName: readContractField(entry, "matchName"),
      kind: readContractField(entry, "kind"),
      workflowName: readContractField(entry, "workflowName"),
    }
    const proofId = fields.proofId.value
    const matchName = fields.matchName.value
    const kind = fields.kind.value
    const workflowName = fields.workflowName.value
    const at = proofId || `#${index}`

    // A wrong-typed field is reported as such and never coerced into a usable value.
    Object.entries(fields).forEach(([key, field]) => {
      if (field.wrongType) errors.push(`ENTRY_NON_STRING_FIELD:${at}:${key}`)
    })

    if (!proofId && !fields.proofId.wrongType) errors.push(`ENTRY_MISSING_PROOF_ID:#${index}`)
    if (!matchName && !fields.matchName.wrongType) errors.push(`ENTRY_MISSING_MATCH_NAME:${at}`)
    if (!PROOF_KINDS.has(kind) && !fields.kind.wrongType) errors.push(`ENTRY_INVALID_KIND:${at}`)
    if (kind === "CheckRun" && !workflowName && !fields.workflowName.wrongType) {
      errors.push(`ENTRY_MISSING_WORKFLOW_NAME:${at}`)
    }
    if (proofId && seenIds.has(proofId)) errors.push(`DUPLICATE_PROOF_ID:${proofId}`)
    if (proofId) seenIds.add(proofId)

    if (matchName && PROOF_KINDS.has(kind)) {
      const identity = encodeIdentity(kind, workflowName, matchName)
      if (seenIdentities.has(identity)) errors.push(`DUPLICATE_PROOF_IDENTITY:${at}`)
      seenIdentities.add(identity)
    }

    proofs.push({ proofId, matchName, kind, workflowName })
  })

  if (declared.length === 0) errors.push("CONTRACT_DECLARES_NO_REQUIRED_PROOFS")
  return { proofs, errors }
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
  const { proofs: declaredProofs, errors: contractErrors } = parseContract(contract)
  const observed = Array.isArray(checks) ? checks : []

  const identityOf = (entry) => encodeIdentity(entry.kind, entry.workflowName, entry.matchName)
  const observedIdentity = (check) => {
    const kind = checkKind(check)
    if (!kind) return null
    // A StatusContext carries no workflow, so its identity is (kind, name) with an empty workflow.
    const workflow = kind === "CheckRun" ? checkWorkflowName(check) : ""
    return encodeIdentity(kind, workflow, proofCheckName(check))
  }

  const requiredIdentities = new Set(declaredProofs.map(identityOf))

  const requiredResults = declaredProofs.map((entry) => {
    const wanted = identityOf(entry)
    const matches = observed.filter((check) => observedIdentity(check) === wanted)
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

  // Optional assurance is reported but can never affect admissibility. Membership is decided by
  // full identity, so a check merely sharing a required display name is optional, not required.
  const optionalAssurance = observed
    .filter((check) => !requiredIdentities.has(observedIdentity(check)))
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

  const waitingProofs = [...missingProofs, ...pendingProofs].map((r) => r.proofId)
  const blockingReasons = []
  const terminalRefusals = []
  // A malformed contract fails closed. Dropping a bad entry would let a typo delete a required proof.
  contractErrors.forEach((reason) => terminalRefusals.push(`CONTRACT_INVALID:${reason}`))
  if (!/^[0-9a-f]{40}$/.test(String(headSha ?? ""))) terminalRefusals.push("SUBJECT_HEAD_SHA_UNBOUND")
  missingProofs.forEach((r) => blockingReasons.push(`REQUIRED_PROOF_MISSING:${r.proofId}`))
  ambiguousProofs.forEach((r) => terminalRefusals.push(`REQUIRED_PROOF_AMBIGUOUS:${r.proofId}`))
  nonExecutedProofs.forEach((r) => terminalRefusals.push(`REQUIRED_PROOF_DID_NOT_EXECUTE:${r.proofId}:${r.state}`))
  pendingProofs.forEach((r) => blockingReasons.push(`REQUIRED_PROOF_PENDING:${r.proofId}`))
  failedProofs.forEach((r) => terminalRefusals.push(`REQUIRED_PROOF_FAILED:${r.proofId}`))

  // Every terminal refusal is also a blocking reason; waiting states block admission without being
  // terminal. Ordering keeps terminal causes first so a truncated message shows the decisive ones.
  blockingReasons.unshift(...terminalRefusals)

  const verdict = blockingReasons.length === 0 ? ADMISSION.ADMISSIBLE : ADMISSION.INADMISSIBLE
  const admissionState = verdict === ADMISSION.ADMISSIBLE
    ? ADMISSION_STATE.ADMISSIBLE
    : terminalRefusals.length > 0 ? ADMISSION_STATE.REFUSED : ADMISSION_STATE.WAITING

  return {
    contractId: String(contract?.contractId ?? ""),
    contractHash: contractHash(contract ?? {}),
    contractErrors,
    subjectHeadSha: String(headSha ?? ""),
    adjudicatedAt: adjudicatedAt ?? new Date().toISOString(),
    requiredProofs: requiredResults,
    optionalAssurance,
    missingProofs: missingProofs.map((r) => r.proofId),
    ambiguousProofs: ambiguousProofs.map((r) => r.proofId),
    nonExecutedProofs: nonExecutedProofs.map((r) => ({ proofId: r.proofId, state: r.state })),
    pendingProofs: pendingProofs.map((r) => r.proofId),
    failedProofs: failedProofs.map((r) => r.proofId),
    waitingProofs,
    terminalRefusals,
    blockingReasons,
    admissionState,
    verdict,
  }
}
