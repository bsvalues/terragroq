import crypto from "node:crypto"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { spawnSync } from "node:child_process"

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("../scripts/multi-agent-operator/codex-host-session-registry.mjs", async () => (
  import("./fixtures/codex-host-session-registry-fixture.mjs")
))
vi.mock("../scripts/multi-agent-operator/codex-native-bridge-registry.mjs", async () => (
  import("./fixtures/codex-native-bridge-registry-fixture.mjs")
))

import {
  HostedCodexCoordinatorAdapterError,
  cancelHostedCodexNativeAssignment,
  captureHostedCodexNativeEvidence,
  compileHostedCodexCoordinatorAdapter,
  createHostedCodexNativeMessage,
  getHostedCodexNativeAssignmentHandle,
  startHostedCodexNativeAssignment,
} from "../scripts/multi-agent-operator/codex-coordinator-adapter.mjs"
import {
  canonicalJson,
  computeAuthorityContentHash,
} from "../scripts/multi-agent-operator/authority-events.mjs"
import { codexProviderConformanceFixture } from "../scripts/multi-agent-operator/codex-provider-conformance.mjs"
import { validateDispatchEnvelope } from "../scripts/multi-agent-operator/dispatch-envelope.mjs"
import {
  clearTestCodexHostSessionRecords,
  installTestCodexHostSessionRecord,
} from "./fixtures/codex-host-session-registry-fixture.mjs"
import {
  clearTestHostedCodexNativeBridgeRegistry,
  installTestHostedCodexNativeBridge,
  installTestHostedCodexTrustRecord,
} from "./fixtures/codex-native-bridge-registry-fixture.mjs"

const temporaryDirectories: string[] = []
const PROGRAM = "PROGRAM-WILLIAMOS-MULTI-AGENT-OPERATOR-001"
const GOAL = "GOAL-WOS-MULTI-AGENT-OPERATOR-001"
const LOOP = "LOOP-WOS-MULTI-AGENT-OPERATOR-001"
const HOST_SESSION_ID = "native-coordinator-mao-030"
const ROLES = {
  coordinator: "codex-coordinator",
  builder: "codex-builder",
  reviewer: "codex-reviewer",
}

function iso(offsetMs: number) {
  return new Date(Date.now() + offsetMs).toISOString()
}

function installSessions(overrides: Record<string, unknown> = {}) {
  installTestCodexHostSessionRecord({
      schemaVersion: 1,
      artifactType: "CODEX_HOST_SESSION_IDENTITY",
      proofId: "proof-coordinator-mao-030",
      sessionId: HOST_SESSION_ID,
      workerId: ROLES.coordinator,
      providerId: "hosted-codex",
      adapterId: "hosted-codex-session-native-team-v1",
      status: "ACTIVE",
      issuedAt: iso(-60_000),
      expiresAt: iso(3_600_000),
      evaluationTime: iso(0),
      ...overrides,
  })
}

let observations = new Map<string, Record<string, unknown>>()
let bridgeCalls = { spawn: 0, lookupSpawn: 0, send: 0, lookupSend: 0, cancel: 0, lookupCancel: 0, observe: 0 }
let bridgeResults = {
  spawn: new Map<string, Record<string, unknown>>(),
  send: new Map<string, Record<string, unknown>>(),
  cancel: new Map<string, Record<string, unknown>>(),
}

function installBridge(overrides: Record<string, unknown> = {}) {
  installTestHostedCodexNativeBridge({
    bridgeId: "bridge-mao-030",
    providerId: "hosted-codex",
    adapterId: "hosted-codex-session-native-team-v1",
    currentSessionOnly: true,
    durableTransport: false,
    hostIdempotencyEnforced: true,
    lookupMayPerformSideEffect: false,
    authorityGranted: false,
    spawn(request: Record<string, unknown>) {
      bridgeCalls.spawn += 1
      const result = {
        schemaVersion: 1, artifactType: "HOSTED_CODEX_NATIVE_SPAWN_RESULT",
        bridgeId: "bridge-mao-030", adapterRunId: request.adapterRunId,
        assignmentId: request.assignmentId, workOrderId: request.workOrderId, laneId: request.laneId,
        role: request.role, logicalWorkerId: request.logicalWorkerId,
        nativeWorkerId: `native-${request.role}-mao-030`, status: "SPAWNED", spawnPerformed: true,
        currentSessionOnly: true, authorityGranted: false,
      }
      bridgeResults.spawn.set(request.idempotencyKey as string, result)
      return result
    },
    lookupSpawn(request: Record<string, unknown>) {
      bridgeCalls.lookupSpawn += 1
      const result = bridgeResults.spawn.get(request.idempotencyKey as string)
      if (!result) throw new Error("spawn outcome unavailable")
      return result
    },
    send(request: Record<string, unknown>) {
      bridgeCalls.send += 1
      const result = {
        schemaVersion: 1, artifactType: "HOSTED_CODEX_NATIVE_SEND_RESULT", bridgeId: "bridge-mao-030",
        assignmentId: request.assignmentId, nativeWorkerId: request.nativeWorkerId,
        messageDigest: request.messageDigest, status: "DELIVERED", deliveryPerformed: true,
        authorityGranted: false,
      }
      bridgeResults.send.set(request.idempotencyKey as string, result)
      return result
    },
    lookupSend(request: Record<string, unknown>) {
      bridgeCalls.lookupSend += 1
      const result = bridgeResults.send.get(request.idempotencyKey as string)
      if (!result) throw new Error("send outcome unavailable")
      return result
    },
    cancel(request: Record<string, unknown>) {
      bridgeCalls.cancel += 1
      const result = {
        schemaVersion: 1, artifactType: "HOSTED_CODEX_NATIVE_CANCEL_RESULT", bridgeId: "bridge-mao-030",
        assignmentId: request.assignmentId, nativeWorkerId: request.nativeWorkerId,
        reasonCode: request.reasonCode, status: "CANCELLED", cancellationPerformed: true,
        cancelAcknowledged: true, authorityGranted: false,
      }
      bridgeResults.cancel.set(request.idempotencyKey as string, result)
      return result
    },
    lookupCancel(request: Record<string, unknown>) {
      bridgeCalls.lookupCancel += 1
      const result = bridgeResults.cancel.get(request.idempotencyKey as string)
      if (!result) throw new Error("cancel outcome unavailable")
      return result
    },
    observe(request: Record<string, unknown>) {
      bridgeCalls.observe += 1
      const response = observations.get(request.observationId as string)
      if (!response) throw new Error("missing observation")
      return response
    },
    ...overrides,
  })
}

