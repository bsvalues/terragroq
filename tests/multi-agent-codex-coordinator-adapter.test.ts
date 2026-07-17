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
vi.mock("../scripts/multi-agent-operator/hosted-codex-authority-status-registry.mjs", async () => (
  import("./fixtures/hosted-codex-authority-status-registry-fixture.mjs")
))

import {
  HostedCodexCoordinatorAdapterError,
  attestHostedCodexRoleAssignmentPair,
  attestHostedCodexRoleAssignmentHandles,
  attestHostedCodexSemanticEvidence,
  cancelHostedCodexNativeAssignment,
  captureHostedCodexNativeEvidence,
  captureHostedCodexNativeSemanticEvidence,
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
  CodexRoleAdapterError,
  adaptCodexRoleLifecycle,
} from "../scripts/multi-agent-operator/codex-role-adapters.mjs"
import {
  clearTestCodexHostSessionRecords,
  installTestCodexHostSessionRecord,
} from "./fixtures/codex-host-session-registry-fixture.mjs"
import {
  clearTestHostedCodexNativeBridgeRegistry,
  isHostedCodexAtomicAuthorityFenceRejection,
  isHostedCodexObservationPending,
  installTestHostedCodexNativeBridge,
  installTestHostedCodexTrustRecord,
} from "./fixtures/codex-native-bridge-registry-fixture.mjs"
import {
  advanceTestHostedCodexAuthorityStatusChain,
  clearTestHostedCodexAuthorityStatusRegistry,
  installTestHostedCodexAuthorityStatusChain,
  removeTestHostedCodexAuthorityStatusChain,
} from "./fixtures/hosted-codex-authority-status-registry-fixture.mjs"

const temporaryDirectories: string[] = []
const PROGRAM = "PROGRAM-WILLIAMOS-MULTI-AGENT-OPERATOR-001"
const GOAL = "GOAL-WOS-MULTI-AGENT-OPERATOR-001"
const LOOP = "LOOP-WOS-MULTI-AGENT-OPERATOR-001"
const HOST_SESSION_ID = "native-coordinator-mao-030"
const AUTHORITY_SIGNERS = new WeakMap<object, (record: Record<string, unknown>) => Record<string, unknown>>()
const AUTHORITY_INITIAL_RECORDS = new WeakMap<object, ReturnType<typeof authorityStatusRecord>>()
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
    atomicAuthorityFenceEnforced: true,
    exactAuthorityFenceEcho: true,
    authorityFenceEchoRequired: true,
    authorityStatusRegistryId: "hosted-codex-authority-status-registry-v1",
    isAtomicAuthorityFenceRejection: isHostedCodexAtomicAuthorityFenceRejection,
    isObservationPending: isHostedCodexObservationPending,
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
  vi.useRealTimers()
  clearTestCodexHostSessionRecords()
  clearTestHostedCodexNativeBridgeRegistry()
  clearTestHostedCodexAuthorityStatusRegistry()
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

function authorityArtifacts(
  includeContinuation = false,
  workOrderId = "WO-MAO-030",
  repositories = ["bsvalues/terragroq"],
) {
  const suffix = workOrderId === "WO-MAO-030" ? "mao-030" : workOrderId.toLowerCase()
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
    grantId: `grant-${suffix}`,
    authorityDecisionId: `decision-${suffix}`,
    issuer: { role: "OWNER", ownerId: "owner-mao-030" },
    subject: { type: "PROGRAM", id: PROGRAM },
    scope: {
      programIds: [PROGRAM], goalIds: [GOAL], loopIds: [LOOP], workOrderIds: [workOrderId],
      decisionIds: [`decision-${suffix}`], repositories, riskClasses: ["R1"],
      actions: ["READ_REPOSITORY", "RUN_VALIDATION", "WRITE_RESERVED_PATHS"], mergeModes: ["NO_MERGE"],
    },
    issuedAt: iso(-3_600_000),
    expiresAt: iso(3_600_000),
  })
  const active = sign({
    schemaVersion: 1,
    artifactType: "OWNER_AUTHORITY_STATUS_EVENT",
    eventId: workOrderId === "WO-MAO-030" ? "event-mao-030-z-active" : `event-${workOrderId.toLowerCase()}`,
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
    eventId: workOrderId === "WO-MAO-030"
      ? "event-mao-030-a-continuation"
      : `event-${workOrderId.toLowerCase()}-continuation`,
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
  const artifacts = {
    grant,
    events,
    trustedOwners,
    trustedOwnerKeyFingerprint: fingerprint,
    trustedOwnerBundleContentHash: trustedOwners.contentHash,
  }
  AUTHORITY_SIGNERS.set(artifacts, sign)
  return artifacts
}

function sha256Canonical(value: unknown) {
  return crypto.createHash("sha256").update(canonicalJson(value)).digest("hex")
}

function authorityStatusRecordId(artifacts: ReturnType<typeof authorityArtifacts>, workOrderId: string) {
  return sha256Canonical({
    domain: "HOSTED_CODEX_AUTHORITY_STATUS_V1",
    grantId: artifacts.grant.grantId,
    authorityDecisionId: artifacts.grant.authorityDecisionId,
    workOrderId,
  })
}

function authorityStatusRecord(
  original: ReturnType<typeof authorityArtifacts>,
  current: ReturnType<typeof authorityArtifacts>,
  workOrderId: string,
  fencingToken: number,
  previousRecordContentHash: string | null,
  status: "ACTIVE" | "REVOKED_TERMINAL",
) {
  const originalEventHashes = original.events.map(({ contentHash }) => contentHash)
  const currentEventHashes = current.events.map(({ contentHash }) => contentHash)
  const claims = {
    schemaVersion: 1,
    artifactType: "HOSTED_CODEX_AUTHORITY_STATUS_RECORD",
    recordId: authorityStatusRecordId(original, workOrderId),
    recordVersion: fencingToken,
    fencingToken,
    status,
    issuedAt: iso(-1_000),
    expiresAt: iso(120_000),
    maximumAgeMs: 60_000,
    previousRecordContentHash,
    grantId: original.grant.grantId,
    authorityDecisionId: original.grant.authorityDecisionId,
    workOrderId,
    originalGrantContentHash: original.grant.contentHash,
    originalEventChainHash: sha256Canonical(originalEventHashes),
    originalTrustBundleContentHash: original.trustedOwnerBundleContentHash,
    originalStatusHeadHash: originalEventHashes.at(-1) ?? null,
    originalStatusEventCount: originalEventHashes.length,
    currentArtifacts: {
      authorityGrant: current.grant,
      authorityStatusEvents: current.events,
      ownerAuthorityTrustBundle: current.trustedOwners,
    },
    currentEventChainHash: sha256Canonical(currentEventHashes),
    currentTrustBundleContentHash: current.trustedOwnerBundleContentHash,
    currentStatusHeadHash: currentEventHashes.at(-1) ?? null,
    currentStatusEventCount: currentEventHashes.length,
    immutable: true,
    authorityGranted: false,
  }
  return { ...claims, recordContentHash: sha256Canonical(claims) }
}

function installAuthorityStatus(artifacts: ReturnType<typeof authorityArtifacts>, workOrderId: string) {
  const record = authorityStatusRecord(artifacts, artifacts, workOrderId, 1, null, "ACTIVE")
  AUTHORITY_INITIAL_RECORDS.set(artifacts, record)
  installTestHostedCodexAuthorityStatusChain({
    registryId: "hosted-codex-authority-status-registry-v1",
    registryVersion: 1,
    evaluationTime: iso(0),
    recordId: record.recordId,
    latestFencingToken: 1,
    latestRecordContentHash: record.recordContentHash,
    records: [record],
  })
  return record
}

function revokedAuthorityArtifacts(original: ReturnType<typeof authorityArtifacts>) {
  const sign = AUTHORITY_SIGNERS.get(original)
  if (!sign) throw new Error("missing authority test signer")
  const last = original.events.at(-1)!
  const revoked = sign({
    schemaVersion: 1,
    artifactType: "OWNER_AUTHORITY_STATUS_EVENT",
    eventId: `${last.eventId}-revoked`,
    grantId: original.grant.grantId,
    sequence: original.events.length + 1,
    status: "REVOKED",
    issuedAt: iso(-500),
    previousEventHash: last.contentHash,
    issuer: { role: "OWNER", ownerId: "owner-mao-030" },
  })
  const events = [...original.events, revoked]
  const { contentHash: _contentHash, signature: _signature, ...trustClaims } = original.trustedOwners
  const trustedOwners = sign({
    ...trustClaims,
    statusHeads: [{
      grantId: original.grant.grantId,
      eventCount: events.length,
      latestEventHash: revoked.contentHash,
    }],
  })
  return {
    ...original,
    events,
    trustedOwners,
    trustedOwnerBundleContentHash: trustedOwners.contentHash,
  } as ReturnType<typeof authorityArtifacts>
}

function advanceAuthorityToRevoked(original: ReturnType<typeof authorityArtifacts>, workOrderId = "WO-MAO-030") {
  const initial = AUTHORITY_INITIAL_RECORDS.get(original)
  if (!initial) throw new Error("missing initial authority status record")
  const revoked = revokedAuthorityArtifacts(original)
  const record = authorityStatusRecord(
    original,
    revoked,
    workOrderId,
    2,
    initial.recordContentHash,
    "REVOKED_TERMINAL",
  )
  advanceTestHostedCodexAuthorityStatusChain(initial.recordId, record, iso(0))
  return record
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
    repositories?: string[]
    reservationRepositories?: string[]
    sameRelativeReservationPath?: boolean
    retryBudget?: { maxAttempts: number, backoffSeconds: number }
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
  if (options.retryBudget) {
    target.retryBudget = { ...options.retryBudget }
    topology.lanes[0].envelope.retryBudget = { ...options.retryBudget }
  }
  if (options.repositories) {
    target.repositories = [...options.repositories]
    target.baseRefs = options.repositories.map((repository) => ({
      repository,
      ref: "refs/heads/main",
      commitSha: "35de2eb8517697abc0539fa8b1cfc686aba26263",
    }))
    target.reservations.paths = (options.reservationRepositories ?? options.repositories).map((repository, index) => ({
      repository,
      path: options.sameRelativeReservationPath
        ? "scripts/multi-agent-operator/shared-relative-path.mjs"
        : index === 0
        ? "scripts/multi-agent-operator/codex-coordinator-adapter.mjs"
        : `scripts/multi-agent-operator/repository-scope-${index}.mjs`,
    }))
    topology.lanes[0].envelope = dispatchEnvelope(target)
  }
  const envelopeContentHash = validateDispatchEnvelope(topology.lanes[0].envelope).contentHash
  for (const role of ["coordinator", "builder", "reviewer"] as const) {
    installTestHostedCodexTrustRecord(trustEvidence(role, envelopeContentHash, {
      laneId: target.laneId,
      allowedPaths: target.reservations.paths.map(({ path }) => path),
    }))
  }
  const authority = options.authority ?? authorityArtifacts()
  installAuthorityStatus(authority, "WO-MAO-030")
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
    authorityProofs: [{ workOrderId: "WO-MAO-030", artifacts: authority }],
    runtimeActivationRequested: false,
    localIssue357Requested: false,
    durableTransportClaimed: false,
    ownerTouchBudget: ownerBudget(),
    ...overrides,
  }
}

