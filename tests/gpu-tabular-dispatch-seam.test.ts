import { describe, expect, it } from "vitest"
import path from "node:path"
import { pathToFileURL } from "node:url"

import * as registry from "@/components/operator/multi-agent-capability-registry"
import * as adapter from "../scripts/execution-fabric/gpu-tabular-capability.mjs"
import { canonicalEvidenceLedgerJson } from "../scripts/multi-agent-operator/evidence-ledger.mjs"
import * as lifecycle from "../scripts/multi-agent-operator/lifecycle-state-machine.mjs"

const seam = await import(
  pathToFileURL(path.resolve("scripts/execution-fabric/gpu-tabular-dispatch.mjs")).href)

const HEALTHY = { ok: true, deviceHealthy: true, deviceQuerySucceeded: true,
  cumlVersion: "26.08.00", cudfVersion: "26.08.01" }
const DEVICE_DOWN = { ok: true, deviceHealthy: false, deviceQuerySucceeded: true }
const NODE_DOWN = { ok: false, deviceHealthy: false, deviceQuerySucceeded: false,
  probeError: "binding-probe-unreachable rc=-1" }

const WO = { id: 77, ref: "WO-TEST-77", status: "active", userId: "owner-1",
  allowedFiles: ["scripts/execution-fabric"] }
const GRANT = { id: 9, ref: "GRANT-TEST-9", allowedActions: ["scripts/execution-fabric"],
  expiresAt: new Date(Date.now() + 3_600_000) }

function workerResult({ status = "SUCCEEDED", device = "cuda", workload = "regression" } = {}) {
  return JSON.stringify({ schemaVersion: 1, status, workload, device,
    value: { rmse: 1.0 }, workloadSeconds: 2.5, totalSeconds: 4.0,
    binding: HEALTHY, syntheticDataOnly: true, promoted: false })
}

/** Fake bindings: in-memory ledger that honors the real module's idempotency semantics. */
function fakeBindings() {
  const events = new Map()
  const appends: string[] = []
  let created = false
  return {
    events, appends,
    canonical: canonicalEvidenceLedgerJson,
    lifecycle,
    options: {},
    ledgerMod: {
      appendEvidenceEvent(_dir, _id, input) {
        created = true
        if (events.has(input.eventId)) {
          return { ok: true, idempotent: true, event: events.get(input.eventId) }
        }
        const event = Object.freeze({ ...input, eventHash: "f".repeat(64) })
        events.set(input.eventId, event)
        appends.push(input.eventType)
        return { ok: true, idempotent: false, event }
      },
      inspectVerifiedEvidenceEvent(_dir, _id, input) {
        if (!created) return { ok: false, status: "EVIDENCE_LEDGER_NOT_FOUND" }
        const event = events.get(input.eventId)
        if (!event) return { ok: false, status: "EVIDENCE_EVENT_NOT_FOUND_WALL" }
        return { ok: true, event }
      },
    },
  }
}

