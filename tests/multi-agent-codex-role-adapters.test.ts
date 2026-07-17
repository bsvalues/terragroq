import crypto from "node:crypto"
import { spawnSync } from "node:child_process"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"

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
  adaptCodexRoleLifecycle,
  CodexRoleAdapterError,
} from "../scripts/multi-agent-operator/codex-role-adapters.mjs"
import {
  compileHostedCodexCoordinatorAdapter,
} from "../scripts/multi-agent-operator/codex-coordinator-adapter.mjs"
import { canonicalJson, computeAuthorityContentHash } from "../scripts/multi-agent-operator/authority-events.mjs"
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
import {
  clearTestHostedCodexAuthorityStatusRegistry,
  installTestHostedCodexAuthorityStatusChain,
} from "./fixtures/hosted-codex-authority-status-registry-fixture.mjs"

const PROGRAM = "PROGRAM-WILLIAMOS-MULTI-AGENT-OPERATOR-001"
const GOAL = "GOAL-WOS-MULTI-AGENT-OPERATOR-001"
const LOOP = "LOOP-WOS-MULTI-AGENT-OPERATOR-001"
const WORK_ORDER = "WO-MAO-031"
const LANE = "LANE-WO-MAO-031"
const ROLES = {
  coordinator: "codex-coordinator",
  builder: "codex-builder",
  reviewer: "codex-reviewer",
}

let observations = new Map<string, Record<string, unknown>>()
let bridgeCalls = { spawn: 0, send: 0, observe: 0 }

function iso(offsetMs: number) {
  return new Date(Date.now() + offsetMs).toISOString()
}

function ownerBudget() {
  return {
    credentialTouches: 0,
    diagnosticTouches: 0,
    operationTouches: 0,
    routineContacts: 0,
    routineDecisions: 0,
  }
}

function sha256Canonical(value: unknown) {
  return crypto.createHash("sha256").update(canonicalJson(value)).digest("hex")
}

function signAuthority() {
  const { publicKey, privateKey } = crypto.generateKeyPairSync("ed25519")
  const fingerprint = crypto.createHash("sha256").update(publicKey.export({ type: "spki", format: "der" })).digest("hex")
  const sign = <T extends Record<string, unknown>>(record: T) => {
    const contentHash = computeAuthorityContentHash(record)
    return {
      ...record,
      contentHash,
      signature: {
        algorithm: "Ed25519",
        keyId: "owner-key-mao-031",
        value: crypto.sign(null, Buffer.from(canonicalJson(record)), privateKey).toString("base64"),
      },
    }
  }
  const grant = sign({
    schemaVersion: 1,
    artifactType: "OWNER_AUTHORITY_GRANT",
    grantKind: "ACTION_AUTHORITY",
    grantId: "grant-mao-031",
    authorityDecisionId: "decision-mao-031",
    issuer: { role: "OWNER", ownerId: "owner-mao-031" },
    subject: { type: "PROGRAM", id: PROGRAM },
    scope: {
      programIds: [PROGRAM],
      goalIds: [GOAL],
      loopIds: [LOOP],
      workOrderIds: [WORK_ORDER],
      decisionIds: ["decision-mao-031"],
      repositories: ["bsvalues/terragroq"],
      riskClasses: ["R1"],
      actions: ["READ_REPOSITORY", "RUN_VALIDATION", "WRITE_RESERVED_PATHS"],
      mergeModes: ["NO_MERGE"],
    },
    issuedAt: iso(-3_600_000),
    expiresAt: iso(3_600_000),
  })
  const active = sign({
    schemaVersion: 1,
    artifactType: "OWNER_AUTHORITY_STATUS_EVENT",
    eventId: "event-mao-031-active",
    grantId: grant.grantId,
    sequence: 1,
    status: "ACTIVE",
    issuedAt: iso(-3_500_000),
    previousEventHash: null,
    issuer: { role: "OWNER", ownerId: "owner-mao-031" },
  })
  const trustedOwners = sign({
    schemaVersion: 1,
    artifactType: "OWNER_TRUST_BUNDLE",
    issuer: { role: "OWNER", ownerId: "owner-mao-031" },
    issuedAt: iso(-3_400_000),
    statusHeads: [{ grantId: grant.grantId, eventCount: 1, latestEventHash: active.contentHash }],
    legacyRevocationHeads: [],
    owners: [{
      ownerId: "owner-mao-031",
      publicKeyId: "owner-key-mao-031",
      algorithm: "Ed25519",
      publicKeyPem: publicKey.export({ type: "spki", format: "pem" }).toString(),
      status: "ACTIVE",
    }],
  })
  return {
    grant,
    events: [active],
    trustedOwners,
    trustedOwnerKeyFingerprint: fingerprint,
    trustedOwnerBundleContentHash: trustedOwners.contentHash,
  }
}