beforeEach(() => {
  observations = new Map()
  bridgeCalls = { spawn: 0, lookupSpawn: 0, send: 0, lookupSend: 0, cancel: 0, lookupCancel: 0, observe: 0 }
  bridgeResults = { spawn: new Map(), send: new Map(), cancel: new Map() }
  installSessions()
  installBridge()
})
afterEach(() => {
  clearTestCodexHostSessionRecords()
  clearTestHostedCodexNativeBridgeRegistry()
  for (const directory of temporaryDirectories.splice(0)) fs.rmSync(directory, { recursive: true, force: true })
})

function ownerBudget() {
  return {
    credentialTouches: 0,
    diagnosticTouches: 0,
    operationTouches: 0,
    routineContacts: 0,
    routineDecisions: 0,
  }
}

function v2Envelope(workOrderId: string, dependencies: string[] = []) {
  return {
    artifactType: "WORK_ORDER_ENVELOPE_V2",
    schemaVersion: 2,
    programId: PROGRAM,
    goalId: GOAL,
    loopId: LOOP,
    workOrderId,
    objective: `Execute bounded ${workOrderId} current-session work.`,
    riskClass: "R1",
    repositories: ["bsvalues/terragroq"],
    baseRefs: [{ repository: "bsvalues/terragroq", ref: "refs/heads/main", commitSha: "35de2eb8517697abc0539fa8b1cfc686aba26263" }],
    dependencies,
    fanInGate: "ALL",
    laneId: `LANE-${workOrderId}`,
    teamRoles: workOrderId === "WO-MAO-030" ? ROLES : {
      coordinator: "dependency-coordinator",
      builder: `dependency-builder-${workOrderId.toLowerCase()}`,
      reviewer: `dependency-reviewer-${workOrderId.toLowerCase()}`,
    },
    providerRequirements: ["current-hosted-session", "native-team-coordination", "sanitized-evidence"],
    preferredProviders: ["hosted-codex"],
    fallbackProviders: [],
    reservations: {
      paths: [{ repository: "bsvalues/terragroq", path: workOrderId === "WO-MAO-030" ? "scripts/multi-agent-operator/codex-coordinator-adapter.mjs" : `tmp/${workOrderId.toLowerCase()}.txt` }],
      contracts: [],
      environments: [],
    },
    allowedActions: ["READ_REPOSITORY", "RUN_VALIDATION", "WRITE_RESERVED_PATHS"],
    forbiddenActions: ["CREDENTIAL_ACCESS", "OWNER_CONTACT", "RUNTIME_ACTIVATION"],
    authorityGrantRefs: [workOrderId === "WO-MAO-030" ? "grant-mao-030" : `grant-${workOrderId.toLowerCase()}`],
    programActivationGrantRef: null,
    grantStatusEventRefs: [workOrderId === "WO-MAO-030" ? "event-mao-030-z-active" : `event-${workOrderId.toLowerCase()}`],
    requiredOutputs: ["implementation", "tests", "sanitized-evidence"],
    requiredValidation: ["focused-vitest", "independent-review"],
    reviewRequirements: { independentReviewer: true, minimumApprovals: 1, maximumUnresolvedThreads: 0 },
    mergeMode: "NO_MERGE",
    retryBudget: { maxAttempts: 2, backoffSeconds: 0 },
    remediationBudget: { maxCycles: 2 },
    reroutePolicy: "NONE",
    stopConditions: ["authority-wall", "reservation-collision"],
    evidenceTargets: ["owner-operation-counters", "sanitized-provider-events"],
    ownerDecisionConditions: [],
    ownerOperationsAllowed: false,
    ownerTouchBudget: ownerBudget(),
    communicationPolicy: "FINAL_ONLY",
  }
}

function dispatchEnvelope(envelope: ReturnType<typeof v2Envelope>) {
  const value = structuredClone(envelope) as Record<string, unknown>
  delete value.artifactType
  delete value.ownerTouchBudget
  delete value.communicationPolicy
  return value
}

function topologyInput() {
  const target = v2Envelope("WO-MAO-030", ["WO-MAO-024", "WO-MAO-028", "WO-MAO-029"])
  const dependencies = target.dependencies.map((id) => v2Envelope(id))
  return {
    schemaVersion: 1,
    artifactType: "MULTI_AGENT_TEAM_TOPOLOGY_INPUT",
    topologyId: "topology-wo-mao-030",
    dagInput: {
      schemaVersion: 1,
      artifactType: "DAG_ELIGIBILITY_INPUT",
      workOrders: [...dependencies, target],
      workOrderStates: [
        ...dependencies.map(({ workOrderId }) => ({ workOrderId, state: "COMPLETE", reasonCode: null })),
        { workOrderId: "WO-MAO-030", state: "PLANNED", reasonCode: null },
      ],
    },
    lanes: [{
      envelope: dispatchEnvelope(target),
      roleAssignments: {
        ...ROLES,
        remediator: ROLES.builder,
        mergeController: "codex-merge-controller",
        verifier: "codex-verifier",
      },
    }],
  }
}