/** Fake lease store honoring ACTIVE-duplicate / fresh / released semantics. */
function fakeLeases({ activeLane = false } = {}) {
  const lanes = new Map()
  if (activeLane) {
    const lane = { workOrderId: WO.ref, laneId: "preset", status: "ACTIVE",
      expiresAt: new Date(Date.now() + 600_000).toISOString(), fencingToken: 1 }
    lanes.set(`${WO.ref}|preset`, lane)
  }
  let nextFence = 1
  return {
    lanes,
    acquireLaneLease(_path, _store, request) {
      const key = `${request.workOrderId}|${request.laneId}`
      if (lanes.has(key)) return { ok: false, status: "LANE_LEASE_ALREADY_EXISTS" }
      const lane = { workOrderId: request.workOrderId, laneId: request.laneId,
        workerId: request.workerId, status: "ACTIVE", fencingToken: nextFence++,
        expiresAt: new Date(Date.now() + 600_000).toISOString(), checkpoint: { sequence: 1 } }
      lanes.set(key, lane)
      return { ok: true, workOrderId: request.workOrderId, laneId: request.laneId,
        workerId: request.workerId, fencingToken: lane.fencingToken, checkpointSequence: 1 }
    },
    inspectLaneLeaseStore() { return { ok: true, lanes: [...lanes.values()] } },
    expireLaneLease(_path, _store, request) {
      const lane = lanes.get(`${request.workOrderId}|${request.laneId}`)
      if (!lane || lane.fencingToken !== request.expectedFencingToken) {
        return { ok: false, status: "LANE_LEASE_FENCE_CONFLICT" }
      }
      lane.status = "EXPIRED"
      return { ok: true, status: "LANE_LEASE_EXPIRED_RECORDED" }
    },
    releaseLaneLease(_path, _store, request) {
      const lane = lanes.get(`${request.workOrderId}|${request.laneId}`)
      if (lane) lane.status = "RELEASED"
      return { ok: true, status: "LANE_LEASE_RELEASED" }
    },
    reclaimLaneLease() { return { ok: false, status: "LANE_LEASE_NOT_EXPIRED" } },
  }
}

/** Fake ssh: records commands, replies to the run with a canned worker result. */
function fakeSsh({ runStdout = workerResult(), nodeAlive = true, capture = [] } = {}) {
  return async (node, { command, stdinText }) => {
    capture.push({ node, command, stdinText })
    if (!nodeAlive) return { exitCode: -1, stdout: "", stderr: "ssh: connect: unreachable" }
    if (command.includes("resident-gpu-tabular-worker.py") && stdinText) {
      return { exitCode: 0, stdout: runStdout, stderr: "" }
    }
    if (command.startsWith("cat ")) {
      return { exitCode: 1, stdout: "", stderr: "" } // no adopted result by default
    }
    return { exitCode: 0, stdout: "", stderr: "" }
  }
}

function baseDeps(overrides: Record<string, unknown> = {}) {
  const queries: Array<{ sql: string; params: unknown[] }> = []
  const deps = {
    registry,
    adapter,
    bindings: fakeBindings(),
    leaseMod: fakeLeases(),
    ssh: fakeSsh(),
    now: () => new Date("2026-09-11T20:00:00.000Z"),
    healthProbe: HEALTHY,
    loadWorkOrder: async () => WO,
    loadActiveGrant: async () => GRANT,
    captureQueries: queries,
    runQuery: async (sql: string, params: unknown[]) => {
      queries.push({ sql, params })
      if (sql.includes("INSERT INTO evidence_record")) return { rows: [{ id: 501, ref: "EV-GPU-x" }] }
      return { rows: [] }
    },
    ...overrides,
  }
  return deps
}

const submission = { workOrderRef: WO.ref, workload: "regression",
  synthetic: { parcels: 2_500_000, transactions: 20_000_000, seed: 42 } }

describe("gpu tabular dispatch seam: job identity is deterministic", () => {
  it("derives stable ids from the submission and changes them when the submission changes", () => {
    const a = seam.jobDigest(submission)
    const b = seam.jobDigest(JSON.parse(JSON.stringify(submission)))
    expect(a).toBe(b)
    const other = seam.jobDigest({ ...submission, synthetic: { ...submission.synthetic, parcels: 1 } })
    expect(other).not.toBe(a)
    const ids = seam.jobIdentity(a)
    expect(ids.completionEventId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-8[0-9a-f]{3}-[0-9a-f]{12}$/)
    expect(ids.scratchDir).toMatch(/^\/home\/daedalus\/gpu-tabular-bench\/scratch\/[a-f0-9]{32}\/attempt-0$/)
    expect(ids.laneId).toMatch(/^gpu-tab\.[a-f0-9]{24}$/)
    const retry = seam.jobIdentity(a, 1)
    expect(retry.laneId).toBe(`${ids.laneId}.a1`)
    expect(retry.scratchDir).toMatch(/\/attempt-1$/)
    // Completion identity is attempt-free by design: two attempts can never both project output.
    expect(retry.completionEventId).toBe(ids.completionEventId)
    // A different work order reference must never share ids with this one.
    expect(seam.jobIdentity(seam.jobDigest({ ...submission, workOrderRef: "WO-OTHER" })).laneId)
      .not.toBe(ids.laneId)
  })
})