function authorityStatusRecord(artifacts: ReturnType<typeof signAuthority>) {
  const eventHashes = artifacts.events.map(({ contentHash }) => contentHash)
  const claims = {
    schemaVersion: 1,
    artifactType: "HOSTED_CODEX_AUTHORITY_STATUS_RECORD",
    recordId: sha256Canonical({
      domain: "HOSTED_CODEX_AUTHORITY_STATUS_V1",
      grantId: artifacts.grant.grantId,
      authorityDecisionId: artifacts.grant.authorityDecisionId,
      workOrderId: WORK_ORDER,
    }),
    recordVersion: 1,
    fencingToken: 1,
    status: "ACTIVE",
    issuedAt: iso(-1_000),
    expiresAt: iso(120_000),
    maximumAgeMs: 60_000,
    previousRecordContentHash: null,
    grantId: artifacts.grant.grantId,
    authorityDecisionId: artifacts.grant.authorityDecisionId,
    workOrderId: WORK_ORDER,
    originalGrantContentHash: artifacts.grant.contentHash,
    originalEventChainHash: sha256Canonical(eventHashes),
    originalTrustBundleContentHash: artifacts.trustedOwnerBundleContentHash,
    originalStatusHeadHash: eventHashes.at(-1) ?? null,
    originalStatusEventCount: eventHashes.length,
    currentArtifacts: {
      authorityGrant: artifacts.grant,
      authorityStatusEvents: artifacts.events,
      ownerAuthorityTrustBundle: artifacts.trustedOwners,
    },
    currentEventChainHash: sha256Canonical(eventHashes),
    currentTrustBundleContentHash: artifacts.trustedOwnerBundleContentHash,
    currentStatusHeadHash: eventHashes.at(-1) ?? null,
    currentStatusEventCount: eventHashes.length,
    immutable: true,
    authorityGranted: false,
  }
  return { ...claims, recordContentHash: sha256Canonical(claims) }
}

function envelope() {
  return {
    artifactType: "WORK_ORDER_ENVELOPE_V2",
    schemaVersion: 2,
    programId: PROGRAM,
    goalId: GOAL,
    loopId: LOOP,
    workOrderId: WORK_ORDER,
    objective: "Prove current-session Codex builder, assurance, remediation, and re-review adapters.",
    riskClass: "R1",
    repositories: ["bsvalues/terragroq"],
    baseRefs: [{ repository: "bsvalues/terragroq", ref: "refs/heads/main", commitSha: "c5d44c6c31ec969e2fbf3d5620a4a21c3255cb16" }],
    dependencies: ["WO-MAO-026", "WO-MAO-029", "WO-MAO-030"],
    fanInGate: "ALL",
    laneId: LANE,
    teamRoles: ROLES,
    providerRequirements: ["current-hosted-session", "native-team-coordination", "sanitized-evidence"],
    preferredProviders: ["hosted-codex"],
    fallbackProviders: [],
    reservations: {
      paths: [{ repository: "bsvalues/terragroq", path: "scripts/multi-agent-operator/codex-role-adapters.mjs" }],
      contracts: ["codex-role-adapters"],
      environments: [],
    },
    allowedActions: ["READ_REPOSITORY", "RUN_VALIDATION", "WRITE_RESERVED_PATHS"],
    forbiddenActions: ["CREDENTIAL_ACCESS", "OWNER_CONTACT", "RUNTIME_ACTIVATION"],
    authorityGrantRefs: ["grant-mao-031"],
    programActivationGrantRef: null,
    grantStatusEventRefs: ["event-mao-031-active"],
    requiredOutputs: ["role-lifecycle", "sanitized-evidence"],
    requiredValidation: ["focused-vitest", "git-diff-check"],
    reviewRequirements: { independentReviewer: true, minimumApprovals: 1, maximumUnresolvedThreads: 0 },
    mergeMode: "NO_MERGE",
    retryBudget: { maxAttempts: 3, backoffSeconds: 10 },
    remediationBudget: { maxCycles: 2 },
    reroutePolicy: "COMPATIBLE_PROVIDER_ONLY",
    stopConditions: ["authority-wall", "reservation-collision"],
    evidenceTargets: ["owner-operation-counters", "sanitized-provider-events"],
    ownerDecisionConditions: [],
    ownerOperationsAllowed: false,
    ownerTouchBudget: ownerBudget(),
    communicationPolicy: "FINAL_ONLY",
  }
}

