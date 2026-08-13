import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"
import { createCoordinator, validateCoordinatorConfig } from "../lib/execution-control/coordinator/core.mjs"

const config = () => ({ coordinatorId: "atlas:aeh:fixture", atlasDatabaseEnv: "AEH_ATLAS_DATABASE_URL", leaderLockKey: 16600420, pollIntervalMs: 1000, shutdownTimeoutMs: 30000, healthPort: 9080, reconciliationDependency: "WO-AEH-019_REQUIRED_NOT_IMPLEMENTED" })
const session = (acquired = true, unlockReleased = true) => { const calls = []; return { calls, released: false, async query(sql) { calls.push(sql); if (sql.includes("pg_try")) return { rows: [{ acquired }] }; if (sql.includes("pg_advisory_unlock")) return { rows: [{ released: unlockReleased }] }; return { rows: [{ healthy: 1 }] } }, async release() { this.released = true } } }
const cleanDrain = async () => ({ activeLeaseCount: 0, ambiguousAttemptCount: 0 })

test("configuration fails closed and contains no connection value", () => {
  assert.equal(validateCoordinatorConfig(config()).atlasDatabaseEnv, "AEH_ATLAS_DATABASE_URL")
  assert.throws(() => validateCoordinatorConfig({ ...config(), atlasDatabaseEnv: "DATABASE_URL" }), /COORDINATOR_CONFIG_INVALID/)
  assert.throws(() => validateCoordinatorConfig({ ...config(), reconciliationDependency: "READY" }), /COORDINATOR_CONFIG_INVALID/)
})

test("one session owns leadership and follower cannot pull", async () => {
  const leaderSession = session(true), followerSession = session(false)
  const leader = createCoordinator({ config: config(), openLeaderSession: async () => leaderSession, pullEligibleJob: async () => ({ fencing_token: "1" }), inspectDrainState: cleanDrain })
  const follower = createCoordinator({ config: config(), openLeaderSession: async () => followerSession, pullEligibleJob: async () => ({ fencing_token: "2" }), inspectDrainState: cleanDrain })
  assert.equal((await leader.start()).state, "LEADER")
  assert.equal((await follower.start()).state, "FOLLOWER")
  assert.equal(follower.health().ok, false)
  assert.equal((await leader.poll({})).fencing_token, "1")
  await assert.rejects(follower.poll({}), /COORDINATOR_NOT_LEADER/)
})

test("readiness and health reject stale database proof", async () => {
  let clock = Date.parse("2026-01-01T00:00:00.000Z")
  const coordinator = createCoordinator({ config: config(), openLeaderSession: async () => session(true), pullEligibleJob: async () => ({}), inspectDrainState: cleanDrain, now: () => new Date(clock).toISOString() })
  assert.equal(coordinator.health().ok, false)
  await coordinator.start(); assert.equal(coordinator.health().ok, true)
  clock += 1001
  assert.equal(coordinator.readiness().ready, false)
  assert.deepEqual(coordinator.readiness().reasons, ["ATLAS_DATABASE_PROOF_STALE"])
  assert.equal(coordinator.health().ok, false)
  clock -= 2000
  assert.equal(coordinator.readiness().ready, false)
})

test("leader query uncertainty immediately fences coordinator", async () => {
  const db = session(true)
  const coordinator = createCoordinator({ config: config(), openLeaderSession: async () => db, pullEligibleJob: async () => { throw new Error("disconnect") }, inspectDrainState: cleanDrain })
  await coordinator.start()
  await assert.rejects(coordinator.poll({}), /COORDINATOR_LEADER_SESSION_UNCERTAIN/)
  assert.deepEqual(coordinator.status(), { state: "FAILED", leader: false, accepting: false, lastDatabaseProof: coordinator.status().lastDatabaseProof, lastFailure: "disconnect", reconciliation: "WO-AEH-019_REQUIRED_NOT_IMPLEMENTED", coordinatorId: "atlas:aeh:fixture" })
  assert.equal(coordinator.readiness().ready, false)
})

test("empty eligible queue returns typed no-work and preserves leader", async () => {
  const empty = Object.assign(new Error("CLAIM_NOT_ELIGIBLE"), { code: "CLAIM_NOT_ELIGIBLE" })
  const coordinator = createCoordinator({ config: config(), openLeaderSession: async () => session(true), pullEligibleJob: async () => { throw empty }, inspectDrainState: cleanDrain })
  await coordinator.start()
  assert.deepEqual(await coordinator.poll({}), { outcome: "NO_WORK", code: "CLAIM_NOT_ELIGIBLE" })
  assert.equal(coordinator.status().state, "LEADER"); assert.equal(coordinator.readiness().ready, true)
})

test("deterministic claim conflict propagates without leadership demotion", async () => {
  const conflict = Object.assign(new Error("OPERATION_IDEMPOTENCY_CONFLICT"), { code: "OPERATION_IDEMPOTENCY_CONFLICT" })
  const coordinator = createCoordinator({ config: config(), openLeaderSession: async () => session(true), pullEligibleJob: async () => { throw conflict }, inspectDrainState: cleanDrain })
  await coordinator.start()
  await assert.rejects(coordinator.poll({}), error => error === conflict)
  assert.equal(coordinator.status().state, "LEADER"); assert.equal(coordinator.status().leader, true)
  assert.equal(coordinator.readiness().ready, true)
})