describe("gpu tabular dispatch seam: placement consults the registry and the adapter", () => {
  it("places eligible large workloads on the accelerator with the measured reason", async () => {
    const decision = await seam.preflightPlacement(
      { workload: "regression", rows: 2_500_000, workOrder: WO, grant: GRANT },
      { registry, adapter, health: HEALTHY })
    expect(decision.placement).toBe("CUDA_DEVICE")
    expect(decision.reasonCode).toBe("GPU_ELIGIBLE_ABOVE_MEASURED_THRESHOLD")
    expect(decision.registryAllowed).toBe(true)
    expect(decision.thresholdRows).toBe(50_000)
  })

  it("places below-threshold and refused workloads on the CPU path", async () => {
    const small = await seam.preflightPlacement(
      { workload: "clustering", rows: 10_000, workOrder: WO, grant: GRANT },
      { registry, adapter, health: HEALTHY })
    expect(small.placement).toBe("CPU")
    expect(small.reasonCode).toBe("CPU_BELOW_MEASURED_THRESHOLD")
    const pca = await seam.preflightPlacement(
      { workload: "decomposition", rows: 2_500_000, workOrder: WO, grant: GRANT },
      { registry, adapter, health: HEALTHY })
    expect(pca.placement).toBe("CPU")
    expect(pca.reasonCode).toBe("CPU_MEASURED_NO_GPU_BENEFIT")
  })

  it("keeps anomaly detection screening-only: dispatch refuses it outright", async () => {
    const outcome = await seam.dispatchComputeJob(
      { workOrderRef: WO.ref, workload: "outlier", synthetic: { parcels: 1000, seed: 1 } },
      baseDeps())
    expect(outcome.status).toBe("REFUSED")
    expect(outcome.outcome).toBe("SCREENING_ONLY_NOT_AUTHORITATIVE")
    expect(outcome.executed).toBe(false)
  })

  it("falls back to CPU placement when the device is down, and to authority-missing when the registry denies", async () => {
    const deviceDown = await seam.preflightPlacement(
      { workload: "regression", rows: 2_500_000, workOrder: WO, grant: GRANT },
      { registry, adapter, health: DEVICE_DOWN })
    expect(deviceDown.placement).toBe("CPU")
    expect(deviceDown.reasonCode).toBe("CPU_DEFAULT_BINDING_UNAVAILABLE")

    // A registry denial must route through the adapter's typed authority-missing CPU path, not GPU.
    const denying = { ...registry, evaluateCapabilityDispatch: () => ({ allowed: false,
      reasonCode: "CAPABILITY_NOT_AUTHORIZED" }) }
    const denied = await seam.preflightPlacement(
      { workload: "regression", rows: 2_500_000, workOrder: WO, grant: GRANT },
      { registry: denying, adapter, health: HEALTHY })
    expect(denied.placement).toBe("CPU")
    expect(denied.reasonCode).toBe("CPU_DEFAULT_AUTHORITY_MISSING")
  })

  it("drifts to CPU when the work order files and the grant actions disagree", async () => {
    const drifted = await seam.preflightPlacement(
      { workload: "regression", rows: 2_500_000,
        workOrder: { ...WO, allowedFiles: ["docs"] }, grant: GRANT },
      { registry, adapter, health: HEALTHY })
    expect(drifted.placement).toBe("CPU")
    expect(drifted.reasonCode).toBe("CPU_DEFAULT_TRUST_GATE_DENIED")
  })
})