function dispatchEnvelope(value: ReturnType<typeof envelope>) {
  const copy = structuredClone(value) as Record<string, unknown>
  delete copy.artifactType
  delete copy.ownerTouchBudget
  delete copy.communicationPolicy
  return copy
}

function trustEvidence(role: keyof typeof ROLES, envelopeContentHash: string) {
  return {
    schemaVersion: 2,
    artifactType: "HOSTED_CODEX_PREVENTIVE_TRUST_EVIDENCE",
    proofId: `trust-${role}-mao-031`,
    workOrderId: WORK_ORDER,
    laneId: LANE,
    requestedRole: role,
    workerId: ROLES[role],
    provider: "hosted-codex",
    surface: "current-hosted-session-native-team",
    promptInjectionBoundary: "trusted-work-order-envelope-v1",
    allowedPaths: ["scripts/multi-agent-operator/codex-role-adapters.mjs"],
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
  }
}

function installBridge() {
  const spawned = new Map<string, Record<string, unknown>>()
  const sent = new Map<string, Record<string, unknown>>()
  installTestHostedCodexNativeBridge({
    bridgeId: "bridge-mao-031",
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
        schemaVersion: 1,
        artifactType: "HOSTED_CODEX_NATIVE_SPAWN_RESULT",
        bridgeId: "bridge-mao-031",
        adapterRunId: request.adapterRunId,
        assignmentId: request.assignmentId,
        workOrderId: request.workOrderId,
        laneId: request.laneId,
        role: request.role,
        logicalWorkerId: request.logicalWorkerId,
        nativeWorkerId: `native-${request.role}-mao-031`,
        status: "SPAWNED",
        spawnPerformed: true,
        currentSessionOnly: true,
        authorityGranted: false,
      }
      spawned.set(String(request.idempotencyKey), result)
      return result
    },
    lookupSpawn(request: Record<string, unknown>) {
      const result = spawned.get(String(request.idempotencyKey))
      if (!result) throw new Error("missing spawn")
      return result
    },
    send(request: Record<string, unknown>) {
      bridgeCalls.send += 1
      const result = {
        schemaVersion: 1,
        artifactType: "HOSTED_CODEX_NATIVE_SEND_RESULT",
        bridgeId: "bridge-mao-031",
        assignmentId: request.assignmentId,
        nativeWorkerId: request.nativeWorkerId,
        messageDigest: request.messageDigest,
        status: "DELIVERED",
        deliveryPerformed: true,
        authorityGranted: false,
      }
      sent.set(String(request.idempotencyKey), result)
      return result
    },
    lookupSend(request: Record<string, unknown>) {
      const result = sent.get(String(request.idempotencyKey))
      if (!result) throw new Error("missing send")
      return result
    },
    cancel() {
      throw new Error("cancel not used in WO-MAO-031 proof")
    },
    lookupCancel() {
      throw new Error("cancel lookup not used in WO-MAO-031 proof")
    },
    observe(request: Record<string, unknown>) {
      bridgeCalls.observe += 1
      const response = observations.get(String(request.observationId))
      if (!response) throw new Error("missing observation")
      return response
    },
  })
}

function compilePlan() {
  const target = envelope()
  const laneEnvelope = dispatchEnvelope(target)
  const envelopeContentHash = validateDispatchEnvelope(laneEnvelope).contentHash
  for (const role of ["coordinator", "builder", "reviewer"] as const) {
    installTestHostedCodexTrustRecord(trustEvidence(role, envelopeContentHash))
  }
  const authority = signAuthority()
  const record = authorityStatusRecord(authority)
  installTestHostedCodexAuthorityStatusChain({
    registryId: "hosted-codex-authority-status-registry-v1",
    registryVersion: 1,
    evaluationTime: iso(0),
    recordId: record.recordId,
    latestFencingToken: 1,
    latestRecordContentHash: record.recordContentHash,
    records: [record],
  })
  return compileHostedCodexCoordinatorAdapter({
    schemaVersion: 1,
    artifactType: "HOSTED_CODEX_COORDINATOR_ADAPTER_INPUT",
    adapterRunId: "run-mao-031",
    topologyInput: {
      schemaVersion: 1,
      artifactType: "MULTI_AGENT_TEAM_TOPOLOGY_INPUT",
      topologyId: "topology-mao-031",
      dagInput: {
        schemaVersion: 1,
        artifactType: "DAG_ELIGIBILITY_INPUT",
        workOrders: [target, ...target.dependencies.map((workOrderId) => ({ ...envelope(), workOrderId, dependencies: [] }))],
        workOrderStates: [
          ...target.dependencies.map((workOrderId) => ({ workOrderId, state: "COMPLETE", reasonCode: null })),
          { workOrderId: WORK_ORDER, state: "PLANNED", reasonCode: null },
        ],
      },
      lanes: [{
        envelope: laneEnvelope,
        roleAssignments: {
          ...ROLES,
          remediator: ROLES.builder,
          mergeController: "codex-merge-controller",
          verifier: "codex-verifier",
        },
      }],
    },
    conformance: codexProviderConformanceFixture(),
    coordinatorHostSessionProofReference: {
      workerId: ROLES.coordinator,
      proofId: "proof-coordinator-mao-031",
    },
    preventiveTrustProofReferences: (["coordinator", "builder", "reviewer"] as const)
      .map((role) => ({ proofId: `trust-${role}-mao-031` })),
    hostBridgeReference: { bridgeId: "bridge-mao-031" },
    authorityProofs: [{ workOrderId: WORK_ORDER, artifacts: authority }],
    runtimeActivationRequested: false,
    localIssue357Requested: false,
    durableTransportClaimed: false,
    ownerTouchBudget: ownerBudget(),
  })
}

