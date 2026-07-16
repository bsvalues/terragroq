import { spawnSync } from "node:child_process"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"

import { afterEach, describe, expect, it } from "vitest"

import {
  ReservationAwareHandoffError,
  applyReservationAwareHandoff,
  inspectReservationAwareHandoffStore,
  planReservationAwareHandoff,
} from "../scripts/multi-agent-operator/reservation-aware-handoff.mjs"
import { createReservationAwareHandoffHostVerifier } from "../scripts/multi-agent-operator/reservation-aware-handoff-host.mjs"
import { acquireLaneLease, checkpointLaneLease } from "../scripts/multi-agent-operator/lane-lease-checkpoint.mjs"
import { acquireReservations } from "../scripts/multi-agent-operator/reservation-ledger.mjs"

const HEAD = "a".repeat(40)
const roots: string[] = []

function request(overrides: Record<string, unknown> = {}) {
  return {
    schemaVersion: 1,
    artifactType: "MULTI_AGENT_RESERVATION_AWARE_HANDOFF_REQUEST",
    handoffId: "handoff-mao-026-001",
    storeId: "handoff-store-mao-001",
    workOrderId: "WO-MAO-026",
    laneId: "lane-mao-026",
    repository: "bsvalues/terragroq",
    workspacePath: "/operator/worktrees/lane-mao-026",
    branch: "codex/mao-reservation-handoff-026",
    expectedSequence: 0,
    sourceRole: "BUILDER",
    targetRole: "REVIEWER",
    roleAssignments: {
      builder: "builder-mao-026",
      reviewer: "reviewer-mao-026",
      remediator: "builder-mao-026",
      verifier: "verifier-mao-026",
    },
    reservation: {
      reservationSetId: "reservation-mao-026",
      holderWorkerId: "builder-mao-026",
      fencingToken: 7,
      ledgerVersion: 11,
      released: false,
    },
    lease: {
      workerId: "builder-mao-026",
      fencingToken: 13,
      checkpointSequence: 17,
      status: "ACTIVE",
    },
    workspace: {
      ownerWorkerId: "builder-mao-026",
      clean: true,
      headCommitSha: HEAD,
      checkpointHeadCommitSha: HEAD,
    },
    evidenceEventId: "evidence-mao-026-001",
    idempotencyKey: "handoff-operation-001",
    ...overrides,
  }
}

function trust() {
  return {
    verifyHandoffBinding: (binding: Record<string, unknown>) => ({ verified: true, ...binding }),
  }
}

function workspace() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "mao-handoff-"))
  roots.push(root)
  return { root, store: path.join(root, "state", "handoffs.json") }
}

function git(repository: string, ...args: string[]) {
  const result = spawnSync("git", ["-C", repository, ...args], { encoding: "utf8" })
  if (result.status !== 0) throw new Error(result.stderr)
  return result.stdout.trim()
}

function next(previous: ReturnType<typeof request>, sourceRole: string, targetRole: string, sequence: number) {
  return request({
    storeId: previous.storeId,
    workOrderId: previous.workOrderId,
    laneId: previous.laneId,
    repository: previous.repository,
    workspacePath: previous.workspacePath,
    branch: previous.branch,
    sourceRole,
    targetRole,
    expectedSequence: sequence,
    handoffId: `handoff-mao-026-${String(sequence + 1).padStart(3, "0")}`,
    evidenceEventId: `evidence-mao-026-${String(sequence + 1).padStart(3, "0")}`,
    idempotencyKey: `handoff-operation-${String(sequence + 1).padStart(3, "0")}`,
    roleAssignments: previous.roleAssignments,
    reservation: previous.reservation,
    lease: previous.lease,
    workspace: previous.workspace,
  })
}

function expectWall(value: unknown, code: string, detail?: string) {
  try {
    planReservationAwareHandoff(value)
    throw new Error("expected handoff wall")
  } catch (error) {
    expect(error).toBeInstanceOf(ReservationAwareHandoffError)
    expect(error).toMatchObject({ code, ...(detail ? { detail } : {}) })
  }
}

afterEach(() => {
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true })
})