function multiLaneInput() {
  const value = input()
  const workOrderId = "WO-MAO-031"
  const second = v2Envelope(workOrderId, ["WO-MAO-024", "WO-MAO-028", "WO-MAO-029"])
  second.teamRoles = {
    coordinator: ROLES.coordinator,
    builder: "codex-builder-second-lane",
    reviewer: "codex-reviewer-second-lane",
  }
  value.topologyInput.dagInput.workOrders.push(second)
  value.topologyInput.dagInput.workOrderStates.push({ workOrderId, state: "PLANNED", reasonCode: null })
  value.topologyInput.lanes.push({
    envelope: dispatchEnvelope(second),
    roleAssignments: {
      ...second.teamRoles,
      remediator: second.teamRoles.builder,
      mergeController: "codex-merge-controller",
      verifier: "codex-verifier",
    },
  })
  const envelopeContentHash = validateDispatchEnvelope(value.topologyInput.lanes[1].envelope).contentHash
  for (const role of ["coordinator", "builder", "reviewer"] as const) {
    const proofId = `trust-${role}-mao-031`
    installTestHostedCodexTrustRecord(trustEvidence(role, envelopeContentHash, {
      proofId,
      workOrderId,
      laneId: second.laneId,
      workerId: second.teamRoles[role],
      allowedPaths: second.reservations.paths.map(({ path }) => path),
    }))
    value.preventiveTrustProofReferences.push({ proofId })
  }
  const authority = authorityArtifacts(false, workOrderId)
  installAuthorityStatus(authority, workOrderId)
  value.authorityProofs.push({ workOrderId, artifacts: authority })
  return value
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
    expect(publicPlan).not.toContain("authorityStatusEvents")
    expect(publicPlan).not.toContain("ownerAuthorityTrustBundle")
    expect(publicPlan).not.toContain("publicKeyPem")
    expect(publicPlan).not.toContain("recordId")
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

    const nullGrant = input()
    nullGrant.authorityProofs[0].artifacts.grant = null as never
    expectWall(() => compileHostedCodexCoordinatorAdapter(nullGrant), "HOSTED_CODEX_AUTHORITY_WALL")
  })

  it.each([
    [["bsvalues/terragroq", "bsvalues/second-repository"]],
    [["bsvalues/second-repository", "bsvalues/terragroq"]],
  ])("rejects first-repository-only authority for multi-repository order %j", (repositories) => {
    expectWall(() => compileHostedCodexCoordinatorAdapter(input({}, { repositories })), "HOSTED_CODEX_AUTHORITY_WALL")
  })

  it.each([
    [["bsvalues/terragroq", "bsvalues/second-repository"]],
    [["bsvalues/second-repository", "bsvalues/terragroq"]],
  ])("validates every exact repository then contains multi-repository execution for order %j", (repositories) => {
    const authority = authorityArtifacts(false, "WO-MAO-030", repositories)
    expectWall(() => compileHostedCodexCoordinatorAdapter(input({}, {
      repositories,
      authority,
    })), "HOSTED_CODEX_MULTI_REPOSITORY_WALL")
    expect(bridgeCalls.spawn).toBe(0)
  })

  it("allows a grant repository superset for a single-repository envelope", () => {
    const authority = authorityArtifacts(false, "WO-MAO-030", [
      "bsvalues/terragroq",
      "bsvalues/unused-repository",
    ])
    expect(compileHostedCodexCoordinatorAdapter(input({}, { authority })).assignments).toHaveLength(3)
  })

  it("validates declared repositories even when no reservation uses them", () => {
    const repositories = ["bsvalues/terragroq", "bsvalues/second-repository"]
    expectWall(() => compileHostedCodexCoordinatorAdapter(input({}, {
      repositories,
      reservationRepositories: [repositories[0]],
    })), "HOSTED_CODEX_AUTHORITY_WALL")
  })

  it("contains identical relative paths until trust evidence is repository-qualified", () => {
    const repositories = ["bsvalues/terragroq", "bsvalues/second-repository"]
    const authority = authorityArtifacts(false, "WO-MAO-030", repositories)
    const value = input({}, {
      repositories,
      authority,
      sameRelativeReservationPath: true,
    })
    const envelopeHash = validateDispatchEnvelope(value.topologyInput.lanes[0].envelope).contentHash
    for (const role of ["coordinator", "builder", "reviewer"] as const) {
      installTestHostedCodexTrustRecord(trustEvidence(role, envelopeHash, {
        allowedPaths: ["scripts/multi-agent-operator/shared-relative-path.mjs"],
      }))
    }
    expectWall(() => compileHostedCodexCoordinatorAdapter(value), "HOSTED_CODEX_MULTI_REPOSITORY_WALL")
  })

  it("contains case-variant repository identities without claiming logical deduplication", () => {
    const repositories = ["bsvalues/terragroq", "BSVALUES/TerraGroq"]
    const authority = authorityArtifacts(false, "WO-MAO-030", repositories)
    expectWall(() => compileHostedCodexCoordinatorAdapter(input({}, {
      repositories,
      authority,
    })), "HOSTED_CODEX_MULTI_REPOSITORY_WALL")
  })

  it.each(["start", "send", "cancel", "observe", "committed-replay", "ambiguous-lookup"] as const)(
    "enforces a host-backed terminal authority revocation before %s",
    (scenario) => {
      if (scenario === "ambiguous-lookup") {
        installBridge({
          send(request: Record<string, unknown>) {
            bridgeCalls.send += 1
            const result = {
              schemaVersion: 1,
              artifactType: "HOSTED_CODEX_NATIVE_SEND_RESULT",
              bridgeId: "bridge-mao-030",
              assignmentId: request.assignmentId,
              nativeWorkerId: request.nativeWorkerId,
              messageDigest: request.messageDigest,
              status: "DELIVERED",
              deliveryPerformed: true,
              authorityGranted: false,
            }
            bridgeResults.send.set(request.idempotencyKey as string, result)
            return { ...result, deliveryPerformed: false }
          },
        })
      }
      const value = input()
      const original = value.authorityProofs[0].artifacts
      const plan = compileHostedCodexCoordinatorAdapter(value)
      const builder = assignment(plan, "builder")
      if (scenario !== "start") {
        startHostedCodexNativeAssignment(plan, {
          assignmentHandle: builder.handle,
          idempotencyKey: `spawn-before-revocation-${scenario}`,
        })
      }
      const message = {
        assignmentHandle: builder.handle,
        direction: "TO_ASSIGNMENT",
        messageType: "STATUS",
        summary: "Status before revocation.",
        idempotencyKey: `send-before-revocation-${scenario}`,
      }
      if (scenario === "committed-replay") createHostedCodexNativeMessage(plan, message)
      if (scenario === "ambiguous-lookup") {
        expectWall(() => createHostedCodexNativeMessage(plan, message), "HOSTED_CODEX_BRIDGE_WALL")
      }
      if (scenario === "observe") {
        observations.set("observation-after-revocation", {
          schemaVersion: 1,
          artifactType: "PROVIDER_STATUS",
          providerId: "hosted-codex",
          adapterId: "hosted-codex-session-native-team-v1",
          dispatchId: builder.item.assignmentId,
          workOrderId: builder.item.workOrderId,
          laneId: builder.item.laneId,
          providerState: "RUNNING",
          reasonCode: null,
          sanitized: true,
          authorityGranted: false,
          progressMarker: "RUNNING",
        })
      }
      advanceAuthorityToRevoked(original)

      const operation = () => {
        if (scenario === "start") {
          return startHostedCodexNativeAssignment(plan, {
            assignmentHandle: builder.handle,
            idempotencyKey: "spawn-after-revocation",
          })
        }
        if (scenario === "cancel") {
          return cancelHostedCodexNativeAssignment(plan, {
            assignmentHandle: builder.handle,
            requestedBy: ROLES.coordinator,
            reasonCode: "SUPERSEDED",
            idempotencyKey: "cancel-after-revocation",
          })
        }
        if (scenario === "observe") {
          return captureHostedCodexNativeEvidence(plan, {
            assignmentHandle: builder.handle,
            observationId: "observation-after-revocation",
          })
        }
        return createHostedCodexNativeMessage(plan, message)
      }
      expectWall(operation, "HOSTED_CODEX_AUTHORITY_REVOKED_TERMINAL_WALL")
      const counters = { ...bridgeCalls }
      installAuthorityStatus(original, "WO-MAO-030")
      expectWall(operation, "HOSTED_CODEX_AUTHORITY_REVOKED_TERMINAL_WALL")
      expect(bridgeCalls).toEqual(counters)
      if (scenario === "start") expect(bridgeCalls.spawn).toBe(0)
      if (scenario === "send") expect(bridgeCalls.send).toBe(0)
      if (scenario === "cancel") expect(bridgeCalls.cancel).toBe(0)
      if (scenario === "observe") expect(bridgeCalls.observe).toBe(0)
      if (scenario === "committed-replay") expect(bridgeCalls.send).toBe(1)
      if (scenario === "ambiguous-lookup") {
        expect(bridgeCalls).toMatchObject({ send: 1, lookupSend: 0 })
      }
    },
  )

  it.each([
    ["spawn", "ACTIVE_ADVANCE"], ["spawn", "REVOKED"],
    ["send", "ACTIVE_ADVANCE"], ["send", "REVOKED"],
    ["cancel", "ACTIVE_ADVANCE"], ["cancel", "REVOKED"],
    ["observe", "ACTIVE_ADVANCE"], ["observe", "REVOKED"],
  ] as const)("atomically rejects a %s effect after an in-boundary %s fence change", (operation, transition) => {
    const value = input()
    const original = value.authorityProofs[0].artifacts
    const initial = AUTHORITY_INITIAL_RECORDS.get(original)!
    let injected = false
    installBridge({
      beforeAuthorityFenceCheck(currentOperation: string) {
        if (currentOperation !== operation || injected) return
        injected = true
        if (transition === "REVOKED") {
          advanceAuthorityToRevoked(original)
        } else {
          const activeAdvance = authorityStatusRecord(
            original,
            original,
            "WO-MAO-030",
            2,
            initial.recordContentHash,
            "ACTIVE",
          )
          advanceTestHostedCodexAuthorityStatusChain(initial.recordId, activeAdvance, iso(0))
        }
      },
    })
    const plan = compileHostedCodexCoordinatorAdapter(value)
    const builder = assignment(plan, "builder")
    if (operation !== "spawn") {
      startHostedCodexNativeAssignment(plan, {
        assignmentHandle: builder.handle,
        idempotencyKey: `spawn-before-${operation}-${transition.toLowerCase()}`,
      })
    }
    if (operation === "observe") {
      observations.set(`observe-${transition.toLowerCase()}`, {
        schemaVersion: 1,
        artifactType: "PROVIDER_STATUS",
        providerId: "hosted-codex",
        adapterId: "hosted-codex-session-native-team-v1",
        dispatchId: builder.item.assignmentId,
        workOrderId: builder.item.workOrderId,
        laneId: builder.item.laneId,
        providerState: "RUNNING",
        reasonCode: null,
        sanitized: true,
        authorityGranted: false,
        progressMarker: "RUNNING",
      })
    }
    const before = { ...bridgeCalls }
    const invoke = () => {
      if (operation === "spawn") {
        return startHostedCodexNativeAssignment(plan, {
          assignmentHandle: builder.handle,
          idempotencyKey: `spawn-race-${transition.toLowerCase()}`,
        })
      }
      if (operation === "send") {
        return createHostedCodexNativeMessage(plan, {
          assignmentHandle: builder.handle,
          direction: "TO_ASSIGNMENT",
          messageType: "STATUS",
          summary: "Atomic authority fence race.",
          idempotencyKey: `send-race-${transition.toLowerCase()}`,
        })
      }
      if (operation === "cancel") {
        return cancelHostedCodexNativeAssignment(plan, {
          assignmentHandle: builder.handle,
          requestedBy: ROLES.coordinator,
          reasonCode: "SUPERSEDED",
          idempotencyKey: `cancel-race-${transition.toLowerCase()}`,
        })
      }
      return captureHostedCodexNativeEvidence(plan, {
        assignmentHandle: builder.handle,
        observationId: `observe-${transition.toLowerCase()}`,
      })
    }
    expectWall(invoke, "HOSTED_CODEX_AUTHORITY_FENCE_WALL")
    expect(injected).toBe(true)
    expect(bridgeCalls).toEqual(before)
    if (transition === "REVOKED") {
      expectWall(invoke, "HOSTED_CODEX_AUTHORITY_REVOKED_TERMINAL_WALL")
      expect(bridgeCalls).toEqual(before)
    } else {
      expect(invoke()).toBeDefined()
      expect(bridgeCalls).toEqual({ ...before, [operation]: before[operation] + 1 })
    }
  })

  it.each([
    ["lookupSpawn", "ACTIVE_ADVANCE"], ["lookupSpawn", "REVOKED"],
    ["lookupSend", "ACTIVE_ADVANCE"], ["lookupSend", "REVOKED"],
    ["lookupCancel", "ACTIVE_ADVANCE"], ["lookupCancel", "REVOKED"],
  ] as const)("atomically rejects %s after an in-boundary %s fence change", (lookupOperation, transition) => {
    const value = input()
    const original = value.authorityProofs[0].artifacts
    const initial = AUTHORITY_INITIAL_RECORDS.get(original)!
    const effect = lookupOperation.slice("lookup".length).toLowerCase()
    let lookupRaceArmed = false
    let injected = false
    installBridge({
      beforeAuthorityFenceCheck(currentOperation: string) {
        if (!lookupRaceArmed || currentOperation !== lookupOperation || injected) return
        injected = true
        if (transition === "REVOKED") {
          advanceAuthorityToRevoked(original)
        } else {
          const activeAdvance = authorityStatusRecord(
            original, original, "WO-MAO-030", 2, initial.recordContentHash, "ACTIVE",
          )
          advanceTestHostedCodexAuthorityStatusChain(initial.recordId, activeAdvance, iso(0))
        }
      },
      ...(effect === "spawn" ? {
        spawn(request: Record<string, unknown>) {
          bridgeCalls.spawn += 1
          const result = {
            schemaVersion: 1, artifactType: "HOSTED_CODEX_NATIVE_SPAWN_RESULT",
            bridgeId: "bridge-mao-030", adapterRunId: request.adapterRunId,
            assignmentId: request.assignmentId, workOrderId: request.workOrderId,
            laneId: request.laneId, role: request.role, logicalWorkerId: request.logicalWorkerId,
            nativeWorkerId: "native-builder-ambiguous", status: "SPAWNED", spawnPerformed: false,
            currentSessionOnly: true, authorityGranted: false,
          }
          bridgeResults.spawn.set(request.idempotencyKey as string, { ...result, spawnPerformed: true })
          return result
        },
      } : {}),
      ...(effect === "send" ? {
        send(request: Record<string, unknown>) {
          bridgeCalls.send += 1
          const committed = {
            schemaVersion: 1, artifactType: "HOSTED_CODEX_NATIVE_SEND_RESULT", bridgeId: "bridge-mao-030",
            assignmentId: request.assignmentId, nativeWorkerId: request.nativeWorkerId,
            messageDigest: request.messageDigest, status: "DELIVERED", deliveryPerformed: true,
            authorityGranted: false,
          }
          bridgeResults.send.set(request.idempotencyKey as string, committed)
          return { ...committed, deliveryPerformed: false }
        },
      } : {}),
      ...(effect === "cancel" ? {
        cancel(request: Record<string, unknown>) {
          bridgeCalls.cancel += 1
          const committed = {
            schemaVersion: 1, artifactType: "HOSTED_CODEX_NATIVE_CANCEL_RESULT", bridgeId: "bridge-mao-030",
            assignmentId: request.assignmentId, nativeWorkerId: request.nativeWorkerId,
            reasonCode: request.reasonCode, status: "CANCELLED", cancellationPerformed: true,
            cancelAcknowledged: true, authorityGranted: false,
          }
          bridgeResults.cancel.set(request.idempotencyKey as string, committed)
          return { ...committed, cancellationPerformed: false }
        },
      } : {}),
    })
    const plan = compileHostedCodexCoordinatorAdapter(value)
    const builder = assignment(plan, "builder")
    if (effect !== "spawn") {
      startHostedCodexNativeAssignment(plan, {
        assignmentHandle: builder.handle,
        idempotencyKey: `spawn-before-ambiguous-${effect}-${transition.toLowerCase()}`,
      })
    }
    const idempotencyKey = `ambiguous-${effect}-${transition.toLowerCase()}`
    const invoke = () => {
      if (effect === "spawn") {
        return startHostedCodexNativeAssignment(plan, { assignmentHandle: builder.handle, idempotencyKey })
      }
      if (effect === "send") {
        return createHostedCodexNativeMessage(plan, {
          assignmentHandle: builder.handle, direction: "TO_ASSIGNMENT", messageType: "STATUS",
          summary: "Ambiguous effect requires fenced reconciliation.", idempotencyKey,
        })
      }
      return cancelHostedCodexNativeAssignment(plan, {
        assignmentHandle: builder.handle, requestedBy: ROLES.coordinator,
        reasonCode: "SUPERSEDED", idempotencyKey,
      })
    }
    expectWall(invoke, "HOSTED_CODEX_BRIDGE_WALL")
    lookupRaceArmed = true
    const before = { ...bridgeCalls }
    expectWall(invoke, "HOSTED_CODEX_AUTHORITY_FENCE_WALL")
    expect(injected).toBe(true)
    expect(bridgeCalls).toEqual(before)
    if (transition === "REVOKED") {
      expectWall(invoke, "HOSTED_CODEX_AUTHORITY_REVOKED_TERMINAL_WALL")
      expect(bridgeCalls).toEqual(before)
    } else {
      expect(invoke()).toBeDefined()
      expect(bridgeCalls).toEqual({ ...before, [lookupOperation]: before[lookupOperation] + 1 })
    }
  })

  it("quarantines an effect when the trusted bridge does not echo the exact enforced authority fence", () => {
    installBridge({
      transformBridgeInvocation(operation: string, invocation: Record<string, unknown>) {
        if (operation !== "spawn") return invocation
        return {
          ...invocation,
          authorityFence: { ...(invocation.authorityFence as Record<string, unknown>), fencingToken: 999 },
        }
      },
    })
    const plan = compileHostedCodexCoordinatorAdapter(input())
    const builder = assignment(plan, "builder")
    expectWall(() => startHostedCodexNativeAssignment(plan, {
      assignmentHandle: builder.handle,
      idempotencyKey: "spawn-with-substituted-fence-echo",
    }), "HOSTED_CODEX_BRIDGE_WALL")
    expect(bridgeCalls.spawn).toBe(1)
  })

  it("does not substitute an already compiled plan bridge when the test registry entry changes", () => {
    const plan = compileHostedCodexCoordinatorAdapter(input())
    const builder = assignment(plan, "builder")
    let substitutedBridgeCalled = false
    installBridge({
      spawn() {
        substitutedBridgeCalled = true
        throw new Error("substituted bridge must remain unreachable")
      },
    })
    expect(startHostedCodexNativeAssignment(plan, {
      assignmentHandle: builder.handle,
      idempotencyKey: "spawn-with-post-compile-bridge-substitution",
    })).toMatchObject({ nativeAssignmentExecuted: true })
    expect(substitutedBridgeCalled).toBe(false)
  })

  it("keeps an ambiguous lookup quarantined when its original effect binding echo is substituted", () => {
    installBridge({
      send(request: Record<string, unknown>) {
        bridgeCalls.send += 1
        const committed = {
          schemaVersion: 1, artifactType: "HOSTED_CODEX_NATIVE_SEND_RESULT", bridgeId: "bridge-mao-030",
          assignmentId: request.assignmentId, nativeWorkerId: request.nativeWorkerId,
          messageDigest: request.messageDigest, status: "DELIVERED", deliveryPerformed: true,
          authorityGranted: false,
        }
        bridgeResults.send.set(request.idempotencyKey as string, committed)
        return { ...committed, deliveryPerformed: false }
      },
      transformBridgeInvocation(operation: string, invocation: Record<string, unknown>) {
        if (operation !== "lookupSend") return invocation
        const original = invocation.originalEffectBinding as Record<string, unknown>
        return { ...invocation, originalEffectBinding: { ...original, effectDigest: "0".repeat(64) } }
      },
    })
    const plan = compileHostedCodexCoordinatorAdapter(input())
    const builder = assignment(plan, "builder")
    startHostedCodexNativeAssignment(plan, {
      assignmentHandle: builder.handle,
      idempotencyKey: "spawn-before-original-effect-binding-attack",
    })
    const request = {
      assignmentHandle: builder.handle,
      direction: "TO_ASSIGNMENT",
      messageType: "STATUS",
      summary: "Original effect fence binding must remain exact.",
      idempotencyKey: "send-original-effect-binding-attack",
    }
    expectWall(() => createHostedCodexNativeMessage(plan, request), "HOSTED_CODEX_BRIDGE_WALL")
    expectWall(() => createHostedCodexNativeMessage(plan, request), "HOSTED_CODEX_BRIDGE_WALL")
    expect(bridgeCalls).toMatchObject({ send: 1, lookupSend: 1 })
  })

  it.each(["spawn", "send", "cancel"] as const)(
    "does not trust a forged fence-rejection code thrown after a %s effect",
    (operation) => {
      const forgedFenceError = () => {
        const error = new Error("forged post-effect fence rejection") as Error & { code: string }
        error.code = "HOSTED_CODEX_HOST_AUTHORITY_FENCE_WALL"
        return error
      }
      installBridge({
        effectCommittedAfterThrow(currentOperation: string) {
          return currentOperation === operation
        },
        ...(operation === "spawn" ? {
          spawn(request: Record<string, unknown>) {
            bridgeCalls.spawn += 1
            bridgeResults.spawn.set(request.idempotencyKey as string, {
              schemaVersion: 1, artifactType: "HOSTED_CODEX_NATIVE_SPAWN_RESULT",
              bridgeId: "bridge-mao-030", adapterRunId: request.adapterRunId,
              assignmentId: request.assignmentId, workOrderId: request.workOrderId,
              laneId: request.laneId, role: request.role, logicalWorkerId: request.logicalWorkerId,
              nativeWorkerId: "native-builder-forged-wall", status: "SPAWNED", spawnPerformed: true,
              currentSessionOnly: true, authorityGranted: false,
            })
            throw forgedFenceError()
          },
        } : {}),
        ...(operation === "send" ? {
          send(request: Record<string, unknown>) {
            bridgeCalls.send += 1
            bridgeResults.send.set(request.idempotencyKey as string, {
              schemaVersion: 1, artifactType: "HOSTED_CODEX_NATIVE_SEND_RESULT", bridgeId: "bridge-mao-030",
              assignmentId: request.assignmentId, nativeWorkerId: request.nativeWorkerId,
              messageDigest: request.messageDigest, status: "DELIVERED", deliveryPerformed: true,
              authorityGranted: false,
            })
            throw forgedFenceError()
          },
        } : {}),
        ...(operation === "cancel" ? {
          cancel(request: Record<string, unknown>) {
            bridgeCalls.cancel += 1
            bridgeResults.cancel.set(request.idempotencyKey as string, {
              schemaVersion: 1, artifactType: "HOSTED_CODEX_NATIVE_CANCEL_RESULT", bridgeId: "bridge-mao-030",
              assignmentId: request.assignmentId, nativeWorkerId: request.nativeWorkerId,
              reasonCode: request.reasonCode, status: "CANCELLED", cancellationPerformed: true,
              cancelAcknowledged: true, authorityGranted: false,
            })
            throw forgedFenceError()
          },
        } : {}),
      })
      const plan = compileHostedCodexCoordinatorAdapter(input())
      const builder = assignment(plan, "builder")
      if (operation !== "spawn") {
        startHostedCodexNativeAssignment(plan, {
          assignmentHandle: builder.handle,
          idempotencyKey: `spawn-before-forged-${operation}-wall`,
        })
      }
      const idempotencyKey = `forged-${operation}-fence-wall`
      const invoke = () => {
        if (operation === "spawn") {
          return startHostedCodexNativeAssignment(plan, { assignmentHandle: builder.handle, idempotencyKey })
        }
        if (operation === "send") {
          return createHostedCodexNativeMessage(plan, {
            assignmentHandle: builder.handle, direction: "TO_ASSIGNMENT", messageType: "STATUS",
            summary: "Forged fence error must remain ambiguous.", idempotencyKey,
          })
        }
        return cancelHostedCodexNativeAssignment(plan, {
          assignmentHandle: builder.handle, requestedBy: ROLES.coordinator,
          reasonCode: "SUPERSEDED", idempotencyKey,
        })
      }
      expectWall(invoke, "HOSTED_CODEX_BRIDGE_WALL")
      if (operation === "spawn") {
        expectWall(() => startHostedCodexNativeAssignment(plan, {
          assignmentHandle: builder.handle,
          idempotencyKey: "new-key-after-forged-spawn-wall",
        }), "HOSTED_CODEX_ASSIGNMENT_WALL")
      } else if (operation === "send") {
        expectWall(() => createHostedCodexNativeMessage(plan, {
          assignmentHandle: builder.handle, direction: "TO_ASSIGNMENT", messageType: "STATUS",
          summary: "A new key cannot bypass ambiguity.",
          idempotencyKey: "new-key-after-forged-send-wall",
        }), "HOSTED_CODEX_MESSAGE_WALL")
      } else {
        expectWall(() => cancelHostedCodexNativeAssignment(plan, {
          assignmentHandle: builder.handle, requestedBy: ROLES.coordinator,
          reasonCode: "SUPERSEDED", idempotencyKey: "new-key-after-forged-cancel-wall",
        }), "HOSTED_CODEX_CANCELLATION_WALL")
      }
      expect(invoke()).toBeDefined()
      expect(bridgeCalls[operation]).toBe(1)
      const lookupOperation = `lookup${operation[0].toUpperCase()}${operation.slice(1)}` as keyof typeof bridgeCalls
      expect(bridgeCalls[lookupOperation]).toBe(1)
    },
  )

  it("requires atomic fence enforcement and exact echo capabilities on the bridge", () => {
    installBridge({ atomicAuthorityFenceEnforced: false })
    expectWall(() => compileHostedCodexCoordinatorAdapter(input()), "HOSTED_CODEX_BRIDGE_WALL")
    installBridge({ authorityFenceEchoRequired: false })
    expectWall(() => compileHostedCodexCoordinatorAdapter(input()), "HOSTED_CODEX_BRIDGE_WALL")
  })

  it("keeps a trusted not-yet-committed observation retryable without manufacturing evidence", () => {
    let pending = true
    installBridge({
      observe(request: Record<string, unknown>) {
        bridgeCalls.observe += 1
        if (pending) {
          const error = new Error("observation not committed") as Error & { code: string }
          error.code = "HOST_OBSERVATION_PENDING"
          throw error
        }
        const response = observations.get(request.observationId as string)
        if (!response) throw new Error("missing observation")
        return response
      },
    })
    const plan = compileHostedCodexCoordinatorAdapter(input())
    const builder = assignment(plan, "builder")
    startHostedCodexNativeAssignment(plan, {
      assignmentHandle: builder.handle,
      idempotencyKey: "spawn-before-pending-observation",
    })
    observations.set("pending-observation", {
      schemaVersion: 1,
      artifactType: "PROVIDER_STATUS",
      providerId: "hosted-codex",
      adapterId: "hosted-codex-session-native-team-v1",
      dispatchId: builder.item.assignmentId,
      workOrderId: builder.item.workOrderId,
      laneId: builder.item.laneId,
      providerState: "RUNNING",
      reasonCode: null,
      sanitized: true,
      authorityGranted: false,
      progressMarker: "RUNNING",
    })
    const request = { assignmentHandle: builder.handle, observationId: "pending-observation" }
    expectWall(() => captureHostedCodexNativeEvidence(plan, request), "HOSTED_CODEX_OBSERVATION_PENDING_WALL")
    expect(bridgeCalls.observe).toBe(1)
    pending = false
    expect(captureHostedCodexNativeEvidence(plan, request)).toMatchObject({ providerState: "RUNNING" })
    expect(bridgeCalls.observe).toBe(2)
  })

  it("attests only closed PROVIDER_EVIDENCE lifecycle semantics without exposing private attributes or fence fields", () => {
    const plan = compileHostedCodexCoordinatorAdapter(input())
    const builder = assignment(plan, "builder")
    startHostedCodexNativeAssignment(plan, {
      assignmentHandle: builder.handle,
      idempotencyKey: "spawn-semantic-builder",
    })
    observations.set("semantic-build-complete", {
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
      eventId: "semantic-build-complete",
      evidenceType: "CODEX_ROLE_BUILD_COMPLETE",
      contentHash: "a".repeat(64),
      summary: "Builder completed the reserved implementation.",
      attributes: { outcome: "COMPLETE", stage: "BUILD" },
      rawProviderOutputIncluded: false,
    })
    const evidenceHandle = captureHostedCodexNativeSemanticEvidence(plan, {
      assignmentHandle: builder.handle,
      observationId: "semantic-build-complete",
      expectedKind: "CODEX_ROLE_BUILD_COMPLETE",
    })
    const attestation = attestHostedCodexSemanticEvidence(plan, {
      assignmentHandle: builder.handle,
      evidenceHandle,
      semanticConstraintId: "BUILD_COMPLETE",
    })
    expect(attestation).toMatchObject({
      assignmentId: builder.item.assignmentId,
      workOrderId: "WO-MAO-030",
      role: "builder",
      semanticConstraintId: "BUILD_COMPLETE",
      evidenceType: "CODEX_ROLE_BUILD_COMPLETE",
      sanitized: true,
      rawProviderOutputIncluded: false,
      authorityGranted: false,
    })
    expect(attestation).not.toHaveProperty("attributes")
    expect(JSON.stringify(attestation)).not.toMatch(/recordId|fencingToken|recordContentHash|native-builder-mao-030/)
    expectWall(() => attestHostedCodexSemanticEvidence(plan, {
      assignmentHandle: builder.handle,
      evidenceHandle,
      semanticConstraintId: "CALLER_SELECTED_CONSTRAINT",
    }), "HOSTED_CODEX_EVIDENCE_HANDLE_WALL")
  })

  it("does not accept a matching PROVIDER_ARTIFACT kind as lifecycle semantic evidence", () => {
    const plan = compileHostedCodexCoordinatorAdapter(input())
    const builder = assignment(plan, "builder")
    startHostedCodexNativeAssignment(plan, {
      assignmentHandle: builder.handle,
      idempotencyKey: "spawn-artifact-semantic-wall",
    })
    observations.set("artifact-semantic-wall", {
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
      artifactId: "artifact-semantic-wall",
      artifactKind: "CODEX_ROLE_BUILD_COMPLETE",
      contentHash: "b".repeat(64),
      relativePath: "scripts/multi-agent-operator/codex-coordinator-adapter.mjs",
    })
    expectWall(() => captureHostedCodexNativeSemanticEvidence(plan, {
      assignmentHandle: builder.handle,
      observationId: "artifact-semantic-wall",
      expectedKind: "CODEX_ROLE_BUILD_COMPLETE",
    }), "HOSTED_CODEX_EVIDENCE_WALL")
  })

  it("attests a same-lane builder/reviewer pair with distinct private native bindings", () => {
    const plan = compileHostedCodexCoordinatorAdapter(input())
    const builder = assignment(plan, "builder")
    const reviewer = assignment(plan, "reviewer")
    const builderStart = startHostedCodexNativeAssignment(plan, {
      assignmentHandle: builder.handle,
      idempotencyKey: "spawn-pair-builder",
    })
    const reviewerStart = startHostedCodexNativeAssignment(plan, {
      assignmentHandle: reviewer.handle,
      idempotencyKey: "spawn-pair-reviewer",
    })
    const pair = attestHostedCodexRoleAssignmentPair(plan, {
      builderAssignmentHandle: builder.handle,
      reviewerAssignmentHandle: reviewer.handle,
    })
    expect(pair).toMatchObject({
      workOrderId: "WO-MAO-030",
      laneId: "LANE-WO-MAO-030",
      remediationBudget: { maxCycles: 2 },
      authorityGranted: false,
    })
    expect(pair.builderNativeBindingDigest).not.toBe(pair.reviewerNativeBindingDigest)
    expect(pair.builderNativeWorkerDigest).toBe(builderStart.nativeWorkerDigest)
    expect(pair.reviewerNativeWorkerDigest).toBe(reviewerStart.nativeWorkerDigest)
    expect(JSON.stringify(pair)).not.toMatch(/native-builder-mao-030|native-reviewer-mao-030/)
  })

  it("rejects copied and cross-plan role handle pairs before any bridge effect", () => {
    const left = compileHostedCodexCoordinatorAdapter(input({ adapterRunId: "run-cross-plan-left" }))
    const leftBuilder = assignment(left, "builder")
    const leftReviewer = assignment(left, "reviewer")
    const right = compileHostedCodexCoordinatorAdapter(input({ adapterRunId: "run-cross-plan-left" }))
    const rightReviewer = assignment(right, "reviewer")
    expectWall(() => attestHostedCodexRoleAssignmentHandles(left, {
      builderAssignmentHandle: leftBuilder.handle,
      reviewerAssignmentHandle: structuredClone(leftReviewer.handle),
    }), "HOSTED_CODEX_ASSIGNMENT_HANDLE_WALL")
    expectWall(() => attestHostedCodexRoleAssignmentHandles(left, {
      builderAssignmentHandle: leftBuilder.handle,
      reviewerAssignmentHandle: rightReviewer.handle,
    }), "HOSTED_CODEX_ASSIGNMENT_HANDLE_WALL")
    expect(bridgeCalls).toMatchObject({ spawn: 0, send: 0, cancel: 0, observe: 0 })
  })

  it("fails closed when the host authority-status source disappears", () => {
    const value = input()
    const original = value.authorityProofs[0].artifacts
    const plan = compileHostedCodexCoordinatorAdapter(value)
    const builder = assignment(plan, "builder")
    removeTestHostedCodexAuthorityStatusChain(authorityStatusRecordId(original, "WO-MAO-030"))
    expectWall(() => startHostedCodexNativeAssignment(plan, {
      assignmentHandle: builder.handle,
      idempotencyKey: "spawn-with-missing-authority-source",
    }), "HOSTED_CODEX_AUTHORITY_STATUS_REGISTRY_WALL")
    expect(bridgeCalls.spawn).toBe(0)
  })

  it("preserves registry identity and rejects a substituted registry before spawn", () => {
    const value = input()
    const original = value.authorityProofs[0].artifacts
    const initial = AUTHORITY_INITIAL_RECORDS.get(original)!
    const plan = compileHostedCodexCoordinatorAdapter(value)
    const builder = assignment(plan, "builder")
    installTestHostedCodexAuthorityStatusChain({
      registryId: "substituted-authority-status-registry",
      registryVersion: 1,
      evaluationTime: iso(0),
      recordId: initial.recordId,
      latestFencingToken: 1,
      latestRecordContentHash: initial.recordContentHash,
      records: [initial],
    })
    expectWall(() => startHostedCodexNativeAssignment(plan, {
      assignmentHandle: builder.handle,
      idempotencyKey: "spawn-with-substituted-authority-registry",
    }), "HOSTED_CODEX_AUTHORITY_STATUS_REGISTRY_WALL")
    expect(bridgeCalls.spawn).toBe(0)
  })

  it.each([
    ["ahead", 2],
    ["behind", 0],
  ] as const)("rejects a declared authority head fence %s of its records", (_direction, latestFencingToken) => {
    const value = input()
    const original = value.authorityProofs[0].artifacts
    const initial = AUTHORITY_INITIAL_RECORDS.get(original)!
    const plan = compileHostedCodexCoordinatorAdapter(value)
    const builder = assignment(plan, "builder")
    installTestHostedCodexAuthorityStatusChain({
      registryId: "hosted-codex-authority-status-registry-v1",
      registryVersion: 1,
      evaluationTime: iso(0),
      recordId: initial.recordId,
      latestFencingToken,
      latestRecordContentHash: initial.recordContentHash,
      records: [initial],
    })
    expectWall(() => startHostedCodexNativeAssignment(plan, {
      assignmentHandle: builder.handle,
      idempotencyKey: `spawn-with-${_direction}-authority-fence`,
    }), "HOSTED_CODEX_AUTHORITY_STATUS_REGISTRY_WALL")
    expect(bridgeCalls.spawn).toBe(0)
  })

  it("derives the authority head hash from the immutable last record", () => {
    const value = input()
    const original = value.authorityProofs[0].artifacts
    const initial = AUTHORITY_INITIAL_RECORDS.get(original)!
    const plan = compileHostedCodexCoordinatorAdapter(value)
    const builder = assignment(plan, "builder")
    installTestHostedCodexAuthorityStatusChain({
      registryId: "hosted-codex-authority-status-registry-v1",
      registryVersion: 1,
      evaluationTime: iso(0),
      recordId: initial.recordId,
      latestFencingToken: 1,
      latestRecordContentHash: "a".repeat(64),
      records: [initial],
    })
    expect(startHostedCodexNativeAssignment(plan, {
      assignmentHandle: builder.handle,
      idempotencyKey: "spawn-with-derived-authority-head-hash",
    })).toMatchObject({ nativeAssignmentExecuted: true })
  })

  it("rejects authority fence rollback after accepting a live record", () => {
    const value = input()
    const original = value.authorityProofs[0].artifacts
    const initial = AUTHORITY_INITIAL_RECORDS.get(original)!
    const plan = compileHostedCodexCoordinatorAdapter(value)
    const builder = assignment(plan, "builder")
    startHostedCodexNativeAssignment(plan, {
      assignmentHandle: builder.handle,
      idempotencyKey: "spawn-before-authority-fence-rollback",
    })
    installTestHostedCodexAuthorityStatusChain({
      registryId: "hosted-codex-authority-status-registry-v1",
      registryVersion: 1,
      evaluationTime: iso(0),
      recordId: initial.recordId,
      latestFencingToken: 0,
      latestRecordContentHash: initial.recordContentHash,
      records: [initial],
    })
    expectWall(() => createHostedCodexNativeMessage(plan, {
      assignmentHandle: builder.handle,
      direction: "TO_ASSIGNMENT",
      messageType: "STATUS",
      summary: "Fence rollback must fail closed.",
      idempotencyKey: "send-after-authority-fence-rollback",
    }), "HOSTED_CODEX_AUTHORITY_STATUS_REGISTRY_WALL")
    expect(bridgeCalls.send).toBe(0)
  })

  it("rejects authority registry-version rollback after accepting a live record", () => {
    const value = input()
    const original = value.authorityProofs[0].artifacts
    const initial = AUTHORITY_INITIAL_RECORDS.get(original)!
    installTestHostedCodexAuthorityStatusChain({
      registryId: "hosted-codex-authority-status-registry-v1",
      registryVersion: 2,
      evaluationTime: iso(0),
      recordId: initial.recordId,
      latestFencingToken: 1,
      latestRecordContentHash: initial.recordContentHash,
      records: [initial],
    })
    const plan = compileHostedCodexCoordinatorAdapter(value)
    const builder = assignment(plan, "builder")
    startHostedCodexNativeAssignment(plan, {
      assignmentHandle: builder.handle,
      idempotencyKey: "spawn-before-authority-registry-version-rollback",
    })
    installTestHostedCodexAuthorityStatusChain({
      registryId: "hosted-codex-authority-status-registry-v1",
      registryVersion: 1,
      evaluationTime: iso(0),
      recordId: initial.recordId,
      latestFencingToken: 1,
      latestRecordContentHash: initial.recordContentHash,
      records: [initial],
    })
    expectWall(() => createHostedCodexNativeMessage(plan, {
      assignmentHandle: builder.handle,
      direction: "TO_ASSIGNMENT",
      messageType: "STATUS",
      summary: "Registry version rollback must fail closed.",
      idempotencyKey: "send-after-authority-registry-version-rollback",
    }), "HOSTED_CODEX_AUTHORITY_STATUS_REGISTRY_WALL")
    expect(bridgeCalls.send).toBe(0)
  })

  it("rejects equal-fence equivocation before any later bridge call", () => {
    const value = input()
    const original = value.authorityProofs[0].artifacts
    const initial = AUTHORITY_INITIAL_RECORDS.get(original)!
    const plan = compileHostedCodexCoordinatorAdapter(value)
    const builder = assignment(plan, "builder")
    startHostedCodexNativeAssignment(plan, {
      assignmentHandle: builder.handle,
      idempotencyKey: "spawn-before-equal-fence-equivocation",
    })
    advanceTestHostedCodexAuthorityStatusChain(initial.recordId, {
      ...initial,
      recordContentHash: "a".repeat(64),
    }, iso(0))
    expectWall(() => createHostedCodexNativeMessage(plan, {
      assignmentHandle: builder.handle,
      direction: "TO_ASSIGNMENT",
      messageType: "STATUS",
      summary: "Must not cross an equivocated fence.",
      idempotencyKey: "send-after-equal-fence-equivocation",
    }), "HOSTED_CODEX_AUTHORITY_STATUS_INTEGRITY_WALL")
    expect(bridgeCalls.send).toBe(0)
  })

  it("cryptographically revalidates cached authority artifacts on an unchanged fence", () => {
    const value = input()
    const original = value.authorityProofs[0].artifacts
    const initial = AUTHORITY_INITIAL_RECORDS.get(original)!
    const plan = compileHostedCodexCoordinatorAdapter(value)
    const builder = assignment(plan, "builder")
    startHostedCodexNativeAssignment(plan, {
      assignmentHandle: builder.handle,
      idempotencyKey: "spawn-before-cached-authority-expiry",
    })
    const afterGrantExpiry = new Date(Date.parse(original.grant.expiresAt) + 1)
    vi.useFakeTimers()
    vi.setSystemTime(afterGrantExpiry)
    installTestHostedCodexAuthorityStatusChain({
      registryId: "hosted-codex-authority-status-registry-v1",
      registryVersion: 1,
      evaluationTime: afterGrantExpiry.toISOString(),
      recordId: initial.recordId,
      latestFencingToken: 1,
      latestRecordContentHash: initial.recordContentHash,
      records: [initial],
    })
    expectWall(() => createHostedCodexNativeMessage(plan, {
      assignmentHandle: builder.handle,
      direction: "TO_ASSIGNMENT",
      messageType: "STATUS",
      summary: "Cached authority must be revalidated.",
      idempotencyKey: "send-after-cached-authority-expiry",
    }), "HOSTED_CODEX_AUTHORITY_STATUS_INTEGRITY_WALL")
    expect(bridgeCalls.send).toBe(0)
  })

  it("terminally latches signed revocation even when its host wrapper claims ACTIVE", () => {
    const value = input()
    const original = value.authorityProofs[0].artifacts
    const initial = AUTHORITY_INITIAL_RECORDS.get(original)!
    const plan = compileHostedCodexCoordinatorAdapter(value)
    const builder = assignment(plan, "builder")
    const revoked = revokedAuthorityArtifacts(original)
    const mislabeled = authorityStatusRecord(
      original,
      revoked,
      "WO-MAO-030",
      2,
      initial.recordContentHash,
      "ACTIVE",
    )
    advanceTestHostedCodexAuthorityStatusChain(initial.recordId, mislabeled, iso(0))
    const operation = () => startHostedCodexNativeAssignment(plan, {
      assignmentHandle: builder.handle,
      idempotencyKey: "spawn-after-mislabeled-revocation",
    })
    expectWall(operation, "HOSTED_CODEX_AUTHORITY_REVOKED_TERMINAL_WALL")
    expect(bridgeCalls.spawn).toBe(0)

    const activeSecondFence = authorityStatusRecord(
      original,
      original,
      "WO-MAO-030",
      2,
      initial.recordContentHash,
      "ACTIVE",
    )
    installTestHostedCodexAuthorityStatusChain({
      registryId: "hosted-codex-authority-status-registry-v1",
      registryVersion: 1,
      evaluationTime: iso(0),
      recordId: initial.recordId,
      latestFencingToken: 2,
      latestRecordContentHash: activeSecondFence.recordContentHash,
      records: [initial, activeSecondFence],
    })
    expectWall(operation, "HOSTED_CODEX_AUTHORITY_REVOKED_TERMINAL_WALL")
    expect(bridgeCalls.spawn).toBe(0)
  })

  it("typed-walls malformed current trust identities instead of throwing", () => {
    const value = input()
    const original = value.authorityProofs[0].artifacts
    const initial = AUTHORITY_INITIAL_RECORDS.get(original)!
    const plan = compileHostedCodexCoordinatorAdapter(value)
    const builder = assignment(plan, "builder")
    const malformed = structuredClone(authorityStatusRecord(
      original,
      original,
      "WO-MAO-030",
      2,
      initial.recordContentHash,
      "ACTIVE",
    ))
    malformed.currentArtifacts.ownerAuthorityTrustBundle.owners = null as never
    const { recordContentHash: _recordContentHash, ...claims } = malformed
    malformed.recordContentHash = sha256Canonical(claims)
    advanceTestHostedCodexAuthorityStatusChain(initial.recordId, malformed, iso(0))
    expectWall(() => startHostedCodexNativeAssignment(plan, {
      assignmentHandle: builder.handle,
      idempotencyKey: "spawn-with-malformed-live-trust",
    }), "HOSTED_CODEX_AUTHORITY_STATUS_BINDING_WALL")
    expect(bridgeCalls.spawn).toBe(0)
  })

  it.each(["authorityStatusRecordId", "authorityRegistryVersion", "fencingToken", "authorityRepository"])(
    "rejects caller authority-status selector %s",
    (field) => {
      expectWall(() => compileHostedCodexCoordinatorAdapter(input({ [field]: "caller-selected" })), "HOSTED_CODEX_UNKNOWN_FIELD_WALL")
    },
  )

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

  it("deduplicates a shared coordinator while counting each active or ambiguous child", () => {
    installBridge({
      spawn(request: Record<string, unknown>) {
        bridgeCalls.spawn += 1
        const result = {
          schemaVersion: 1,
          artifactType: "HOSTED_CODEX_NATIVE_SPAWN_RESULT",
          bridgeId: "bridge-mao-030",
          adapterRunId: request.adapterRunId,
          assignmentId: request.assignmentId,
          workOrderId: request.workOrderId,
          laneId: request.laneId,
          role: request.role,
          logicalWorkerId: request.logicalWorkerId,
          nativeWorkerId: `native-${String(request.workOrderId).toLowerCase()}-${request.role}`,
          status: "SPAWNED",
          spawnPerformed: true,
          currentSessionOnly: true,
          authorityGranted: false,
        }
        bridgeResults.spawn.set(request.idempotencyKey as string, result)
        return result
      },
      send() {
        bridgeCalls.send += 1
        throw new Error("ambiguous send")
      },
    })
    const plan = compileHostedCodexCoordinatorAdapter(multiLaneInput())
    expect(plan.assignmentCount).toBe(6)
    expect(plan.concurrency).toEqual({
      ceiling: 3,
      phaseWidths: { COORDINATION: 1, BUILD: 3, REVIEW: 3, REMEDIATION: 2 },
    })
    const builders = plan.assignments.filter(({ role }) => role === "builder")
    const reviewers = plan.assignments.filter(({ role }) => role === "reviewer")
    const handle = (item: typeof plan.assignments[number]) => (
      getHostedCodexNativeAssignmentHandle(plan, item.assignmentId)
    )
    const builderHandles = builders.map(handle)
    const reviewerHandles = reviewers.map(handle)

    startHostedCodexNativeAssignment(plan, {
      assignmentHandle: builderHandles[0],
      idempotencyKey: "spawn-multi-builder-one",
    })
    startHostedCodexNativeAssignment(plan, {
      assignmentHandle: builderHandles[1],
      idempotencyKey: "spawn-multi-builder-two",
    })
    expect(bridgeCalls.spawn).toBe(2)
    expectWall(() => startHostedCodexNativeAssignment(plan, {
      assignmentHandle: reviewerHandles[0],
      idempotencyKey: "spawn-multi-reviewer-one",
    }), "HOSTED_CODEX_CONCURRENCY_WALL")

    cancelHostedCodexNativeAssignment(plan, {
      assignmentHandle: builderHandles[0],
      requestedBy: ROLES.coordinator,
      reasonCode: "SUPERSEDED",
      idempotencyKey: "cancel-multi-builder-one",
    })
    startHostedCodexNativeAssignment(plan, {
      assignmentHandle: reviewerHandles[0],
      idempotencyKey: "spawn-multi-reviewer-one",
    })
    expectWall(() => createHostedCodexNativeMessage(plan, {
      assignmentHandle: reviewerHandles[0],
      direction: "TO_ASSIGNMENT",
      messageType: "STATUS",
      summary: "Ambiguous child remains occupied.",
      idempotencyKey: "send-multi-reviewer-ambiguous",
    }), "HOSTED_CODEX_BRIDGE_WALL")
    expectWall(() => startHostedCodexNativeAssignment(plan, {
      assignmentHandle: reviewerHandles[1],
      idempotencyKey: "spawn-multi-reviewer-two",
    }), "HOSTED_CODEX_CONCURRENCY_WALL")
    expect(bridgeCalls).toMatchObject({ spawn: 3, send: 1 })
  })

  it("runs the real one-cycle role lifecycle through the real coordinator bridge with retry-safe observations", () => {
    let successfulObservations = 0
    installBridge({
      observe(request: Record<string, unknown>) {
        bridgeCalls.observe += 1
        const response = observations.get(request.observationId as string)
        if (!response) {
          const error = new Error("observation not committed") as Error & { code: string }
          error.code = "HOST_OBSERVATION_PENDING"
          throw error
        }
        successfulObservations += 1
        return response
      },
    })
    const coordinatorInput = input({ adapterRunId: "run-real-role-lifecycle" })
    const plan = compileHostedCodexCoordinatorAdapter(coordinatorInput)
    const twinPlan = compileHostedCodexCoordinatorAdapter(coordinatorInput)
    const builder = assignment(plan, "builder")
    const reviewer = assignment(plan, "reviewer")
    const observationIds = {
      build: "real-role-build",
      requestChanges: "real-role-request-changes",
      remediation: "real-role-remediation",
      approval: "real-role-approval",
    }
    const evidence = (
      target: typeof builder,
      observationId: string,
      evidenceType: string,
      providerState: "RUNNING" | "SUCCEEDED",
      attributes: Record<string, unknown>,
      contentCharacter: string,
    ) => ({
      schemaVersion: 1, artifactType: "PROVIDER_EVIDENCE", providerId: "hosted-codex",
      adapterId: "hosted-codex-session-native-team-v1", dispatchId: target.item.assignmentId,
      workOrderId: target.item.workOrderId, laneId: target.item.laneId, providerState,
      reasonCode: null, sanitized: true, authorityGranted: false, eventId: observationId,
      evidenceType, contentHash: contentCharacter.repeat(64),
      summary: `Sanitized ${evidenceType} lifecycle evidence.`, attributes,
      rawProviderOutputIncluded: false,
    })
    observations.set(observationIds.requestChanges, evidence(
      reviewer, observationIds.requestChanges, "CODEX_ROLE_REQUEST_CHANGES", "RUNNING",
      { stage: "ASSURANCE_REVIEW", unresolvedThreads: 1, verdict: "REQUEST_CHANGES" }, "b",
    ))
    observations.set(observationIds.remediation, evidence(
      builder, observationIds.remediation, "CODEX_ROLE_REMEDIATION_COMPLETE", "SUCCEEDED",
      { outcome: "COMPLETE", remediationCycle: 1, stage: "REMEDIATION" }, "c",
    ))
    observations.set(observationIds.approval, evidence(
      reviewer, observationIds.approval, "CODEX_ROLE_APPROVED_ZERO_UNRESOLVED", "SUCCEEDED",
      { stage: "REREVIEW", unresolvedThreads: 0, verdict: "APPROVED" }, "d",
    ))
    const lifecycleRequest = {
      schemaVersion: 2, artifactType: "CODEX_ROLE_LIFECYCLE_REQUEST",
      adapterId: "hosted-codex-role-lifecycle-v2", plan,
      builderAssignmentHandle: builder.handle, reviewerAssignmentHandle: reviewer.handle,
      idempotencyNamespace: "real-role-lifecycle", observationIds,
      messageSummaries: {
        buildDirective: "Execute the exact reserved build task.",
        buildResultNotice: "The build result is ready for independent observation.",
        reviewDirective: "Independently review the observed build result.",
        changeRequestNotice: "A bounded change request is ready for coordinator routing.",
        remediationDirective: "Remediate the independently observed change request.",
        remediationResultNotice: "The remediation result is ready for independent observation.",
        rereviewDirective: "Re-review the remediated result and resolve every thread.",
      },
    }
    const roleWall = (callback: () => unknown, detail: string) => {
      try {
        callback()
        throw new Error("expected real role lifecycle wall")
      } catch (error) {
        expect(error).toBeInstanceOf(CodexRoleAdapterError)
        expect((error as CodexRoleAdapterError).detail).toContain(detail)
      }
    }
    roleWall(() => adaptCodexRoleLifecycle({
      ...lifecycleRequest, reviewerAssignmentHandle: structuredClone(reviewer.handle),
    }), "HOSTED_CODEX_ASSIGNMENT_HANDLE_WALL")
    expect(bridgeCalls).toMatchObject({ spawn: 0, send: 0, observe: 0 })
    const twinReviewer = assignment(twinPlan, "reviewer")
    expect(twinReviewer.handle).toEqual(reviewer.handle)
    roleWall(() => adaptCodexRoleLifecycle({
      ...lifecycleRequest, reviewerAssignmentHandle: twinReviewer.handle,
    }), "HOSTED_CODEX_ASSIGNMENT_HANDLE_WALL")
    expect(bridgeCalls).toMatchObject({ spawn: 0, send: 0, observe: 0 })

    roleWall(() => adaptCodexRoleLifecycle(lifecycleRequest), "HOSTED_CODEX_OBSERVATION_PENDING_WALL")
    expect(bridgeCalls).toMatchObject({ spawn: 2, send: 1, observe: 1 })
    expect(successfulObservations).toBe(0)
    observations.set(observationIds.build, evidence(
      builder, observationIds.build, "CODEX_ROLE_BUILD_COMPLETE", "RUNNING",
      { outcome: "COMPLETE", stage: "BUILD" }, "a",
    ))
    const result = adaptCodexRoleLifecycle(lifecycleRequest)
    expect(result).toMatchObject({
      status: "ROLE_LIFECYCLE_PROVEN", roleBindings: { identitiesDistinct: true },
      remediation: { originalBuilderReused: true, completedCycles: 1, budgetExceeded: false },
      review: { independentReviewer: true, initialVerdict: "REQUEST_CHANGES", initialUnresolvedThreads: 1, finalVerdict: "APPROVED", finalUnresolvedThreads: 0 },
      retry: { attemptsUsed: 2, maximumAttempts: 2, backoffSeconds: 0, budgetExceeded: false },
      nativeAssignmentsStarted: 2, messageCount: 7, ownerTouchCount: 0,
      durablePersistenceClaimed: false, runtimeActivationAllowed: false,
      githubMutationClaimed: false, authorityGranted: false,
    })
    expect(bridgeCalls).toMatchObject({ spawn: 2, send: 7, observe: 5 })
    expect(successfulObservations).toBe(4)
    expect(result.roleBindings.builder.nativeBindingDigest).not.toBe(result.roleBindings.reviewer.nativeBindingDigest)
    expect(result.stages.map(({ role }) => role)).toEqual(["builder", "reviewer", "builder", "reviewer"])
    expect(new Set(result.stages.map(({ evidenceBindingDigest }) => evidenceBindingDigest)).size).toBe(4)
    expect(result.stages.every(({ authorityFenceDigest }) => /^[a-f0-9]{64}$/.test(authorityFenceDigest))).toBe(true)
    expect(JSON.stringify(result)).not.toMatch(/recordId|fencingToken|recordContentHash|native-builder-mao-030|native-reviewer-mao-030/)
    const committedCounts = { ...bridgeCalls }
    expect(adaptCodexRoleLifecycle(lifecycleRequest)).toBe(result)
    expect(bridgeCalls).toEqual(committedCounts)

    const crossPlan = compileHostedCodexCoordinatorAdapter(input(
      { adapterRunId: "run-real-role-cross-plan" }, { laneId: "LANE-REAL-ROLE-CROSS-PLAN" },
    ))
    const crossReviewer = assignment(crossPlan, "reviewer")
    roleWall(() => adaptCodexRoleLifecycle({
      ...lifecycleRequest, idempotencyNamespace: "cross-plan-role-lifecycle",
      reviewerAssignmentHandle: crossReviewer.handle,
    }), "SAME_PRIVATE_PLAN_REQUIRED")
    expect(bridgeCalls).toEqual(committedCounts)
  })

  it.each([
    ["spawn", 2, "RESOLVE"], ["send", 2, "RESOLVE"],
    ["spawn", 1, "RESOLVE"], ["send", 1, "RESOLVE"],
    ["spawn", 2, "PERSIST"], ["send", 2, "PERSIST"],
  ] as const)(
    "contains a malformed post-effect %s acknowledgement with role retry budget %i in %s mode",
    (malformedOperation, maximumAttempts, reconciliationMode) => {
      let malformed = true
      const cancelledAssignments: string[] = []
      installBridge({
        cancel(request: Record<string, unknown>) {
          bridgeCalls.cancel += 1
          cancelledAssignments.push(request.assignmentId as string)
          const result = {
            schemaVersion: 1, artifactType: "HOSTED_CODEX_NATIVE_CANCEL_RESULT",
            bridgeId: "bridge-mao-030", assignmentId: request.assignmentId,
            nativeWorkerId: request.nativeWorkerId, reasonCode: request.reasonCode,
            status: "CANCELLED", cancellationPerformed: true, cancelAcknowledged: true,
            authorityGranted: false,
          }
          bridgeResults.cancel.set(request.idempotencyKey as string, result)
          return result
        },
        ...(malformedOperation === "spawn" ? {
          spawn(request: Record<string, unknown>) {
            bridgeCalls.spawn += 1
            const committed = {
              schemaVersion: 1, artifactType: "HOSTED_CODEX_NATIVE_SPAWN_RESULT",
              bridgeId: "bridge-mao-030", adapterRunId: request.adapterRunId,
              assignmentId: request.assignmentId, workOrderId: request.workOrderId,
              laneId: request.laneId, role: request.role, logicalWorkerId: request.logicalWorkerId,
              nativeWorkerId: `native-${request.role}-malformed-role`, status: "SPAWNED",
              spawnPerformed: true, currentSessionOnly: true, authorityGranted: false,
            }
            bridgeResults.spawn.set(request.idempotencyKey as string, committed)
            if (malformed) {
              malformed = false
              return { ...committed, spawnPerformed: false }
            }
            return committed
          },
        } : {}),
        ...(malformedOperation === "send" ? {
          send(request: Record<string, unknown>) {
            bridgeCalls.send += 1
            const committed = {
              schemaVersion: 1, artifactType: "HOSTED_CODEX_NATIVE_SEND_RESULT",
              bridgeId: "bridge-mao-030", assignmentId: request.assignmentId,
              nativeWorkerId: request.nativeWorkerId, messageDigest: request.messageDigest,
              status: "DELIVERED", deliveryPerformed: true, authorityGranted: false,
            }
            bridgeResults.send.set(request.idempotencyKey as string, committed)
            if (malformed) {
              malformed = false
              return { ...committed, deliveryPerformed: false }
            }
            return committed
          },
        } : {}),
        ...(reconciliationMode === "PERSIST" && malformedOperation === "spawn" ? {
          lookupSpawn() {
            bridgeCalls.lookupSpawn += 1
            throw new Error("spawn outcome unavailable")
          },
        } : {}),
        ...(reconciliationMode === "PERSIST" && malformedOperation === "send" ? {
          lookupSend() {
            bridgeCalls.lookupSend += 1
            throw new Error("send outcome unavailable")
          },
        } : {}),
      })
      const plan = compileHostedCodexCoordinatorAdapter(input({
        adapterRunId: `run-malformed-role-${malformedOperation}-${maximumAttempts}-${reconciliationMode.toLowerCase()}`,
      }, { retryBudget: { maxAttempts: maximumAttempts, backoffSeconds: 0 } }))
      const builder = assignment(plan, "builder")
      const reviewer = assignment(plan, "reviewer")
      const ids = {
        build: `malformed-${malformedOperation}-build`,
        requestChanges: `malformed-${malformedOperation}-request-changes`,
        remediation: `malformed-${malformedOperation}-remediation`,
        approval: `malformed-${malformedOperation}-approval`,
      }
      const event = (
        target: typeof builder,
        observationId: string,
        evidenceType: string,
        providerState: "RUNNING" | "SUCCEEDED",
        attributes: Record<string, unknown>,
        character: string,
      ) => ({
        schemaVersion: 1, artifactType: "PROVIDER_EVIDENCE", providerId: "hosted-codex",
        adapterId: "hosted-codex-session-native-team-v1", dispatchId: target.item.assignmentId,
        workOrderId: target.item.workOrderId, laneId: target.item.laneId, providerState,
        reasonCode: null, sanitized: true, authorityGranted: false, eventId: observationId,
        evidenceType, contentHash: character.repeat(64), summary: `Sanitized ${evidenceType}.`,
        attributes, rawProviderOutputIncluded: false,
      })
      observations.set(ids.build, event(builder, ids.build, "CODEX_ROLE_BUILD_COMPLETE", "RUNNING", { outcome: "COMPLETE", stage: "BUILD" }, "a"))
      observations.set(ids.requestChanges, event(reviewer, ids.requestChanges, "CODEX_ROLE_REQUEST_CHANGES", "RUNNING", { stage: "ASSURANCE_REVIEW", unresolvedThreads: 1, verdict: "REQUEST_CHANGES" }, "b"))
      observations.set(ids.remediation, event(builder, ids.remediation, "CODEX_ROLE_REMEDIATION_COMPLETE", "SUCCEEDED", { outcome: "COMPLETE", remediationCycle: 1, stage: "REMEDIATION" }, "c"))
      observations.set(ids.approval, event(reviewer, ids.approval, "CODEX_ROLE_APPROVED_ZERO_UNRESOLVED", "SUCCEEDED", { stage: "REREVIEW", unresolvedThreads: 0, verdict: "APPROVED" }, "d"))
      const request = {
        schemaVersion: 2, artifactType: "CODEX_ROLE_LIFECYCLE_REQUEST",
        adapterId: "hosted-codex-role-lifecycle-v2", plan,
        builderAssignmentHandle: builder.handle, reviewerAssignmentHandle: reviewer.handle,
        idempotencyNamespace: `malformed-role-${malformedOperation}-${maximumAttempts}-${reconciliationMode.toLowerCase()}`, observationIds: ids,
        messageSummaries: {
          buildDirective: "Execute the exact reserved build task.",
          buildResultNotice: "The build result is ready for independent observation.",
          reviewDirective: "Independently review the observed build result.",
          changeRequestNotice: "A bounded change request is ready for coordinator routing.",
          remediationDirective: "Remediate the independently observed change request.",
          remediationResultNotice: "The remediation result is ready for independent observation.",
          rereviewDirective: "Re-review the remediated result and resolve every thread.",
        },
      }
      try {
        adaptCodexRoleLifecycle(request)
        throw new Error("expected ambiguous role lifecycle outcome")
      } catch (error) {
        expect(error).toBeInstanceOf(CodexRoleAdapterError)
        expect(error).toMatchObject({
          code: "CODEX_ROLE_COORDINATOR_WALL",
          detail: "HOSTED_CODEX_BRIDGE_WALL:HOST_SIDE_EFFECT_OUTCOME_AMBIGUOUS",
        })
      }
      const effectsAfterAmbiguity = bridgeCalls[malformedOperation]
      if (reconciliationMode === "PERSIST") {
        const expectRoleWall = (code: string, detail: string) => {
          try {
            adaptCodexRoleLifecycle(request)
            throw new Error("expected persistent ambiguity wall")
          } catch (error) {
            expect(error).toBeInstanceOf(CodexRoleAdapterError)
            expect(error).toMatchObject({ code, detail })
          }
        }
        expectRoleWall("CODEX_ROLE_COORDINATOR_WALL", "HOSTED_CODEX_BRIDGE_WALL:HOST_SIDE_EFFECT_RECONCILIATION_PENDING")
        expectRoleWall("CODEX_ROLE_QUARANTINE_WALL", "AMBIGUOUS_EFFECT_RECONCILIATION_REQUIRED")
        expectRoleWall("CODEX_ROLE_QUARANTINE_WALL", "AMBIGUOUS_EFFECT_CLEANUP_RETRY_BUDGET_EXHAUSTED")
        const terminalCounts = { ...bridgeCalls }
        expectRoleWall("CODEX_ROLE_QUARANTINE_WALL", "AMBIGUOUS_EFFECT_CLEANUP_RETRY_BUDGET_EXHAUSTED")
        expect(bridgeCalls).toEqual(terminalCounts)
        expect(bridgeCalls[malformedOperation]).toBe(1)
        expect(bridgeCalls.cancel).toBe(malformedOperation === "spawn" ? 0 : 1)
        expect(cancelledAssignments).not.toContain(builder.item.assignmentId)
        if (malformedOperation === "send") {
          expect(cancelledAssignments).toEqual([reviewer.item.assignmentId])
        }
      } else if (maximumAttempts === 2) {
        const result = adaptCodexRoleLifecycle(request)
        expect(result).toMatchObject({ status: "ROLE_LIFECYCLE_PROVEN", retry: { attemptsUsed: 2 } })
        expect(bridgeCalls[malformedOperation]).toBe(malformedOperation === "spawn" ? 2 : 7)
      } else {
        try {
          adaptCodexRoleLifecycle(request)
          throw new Error("expected last-attempt containment")
        } catch (error) {
          expect(error).toBeInstanceOf(CodexRoleAdapterError)
          expect(error).toMatchObject({
            code: "CODEX_ROLE_RETRY_BUDGET_WALL",
            detail: "LIFECYCLE_RETRY_BUDGET_EXHAUSTED",
          })
        }
        expect(bridgeCalls[malformedOperation]).toBe(1)
        expect(bridgeCalls.cancel).toBe(malformedOperation === "spawn" ? 1 : 2)
        expect(cancelledAssignments).toContain(builder.item.assignmentId)
      }
      expect(effectsAfterAmbiguity).toBe(1)
      const lookup = `lookup${malformedOperation[0].toUpperCase()}${malformedOperation.slice(1)}` as keyof typeof bridgeCalls
      expect(bridgeCalls[lookup]).toBe(reconciliationMode === "PERSIST" ? 3 : 1)
    },
  )

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

  it("keeps the production authority-status registry immutable and empty", () => {
    const script = [
      "import { HOSTED_CODEX_AUTHORITY_STATUS_REGISTRY_METADATA as metadata,",
      "loadCanonicalHostedCodexAuthorityStatusChain as load }",
      "from './scripts/multi-agent-operator/hosted-codex-authority-status-registry.mjs';",
      "console.log(JSON.stringify({ metadata, loaded: load('a'.repeat(64), 0) }));",
    ].join(" ")
    const result = spawnSync(process.execPath, ["--input-type=module", "-e", script], {
      cwd: process.cwd(), encoding: "utf8",
    })
    expect(result.status).toBe(0)
    expect(JSON.parse(result.stdout)).toMatchObject({
      metadata: {
        registryId: "hosted-codex-authority-status-registry-v1",
        mutableRegistrationAllowed: false,
        hostBacked: true,
        terminalRevocationEnforced: true,
        authorityGranted: false,
      },
      loaded: null,
    })
  })
})