function providerStatus(plan: ReturnType<typeof compilePlan>, role: string, providerState: "RUNNING" | "SUCCEEDED") {
  const assignment = plan.assignments.find((entry) => entry.role === (role === "remediator" ? "builder" : role))
  if (!assignment) throw new Error(`missing assignment ${role}`)
  return {
    schemaVersion: 1,
    artifactType: "PROVIDER_STATUS",
    providerId: "hosted-codex",
    adapterId: "hosted-codex-session-native-team-v1",
    dispatchId: assignment.assignmentId,
    workOrderId: WORK_ORDER,
    laneId: LANE,
    providerState,
    reasonCode: null,
    sanitized: true,
    authorityGranted: false,
    progressMarker: `${role}-${providerState.toLowerCase()}`,
  }
}

function installObservations(plan: ReturnType<typeof compilePlan>) {
  observations.set("observation-build", providerStatus(plan, "builder", "RUNNING"))
  observations.set("observation-review", providerStatus(plan, "reviewer", "RUNNING"))
  observations.set("observation-remediation", providerStatus(plan, "remediator", "SUCCEEDED"))
  observations.set("observation-rereview", providerStatus(plan, "reviewer", "SUCCEEDED"))
}

function stages(overrides: Record<string, unknown> = {}) {
  const value = [
    { stageId: "stage-build", stage: "BUILD", role: "builder", workerId: ROLES.builder, startIdempotencyKey: "start-builder", messageType: "STATUS", messageSummary: "Build stage evidence.", messageIdempotencyKey: "message-build", observationId: "observation-build", review: null, remediationCycle: null },
    { stageId: "stage-assurance", stage: "ASSURANCE_REVIEW", role: "reviewer", workerId: ROLES.reviewer, startIdempotencyKey: "start-reviewer", messageType: "REVIEW_REQUEST", messageSummary: "Assurance review evidence.", messageIdempotencyKey: "message-review", observationId: "observation-review", review: { verdict: "REQUESTED_CHANGES", unresolvedThreads: 1 }, remediationCycle: null },
    { stageId: "stage-remediation", stage: "REMEDIATION", role: "remediator", workerId: ROLES.builder, startIdempotencyKey: null, messageType: "CHANGE_REQUEST", messageSummary: "Remediation evidence.", messageIdempotencyKey: "message-remediation", observationId: "observation-remediation", review: null, remediationCycle: 1 },
    { stageId: "stage-rereview", stage: "REREVIEW", role: "reviewer", workerId: ROLES.reviewer, startIdempotencyKey: null, messageType: "REVIEW_REQUEST", messageSummary: "Rereview approval evidence.", messageIdempotencyKey: "message-rereview", observationId: "observation-rereview", review: { verdict: "APPROVED", unresolvedThreads: 0 }, remediationCycle: null },
  ]
  for (const [key, child] of Object.entries(overrides)) value[Number(key)] = { ...value[Number(key)], ...(child as Record<string, unknown>) }
  return value
}

function adapterInput(plan: ReturnType<typeof compilePlan>, overrides: Record<string, unknown> = {}) {
  return {
    schemaVersion: 1,
    artifactType: "CODEX_ROLE_ADAPTER_INPUT",
    adapterId: "hosted-codex-role-adapters-v1",
    envelope: envelope(),
    coordinatorPlan: plan,
    stages: stages(),
    ...overrides,
  }
}