function authorityArtifacts(includeContinuation = false) {
  const { publicKey, privateKey } = crypto.generateKeyPairSync("ed25519")
  const fingerprint = crypto.createHash("sha256").update(publicKey.export({ type: "spki", format: "der" })).digest("hex")
  const sign = <T extends Record<string, unknown>>(record: T) => {
    const contentHash = computeAuthorityContentHash(record)
    return {
      ...record,
      contentHash,
      signature: {
        algorithm: "Ed25519",
        keyId: "owner-key-mao-030",
        value: crypto.sign(null, Buffer.from(canonicalJson(record)), privateKey).toString("base64"),
      },
    }
  }
  const grant = sign({
    schemaVersion: 1,
    artifactType: "OWNER_AUTHORITY_GRANT",
    grantKind: "ACTION_AUTHORITY",
    grantId: "grant-mao-030",
    authorityDecisionId: "decision-mao-030",
    issuer: { role: "OWNER", ownerId: "owner-mao-030" },
    subject: { type: "PROGRAM", id: PROGRAM },
    scope: {
      programIds: [PROGRAM], goalIds: [GOAL], loopIds: [LOOP], workOrderIds: ["WO-MAO-030"],
      decisionIds: ["decision-mao-030"], repositories: ["bsvalues/terragroq"], riskClasses: ["R1"],
      actions: ["READ_REPOSITORY", "RUN_VALIDATION", "WRITE_RESERVED_PATHS"], mergeModes: ["NO_MERGE"],
    },
    issuedAt: iso(-3_600_000),
    expiresAt: iso(3_600_000),
  })
  const active = sign({
    schemaVersion: 1,
    artifactType: "OWNER_AUTHORITY_STATUS_EVENT",
    eventId: "event-mao-030-z-active",
    grantId: grant.grantId,
    sequence: 1,
    status: "ACTIVE",
    issuedAt: iso(-3_500_000),
    previousEventHash: null,
    issuer: { role: "OWNER", ownerId: "owner-mao-030" },
  })
  const continuation = sign({
    schemaVersion: 1,
    artifactType: "OWNER_AUTHORITY_STATUS_EVENT",
    eventId: "event-mao-030-a-continuation",
    grantId: grant.grantId,
    sequence: 2,
    status: "ACTIVE",
    issuedAt: iso(-3_450_000),
    previousEventHash: active.contentHash,
    issuer: { role: "OWNER", ownerId: "owner-mao-030" },
  })
  const events = includeContinuation ? [active, continuation] : [active]
  const trustedOwners = sign({
    schemaVersion: 1,
    artifactType: "OWNER_TRUST_BUNDLE",
    issuer: { role: "OWNER", ownerId: "owner-mao-030" },
    issuedAt: iso(-3_400_000),
    statusHeads: [{ grantId: grant.grantId, eventCount: events.length, latestEventHash: events.at(-1)!.contentHash }],
    legacyRevocationHeads: [],
    owners: [{
      ownerId: "owner-mao-030",
      publicKeyId: "owner-key-mao-030",
      algorithm: "Ed25519",
      publicKeyPem: publicKey.export({ type: "spki", format: "pem" }).toString(),
      status: "ACTIVE",
    }],
  })
  return {
    grant,
    events,
    trustedOwners,
    trustedOwnerKeyFingerprint: fingerprint,
    trustedOwnerBundleContentHash: trustedOwners.contentHash,
  }
}

function trustEvidence(role: keyof typeof ROLES, envelopeContentHash: string, overrides: Record<string, unknown> = {}) {
  return {
    schemaVersion: 2,
    artifactType: "HOSTED_CODEX_PREVENTIVE_TRUST_EVIDENCE",
    proofId: `trust-${role}-mao-030`,
    workOrderId: "WO-MAO-030",
    laneId: "LANE-WO-MAO-030",
    requestedRole: role,
    workerId: ROLES[role],
    provider: "hosted-codex",
    surface: "current-hosted-session-native-team",
    promptInjectionBoundary: "trusted-work-order-envelope-v1",
    allowedPaths: ["scripts/multi-agent-operator/codex-coordinator-adapter.mjs"],
    rawCredentialInspection: false,
    exactPathConfinement: true,
    outputRedaction: true,
    cancellationSupported: true,
    independentEvidenceCapture: true,
    envelopeContentHash,
    status: "ACTIVE",
    issuedAt: iso(-60_000),
    expiresAt: iso(3_600_000),
    evaluationTime: iso(0),
    authorityGranted: false,
    ...overrides,
  }
}

function input(
  overrides: Record<string, unknown> = {},
  options: {
    laneId?: string
    authority?: ReturnType<typeof authorityArtifacts>
    grantStatusEventRefs?: string[]
  } = {},
) {
  const topology = topologyInput()
  const target = topology.dagInput.workOrders.find(({ workOrderId }) => workOrderId === "WO-MAO-030")!
  if (options.laneId) {
    target.laneId = options.laneId
    topology.lanes[0].envelope.laneId = options.laneId
  }
  if (options.grantStatusEventRefs) {
    target.grantStatusEventRefs = [...options.grantStatusEventRefs]
    topology.lanes[0].envelope.grantStatusEventRefs = [...options.grantStatusEventRefs]
  }
  const envelopeContentHash = validateDispatchEnvelope(topology.lanes[0].envelope).contentHash
  for (const role of ["coordinator", "builder", "reviewer"] as const) {
    installTestHostedCodexTrustRecord(trustEvidence(role, envelopeContentHash, { laneId: target.laneId }))
  }
  return {
    schemaVersion: 1,
    artifactType: "HOSTED_CODEX_COORDINATOR_ADAPTER_INPUT",
    adapterRunId: "run-mao-030",
    topologyInput: topology,
    conformance: codexProviderConformanceFixture(),
    coordinatorHostSessionProofReference: {
      workerId: ROLES.coordinator,
      proofId: "proof-coordinator-mao-030",
    },
    preventiveTrustProofReferences: (["coordinator", "builder", "reviewer"] as const)
      .map((role) => ({ proofId: `trust-${role}-mao-030` })),
    hostBridgeReference: { bridgeId: "bridge-mao-030" },
    authorityProofs: [{ workOrderId: "WO-MAO-030", artifacts: options.authority ?? authorityArtifacts() }],
    runtimeActivationRequested: false,
    localIssue357Requested: false,
    durableTransportClaimed: false,
    ownerTouchBudget: ownerBudget(),
    ...overrides,
  }
}

function compile() {
  return compileHostedCodexCoordinatorAdapter(input())
}

function assignment(plan: ReturnType<typeof compile>, role: string) {
  const item = plan.assignments.find((candidate) => candidate.role === role)!
  return { item, handle: getHostedCodexNativeAssignmentHandle(plan, item.assignmentId) }
}

function expectWall(callback: () => unknown, code: string) {
  try {
    callback()
    throw new Error("expected hosted Codex adapter wall")
  } catch (error) {
    expect(error).toBeInstanceOf(HostedCodexCoordinatorAdapterError)
    expect(error).toMatchObject({ code })
  }
}