test("deterministic validation rejection preserves leadership", async () => {
  const invalid = Object.assign(new Error("CLAIM_TTL_INVALID"), { code: "CLAIM_TTL_INVALID" })
  const coordinator = createCoordinator({ config: config(), openLeaderSession: async () => session(true), pullEligibleJob: async () => { throw invalid }, inspectDrainState: cleanDrain })
  await coordinator.start()
  await assert.rejects(coordinator.poll({}), error => error === invalid)
  assert.equal(coordinator.status().leader, true); assert.equal(coordinator.readiness().ready, true)
})

test("startup lock query failure never becomes healthy", async () => {
  const db = { async query() { throw new Error("connection lost") }, async release() {} }
  const coordinator = createCoordinator({ config: config(), openLeaderSession: async () => db, pullEligibleJob: async () => ({}), inspectDrainState: cleanDrain })
  await assert.rejects(coordinator.start(), /COORDINATOR_LEADER_SESSION_UNCERTAIN/)
  assert.equal(coordinator.status().state, "FAILED"); assert.equal(coordinator.health().ok, false)
})

test("health probe uncertainty fences an established leader", async () => {
  const db = session(true)
  const coordinator = createCoordinator({ config: config(), openLeaderSession: async () => db, pullEligibleJob: async () => ({}), inspectDrainState: cleanDrain })
  await coordinator.start(); db.query = async () => { throw new Error("probe disconnected") }
  await assert.rejects(coordinator.probeDatabase(), /COORDINATOR_LEADER_SESSION_UNCERTAIN/)
  assert.equal(coordinator.status().state, "FAILED"); assert.equal(coordinator.health().ok, false)
})

test("replacement inspection uncertainty fences instead of unlocking", async () => {
  const db = session(true)
  const coordinator = createCoordinator({ config: config(), openLeaderSession: async () => db, pullEligibleJob: async () => ({}), inspectDrainState: async () => { throw new Error("inspection disconnected") } })
  await coordinator.start()
  await assert.rejects(coordinator.beginReplacement(), /COORDINATOR_LEADER_SESSION_UNCERTAIN/)
  assert.equal(coordinator.status().state, "FAILED")
  assert.equal(db.calls.some((sql) => sql.includes("pg_advisory_unlock")), false)
})

test("unlock false is a typed already-lost fenced failure", async () => {
  const db = session(true, false)
  const coordinator = createCoordinator({ config: config(), openLeaderSession: async () => db, pullEligibleJob: async () => ({}), inspectDrainState: cleanDrain })
  await coordinator.start()
  await assert.rejects(coordinator.beginReplacement(), /COORDINATOR_LEADERSHIP_ALREADY_LOST/)
  assert.equal(coordinator.status().state, "FAILED"); assert.equal(coordinator.status().leader, false); assert.equal(coordinator.status().accepting, false)
})

test("readiness and safe replacement fence unresolved work", async () => {
  const db = session(true); let drain = { activeLeaseCount: 1, ambiguousAttemptCount: 0 }
  const coordinator = createCoordinator({ config: config(), openLeaderSession: async () => db, pullEligibleJob: async () => ({}), inspectDrainState: async () => drain })
  assert.equal(coordinator.readiness().ready, false)
  await coordinator.start(); assert.equal(coordinator.readiness().ready, true)
  await assert.rejects(coordinator.beginReplacement(), /ACTIVE_LEASES_REMAIN/)
  assert.equal(coordinator.status().state, "DRAINING")
  drain = { activeLeaseCount: 0, ambiguousAttemptCount: 0 }
  assert.equal((await coordinator.beginReplacement()).state, "STOPPED")
})

test("clean replacement releases advisory lock and session", async () => {
  const db = session(true), coordinator = createCoordinator({ config: config(), openLeaderSession: async () => db, pullEligibleJob: async () => ({}), inspectDrainState: cleanDrain })
  await coordinator.start(); const stopped = await coordinator.beginReplacement()
  assert.equal(stopped.state, "STOPPED"); assert.equal(db.released, true)
  assert.ok(db.calls.some((sql) => sql.includes("pg_advisory_unlock")))
})

test("ambiguous attempts block replacement on the explicit WO019 dependency", async () => {
  const db = session(true), coordinator = createCoordinator({ config: config(), openLeaderSession: async () => db, pullEligibleJob: async () => ({}), inspectDrainState: async () => ({ activeLeaseCount: 0, ambiguousAttemptCount: 1 }) })
  await coordinator.start()
  await assert.rejects(coordinator.beginReplacement(), /COORDINATOR_RECONCILIATION_REQUIRED_WO_AEH_019/)
  assert.equal(coordinator.status().reconciliation, "WO-AEH-019_REQUIRED_NOT_IMPLEMENTED")
})

test("package binds WO016 and templates safe restart without activation", () => {
  const adapter = readFileSync("lib/execution-control/coordinator/index.ts", "utf8")
  const service = readFileSync("config/ai-evalops-harness/coordinator/aeh-coordinator.service.template", "utf8")
  assert.match(adapter, /pullEligibleJob/); assert.doesNotMatch(adapter, /issue.?357/i)
  assert.match(service, /Restart=on-failure/); assert.match(service, /NoNewPrivileges=true/)
  assert.doesNotMatch(service, /DATABASE_URL=|Password=|Token=/i)
})