describe("gpu tabular dispatch seam: execution, cancellation, recovery", () => {
  it("executes end to end: placement event, worker run, completion event, lease release, evidence row", async () => {
    const deps = baseDeps()
    const outcome = await seam.dispatchComputeJob(submission, deps)
    expect(outcome.status).toBe("SUCCEEDED")
    expect(outcome.placement).toBe("CUDA_DEVICE")
    expect(outcome.executed).toBe(true)
    expect(deps.bindings.appends).toEqual(["TRANSITION", "PROVIDER"])
    const queries = deps.captureQueries.map((entry) => entry.sql).join(";")
    expect(queries).toContain("INSERT INTO evidence_record")
    expect(queries).toContain("GPU_TABULAR_COMPUTE_DISPATCHED")
    expect(queries).toContain("UPDATE work_order SET evidence")
    // Lease was released after completion.
    const lane = [...deps.leaseMod.lanes.values()][0]
    expect(lane.status).toBe("RELEASED")
  })

  it("a replay of the same submission never executes twice (ledger guard before any side effect)", async () => {
    const deps = baseDeps()
    const sshCalls: unknown[] = []
    deps.ssh = fakeSsh({ capture: sshCalls })
    const first = await seam.dispatchComputeJob(submission, deps)
    expect(first.status).toBe("SUCCEEDED")
    const runCallsAfterFirst = sshCalls.filter((entry: any) => String(entry?.stdinText ?? "").includes('"action":"run"'))
    expect(runCallsAfterFirst).toHaveLength(1)
    const callsBefore = sshCalls.length

    const replay = await seam.dispatchComputeJob(submission, deps)
    expect(replay.outcome).toBe("IDEMPOTENT_REPLAY")
    expect(replay.executed).toBe(false)
    // The replay performed NO transport side effects at all.
    expect(sshCalls.length).toBe(callsBefore)
  })

  it("an active lane lease for the same job refuses concurrent execution", async () => {
    const deps = baseDeps()
    // Occupy the exact lane the digest computes, ACTIVE and unexpired.
    const digest = seam.jobDigest({ workOrderRef: WO.ref, workload: "regression",
      synthetic: submission.synthetic, devicePolicy: "auto" })
    const ids = seam.jobIdentity(digest)
    deps.leaseMod.lanes.set(`${WO.ref}|${ids.laneId}`, {
      workOrderId: WO.ref, laneId: ids.laneId, status: "ACTIVE",
      expiresAt: new Date(Date.now() + 600_000).toISOString(), fencingToken: 1,
      checkpoint: { sequence: 1 },
    })
    const sshCalls: unknown[] = []
    deps.ssh = fakeSsh({ capture: sshCalls })
    const outcome = await seam.dispatchComputeJob(submission, deps)
    expect(outcome.status).toBe("REFUSED")
    // Either the duplicate guard fired...
    expect(["LANE_LEASE_ACTIVE_DUPLICATE_GUARD", "LANE_LEASE_WALL", "LANE_LEASE_INSPECT_RACE"])
      .toContain(outcome.outcome)
    // ...and no worker was ever started.
    expect(sshCalls.filter((entry: any) => String(entry?.stdinText ?? "").includes('"action":"run"'))).toHaveLength(0)
  })

  it("cancellation reaches the executing workload: cancel file + signal, no result, no evidence", async () => {
    let cancelArmed = false
    const sshCalls: Array<{ command: string; stdinText?: string }> = []
    const deps = baseDeps({
      ssh: async (_node, { command, stdinText }) => {
        sshCalls.push({ command, stdinText })
        if (stdinText?.includes('"action":"run"')) {
          cancelArmed = true // as if the operator cancelled mid-flight
          return { exitCode: 143, stdout: JSON.stringify({ status: "CANCELLED",
            phase: "after-execute-discarded" }), stderr: "" }
        }
        return { exitCode: 0, stdout: "", stderr: "" }
      },
    })
    const outcome = await seam.dispatchComputeJob(
      { ...submission, cancelCheck: () => cancelArmed }, deps)
    expect(outcome.status).toBe("CANCELLED")
    expect(outcome.executed).toBe(true)
    // The seam touched the cancel artifact and signalled the worker's process group.
    const cancelCommands = sshCalls.filter((entry) => entry.command.includes("CANCEL"))
      .map((entry) => entry.command)
    expect(cancelCommands.some((command) => command.includes("touch"))).toBe(true)
    expect(cancelCommands.some((command) => command.includes("kill -TERM"))).toBe(true)
    // No evidence row for cancelled work; lane released; completion event absent so replay re-runs.
    expect(deps.captureQueries).toHaveLength(0)
    expect([...deps.leaseMod.lanes.values()][0].status).toBe("RELEASED")
    const digest = seam.jobDigest({ workOrderRef: WO.ref, workload: "regression",
      synthetic: submission.synthetic, devicePolicy: "auto" })
    expect(deps.bindings.events.has(seam.jobIdentity(digest).completionEventId)).toBe(false)
    // Replaying a CANCELLED job runs a NEW attempt on a fresh lane (the prior attempt produced no
    // output, so retrying cannot duplicate an effect); the completion event id stays attempt-free,
    // so even concurrent attempts can only project once.
    const replay = await seam.dispatchComputeJob(
      { ...submission, cancelCheck: () => true }, deps)
    expect(replay.status).toBe("CANCELLED")
    expect(replay.executed).toBe(true)
    expect(replay.dispatchId).toBeDefined()
    // The attempt lane advanced: two lanes now, base (released) + .a1.
    const laneIds = [...deps.leaseMod.lanes.keys()].map((key) => key.split("|")[1])
    expect(laneIds.some((id) => id.endsWith(".a1"))).toBe(true)
    // Still no completion recorded for the job: the ledger stays truthful about there being no output.
    expect(deps.bindings.events.has(seam.jobIdentity(digest).completionEventId)).toBe(false)
  })

  it("adopts the worker's result file when the channel is lost mid-flight (one effect, no recompute)", async () => {
    // Fresh replay finds no orphan (guard #1b empty); the run then loses its channel and the
    // worker's result file appears afterwards — mid-flight adoption, not orphan adoption.
    let runStarted = false
    const deps = baseDeps({
      ssh: async (_node, { command, stdinText }) => {
        if (stdinText?.includes('"action":"run"')) {
          runStarted = true
          return { exitCode: null, stdout: "", stderr: "killed: channel lost" }
        }
        if (command.includes("result.json")) {
          return runStarted
            ? { exitCode: 0, stdout: `{"orphanAttempt":"attempt-0"}\n${workerResult()}`, stderr: "" }
            : { exitCode: 1, stdout: "", stderr: "" }
        }
        return { exitCode: 0, stdout: "", stderr: "" }
      },
    })
    const outcome = await seam.dispatchComputeJob(submission, deps)
    expect(outcome.status).toBe("SUCCEEDED")
    expect(outcome.outcome).toBe("RECOVERED_ADOPTED_RESULT")
    expect(deps.bindings.appends).toEqual(["TRANSITION", "PROVIDER"])
  })

  it("a replay finds an orphaned result file and adopts it instead of recomputing (dispatcher-death recovery)", async () => {
    // The scenario: first dispatcher ran the worker to completion but died before recording the
    // ledger event. The replay must find result.json, record completion from it, and start NO run.
    const deps = baseDeps({
      ssh: async (_node, { command, stdinText }) => {
        if (stdinText?.includes('"action":"run"')) {
          return { exitCode: 0, stdout: "", stderr: "run must never start on this replay" }
        }
        if (command.includes("result.json")) {
          return { exitCode: 0, stdout: `{"orphanAttempt":"attempt-0"}\n${workerResult()}`, stderr: "" }
        }
        return { exitCode: 0, stdout: "", stderr: "" }
      },
    })
    const outcome = await seam.dispatchComputeJob(submission, deps)
    expect(outcome.status).toBe("SUCCEEDED")
    expect(outcome.outcome).toBe("RECOVERED_ADOPTED_ORPHAN_RESULT")
    expect(outcome.executed).toBe(false)
    // Completion was recorded from the orphan, and the evidence row projected exactly once.
    expect(deps.bindings.appends).toEqual(["PROVIDER"])
    const inserts = deps.captureQueries.filter((entry) => entry.sql.includes("INSERT INTO evidence_record"))
    expect(inserts).toHaveLength(1)
    // A second replay now hits the ledger guard, not the orphan file.
    const second = await seam.dispatchComputeJob(submission, baseDeps({ bindings: deps.bindings }))
    expect(second.outcome).toBe("IDEMPOTENT_REPLAY")
    expect(second.executed).toBe(false)
  })

  it("an expired-active (zombie) lane settles to durable expiry and the next pass advances the attempt", async () => {
    const digest = seam.jobDigest({ workOrderRef: WO.ref, workload: "regression",
      synthetic: submission.synthetic, devicePolicy: "auto" })
    const ids = seam.jobIdentity(digest, 0)
    const deps = baseDeps()
    // A prior dispatcher died mid-flight leaving an ACTIVE lane whose expiry has passed.
    deps.leaseMod.lanes.set(`${WO.ref}|${ids.laneId}`, {
      workOrderId: WO.ref, laneId: ids.laneId, workerId: "daedalus-gpu-tabular", status: "ACTIVE",
      expiresAt: new Date(Date.now() - 1000).toISOString(), fencingToken: 3, checkpoint: { sequence: 1 },
    })
    const first = await seam.dispatchComputeJob(submission, deps)
    expect(first.status).toBe("REFUSED")
    expect(first.outcome).toBe("LANE_LEASE_ZOMBIE_SETTLING_RETRY")
    expect(first.executed).toBe(false)
    // The zombie was settled durably, not silently overwritten.
    expect(deps.leaseMod.lanes.get(`${WO.ref}|${ids.laneId}`).status).toBe("EXPIRED")
    // Next pass: the settled base lane is taken, so the loop advances to a fresh attempt lane.
    const second = await seam.dispatchComputeJob(submission, deps)
    expect(["SUCCEEDED", "FAILED"]).toContain(second.status)
    expect(second.executed).toBe(true)
    const attemptLanes = [...deps.leaseMod.lanes.keys()].map((key) => key.split("|")[1])
    expect(attemptLanes.some((laneId) => laneId.endsWith(".a1"))).toBe(true)
  })

  it("a lost channel with no result records a typed failure and releases the lane", async () => {
    const deps = baseDeps({ ssh: fakeSsh({ nodeAlive: false }) , healthProbe: NODE_DOWN })
    const outcome = await seam.dispatchComputeJob(submission, deps)
    expect(outcome.status).toBe("DISPATCH_INCOMPLETE")
    expect(outcome.outcome).toBe("COMPUTE_CHANNEL_LOST")
    expect(deps.bindings.appends).toContain("FAILURE")
    expect([...deps.leaseMod.lanes.values()][0].status).toBe("RELEASED")
    // The node-unreachable case never reaches evidence projection.
    expect(deps.captureQueries).toHaveLength(0)
  })

  it("a workload failure on the device reports FAILED, records the completion, and fails the evidence row", async () => {
    const deps = baseDeps({ ssh: fakeSsh({ runStdout: JSON.stringify({
      status: "FAILED", phase: "execute", error: "RuntimeError: cuda OOM", deviceSuspect: true }) }) })
    const outcome = await seam.dispatchComputeJob(submission, deps)
    expect(outcome.status).toBe("FAILED")
    const providerEvent = [...deps.bindings.events.values()].find((event: any) => event.eventType === "PROVIDER")
    expect(providerEvent.payload.state).toBe("FAILED")
    expect(providerEvent.payload.reasonCode).toBe("COMPUTE_WORKLOAD_FAILED")
  })

  it("a closed work order is rejected before any placement or transport", async () => {
    const sshCalls: unknown[] = []
    const deps = baseDeps({ loadWorkOrder: async () => ({ ...WO, status: "closed" }),
      ssh: fakeSsh({ capture: sshCalls }) })
    await expect(seam.dispatchComputeJob(submission, deps))
      .rejects.toThrow("COMPUTE_WORK_ORDER_NOT_ACTIVE")
    expect(sshCalls).toHaveLength(0)
  })

  it("a missing work order is rejected; an absent grant degrades placement to CPU (never GPU)", async () => {
    await expect(seam.dispatchComputeJob(submission, baseDeps({ loadWorkOrder: async () => null })))
      .rejects.toThrow("COMPUTE_WORK_ORDER_NOT_FOUND")
    const deps = baseDeps({ loadActiveGrant: async () => null })
    const outcome = await seam.dispatchComputeJob(submission, deps)
    // Executes on CPU (authority missing fails closed) but never on cuda.
    expect(outcome.placement).toBe("CPU")
    expect(outcome.reasonCode).toBe("CPU_DEFAULT_AUTHORITY_MISSING")
  })
})

