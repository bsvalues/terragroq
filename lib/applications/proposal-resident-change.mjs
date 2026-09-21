const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/

function recoverableResidentOutput(error) {
  return error?.name === "AppServerTurnEndedError" && error.status === "failed"
    && typeof error.detail === "string" && error.detail.startsWith("RESIDENT_MODEL_TURN_OUTPUT_INVALID:")
}

/**
 * Host-owned correction loop shared by the legacy Hello compatibility facade and
 * manifest-bound application proposals. Provider output never decides path scope;
 * every attempt is reconciled against the workspace observed by the host.
 */
export async function runGovernedResidentChangeTransaction({
  client,
  threadId,
  requestText,
  parseRequest,
  promptForRequest,
  readChangedPaths,
  assertChangedPaths,
  errorPrefix,
  timeoutMs = 5_400_000,
  turnTimeoutMs = 1_800_000,
  maximumAttempts = 3,
  verifyAttempt,
  now = Date.now,
}) {
  const code = typeof errorPrefix === "string" && /^[A-Z][A-Z0-9_]{2,60}$/.test(errorPrefix)
    ? errorPrefix : "APPLICATION_PROPOSAL"
  if (!client || typeof client.runTurn !== "function" || typeof parseRequest !== "function"
    || typeof promptForRequest !== "function" || typeof readChangedPaths !== "function"
    || typeof assertChangedPaths !== "function") throw new Error(`${code}_RESIDENT_EVIDENCE_INVALID`)
  const requested = parseRequest(requestText)
  const limit = Math.min(3, Math.max(1, Number.isInteger(maximumAttempts) ? maximumAttempts : 3))
  const budget = Number.isFinite(timeoutMs) ? Math.floor(timeoutMs) : 0
  const perTurn = Number.isFinite(turnTimeoutMs) ? Math.floor(turnTimeoutMs) : 0
  if (budget <= 0 || perTurn <= 0 || typeof now !== "function") throw new Error(`${code}_RESIDENT_TIMEOUT`)
  const started = now()
  if (!Number.isFinite(started)) throw new Error(`${code}_RESIDENT_TIMEOUT`)
  const remainingBudget = () => {
    const current = now()
    if (!Number.isFinite(current)) throw new Error(`${code}_RESIDENT_TIMEOUT`)
    return Math.min(budget, Math.floor(budget - Math.max(0, current - started)))
  }
  let paths = []
  for (let attempt = 1; attempt <= limit; attempt++) {
    const remaining = remainingBudget()
    if (remaining < perTurn) throw new Error(`${code}_RESIDENT_TIMEOUT`)
    const correction = attempt === 1 ? "" : `Correction attempt ${attempt}: emit the required completion object. Preserve the existing edits. Actual changed paths: ${paths.join(", ") || "none"}.\n`
    let turn
    let failure
    try {
      turn = await client.runTurn({
        threadId,
        prompt: correction + promptForRequest(requested),
        timeoutMs: perTurn,
      })
    } catch (error) {
      if (error?.name === "AppServerTimeoutError" || error?.code === "APP_SERVER_TIMEOUT") {
        throw new Error(`${code}_RESIDENT_TIMEOUT`)
      }
      if (!recoverableResidentOutput(error)) throw error
      failure = error
    }
    if (remainingBudget() <= 0) throw new Error(`${code}_RESIDENT_TIMEOUT`)
    const verified = verifyAttempt ? await verifyAttempt({ attempt, turn, failure }) : null
    if (remainingBudget() <= 0) throw new Error(`${code}_RESIDENT_TIMEOUT`)
    paths = await readChangedPaths()
    if (remainingBudget() <= 0) throw new Error(`${code}_RESIDENT_TIMEOUT`)
    if (paths.length) assertChangedPaths(paths, [])
    if (!failure) {
      if (remainingBudget() <= 0) throw new Error(`${code}_RESIDENT_TIMEOUT`)
      return { turn, turnId: turn.turnId, completionMode: "MODEL_OUTPUT_VALID", changedPaths: paths, attempts: attempt }
    }
    if (paths.length && typeof verified?.turnId === "string" && SAFE_ID.test(verified.turnId)) {
      return {
        turn: null,
        turnId: verified.turnId,
        completionMode: "HOST_OBSERVED_OUTPUT_INVALID",
        changedPaths: paths,
        attempts: attempt,
      }
    }
    if (attempt === limit) throw failure
  }
}