describe("WO-MAO-030 hosted Codex coordinator adapter", () => {
  it("compiles a current-session-only native team plan after every preventive gate", () => {
    const plan = compile()
    expect(plan).toMatchObject({
      artifactType: "HOSTED_CODEX_COORDINATOR_PLAN",
      status: "CURRENT_SESSION_NATIVE_TEAM_READY",
      assignmentCount: 3,
      concurrency: { ceiling: 3, phaseWidths: { COORDINATION: 1, BUILD: 2, REVIEW: 2, REMEDIATION: 2 } },
      currentSessionOnly: true,
      providerContractDispatchAllowed: false,
      dispatchPerformed: false,
      durableTransportClaimed: false,
      serviceWorkerClaimed: false,
      runtimeActivationAllowed: false,
      localIssue357Allowed: false,
      credentialInspectionAllowed: false,
      authorityMintingAllowed: false,
      authorityGranted: false,
      ownerTouchBudget: ownerBudget(),
      ownerOperationEvidenceCertified: false,
    })
    expect(plan.assignments.map(({ role }) => role).sort()).toEqual(["builder", "coordinator", "reviewer"])
    expect(plan.assignments.some(({ role }) => role === "mergeController")).toBe(false)
    expect(plan.assignments.every(({ nativeAssignmentExecuted }) => nativeAssignmentExecuted === false)).toBe(true)
    const publicPlan = JSON.stringify(plan)
    expect(publicPlan).not.toContain(HOST_SESSION_ID)
    expect(publicPlan).not.toContain("Execute bounded WO-MAO-030")
    expect(Object.isFrozen(plan)).toBe(true)
  })

  it("recomputes topology and rejects dependency, reservation, and role tampering", () => {
    const value = input()
    value.topologyInput.dagInput.workOrderStates.find(({ workOrderId }) => workOrderId === "WO-MAO-028")!.state = "PLANNED"
    expectWall(() => compileHostedCodexCoordinatorAdapter(value), "HOSTED_CODEX_TOPOLOGY_WALL")

    const collision = input()
    collision.topologyInput.lanes[0].roleAssignments.reviewer = ROLES.builder
    expectWall(() => compileHostedCodexCoordinatorAdapter(collision), "HOSTED_CODEX_TOPOLOGY_WALL")
  })

  it("requires host-registry trust proofs and exact canonical envelope/path bindings", () => {
    const forged = input()
    forged.preventiveTrustProofReferences[0] = { proofId: "caller-minted-proof" }
    expectWall(() => compileHostedCodexCoordinatorAdapter(forged), "HOSTED_CODEX_TRUST_WALL")
    const mismatched = input()
    const envelopeHash = validateDispatchEnvelope(mismatched.topologyInput.lanes[0].envelope).contentHash
    installTestHostedCodexTrustRecord(trustEvidence("builder", envelopeHash, {
      proofId: "trust-builder-mismatched",
      allowedPaths: ["other/file.mjs"],
    }))
    mismatched.preventiveTrustProofReferences[1] = { proofId: "trust-builder-mismatched" }
    expectWall(() => compileHostedCodexCoordinatorAdapter(mismatched), "HOSTED_CODEX_PATH_SCOPE_WALL")
  })

  it("rejects host proof substitution, caller identity clones, and expired current sessions", () => {
    const substituted = input()
    substituted.coordinatorHostSessionProofReference.workerId = ROLES.builder
    expectWall(() => compileHostedCodexCoordinatorAdapter(substituted), "HOSTED_CODEX_SESSION_WALL")

    clearTestCodexHostSessionRecords()
    installSessions({ expiresAt: iso(-1), evaluationTime: iso(-2) })
    expectWall(() => compileHostedCodexCoordinatorAdapter(input()), "HOSTED_CODEX_SESSION_WALL")
  })

  it("cryptographically validates active authority and rejects grant scope changes", () => {
    const value = input()
    value.authorityProofs[0].artifacts.grant.scope.actions = ["READ_REPOSITORY"]
    expectWall(() => compileHostedCodexCoordinatorAdapter(value), "HOSTED_CODEX_AUTHORITY_WALL")
  })

  it("matches authority event references as an exact duplicate-free set without reordering the signed chain", () => {
    const authority = authorityArtifacts(true)
    const eventRefs = authority.events.map(({ eventId }) => eventId)
    const plan = compileHostedCodexCoordinatorAdapter(input({}, {
      authority,
      grantStatusEventRefs: [...eventRefs].reverse(),
    }))
    expect(plan.assignments).toHaveLength(3)

    const reorderedAuthority = { ...authority, events: [...authority.events].reverse() }
    expectWall(() => compileHostedCodexCoordinatorAdapter(input({}, {
      authority: reorderedAuthority,
      grantStatusEventRefs: [...eventRefs].sort(),
    })), "HOSTED_CODEX_AUTHORITY_WALL")

    const duplicate = input({}, {
      authority,
      grantStatusEventRefs: eventRefs,
    })
    duplicate.topologyInput.dagInput.workOrders
      .find(({ workOrderId }) => workOrderId === "WO-MAO-030")!.grantStatusEventRefs = [eventRefs[0], eventRefs[0]]
    duplicate.topologyInput.lanes[0].envelope.grantStatusEventRefs = [eventRefs[0], eventRefs[0]]
    expectWall(() => compileHostedCodexCoordinatorAdapter(duplicate), "HOSTED_CODEX_TOPOLOGY_WALL")

    const malformed = input()
    malformed.authorityProofs[0].artifacts.events = [null as never]
    expectWall(() => compileHostedCodexCoordinatorAdapter(malformed), "HOSTED_CODEX_AUTHORITY_WALL")
  })

  it("bounds near-limit assignment identifiers with deterministic collision separation", () => {
    const runPrefix = `r${"a".repeat(126)}`
    const runOne = `${runPrefix}x`
    const runTwo = `${runPrefix}y`
    const lanePrefix = `L-${"B".repeat(125)}`
    const laneOne = `${lanePrefix}A`
    const laneTwo = `${lanePrefix}B`
    const first = compileHostedCodexCoordinatorAdapter(input({ adapterRunId: runOne }, { laneId: laneOne }))
    const replay = compileHostedCodexCoordinatorAdapter(input({ adapterRunId: runOne }, { laneId: laneOne }))
    const distinctLane = compileHostedCodexCoordinatorAdapter(input({ adapterRunId: runOne }, { laneId: laneTwo }))
    const distinctRun = compileHostedCodexCoordinatorAdapter(input({ adapterRunId: runTwo }, { laneId: laneOne }))

    expect(first.assignments.every(({ assignmentId }) => assignmentId.length <= 128)).toBe(true)
    expect(first.assignments.map(({ assignmentId }) => assignmentId))
      .toEqual(replay.assignments.map(({ assignmentId }) => assignmentId))
    expect(new Set([
      ...first.assignments.map(({ assignmentId }) => assignmentId),
      ...distinctLane.assignments.map(({ assignmentId }) => assignmentId),
      ...distinctRun.assignments.map(({ assignmentId }) => assignmentId),
    ]).size).toBe(9)
    for (const item of first.assignments) {
      expect(getHostedCodexNativeAssignmentHandle(first, item.assignmentId)).toMatchObject({ assignmentId: item.assignmentId })
    }
  })

  it("requires the canonical bridge and reconciles an ambiguous spawn without duplicating the child", () => {
    const missing = input()
    missing.hostBridgeReference = { bridgeId: "caller-bridge" }
    expectWall(() => compileHostedCodexCoordinatorAdapter(missing), "HOSTED_CODEX_BRIDGE_WALL")

    installBridge({
      spawn(request: Record<string, unknown>) {
        bridgeCalls.spawn += 1
        const result = {
          schemaVersion: 1, artifactType: "HOSTED_CODEX_NATIVE_SPAWN_RESULT",
          bridgeId: "bridge-mao-030", adapterRunId: request.adapterRunId,
          assignmentId: request.assignmentId, workOrderId: request.workOrderId, laneId: request.laneId,
          role: request.role, logicalWorkerId: request.logicalWorkerId,
          nativeWorkerId: `native-${request.role}-mao-030`, status: "SPAWNED", spawnPerformed: true,
          currentSessionOnly: true, authorityGranted: false,
        }
        bridgeResults.spawn.set(request.idempotencyKey as string, result)
        return { ...result, status: "MALFORMED_AFTER_HOST_EFFECT" }
      },
    })
    const plan = compile()
    const builder = assignment(plan, "builder")
    expectWall(() => startHostedCodexNativeAssignment(plan, {
      assignmentHandle: builder.handle,
      idempotencyKey: "spawn-ambiguous-outcome",
    }), "HOSTED_CODEX_BRIDGE_WALL")
    expectWall(() => startHostedCodexNativeAssignment(plan, {
      assignmentHandle: builder.handle,
      idempotencyKey: "spawn-new-key-forbidden-while-quarantined",
    }), "HOSTED_CODEX_ASSIGNMENT_WALL")
    expect(startHostedCodexNativeAssignment(plan, {
      assignmentHandle: builder.handle,
      idempotencyKey: "spawn-ambiguous-outcome",
    })).toMatchObject({ nativeAssignmentExecuted: true })
    expect(bridgeCalls).toMatchObject({ spawn: 1, lookupSpawn: 1 })
  })

  it.each([
    ["runtimeActivationRequested", true],
    ["localIssue357Requested", true],
    ["durableTransportClaimed", true],
  ])("fails closed on forbidden boundary %s", (field, requested) => {
    expectWall(() => compileHostedCodexCoordinatorAdapter(input({ [field]: requested })), "HOSTED_CODEX_RUNTIME_WALL")
  })

  it("routes sanitized idempotent messages only through the coordinator", () => {
    const plan = compile()
    const builder = assignment(plan, "builder")
    startHostedCodexNativeAssignment(plan, { assignmentHandle: builder.handle, idempotencyKey: "spawn-builder-001" })
    const request = {
      assignmentHandle: builder.handle,
      direction: "TO_ASSIGNMENT",
      messageType: "REVIEW_REQUEST",
      summary: "Run the declared validation and report only sanitized status.",
      idempotencyKey: "message-mao-030-001",
    }
    const first = createHostedCodexNativeMessage(plan, request)
    expect(createHostedCodexNativeMessage(plan, request)).toBe(first)
    expect(first).toMatchObject({ deliveryPerformed: true, sanitized: true, authorityGranted: false })
    expect(bridgeCalls.send).toBe(1)
    expectWall(() => createHostedCodexNativeMessage(plan, { ...request, summary: "Changed replay." }), "HOSTED_CODEX_REPLAY_WALL")
    expectWall(() => createHostedCodexNativeMessage(plan, { ...request, idempotencyKey: "message-mao-030-002", recipientWorkerId: ROLES.reviewer }), "HOSTED_CODEX_UNKNOWN_FIELD_WALL")
    expectWall(() => createHostedCodexNativeMessage(plan, { ...request, idempotencyKey: "message-mao-030-003", summary: ["token", ["super", "secret", "value"].join("-")].join("=") }), "HOSTED_CODEX_MESSAGE_WALL")
  })

  it.each(["SUCCEEDED", "FAILED", "CANCELLED"] as const)(
    "replays an exact committed send after %s terminal state without redelivery",
    (terminalState) => {
      const plan = compile()
      const builder = assignment(plan, "builder")
      startHostedCodexNativeAssignment(plan, {
        assignmentHandle: builder.handle,
        idempotencyKey: `spawn-terminal-send-replay-${terminalState.toLowerCase()}`,
      })
      const request = {
        assignmentHandle: builder.handle,
        direction: "TO_ASSIGNMENT",
        messageType: "STATUS",
        summary: "Committed before terminal state.",
        idempotencyKey: `send-before-${terminalState.toLowerCase()}`,
      }
      const committed = createHostedCodexNativeMessage(plan, request)
      if (terminalState === "CANCELLED") {
        cancelHostedCodexNativeAssignment(plan, {
          assignmentHandle: builder.handle,
          requestedBy: ROLES.coordinator,
          reasonCode: "SUPERSEDED",
          idempotencyKey: "cancel-after-committed-send",
        })
      } else {
        const observationId = `terminal-send-${terminalState.toLowerCase()}`
        observations.set(observationId, {
          schemaVersion: 1,
          artifactType: "PROVIDER_STATUS",
          providerId: "hosted-codex",
          adapterId: "hosted-codex-session-native-team-v1",
          dispatchId: builder.item.assignmentId,
          workOrderId: builder.item.workOrderId,
          laneId: builder.item.laneId,
          providerState: terminalState,
          reasonCode: terminalState === "FAILED" ? "WORKER_FAILED" : null,
          sanitized: true,
          authorityGranted: false,
          progressMarker: terminalState,
        })
        captureHostedCodexNativeEvidence(plan, { assignmentHandle: builder.handle, observationId })
      }

      expect(createHostedCodexNativeMessage(plan, request)).toBe(committed)
      expect(Object.isFrozen(committed)).toBe(true)
      expect(bridgeCalls.send).toBe(1)
      expectWall(() => createHostedCodexNativeMessage(plan, {
        ...request,
        summary: "Conflicting replay after terminal state.",
      }), "HOSTED_CODEX_REPLAY_WALL")
      expectWall(() => createHostedCodexNativeMessage(plan, {
        ...request,
        idempotencyKey: `new-send-after-${terminalState.toLowerCase()}`,
      }), "HOSTED_CODEX_MESSAGE_WALL")
      expect(bridgeCalls.send).toBe(1)
    },
  )

  it("quarantines an ambiguous send acknowledgement and reconciles by lookup without redelivery", () => {
    installBridge({
      send(request: Record<string, unknown>) {
        bridgeCalls.send += 1
        const result = {
          schemaVersion: 1, artifactType: "HOSTED_CODEX_NATIVE_SEND_RESULT", bridgeId: "bridge-mao-030",
          assignmentId: request.assignmentId, nativeWorkerId: request.nativeWorkerId,
          messageDigest: request.messageDigest, status: "DELIVERED", deliveryPerformed: true,
          authorityGranted: false,
        }
        bridgeResults.send.set(request.idempotencyKey as string, result)
        return { ...result, deliveryPerformed: false }
      },
    })
    const plan = compile()
    const builder = assignment(plan, "builder")
    startHostedCodexNativeAssignment(plan, { assignmentHandle: builder.handle, idempotencyKey: "spawn-send-quarantine" })
    const request = {
      assignmentHandle: builder.handle,
      direction: "TO_ASSIGNMENT",
      messageType: "STATUS",
      summary: "Bounded status.",
      idempotencyKey: "send-ambiguous-outcome",
    }
    expectWall(() => createHostedCodexNativeMessage(plan, request), "HOSTED_CODEX_BRIDGE_WALL")
    expectWall(() => createHostedCodexNativeMessage(plan, {
      ...request, summary: "Another status.", idempotencyKey: "send-new-key-while-quarantined",
    }), "HOSTED_CODEX_MESSAGE_WALL")
    expect(createHostedCodexNativeMessage(plan, request)).toMatchObject({ deliveryPerformed: true })
    expect(bridgeCalls).toMatchObject({ send: 1, lookupSend: 1 })
  })

  it.each([
    ["Authorization", "Basic dXNlcjpwYXNz"].join(": "),
    ["-----BEGIN RSA", "PRIVATE KEY-----"].join(" "),
    ["AKIA", "ABCDEFGHIJKLMNOP"].join(""),
    ["eyJhbGciOiJIUzI1NiJ9", "eyJzdWIiOiIxMjM0NTY3ODkwIn0", "signaturevalue"].join("."),
  ])("reuses canonical provider sanitization for message secret pattern %s", (summary) => {
    const plan = compile()
    const builder = assignment(plan, "builder")
    startHostedCodexNativeAssignment(plan, { assignmentHandle: builder.handle, idempotencyKey: "spawn-secret-test" })
    expectWall(() => createHostedCodexNativeMessage(plan, {
      assignmentHandle: builder.handle,
      direction: "TO_ASSIGNMENT",
      messageType: "STATUS",
      summary,
      idempotencyKey: "message-secret-test",
    }), "HOSTED_CODEX_MESSAGE_WALL")
  })

  it("rejects forged and cross-run assignment handles", () => {
    const one = compile()
    const two = compileHostedCodexCoordinatorAdapter(input({ adapterRunId: "run-mao-030-two" }))
    const builder = assignment(one, "builder")
    expectWall(() => createHostedCodexNativeMessage(one, {
      assignmentHandle: { ...builder.handle },
      direction: "TO_ASSIGNMENT",
      messageType: "STATUS",
      summary: "Bounded update.",
      idempotencyKey: "message-forged",
    }), "HOSTED_CODEX_ASSIGNMENT_HANDLE_WALL")
    expectWall(() => createHostedCodexNativeMessage(two, {
      assignmentHandle: builder.handle,
      direction: "TO_ASSIGNMENT",
      messageType: "STATUS",
      summary: "Bounded update.",
      idempotencyKey: "message-cross-run",
    }), "HOSTED_CODEX_ASSIGNMENT_HANDLE_WALL")
  })

  it("cancels a prepared assignment without claiming delivery or spawn", () => {
    const plan = compile()
    const builder = assignment(plan, "builder")
    const request = {
      assignmentHandle: builder.handle,
      requestedBy: ROLES.coordinator,
      reasonCode: "SUPERSEDED",
      idempotencyKey: "cancel-mao-030-001",
    }
    const result = cancelHostedCodexNativeAssignment(plan, request)
    expect(result).toMatchObject({
      preDispatchCancellation: true,
      cancellationDelivered: false,
      cancellationAcknowledged: false,
      terminalState: "CANCELLED",
      authorityGranted: false,
    })
    expect(cancelHostedCodexNativeAssignment(plan, request)).toBe(result)
    expectWall(() => cancelHostedCodexNativeAssignment(plan, {
      assignmentHandle: builder.handle,
      requestedBy: ROLES.coordinator,
      reasonCode: "SUPERSEDED",
      idempotencyKey: "cancel-mao-030-002",
    }), "HOSTED_CODEX_CANCELLATION_WALL")
  })

  it("captures only hashes and attribution from sanitized provider evidence", () => {
    const plan = compile()
    const builder = assignment(plan, "builder")
    startHostedCodexNativeAssignment(plan, { assignmentHandle: builder.handle, idempotencyKey: "spawn-evidence-001" })
    observations.set("observation-evidence-001", {
      schemaVersion: 1,
      artifactType: "PROVIDER_EVIDENCE",
      providerId: "hosted-codex",
      adapterId: "hosted-codex-session-native-team-v1",
      dispatchId: builder.item.assignmentId,
      workOrderId: builder.item.workOrderId,
      laneId: builder.item.laneId,
      providerState: "RUNNING",
      reasonCode: null,
      sanitized: true,
      authorityGranted: false,
      eventId: "event-provider-mao-030",
      evidenceType: "VALIDATION_STATUS",
      contentHash: "a".repeat(64),
      summary: "Focused validation is running.",
      attributes: { files: 1 },
      rawProviderOutputIncluded: false,
    })
    const result = captureHostedCodexNativeEvidence(plan, {
      assignmentHandle: builder.handle,
      observationId: "observation-evidence-001",
    })
    expect(result).toMatchObject({
      providerState: "RUNNING",
      sanitized: true,
      rawProviderOutputIncluded: false,
      independentlyCaptured: true,
      durablePersistenceClaimed: false,
      authorityGranted: false,
    })
    expect(JSON.stringify(result)).not.toContain("Focused validation")
    expect(JSON.stringify(result)).not.toContain('"attributes"')
    expect(captureHostedCodexNativeEvidence(plan, {
      assignmentHandle: builder.handle,
      observationId: "observation-evidence-001",
    })).toBe(result)
    observations.set("observation-evidence-001", {
      ...observations.get("observation-evidence-001")!,
      contentHash: "c".repeat(64),
      summary: "Conflicting replay.",
    })
    expectWall(() => captureHostedCodexNativeEvidence(plan, {
      assignmentHandle: builder.handle,
      observationId: "observation-evidence-001",
    }), "HOSTED_CODEX_REPLAY_WALL")
    expectWall(() => captureHostedCodexNativeEvidence(plan, {
      ...observations.get("observation-evidence-001"),
      assignmentHandle: builder.handle,
    }), "HOSTED_CODEX_UNKNOWN_FIELD_WALL")
  })

  it("detaches conformance and envelope state from caller mutation after compile", () => {
    const value = input()
    const plan = compileHostedCodexCoordinatorAdapter(value)
    value.conformance.capability.maxConcurrency = 0
    value.topologyInput.dagInput.workOrders.find(({ workOrderId }) => workOrderId === "WO-MAO-030")!.riskClass = "R3"
    const builder = assignment(plan, "builder")
    expect(startHostedCodexNativeAssignment(plan, {
      assignmentHandle: builder.handle,
      idempotencyKey: "spawn-detached-state",
    })).toMatchObject({ nativeAssignmentExecuted: true })
  })

  it("enforces exact reserved artifact paths and provider binding", () => {
    const plan = compile()
    const builder = assignment(plan, "builder")
    startHostedCodexNativeAssignment(plan, { assignmentHandle: builder.handle, idempotencyKey: "spawn-artifact-001" })
    const response = {
      schemaVersion: 1,
      artifactType: "PROVIDER_ARTIFACT",
      providerId: "hosted-codex",
      adapterId: "hosted-codex-session-native-team-v1",
      dispatchId: builder.item.assignmentId,
      workOrderId: builder.item.workOrderId,
      laneId: builder.item.laneId,
      providerState: "SUCCEEDED",
      reasonCode: null,
      sanitized: true,
      authorityGranted: false,
      artifactId: "artifact-mao-030",
      artifactKind: "SOURCE",
      contentHash: "b".repeat(64),
      relativePath: "other/file.mjs",
    }
    observations.set("observation-bad-path", response)
    expectWall(() => captureHostedCodexNativeEvidence(plan, { assignmentHandle: builder.handle, observationId: "observation-bad-path" }), "HOSTED_CODEX_PATH_SCOPE_WALL")
    observations.set("observation-bad-binding", { ...response, relativePath: "scripts/multi-agent-operator/codex-coordinator-adapter.mjs", workOrderId: "WO-MAO-031" })
    expectWall(() => captureHostedCodexNativeEvidence(plan, { assignmentHandle: builder.handle, observationId: "observation-bad-binding" }), "HOSTED_CODEX_EVIDENCE_WALL")
  })

  it("requires an active exact cancellation acknowledgement and seals terminal races", () => {
    const plan = compile()
    const builder = assignment(plan, "builder")
    startHostedCodexNativeAssignment(plan, { assignmentHandle: builder.handle, idempotencyKey: "spawn-cancel-001" })
    const common = {
      schemaVersion: 1,
      providerId: "hosted-codex",
      adapterId: "hosted-codex-session-native-team-v1",
      dispatchId: builder.item.assignmentId,
      workOrderId: builder.item.workOrderId,
      laneId: builder.item.laneId,
      sanitized: true,
      authorityGranted: false,
    }
    observations.set("observation-running", {
      ...common,
      artifactType: "PROVIDER_STATUS",
      providerState: "RUNNING",
      reasonCode: null,
      progressMarker: "BUILD_STARTED",
    })
    captureHostedCodexNativeEvidence(plan, { assignmentHandle: builder.handle, observationId: "observation-running" })
    cancelHostedCodexNativeAssignment(plan, {
      assignmentHandle: builder.handle,
      requestedBy: ROLES.coordinator,
      reasonCode: "SUPERSEDED",
      idempotencyKey: "cancel-active-mao-030",
    })
    expect(bridgeCalls.cancel).toBe(1)
    observations.set("observation-late-success", {
      ...common,
      artifactType: "PROVIDER_STATUS",
      providerState: "SUCCEEDED",
      reasonCode: null,
      progressMarker: "DONE",
    })
    expectWall(() => captureHostedCodexNativeEvidence(plan, { assignmentHandle: builder.handle, observationId: "observation-late-success" }), "HOSTED_CODEX_TERMINAL_RACE_WALL")
    observations.set("observation-late-failure", {
      ...common,
      artifactType: "PROVIDER_STATUS",
      providerState: "FAILED",
      reasonCode: "WORKER_FAILED",
      progressMarker: "FAILED",
    })
    expectWall(() => captureHostedCodexNativeEvidence(plan, { assignmentHandle: builder.handle, observationId: "observation-late-failure" }), "HOSTED_CODEX_TERMINAL_RACE_WALL")
    const cancelled = {
      ...common,
      artifactType: "PROVIDER_CANCELLATION",
      providerState: "CANCELLED",
      reasonCode: "CANCELLED_BY_COORDINATOR",
      cancelAcknowledged: true,
    }
    observations.set("observation-cancelled", cancelled)
    const cancellationEvidence = captureHostedCodexNativeEvidence(plan, {
      assignmentHandle: builder.handle,
      observationId: "observation-cancelled",
    })
    expect(cancellationEvidence).toMatchObject({ providerState: "CANCELLED", terminalState: "CANCELLED" })
    expect(captureHostedCodexNativeEvidence(plan, {
      assignmentHandle: builder.handle,
      observationId: "observation-cancelled",
    })).toBe(cancellationEvidence)
    observations.set("observation-conflicting-cancellation", {
      ...cancelled,
      reasonCode: "DIFFERENT_CANCELLATION_REASON",
    })
    expectWall(() => captureHostedCodexNativeEvidence(plan, {
      assignmentHandle: builder.handle,
      observationId: "observation-conflicting-cancellation",
    }), "HOSTED_CODEX_TERMINAL_RACE_WALL")
    expectWall(() => createHostedCodexNativeMessage(plan, {
      assignmentHandle: builder.handle,
      direction: "TO_ASSIGNMENT",
      messageType: "STATUS",
      summary: "Late message.",
      idempotencyKey: "late-message",
    }), "HOSTED_CODEX_MESSAGE_WALL")
  })

  it("seals terminal evidence to the exact response hash, not merely the same terminal state", () => {
    const plan = compile()
    const builder = assignment(plan, "builder")
    startHostedCodexNativeAssignment(plan, { assignmentHandle: builder.handle, idempotencyKey: "spawn-terminal-hash" })
    const terminal = {
      schemaVersion: 1,
      artifactType: "PROVIDER_STATUS",
      providerId: "hosted-codex",
      adapterId: "hosted-codex-session-native-team-v1",
      dispatchId: builder.item.assignmentId,
      workOrderId: builder.item.workOrderId,
      laneId: builder.item.laneId,
      providerState: "SUCCEEDED",
      reasonCode: null,
      sanitized: true,
      authorityGranted: false,
      progressMarker: "DONE",
    }
    observations.set("terminal-first", terminal)
    captureHostedCodexNativeEvidence(plan, { assignmentHandle: builder.handle, observationId: "terminal-first" })
    observations.set("terminal-conflict", { ...terminal, progressMarker: "DIFFERENT_DONE_DETAIL" })
    expectWall(() => captureHostedCodexNativeEvidence(plan, {
      assignmentHandle: builder.handle,
      observationId: "terminal-conflict",
    }), "HOSTED_CODEX_TERMINAL_RACE_WALL")
  })

  it("quarantines an ambiguous cancellation acknowledgement and reconciles without recancelling", () => {
    installBridge({
      cancel(request: Record<string, unknown>) {
        bridgeCalls.cancel += 1
        const result = {
          schemaVersion: 1, artifactType: "HOSTED_CODEX_NATIVE_CANCEL_RESULT", bridgeId: "bridge-mao-030",
          assignmentId: request.assignmentId, nativeWorkerId: request.nativeWorkerId,
          reasonCode: request.reasonCode, status: "CANCELLED", cancellationPerformed: true,
          cancelAcknowledged: true, authorityGranted: false,
        }
        bridgeResults.cancel.set(request.idempotencyKey as string, result)
        return { ...result, cancelAcknowledged: false }
      },
    })
    const plan = compile()
    const builder = assignment(plan, "builder")
    startHostedCodexNativeAssignment(plan, { assignmentHandle: builder.handle, idempotencyKey: "spawn-cancel-quarantine" })
    const request = {
      assignmentHandle: builder.handle,
      requestedBy: ROLES.coordinator,
      reasonCode: "SUPERSEDED",
      idempotencyKey: "cancel-ambiguous-outcome",
    }
    expectWall(() => cancelHostedCodexNativeAssignment(plan, request), "HOSTED_CODEX_BRIDGE_WALL")
    expectWall(() => cancelHostedCodexNativeAssignment(plan, {
      ...request, idempotencyKey: "cancel-new-key-while-quarantined",
    }), "HOSTED_CODEX_CANCELLATION_WALL")
    expect(cancelHostedCodexNativeAssignment(plan, request)).toMatchObject({
      cancellationDelivered: true, cancellationAcknowledged: true, terminalState: "CANCELLED",
    })
    expect(bridgeCalls).toMatchObject({ cancel: 1, lookupCancel: 1 })
  })

  it("bounds the current session to coordinator plus two active native children", () => {
    const plan = compile()
    const builder = assignment(plan, "builder")
    const reviewer = assignment(plan, "reviewer")
    startHostedCodexNativeAssignment(plan, { assignmentHandle: builder.handle, idempotencyKey: "spawn-budget-builder" })
    startHostedCodexNativeAssignment(plan, { assignmentHandle: reviewer.handle, idempotencyKey: "spawn-budget-reviewer" })
    expect(bridgeCalls.spawn).toBe(2)
    expect(plan.concurrency.ceiling).toBe(3)
  })

  it("CLI fails closed because production has no mutable host-session bridge", () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "mao-030-cli-"))
    temporaryDirectories.push(directory)
    const inputPath = path.join(directory, "input.json")
    const serializable = input()
    fs.writeFileSync(inputPath, JSON.stringify(serializable))
    const result = spawnSync(process.execPath, ["scripts/multi-agent-operator/codex-coordinator-adapter-cli.mjs", inputPath], {
      cwd: process.cwd(), encoding: "utf8",
    })
    expect(result.status).toBe(2)
    expect(JSON.parse(result.stdout)).toMatchObject({ ok: false, code: "HOSTED_CODEX_TRUST_WALL" })
  })
})