function expectWall(callback: () => unknown, code: string) {
  try {
    callback()
    throw new Error("expected role adapter wall")
  } catch (error) {
    expect(error).toBeInstanceOf(CodexRoleAdapterError)
    expect(error).toMatchObject({ code })
  }
}

beforeEach(() => {
  observations = new Map()
  bridgeCalls = { spawn: 0, send: 0, observe: 0 }
  installTestCodexHostSessionRecord({
    schemaVersion: 1,
    artifactType: "CODEX_HOST_SESSION_IDENTITY",
    proofId: "proof-coordinator-mao-031",
    sessionId: "native-coordinator-mao-031",
    workerId: ROLES.coordinator,
    providerId: "hosted-codex",
    adapterId: "hosted-codex-session-native-team-v1",
    status: "ACTIVE",
    issuedAt: iso(-60_000),
    expiresAt: iso(3_600_000),
    evaluationTime: iso(0),
  })
  installBridge()
})

afterEach(() => {
  clearTestCodexHostSessionRecords()
  clearTestHostedCodexNativeBridgeRegistry()
  clearTestHostedCodexAuthorityStatusRegistry()
})

describe("WO-MAO-031 Codex builder, assurance, and remediation adapters", () => {
  it("proves the bounded role lifecycle through opaque WO-MAO-030 native assignment handles", () => {
    const plan = compilePlan()
    installObservations(plan)
    const result = adaptCodexRoleLifecycle(adapterInput(plan))
    expect(result).toMatchObject({
      artifactType: "CODEX_ROLE_ADAPTER_RESULT",
      status: "ROLE_LIFECYCLE_PROVEN",
      workOrderId: WORK_ORDER,
      laneId: LANE,
      ownerRelayRequired: false,
      providerContractDispatchAllowed: false,
      dispatchPerformed: false,
      durablePersistenceClaimed: false,
      serviceWorkerClaimed: false,
      runtimeActivationAllowed: false,
      authorityGranted: false,
    })
    expect(result.roleAdapters.map(({ role, state }) => [role, state])).toEqual([
      ["builder", "ROLE_ADAPTER_READY"],
      ["reviewer", "ROLE_ADAPTER_READY"],
      ["remediator", "ROLE_ADAPTER_READY"],
    ])
    expect(result.stages.map(({ stage, providerResponse }) => [stage, providerResponse.providerState])).toEqual([
      ["BUILD", "RUNNING"],
      ["ASSURANCE_REVIEW", "RUNNING"],
      ["REMEDIATION", "SUCCEEDED"],
      ["REREVIEW", "SUCCEEDED"],
    ])
    expect(bridgeCalls).toEqual({ spawn: 2, send: 4, observe: 4 })
  })

  it("rejects plain JSON plans, replay conflicts, and broken final review lifecycle claims", () => {
    const plan = compilePlan()
    installObservations(plan)
    expectWall(() => adaptCodexRoleLifecycle(adapterInput(structuredClone(plan))), "CODEX_ROLE_COORDINATOR_WALL")

    const replayPlan = compilePlan()
    installObservations(replayPlan)
    adaptCodexRoleLifecycle(adapterInput(replayPlan))
    observations.set("observation-build", {
      ...providerStatus(replayPlan, "builder", "RUNNING"),
      progressMarker: "conflicting-build-replay",
    })
    expectWall(() => adaptCodexRoleLifecycle(adapterInput(replayPlan)), "CODEX_ROLE_REPLAY_WALL")

    const secondPlan = compilePlan()
    installObservations(secondPlan)
    expectWall(() => adaptCodexRoleLifecycle(adapterInput(secondPlan, {
      stages: stages({ 3: { review: { verdict: "REQUESTED_CHANGES", unresolvedThreads: 1 } } }),
    })), "CODEX_ROLE_REVIEW_WALL")
  })

  it("keeps the standalone CLI fail-closed without opaque host plan handles", () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "codex-role-adapter-"))
    const inputPath = path.join(directory, "input.json")
    const plan = compilePlan()
    installObservations(plan)
    fs.writeFileSync(inputPath, JSON.stringify(adapterInput(plan)))
    const result = spawnSync(process.execPath,
      ["scripts/multi-agent-operator/codex-role-adapters-cli.mjs", inputPath], { encoding: "utf8" })
    expect(result.status).toBe(2)
    expect(JSON.parse(result.stdout)).toMatchObject({
      ok: false,
      code: "CODEX_ROLE_COORDINATOR_WALL",
      dispatchPerformed: false,
      authorityGranted: false,
    })
    fs.rmSync(directory, { recursive: true, force: true })
  })
})
