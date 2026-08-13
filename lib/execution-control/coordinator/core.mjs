const STATES = new Set(["STARTING", "FOLLOWER", "LEADER", "DRAINING", "STOPPED", "FAILED"])

export class CoordinatorContractError extends Error {
  constructor(code) { super(code); this.name = "CoordinatorContractError"; this.code = code }
}

const wall = (code) => { throw new CoordinatorContractError(code) }
const transportUncertain = (error) => {
  const code = String(error?.code ?? "")
  const message = String(error?.message ?? error ?? "")
  return /^08/.test(code) || code === "57P01" || /^ECONN/.test(code) || /(?:connection|session).*(?:closed|lost|terminated|reset)|disconnect|socket|ECONN/i.test(message)
}

export function validateCoordinatorConfig(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) wall("COORDINATOR_CONFIG_INVALID")
  const keys = Object.keys(value).sort().join("\0")
  if (keys !== ["atlasDatabaseEnv", "coordinatorId", "healthPort", "leaderLockKey", "pollIntervalMs", "reconciliationDependency", "shutdownTimeoutMs"].sort().join("\0")) wall("COORDINATOR_CONFIG_INVALID")
  if (!/^[a-z0-9][a-z0-9._:-]{2,127}$/.test(value.coordinatorId)
    || value.atlasDatabaseEnv !== "AEH_ATLAS_DATABASE_URL"
    || !Number.isSafeInteger(value.leaderLockKey) || value.leaderLockKey < 1
    || !Number.isSafeInteger(value.pollIntervalMs) || value.pollIntervalMs < 250 || value.pollIntervalMs > 30_000
    || !Number.isSafeInteger(value.shutdownTimeoutMs) || value.shutdownTimeoutMs < 1_000 || value.shutdownTimeoutMs > 120_000
    || !Number.isSafeInteger(value.healthPort) || value.healthPort < 1024 || value.healthPort > 65535
    || value.reconciliationDependency !== "WO-AEH-019_REQUIRED_NOT_IMPLEMENTED") wall("COORDINATOR_CONFIG_INVALID")
  return Object.freeze({ ...value })
}

export function createCoordinator({ config, openLeaderSession, pullEligibleJob, inspectDrainState, now = () => new Date().toISOString() }) {
  const contract = validateCoordinatorConfig(config)
  if (typeof openLeaderSession !== "function" || typeof pullEligibleJob !== "function" || typeof inspectDrainState !== "function") wall("COORDINATOR_DEPENDENCY_INVALID")
  let state = "STARTING", session = null, leader = false, accepting = false, lastDatabaseProof = null, lastFailure = null
  const transition = (next) => { if (!STATES.has(next)) wall("COORDINATOR_STATE_INVALID"); state = next }
  const proofFresh = () => {
    const age = lastDatabaseProof === null ? Number.NaN : Date.parse(now()) - Date.parse(lastDatabaseProof)
    return Number.isFinite(age) && age >= 0 && age <= contract.pollIntervalMs
  }
  const failClosed = (error, code = "COORDINATOR_LEADER_SESSION_UNCERTAIN") => {
    accepting = false; leader = false
    lastFailure = String(error?.code ?? error?.message ?? error ?? code)
    transition("FAILED")
    throw error instanceof CoordinatorContractError ? error : new CoordinatorContractError(code)
  }

  return Object.freeze({
    async start() {
      if (state !== "STARTING") wall("COORDINATOR_ALREADY_STARTED")
      try {
        session = await openLeaderSession()
        const result = await session.query("SELECT pg_try_advisory_lock($1) AS acquired", [contract.leaderLockKey])
        leader = result.rows?.[0]?.acquired === true
        accepting = leader
        lastDatabaseProof = now()
        transition(leader ? "LEADER" : "FOLLOWER")
        return this.status()
      } catch (error) { if (transportUncertain(error)) return failClosed(error); throw error }
    },
    async poll(request) {
      if (!leader || !accepting || state !== "LEADER") wall("COORDINATOR_NOT_LEADER")
      try {
        const receipt = await pullEligibleJob(session, request)
        lastDatabaseProof = now()
        return receipt
      } catch (error) {
        if (transportUncertain(error)) return failClosed(error)
        lastDatabaseProof = now()
        if (error?.code === "CLAIM_NOT_ELIGIBLE") return Object.freeze({ outcome: "NO_WORK", code: "CLAIM_NOT_ELIGIBLE" })
        throw error
      }
    },
    async probeDatabase() {
      if (!session) wall("COORDINATOR_SESSION_MISSING")
      try {
        await session.query("SELECT 1 AS healthy", [])
        lastDatabaseProof = now()
        return true
      } catch (error) { if (transportUncertain(error)) return failClosed(error); throw error }
    },
    async beginReplacement() {
      if (!leader || (state !== "LEADER" && state !== "DRAINING")) wall("COORDINATOR_NOT_LEADER")
      accepting = false
      if (state === "LEADER") transition("DRAINING")
      let drain
      try { drain = await inspectDrainState(session) } catch (error) { if (transportUncertain(error)) return failClosed(error); throw error }
      const { activeLeaseCount, ambiguousAttemptCount } = drain ?? {}
      if (!Number.isSafeInteger(activeLeaseCount) || activeLeaseCount < 0 || !Number.isSafeInteger(ambiguousAttemptCount) || ambiguousAttemptCount < 0) return failClosed(null, "COORDINATOR_DRAIN_INPUT_INVALID")
      if (activeLeaseCount !== 0) wall("COORDINATOR_ACTIVE_LEASES_REMAIN")
      if (ambiguousAttemptCount !== 0) wall("COORDINATOR_RECONCILIATION_REQUIRED_WO_AEH_019")
      let unlocked
      try { unlocked = await session.query("SELECT pg_advisory_unlock($1) AS released", [contract.leaderLockKey]) } catch (error) { if (transportUncertain(error)) return failClosed(error); throw error }
      if (unlocked.rows?.[0]?.released !== true) return failClosed(null, "COORDINATOR_LEADERSHIP_ALREADY_LOST")
      leader = false
      try { await session.release() } catch (error) { return failClosed(error) }
      session = null; transition("STOPPED")
      return this.status()
    },
    status() {
      return Object.freeze({ state, leader, accepting, lastDatabaseProof, lastFailure,
        reconciliation: contract.reconciliationDependency, coordinatorId: contract.coordinatorId })
    },
    health() { return { ok: leader && (state === "LEADER" || state === "DRAINING") && proofFresh(), state, databaseProof: lastDatabaseProof } },
    readiness() {
      const reasons = []
      if (state !== "LEADER" || !leader || !accepting) reasons.push("NOT_ACTIVE_LEADER")
      if (!lastDatabaseProof) reasons.push("NO_ATLAS_DATABASE_PROOF")
      else if (!proofFresh()) reasons.push("ATLAS_DATABASE_PROOF_STALE")
      return { ready: reasons.length === 0, reasons, reconciliationDependency: contract.reconciliationDependency }
    },
  })
}