describe("reservation-aware role handoff", () => {
  it("plans deterministic builder-to-reviewer handoff without authority or release", () => {
    const first = planReservationAwareHandoff(request())
    const second = planReservationAwareHandoff(structuredClone(request()))
    expect(second).toEqual(first)
    expect(first).toMatchObject({
      sourceRole: "BUILDER",
      targetRole: "REVIEWER",
      accessMode: "READ_ONLY",
      writeHolderWorkerId: "builder-mao-026",
      reservationAction: "RETAIN",
      leaseAction: "RETAIN",
      planningOnly: true,
      persistencePerformed: false,
      reservationReleased: false,
      leaseReleased: false,
      secondWriterEnabled: false,
      authorityGranted: false,
      ownerOperationsRequired: false,
    })
    expect(first.planHash).toMatch(/^[a-f0-9]{64}$/)
  })

  it("persists the complete builder-reviewer-remediator-reviewer-verifier chain", () => {
    const { store } = workspace()
    const builderToReviewer = request()
    const reviewerToRemediator = next(builderToReviewer, "REVIEWER", "REMEDIATOR", 1)
    const remediationHead = "b".repeat(40)
    const remediatorToReviewer = {
      ...next(reviewerToRemediator, "REMEDIATOR", "REVIEWER", 2),
      lease: { ...reviewerToRemediator.lease, checkpointSequence: 18 },
      workspace: {
        ...reviewerToRemediator.workspace,
        headCommitSha: remediationHead,
        checkpointHeadCommitSha: remediationHead,
      },
    }
    const reviewerToVerifier = next(remediatorToReviewer, "REVIEWER", "VERIFIER", 3)

    expect(applyReservationAwareHandoff(store, builderToReviewer, trust())).toMatchObject({
      sequence: 1, targetRole: "REVIEWER", targetWorkerId: "reviewer-mao-026", accessMode: "READ_ONLY",
    })
    expect(applyReservationAwareHandoff(store, reviewerToRemediator, trust())).toMatchObject({
      sequence: 2, targetRole: "REMEDIATOR", targetWorkerId: "builder-mao-026",
      accessMode: "ORIGINAL_WRITER_CONTINUATION", writeHolderWorkerId: "builder-mao-026",
      secondWriterEnabled: false,
    })
    expect(applyReservationAwareHandoff(store, remediatorToReviewer, trust())).toMatchObject({
      sequence: 3, targetRole: "REVIEWER", accessMode: "READ_ONLY",
      checkpointSequence: 18, checkpointHeadCommitSha: remediationHead,
    })
    expect(applyReservationAwareHandoff(store, reviewerToVerifier, trust())).toMatchObject({
      sequence: 4, targetRole: "VERIFIER", targetWorkerId: "verifier-mao-026", accessMode: "READ_ONLY",
      reservationReleased: false, leaseReleased: false, authorityGranted: false,
    })
    expect(inspectReservationAwareHandoffStore(store, "handoff-store-mao-001")).toMatchObject({
      version: 4,
      lanes: [{ sequence: 4, activeRole: "VERIFIER", activeWorkerId: "verifier-mao-026",
        writeHolderWorkerId: "builder-mao-026", reservationFencingToken: 7, leaseFencingToken: 13 }],
      operations: expect.arrayContaining([expect.objectContaining({ idempotencyKey: "handoff-operation-004" })]),
    })
  })

  it("makes exact delivery idempotent and rejects key reuse or stale sequence", () => {
    const { store } = workspace()
    const value = request()
    const first = applyReservationAwareHandoff(store, value, trust())
    expect(applyReservationAwareHandoff(store, value, trust())).toMatchObject({
      sequence: first.sequence, idempotent: true,
    })
    expect(() => applyReservationAwareHandoff(store, { ...value, targetRole: "VERIFIER" }, trust()))
      .toThrow("HANDOFF_IDEMPOTENCY_WALL")
    expect(() => applyReservationAwareHandoff(store,
      { ...next(value, "REVIEWER", "VERIFIER", 1), expectedSequence: 0 }, trust()))
      .toThrow("HANDOFF_SEQUENCE_WALL")
  })

  it("requires exact live host verification before persistence", () => {
    const { store } = workspace()
    expect(() => applyReservationAwareHandoff(store, request())).toThrow("HOST_VERIFIER_REQUIRED")
    expect(() => applyReservationAwareHandoff(store, request(), {
      verifyHandoffBinding: (binding: Record<string, unknown>) => ({ verified: true, ...binding, branch: "codex/foreign" }),
    })).toThrow("EXACT_LIVE_BINDING_REQUIRED")
    expect(fs.existsSync(store)).toBe(false)
  })

  it("integrates exact live reservation, lease, workspace, branch, and state-root truth", () => {
    const { root } = workspace()
    const repository = path.join(root, "repository")
    const stateRoot = path.join(root, "approved-state")
    const reservationLedger = path.join(stateRoot, "reservations.json")
    const leaseStore = path.join(stateRoot, "leases.json")
    const handoffStore = path.join(stateRoot, "handoffs.json")
    const hold = "holder-material-mao-026"
    fs.mkdirSync(repository)
    spawnSync("git", ["init", "-b", "codex/mao-reservation-handoff-026", repository], { encoding: "utf8" })
    git(repository, "config", "user.email", "operator@example.invalid")
    git(repository, "config", "user.name", "WilliamOS Test")
    fs.writeFileSync(path.join(repository, "proof.txt"), "handoff proof\n")
    git(repository, "add", "proof.txt")
    git(repository, "commit", "-m", "test: establish handoff checkpoint")
    git(repository, "remote", "add", "origin", "https://github.com/bsvalues/terragroq.git")
    const head = git(repository, "rev-parse", "HEAD")

    const reservation = acquireReservations(reservationLedger, "ledger-mao-026", {
      schemaVersion: 1,
      artifactType: "MULTI_AGENT_RESERVATION_ACQUIRE_REQUEST",
      laneId: "lane-mao-026",
      holderToken: hold,
      reservationSet: {
        schemaVersion: 1,
        artifactType: "MULTI_AGENT_RESERVATION_SET",
        reservationSetId: "reservation-mao-026",
        workerId: "builder-mao-026",
        workOrderId: "WO-MAO-026",
        reservations: { paths: ["scripts/multi-agent-operator"], contracts: [], environments: [], repositories: [], protectedResources: [] },
      },
    })
    expect(reservation.status).toBe("RESERVATION_ACQUIRED")
    const lease = acquireLaneLease(leaseStore, "lease-store-mao-026", {
      schemaVersion: 1,
      artifactType: "MULTI_AGENT_LANE_LEASE_ACQUIRE_REQUEST",
      workOrderId: "WO-MAO-026",
      laneId: "lane-mao-026",
      workerId: "builder-mao-026",
      idempotencyKey: "acquire-mao-026",
      holderToken: hold,
      leaseDurationMs: 60_000,
      checkpointEvidence: { headCommitSha: head },
    }, { now: () => 1_000 })
    expect(lease.status).toBe("LANE_LEASE_ACQUIRED")

    const rFence = reservation.fencingToken
    const lFence = lease.fencingToken
    const value = request({
      workspacePath: repository,
      reservation: { ...request().reservation, fencingToken: rFence, ledgerVersion: reservation.ledgerVersion },
      lease: { ...request().lease, fencingToken: lFence, checkpointSequence: lease.checkpointSequence },
      workspace: { ...request().workspace, headCommitSha: head, checkpointHeadCommitSha: head },
    })
    const verifier = createReservationAwareHandoffHostVerifier({
      approvedStateRoot: stateRoot,
      reservationLedgerPath: reservationLedger,
      reservationLedgerId: "ledger-mao-026",
      laneLeaseStorePath: leaseStore,
      laneLeaseStoreId: "lease-store-mao-026",
      now: () => 1_500,
    })
    const builderToReviewer = applyReservationAwareHandoff(handoffStore, value, verifier)
    expect(builderToReviewer).toMatchObject({
      sequence: 1,
      targetRole: "REVIEWER",
      authorityGranted: false,
      reservationReleased: false,
      leaseReleased: false,
    })
    const reviewerToRemediator = next(value, "REVIEWER", "REMEDIATOR", 1)
    expect(applyReservationAwareHandoff(handoffStore, reviewerToRemediator, verifier)).toMatchObject({
      sequence: 2, targetRole: "REMEDIATOR", accessMode: "ORIGINAL_WRITER_CONTINUATION",
    })

    fs.writeFileSync(path.join(repository, "proof.txt"), "remediated handoff proof\n")
    git(repository, "add", "proof.txt")
    git(repository, "commit", "-m", "fix: advance remediation checkpoint")
    const remediationHead = git(repository, "rev-parse", "HEAD")
    const checkpoint = checkpointLaneLease(leaseStore, "lease-store-mao-026", {
      schemaVersion: 1,
      artifactType: "MULTI_AGENT_LANE_CHECKPOINT_REQUEST",
      workOrderId: "WO-MAO-026",
      laneId: "lane-mao-026",
      workerId: "builder-mao-026",
      idempotencyKey: "checkpoint-mao-026",
      holderToken: hold,
      fencingToken: lFence,
      expectedCheckpointSequence: lease.checkpointSequence,
      transition: { from: "LEASED", to: "PROVIDER_DISPATCHED", reasonCode: null, failureClass: null,
        authorityGap: { present: false, condition: null, conditionRef: null } },
      evidence: { headCommitSha: remediationHead },
    }, { now: () => 2_000 })
    expect(checkpoint.status).toBe("LANE_CHECKPOINT_WRITTEN")
    const remediatorToReviewer = {
      ...next(reviewerToRemediator, "REMEDIATOR", "REVIEWER", 2),
      lease: { ...reviewerToRemediator.lease, checkpointSequence: checkpoint.checkpointSequence },
      workspace: { ...reviewerToRemediator.workspace, headCommitSha: remediationHead,
        checkpointHeadCommitSha: remediationHead },
    }
    expect(applyReservationAwareHandoff(handoffStore, remediatorToReviewer, verifier)).toMatchObject({
      sequence: 3, targetRole: "REVIEWER", checkpointHeadCommitSha: remediationHead,
    })
    expect(() => applyReservationAwareHandoff(path.join(root, "outside.json"), value, verifier))
      .toThrow("STORE_PATH_OUTSIDE_APPROVED_ROOT")
    const outside = path.join(root, "outside-state")
    fs.mkdirSync(outside)
    fs.symlinkSync(outside, path.join(stateRoot, "escape"), "dir")
    expect(() => applyReservationAwareHandoff(path.join(stateRoot, "escape", "handoffs.json"), value, verifier))
      .toThrow("STORE_PATH_OUTSIDE_APPROVED_ROOT")
  })

  it.each([
    ["released reservation", { reservation: { ...request().reservation, released: true } }, "HANDOFF_RESERVATION_WALL"],
    ["foreign reservation holder", { reservation: { ...request().reservation, holderWorkerId: "reviewer-mao-026" } }, "HANDOFF_RESERVATION_WALL"],
    ["inactive lease", { lease: { ...request().lease, status: "RELEASED" } }, "HANDOFF_LEASE_WALL"],
    ["foreign lease holder", { lease: { ...request().lease, workerId: "reviewer-mao-026" } }, "HANDOFF_LEASE_WALL"],
    ["dirty workspace", { workspace: { ...request().workspace, clean: false } }, "HANDOFF_WORKSPACE_WALL"],
    ["head drift", { workspace: { ...request().workspace, headCommitSha: "b".repeat(40) } }, "HANDOFF_WORKSPACE_WALL"],
  ])("rejects %s", (_name, override, code) => expectWall(request(override), code))

  it("rejects a second writer and invalid role transitions", () => {
    expectWall(request({
      roleAssignments: { ...request().roleAssignments, remediator: "remediator-mao-026" },
    }), "HANDOFF_ROLE_WALL", "REMEDIATOR_MUST_EQUAL_BUILDER")
    expectWall(request({
      roleAssignments: { ...request().roleAssignments, reviewer: "builder-mao-026" },
    }), "HANDOFF_ROLE_WALL", "READ_ONLY_ROLE_INDEPENDENCE_REQUIRED")
    expectWall(request({ sourceRole: "BUILDER", targetRole: "REMEDIATOR" }), "HANDOFF_TRANSITION_WALL")
    expectWall(request({ sourceRole: "VERIFIER", targetRole: "BUILDER" }), "HANDOFF_TRANSITION_WALL")
  })

  it("retains exact lane, repository, workspace, branch, and role identities", () => {
    const { store } = workspace()
    const firstRequest = request()
    applyReservationAwareHandoff(store, firstRequest, trust())
    const secondRequest = next(firstRequest, "REVIEWER", "REMEDIATOR", 1)

    for (const [field, value] of [
      ["workOrderId", "WO-MAO-999"],
      ["laneId", "lane-mao-other"],
      ["repository", "bsvalues/other"],
      ["workspacePath", "/tmp/other"],
      ["branch", "codex/other"],
    ] as const) {
      const changed = { ...secondRequest, [field]: value }
      expect(() => applyReservationAwareHandoff(store, changed, trust())).toThrow("HANDOFF_SOURCE_WALL")
    }

    for (const [role, worker] of [
      ["reviewer", "reviewer-other"],
      ["verifier", "verifier-other"],
    ] as const) {
      const changed = { ...secondRequest, roleAssignments: { ...secondRequest.roleAssignments, [role]: worker } }
      expect(() => applyReservationAwareHandoff(store, changed, trust())).toThrow("HANDOFF_SOURCE_WALL")
    }
  })

  it("binds every subsequent handoff to exact persisted fences and active role", () => {
    const { store } = workspace()
    const first = request()
    applyReservationAwareHandoff(store, first, trust())
    const nextRequest = next(first, "REVIEWER", "REMEDIATOR", 1)
    expect(() => applyReservationAwareHandoff(store, {
      ...nextRequest,
      reservation: { ...nextRequest.reservation, fencingToken: 8 },
    }, trust())).toThrow("EXACT_CURRENT_STATE_REQUIRED")
    expect(() => applyReservationAwareHandoff(store, {
      ...nextRequest,
      lease: { ...nextRequest.lease, checkpointSequence: 18 },
    }, trust())).toThrow("EXACT_CURRENT_STATE_REQUIRED")
    expect(() => applyReservationAwareHandoff(store, {
      ...nextRequest,
      sourceRole: "BUILDER",
    }, trust())).toThrow("HANDOFF_TRANSITION_WALL")
  })

  it("fails closed on unknown, missing, malformed, and authority-minting input", () => {
    expectWall({ ...request(), command: "release reservations" }, "HANDOFF_UNKNOWN_FIELD_WALL")
    const missing = request() as Partial<ReturnType<typeof request>>
    delete missing.evidenceEventId
    expectWall(missing, "HANDOFF_MISSING_FIELD_WALL")
    expectWall({ ...request(), schemaVersion: 2 }, "HANDOFF_INPUT_WALL")
    expectWall({ ...request(), authorityGranted: true }, "HANDOFF_AUTHORITY_MINT_WALL")
  })

  it("fails closed on corrupted durable state", () => {
    const { store } = workspace()
    fs.mkdirSync(path.dirname(store), { recursive: true })
    fs.writeFileSync(store, JSON.stringify({ schemaVersion: 1, artifactType: "MULTI_AGENT_RESERVATION_AWARE_HANDOFF_STORE",
      storeId: "handoff-store-mao-001", version: 1, lanes: [null], operations: [] }))
    expect(() => applyReservationAwareHandoff(store, request(), trust())).toThrow("HANDOFF_TYPE_WALL")
  })

  it("rejects a resealed stored result that claims authority or releases a fence", () => {
    const { store } = workspace()
    applyReservationAwareHandoff(store, request(), trust())
    const persisted = JSON.parse(fs.readFileSync(store, "utf8"))
    persisted.operations[0].result.authorityGranted = true
    fs.writeFileSync(store, JSON.stringify(persisted))
    expect(() => inspectReservationAwareHandoffStore(store, "handoff-store-mao-001"))
      .toThrow("HANDOFF_STORE_WALL")
  })

  it("rejects duplicate and inconsistent durable history", () => {
    const { store } = workspace()
    applyReservationAwareHandoff(store, request(), trust())
    const persisted = JSON.parse(fs.readFileSync(store, "utf8"))
    persisted.operations.push(structuredClone(persisted.operations[0]))
    persisted.version = 2
    fs.writeFileSync(store, JSON.stringify(persisted))
    expect(() => inspectReservationAwareHandoffStore(store, "handoff-store-mao-001"))
      .toThrow("UNIQUE_LINEAR_HISTORY_REQUIRED")

    persisted.operations.pop()
    persisted.version = 1
    persisted.lanes[0].activeRole = "VERIFIER"
    persisted.lanes[0].activeWorkerId = "verifier-mao-026"
    fs.writeFileSync(store, JSON.stringify(persisted))
    expect(() => inspectReservationAwareHandoffStore(store, "handoff-store-mao-001"))
      .toThrow("CONSISTENT_LINEAR_HISTORY_REQUIRED")

    persisted.lanes[0].activeRole = "REVIEWER"
    persisted.lanes[0].activeWorkerId = "foreign-reader"
    persisted.lanes[0].reviewerWorkerId = "foreign-reader"
    persisted.operations[0].result.targetWorkerId = "foreign-reader"
    fs.writeFileSync(store, JSON.stringify(persisted))
    expect(() => inspectReservationAwareHandoffStore(store, "handoff-store-mao-001"))
      .toThrow("VALID_NON_AUTHORITY_RESULT_REQUIRED")

    const fresh = workspace().store
    applyReservationAwareHandoff(fresh, request(), trust())
    const alteredTrust = JSON.parse(fs.readFileSync(fresh, "utf8"))
    alteredTrust.operations[0].result.trustBindingHash = "f".repeat(64)
    fs.writeFileSync(fresh, JSON.stringify(alteredTrust))
    expect(() => inspectReservationAwareHandoffStore(fresh, "handoff-store-mao-001"))
      .toThrow("VALID_NON_AUTHORITY_RESULT_REQUIRED")

    const inactiveRole = workspace().store
    applyReservationAwareHandoff(inactiveRole, request(), trust())
    const alteredRole = JSON.parse(fs.readFileSync(inactiveRole, "utf8"))
    alteredRole.lanes[0].verifierWorkerId = "verifier-foreign"
    fs.writeFileSync(inactiveRole, JSON.stringify(alteredRole))
    expect(() => inspectReservationAwareHandoffStore(inactiveRole, "handoff-store-mao-001"))
      .toThrow("CONSISTENT_LINEAR_HISTORY_REQUIRED")
  })

  it("CLI plans deterministically and fails apply before mutation without host trust", () => {
    const { root, store } = workspace()
    const inputFile = path.join(root, "input.json")
    fs.writeFileSync(inputFile, JSON.stringify(request()))
    const cli = path.resolve("scripts/multi-agent-operator/reservation-aware-handoff-cli.mjs")
    const planned = spawnSync(process.execPath, [cli, "plan", inputFile], { encoding: "utf8", env: {} })
    expect(planned.status).toBe(0)
    expect(JSON.parse(planned.stdout)).toMatchObject({ ok: true, planningOnly: true,
      reservationReleased: false, leaseReleased: false, authorityGranted: false })
    const applied = spawnSync(process.execPath, [cli, "apply", store, inputFile], { encoding: "utf8", env: {} })
    expect(applied.status).toBe(2)
    expect(JSON.parse(applied.stdout)).toMatchObject({ ok: false, code: "HANDOFF_TRUST_WALL",
      detail: "HOST_VERIFIER_REQUIRED", persistencePerformed: false,
      reservationReleased: false, leaseReleased: false, secondWriterEnabled: false, authorityGranted: false })
    expect(fs.existsSync(store)).toBe(false)
  })
})