describe("gpu tabular dispatch seam: boundaries", () => {
  it("the wire protocol names no data source: only shape + seed cross the boundary", async () => {
    const digest = seam.jobDigest({ workOrderRef: WO.ref, workload: "regression",
      synthetic: submission.synthetic, devicePolicy: "auto" })
    const sshCalls: Array<{ stdinText?: string }> = []
    const deps = baseDeps({ ssh: fakeSsh({ capture: sshCalls }) })
    await seam.dispatchComputeJob(submission, deps)
    const runCall = sshCalls.find((entry) => entry.stdinText?.includes('"action":"run"'))
    expect(runCall).toBeTruthy()
    const request = JSON.parse(runCall!.stdinText!)
    expect(Object.keys(request.synthetic).sort()).toEqual(["parcels", "seed", "transactions"])
    expect(JSON.stringify(request)).not.toMatch(/database|connection|dsn|table|query/i)
    void digest
  })

  it("rejects unsupported workloads and invalid synthetic specs before any effect", async () => {
    await expect(seam.dispatchComputeJob({ workOrderRef: WO.ref, workload: "quantum_sort",
      synthetic: { parcels: 10, seed: 1 } }, baseDeps()))
      .rejects.toThrow("COMPUTE_WORKLOAD_UNSUPPORTED")
    await expect(seam.dispatchComputeJob({ workOrderRef: WO.ref, workload: "regression",
      synthetic: { parcels: 0.5, seed: 1 } }, baseDeps()))
      .rejects.toThrow("COMPUTE_SYNTHETIC_SPEC_INVALID")
    await expect(seam.dispatchComputeJob({ workOrderRef: WO.ref, workload: "regression",
      synthetic: { parcels: 999_999_999, seed: 1 } }, baseDeps()))
      .rejects.toThrow("COMPUTE_SYNTHETIC_SPEC_INVALID") // bounded far beyond the measured envelope
  })

  it("dispatch carries no authority-mutation or scope-expansion SQL", async () => {
    const deps = baseDeps()
    await seam.dispatchComputeJob(submission, deps)
    const sql = deps.captureQueries.map((entry) => entry.sql).join("\n").toLowerCase()
    for (const forbidden of ["delete from", "update authority_grant", "update outcome_queue",
      "insert into work_order", "drop "]) {
      expect(sql, forbidden).not.toContain(forbidden)
    }
  })
})
