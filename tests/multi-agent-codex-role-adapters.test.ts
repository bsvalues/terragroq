import crypto from "node:crypto"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { spawnSync } from "node:child_process"

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const host = vi.hoisted(() => ({
  plans: new WeakMap<object, any>(),
  handles: new WeakMap<object, any>(),
  evidence: new WeakMap<object, any>(),
}))

vi.mock("../scripts/multi-agent-operator/codex-coordinator-adapter.mjs", () => {
  class HostedCodexCoordinatorAdapterError extends Error {
    code: string
    field: string
    detail: string | null

    constructor(code: string, field: string, detail: string | null = null) {
      super(`${code}:${field}${detail === null ? "" : `:${detail}`}`)
      this.code = code
      this.field = field
      this.detail = detail
    }
  }

  const wall = (code: string, field: string, detail: string | null = null): never => {
    throw new HostedCodexCoordinatorAdapterError(code, field, detail)
  }
  const digest = (value: unknown) => {
    const source = JSON.stringify(value)
    let accumulator = 2166136261
    for (const character of source) accumulator = Math.imul(accumulator ^ character.charCodeAt(0), 16777619)
    return (accumulator >>> 0).toString(16).padStart(64, "0")
  }
  const ensure = (plan: object, handle: object) => {
    const state = host.plans.get(plan)
    const binding = host.handles.get(handle)
    if (!state || !binding || binding.plan !== plan) {
      wall("HOSTED_CODEX_ASSIGNMENT_HANDLE_WALL", "assignmentHandle", "OPAQUE_ASSIGNMENT_HANDLE_REQUIRED")
    }
    return { state, binding, runtime: state.runtime.get(binding.assignment.assignmentId) }
  }
  const idempotent = (state: any, key: string, operation: string, create: () => any) => {
    const prior = state.idempotency.get(key)
    if (prior) {
      if (prior.operation !== operation) wall("HOSTED_CODEX_REPLAY_WALL", "idempotencyKey", "CONFLICTING_REPLAY")
      return prior.result
    }
    const result = create()
    state.idempotency.set(key, { operation, result })
    return result
  }
  const constraint = {
    BUILD_COMPLETE: {
      providerState: "RUNNING", evidenceType: "CODEX_ROLE_BUILD_COMPLETE",
      attributes: { outcome: "COMPLETE", stage: "BUILD" },
    },
    REQUEST_CHANGES_ONE: {
      providerState: "RUNNING", evidenceType: "CODEX_ROLE_REQUEST_CHANGES",
      attributes: { stage: "ASSURANCE_REVIEW", unresolvedThreads: 1, verdict: "REQUEST_CHANGES" },
    },
    REMEDIATION_COMPLETE_ONE: {
      providerState: "SUCCEEDED", evidenceType: "CODEX_ROLE_REMEDIATION_COMPLETE",
      attributes: { outcome: "COMPLETE", remediationCycle: 1, stage: "REMEDIATION" },
    },
    APPROVED_ZERO_UNRESOLVED: {
      providerState: "SUCCEEDED", evidenceType: "CODEX_ROLE_APPROVED_ZERO_UNRESOLVED",
      attributes: { stage: "REREVIEW", unresolvedThreads: 0, verdict: "APPROVED" },
    },
  } as const

  return {
    HostedCodexCoordinatorAdapterError,
    attestHostedCodexRoleAssignmentHandles(plan: object, request: any) {
      const builder = ensure(plan, request.builderAssignmentHandle)
      const reviewer = ensure(plan, request.reviewerAssignmentHandle)
      if (builder.binding.assignment.role !== "builder" || reviewer.binding.assignment.role !== "reviewer"
        || builder.binding.assignment.workOrderId !== reviewer.binding.assignment.workOrderId
        || builder.binding.assignment.laneId !== reviewer.binding.assignment.laneId
        || JSON.stringify(builder.binding.assignment.taskPayload.reservations)
          !== JSON.stringify(reviewer.binding.assignment.taskPayload.reservations)) {
        wall("HOSTED_CODEX_ASSIGNMENT_HANDLE_WALL", "assignmentHandles", "EXACT_OPAQUE_PAIR_REQUIRED")
      }
      return Object.freeze({
        workOrderId: builder.binding.assignment.workOrderId,
        laneId: builder.binding.assignment.laneId,
        builderAssignmentId: builder.binding.assignment.assignmentId,
        reviewerAssignmentId: reviewer.binding.assignment.assignmentId,
        coordinatorWorkerId: `coordinator-${builder.binding.assignment.workOrderId.toLowerCase()}`,
        reservationDigest: digest(builder.binding.assignment.taskPayload.reservations),
        remediationBudget: { maxCycles: builder.state.remediationBudget },
        retryBudget: structuredClone(builder.state.retryBudget),
        authorityGranted: false,
      })
    },
    startHostedCodexNativeAssignment(plan: object, request: any) {
      const { state, binding, runtime } = ensure(plan, request.assignmentHandle)
      if (binding.assignment.role === "reviewer" && state.failReviewerStart) {
        wall("HOSTED_CODEX_BRIDGE_WALL", "start", "HOST_SPAWN_REJECTED")
      }
      return idempotent(state, request.idempotencyKey, `START:${binding.assignment.assignmentId}`, () => {
        if (runtime.state !== "PREPARED") wall("HOSTED_CODEX_ASSIGNMENT_WALL", "start", "PREPARED_ASSIGNMENT_REQUIRED")
        runtime.state = "ACTIVE"
        runtime.nativeWorkerDigest = digest({ nativeWorkerId: `native-${binding.assignment.workerId}` })
        runtime.nativeBindingDigest = digest({ assignmentId: binding.assignment.assignmentId, nativeWorkerId: `native-${binding.assignment.workerId}` })
        state.effects.push({ type: "START", assignmentId: binding.assignment.assignmentId, key: request.idempotencyKey })
        return Object.freeze({
          assignmentId: binding.assignment.assignmentId,
          nativeWorkerDigest: runtime.nativeWorkerDigest,
          nativeAssignmentExecuted: true,
          authorityGranted: false,
        })
      })
    },
    createHostedCodexNativeMessage(plan: object, request: any) {
      const { state, binding, runtime } = ensure(plan, request.assignmentHandle)
      const operation = `MESSAGE:${binding.assignment.assignmentId}:${request.direction}:${request.messageType}:${request.summary}`
      const prior = state.idempotency.get(request.idempotencyKey)
      if (prior) {
        if (prior.operation !== operation) wall("HOSTED_CODEX_REPLAY_WALL", "idempotencyKey", "CONFLICTING_REPLAY")
        return prior.result
      }
      if (state.failNextMessage) {
        const detail = state.failNextMessage
        state.failNextMessage = null
        wall("HOSTED_CODEX_BRIDGE_WALL", "message", detail)
      }
      if (runtime.state !== "ACTIVE") wall("HOSTED_CODEX_MESSAGE_WALL", "message", "ACTIVE_ASSIGNMENT_REQUIRED")
      if (/\b(?:password|token|secret)\s*[:=]/i.test(request.summary)) {
        wall("HOSTED_CODEX_MESSAGE_WALL", "message.summary", "PROVIDER_EVIDENCE_SANITIZATION_WALL")
      }
      return idempotent(state, request.idempotencyKey, operation, () => {
        state.effects.push({ type: "MESSAGE", assignmentId: binding.assignment.assignmentId, key: request.idempotencyKey })
        return Object.freeze({
          assignmentId: binding.assignment.assignmentId,
          messageDigest: digest(request),
          sanitized: true,
          rawProviderOutputIncluded: false,
          authorityGranted: false,
        })
      })
    },
    cancelHostedCodexNativeAssignment(plan: object, request: any) {
      const { state, binding, runtime } = ensure(plan, request.assignmentHandle)
      const prior = state.cancelTransactions.get(request.idempotencyKey)
      if (prior?.status === "AMBIGUOUS") {
        state.effects.push({ type: "CANCEL_LOOKUP", assignmentId: binding.assignment.assignmentId, key: request.idempotencyKey })
        if (state.cancelMode === "ALWAYS_AMBIGUOUS") {
          wall("HOSTED_CODEX_BRIDGE_WALL", "cancellation", "HOST_SIDE_EFFECT_RECONCILIATION_PENDING")
        }
        runtime.state = "CANCELLED"
        prior.status = "COMMITTED"
        return prior.result
      }
      if (["SUCCEEDED", "FAILED", "CANCELLED"].includes(runtime.state)) {
        wall("HOSTED_CODEX_CANCELLATION_WALL", "cancellation", "TERMINAL_ASSIGNMENT_IMMUTABLE")
      }
      if (state.cancelMode) {
        const result = Object.freeze({ assignmentId: binding.assignment.assignmentId, terminalState: "CANCELLED", authorityGranted: false })
        state.cancelTransactions.set(request.idempotencyKey, { status: "AMBIGUOUS", result })
        state.effects.push({ type: "CANCEL_ATTEMPT", assignmentId: binding.assignment.assignmentId, key: request.idempotencyKey })
        wall("HOSTED_CODEX_BRIDGE_WALL", "cancellation", "HOST_SIDE_EFFECT_OUTCOME_AMBIGUOUS")
      }
      return idempotent(state, request.idempotencyKey, `CANCEL:${binding.assignment.assignmentId}`, () => {
        runtime.state = "CANCELLED"
        state.effects.push({ type: "CANCEL", assignmentId: binding.assignment.assignmentId, key: request.idempotencyKey })
        return Object.freeze({ assignmentId: binding.assignment.assignmentId, terminalState: "CANCELLED", authorityGranted: false })
      })
    },
    captureHostedCodexNativeSemanticEvidence(plan: object, request: any) {
      const { state, binding, runtime } = ensure(plan, request.assignmentHandle)
      const event = state.events.get(request.observationId)
      if (!event) wall("HOSTED_CODEX_OBSERVATION_PENDING_WALL", "observation", "HOST_OBSERVATION_NOT_COMMITTED")
      if (event.assignmentId !== binding.assignment.assignmentId
        || event.workOrderId !== binding.assignment.workOrderId
        || event.laneId !== binding.assignment.laneId) {
        wall("HOSTED_CODEX_EVIDENCE_WALL", "response", "EXACT_ASSIGNMENT_BINDING_REQUIRED")
      }
      if (event.providerId !== "hosted-codex" || event.adapterId !== "hosted-codex-session-native-team-v1") {
        wall("HOSTED_CODEX_EVIDENCE_WALL", "response", "EXACT_PROVIDER_BINDING_REQUIRED")
      }
      if (event.artifactType !== "PROVIDER_EVIDENCE" || event.sanitized !== true || event.rawProviderOutputIncluded !== false) {
        wall("HOSTED_CODEX_EVIDENCE_WALL", "response", "SANITIZED_PROVIDER_EVIDENCE_REQUIRED")
      }
      if (event.evidenceType !== request.expectedKind) {
        wall("HOSTED_CODEX_EVIDENCE_WALL", "expectedKind", "EXACT_SEMANTIC_KIND_REQUIRED")
      }
      const eventDigest = digest(event)
      const prior = state.observations.get(request.observationId)
      if (prior) {
        if (prior.eventDigest !== eventDigest || prior.assignmentId !== event.assignmentId) {
          wall("HOSTED_CODEX_REPLAY_WALL", "observationId", "CONFLICTING_OBSERVATION_REPLAY")
        }
        return prior.handle
      }
      if (["SUCCEEDED", "FAILED", "CANCELLED"].includes(runtime.state)) {
        wall("HOSTED_CODEX_TERMINAL_RACE_WALL", "observation", "TERMINAL_ASSIGNMENT_IMMUTABLE")
      }
      const evidenceHandle = Object.freeze({
        ok: true,
        code: "HOSTED_CODEX_SEMANTIC_EVIDENCE_HANDLE_ISSUED",
        evidenceHandleDigest: digest({ eventDigest, observationId: request.observationId }),
        sanitized: true,
        rawProviderOutputIncluded: false,
        authorityGranted: false,
      })
      host.evidence.set(evidenceHandle, {
        plan, assignmentId: event.assignmentId, observationId: request.observationId,
        event, nativeBindingDigest: runtime.nativeBindingDigest,
      })
      state.observations.set(request.observationId, { eventDigest, assignmentId: event.assignmentId, handle: evidenceHandle })
      state.effects.push({ type: "OBSERVE", assignmentId: event.assignmentId, observationId: request.observationId })
      if (["SUCCEEDED", "FAILED", "CANCELLED"].includes(event.providerState)) runtime.state = event.providerState
      return evidenceHandle
    },
    attestHostedCodexSemanticEvidence(plan: object, request: any) {
      const { binding, runtime } = ensure(plan, request.assignmentHandle)
      const evidence = host.evidence.get(request.evidenceHandle)
      const expected = constraint[request.semanticConstraintId as keyof typeof constraint]
      if (!evidence || evidence.plan !== plan || evidence.assignmentId !== binding.assignment.assignmentId
        || evidence.nativeBindingDigest !== runtime.nativeBindingDigest || !expected) {
        wall("HOSTED_CODEX_EVIDENCE_HANDLE_WALL", "evidenceHandle", "EXACT_PRIVATE_BINDING_REQUIRED")
      }
      if (evidence.event.providerState !== expected.providerState
        || evidence.event.evidenceType !== expected.evidenceType
        || JSON.stringify(evidence.event.attributes) !== JSON.stringify(expected.attributes)) {
        wall("HOSTED_CODEX_EVIDENCE_WALL", "semanticConstraintId", "SEMANTIC_CONSTRAINT_FAILED")
      }
      return Object.freeze({
        assignmentId: binding.assignment.assignmentId,
        workOrderId: binding.assignment.workOrderId,
        laneId: binding.assignment.laneId,
        role: binding.assignment.role,
        observationId: evidence.observationId,
        semanticConstraintId: request.semanticConstraintId,
        evidenceType: evidence.event.evidenceType,
        providerResponseHash: digest(evidence.event),
        nativeBindingDigest: runtime.nativeBindingDigest,
        authorityFenceDigest: digest({ fence: plan, assignmentId: binding.assignment.assignmentId }),
        evidenceBindingDigest: digest({ evidence: request.evidenceHandle, assignmentId: binding.assignment.assignmentId }),
        sanitized: true,
        rawProviderOutputIncluded: false,
        authorityGranted: false,
      })
    },
    attestHostedCodexRoleAssignmentPair(plan: object, request: any) {
      const builder = ensure(plan, request.builderAssignmentHandle)
      const reviewer = ensure(plan, request.reviewerAssignmentHandle)
      if (builder.binding.assignment.role !== "builder" || reviewer.binding.assignment.role !== "reviewer"
        || builder.binding.assignment.workOrderId !== reviewer.binding.assignment.workOrderId
        || builder.binding.assignment.laneId !== reviewer.binding.assignment.laneId
        || !builder.runtime.nativeBindingDigest || !reviewer.runtime.nativeBindingDigest
        || builder.runtime.nativeBindingDigest === reviewer.runtime.nativeBindingDigest) {
        wall("HOSTED_CODEX_ROLE_PAIR_WALL", "assignmentHandles", "DISTINCT_BOUND_PAIR_REQUIRED")
      }
      return Object.freeze({
        workOrderId: builder.binding.assignment.workOrderId,
        laneId: builder.binding.assignment.laneId,
        builderAssignmentId: builder.binding.assignment.assignmentId,
        reviewerAssignmentId: reviewer.binding.assignment.assignmentId,
        builderNativeBindingDigest: builder.runtime.nativeBindingDigest,
        reviewerNativeBindingDigest: reviewer.runtime.nativeBindingDigest,
        builderNativeWorkerDigest: builder.state.pairWorkerDigestOverride ?? builder.runtime.nativeWorkerDigest,
        reviewerNativeWorkerDigest: reviewer.runtime.nativeWorkerDigest,
        coordinatorWorkerId: `coordinator-${builder.binding.assignment.workOrderId.toLowerCase()}`,
        reservationDigest: digest(builder.binding.assignment.taskPayload.reservations),
        remediationBudget: { maxCycles: builder.state.remediationBudget },
        retryBudget: structuredClone(builder.state.retryBudget),
        authorityGranted: false,
      })
    },
  }
})

import {
  adaptCodexRoleLifecycle,
  CodexRoleAdapterError,
} from "../scripts/multi-agent-operator/codex-role-adapters.mjs"

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical)
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical((value as any)[key])]))
  }
  return value
}

function contentHash(value: unknown) {
  return crypto.createHash("sha256").update(JSON.stringify(canonical(value))).digest("hex")
}

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
    for (const child of Object.values(value)) deepFreeze(child)
    Object.freeze(value)
  }
  return value
}

function ownerBudget() {
  return { credentialTouches: 0, diagnosticTouches: 0, operationTouches: 0, routineContacts: 0, routineDecisions: 0 }
}

type Fixture = ReturnType<typeof fixture>

function fixture(workOrderId = "WO-MAO-031", suffix = workOrderId.toLowerCase(), options: any = {}) {
  const laneId = `LANE-${workOrderId}`
  const adapterRunId = `run-${suffix}`
  const reservations = { paths: [{ repository: "bsvalues/terragroq", path: `src/${suffix}/implementation.ts` }], contracts: [`contract-${suffix}`], environments: [] }
  const builderAssignment = {
    assignmentId: `${adapterRunId}:builder`, workOrderId, laneId, role: "builder", workerId: `builder-${suffix}`,
    taskPayload: { reservations },
  }
  const reviewerAssignment = {
    assignmentId: `${adapterRunId}:reviewer`, workOrderId, laneId, role: "reviewer", workerId: `reviewer-${suffix}`,
    taskPayload: { reservations: options.reviewerReservations ?? structuredClone(reservations) },
  }
  const plan: any = {
    schemaVersion: 1,
    artifactType: "HOSTED_CODEX_COORDINATOR_PLAN",
    adapterRunId,
    status: "CURRENT_SESSION_NATIVE_TEAM_READY",
    providerId: "hosted-codex",
    adapterId: "hosted-codex-session-native-team-v1",
    currentSessionOnly: true,
    assignments: [builderAssignment, reviewerAssignment],
    ownerTouchBudget: ownerBudget(),
    providerContractDispatchAllowed: false,
    dispatchPerformed: false,
    durableTransportClaimed: false,
    runtimeActivationAllowed: false,
    localIssue357Allowed: false,
    credentialInspectionAllowed: false,
    authorityMintingAllowed: false,
    authorityGranted: false,
  }
  const handle = (assignment: any) => deepFreeze({
    ok: true,
    code: "HOSTED_CODEX_ASSIGNMENT_HANDLE_ISSUED",
    adapterRunId,
    assignmentId: assignment.assignmentId,
    workOrderId,
    laneId,
    role: assignment.role,
    workerId: assignment.workerId,
    assignmentContentHash: contentHash(assignment),
    authorityGranted: false,
  })
  const builder = handle(builderAssignment)
  const reviewer = handle(reviewerAssignment)
  deepFreeze(plan)
  const state = {
    runtime: new Map([
      [builderAssignment.assignmentId, { state: "PREPARED", nativeWorkerDigest: null, nativeBindingDigest: null }],
      [reviewerAssignment.assignmentId, { state: "PREPARED", nativeWorkerDigest: null, nativeBindingDigest: null }],
    ]),
    idempotency: new Map(),
    observations: new Map(),
    events: new Map(),
    effects: [] as any[],
    remediationBudget: options.remediationBudget ?? 2,
    retryBudget: options.retryBudget ?? { maxAttempts: 3, backoffSeconds: 0 },
    failNextMessage: null as string | null,
    pairWorkerDigestOverride: null as string | null,
    failReviewerStart: false,
    cancelMode: null as null | "AMBIGUOUS_ONCE" | "ALWAYS_AMBIGUOUS",
    cancelTransactions: new Map(),
  }
  host.plans.set(plan, state)
  host.handles.set(builder, { plan, assignment: builderAssignment })
  host.handles.set(reviewer, { plan, assignment: reviewerAssignment })
  const observationIds = {
    build: `obs-${suffix}-build`,
    requestChanges: `obs-${suffix}-request-changes`,
    remediation: `obs-${suffix}-remediation`,
    approval: `obs-${suffix}-approval`,
  }
  const event = (assignment: any, evidenceType: string, providerState: string, attributes: any) => ({
    artifactType: "PROVIDER_EVIDENCE",
    providerId: "hosted-codex",
    adapterId: "hosted-codex-session-native-team-v1",
    assignmentId: assignment.assignmentId,
    workOrderId,
    laneId,
    providerState,
    evidenceType,
    attributes,
    sanitized: true,
    rawProviderOutputIncluded: false,
  })
  state.events.set(observationIds.build, event(builderAssignment, "CODEX_ROLE_BUILD_COMPLETE", "RUNNING", { outcome: "COMPLETE", stage: "BUILD" }))
  state.events.set(observationIds.requestChanges, event(reviewerAssignment, "CODEX_ROLE_REQUEST_CHANGES", "RUNNING", { stage: "ASSURANCE_REVIEW", unresolvedThreads: 1, verdict: "REQUEST_CHANGES" }))
  state.events.set(observationIds.remediation, event(builderAssignment, "CODEX_ROLE_REMEDIATION_COMPLETE", "SUCCEEDED", { outcome: "COMPLETE", remediationCycle: 1, stage: "REMEDIATION" }))
  state.events.set(observationIds.approval, event(reviewerAssignment, "CODEX_ROLE_APPROVED_ZERO_UNRESOLVED", "SUCCEEDED", { stage: "REREVIEW", unresolvedThreads: 0, verdict: "APPROVED" }))
  return { plan, builder, reviewer, state, observationIds, builderAssignment, reviewerAssignment }
}

function request(value: Fixture, overrides: Record<string, unknown> = {}) {
  return {
    schemaVersion: 2,
    artifactType: "CODEX_ROLE_LIFECYCLE_REQUEST",
    adapterId: "hosted-codex-role-lifecycle-v2",
    plan: value.plan,
    builderAssignmentHandle: value.builder,
    reviewerAssignmentHandle: value.reviewer,
    idempotencyNamespace: `lifecycle-${value.plan.adapterRunId}`,
    observationIds: value.observationIds,
    messageSummaries: {
      buildDirective: "Execute the exact reserved build task.",
      buildResultNotice: "The build result is ready for independent observation.",
      reviewDirective: "Independently review the observed build result.",
      changeRequestNotice: "A bounded change request is ready for coordinator routing.",
      remediationDirective: "Remediate the independently observed change request.",
      remediationResultNotice: "The remediation result is ready for independent observation.",
      rereviewDirective: "Re-review the remediated result and resolve every thread.",
    },
    ...overrides,
  }
}

function expectWall(callback: () => unknown, code: string, detail?: string) {
  try {
    callback()
    throw new Error("expected role adapter wall")
  } catch (error) {
    expect(error).toBeInstanceOf(CodexRoleAdapterError)
    expect(error).toMatchObject({ code })
    if (detail) expect((error as CodexRoleAdapterError).detail).toContain(detail)
  }
}

beforeEach(() => {
  host.plans = new WeakMap()
  host.handles = new WeakMap()
  host.evidence = new WeakMap()
})
afterEach(() => vi.useRealTimers())

describe("WO-MAO-031 opaque Codex role lifecycle", () => {
  it("proves build, independent request-changes, original-builder remediation, and zero-thread approval", () => {
    const value = fixture()
    const result = adaptCodexRoleLifecycle(request(value))
    expect(result).toMatchObject({
      status: "ROLE_LIFECYCLE_PROVEN",
      workOrderId: "WO-MAO-031",
      nativeAssignmentsStarted: 2,
      ownerTouchCount: 0,
      runtimeActivationAllowed: false,
      localIssue357Allowed: false,
      remediation: { originalBuilderReused: true, completedCycles: 1, maximumCycles: 2 },
      review: { independentReviewer: true, initialVerdict: "REQUEST_CHANGES", initialUnresolvedThreads: 1, finalVerdict: "APPROVED", finalUnresolvedThreads: 0 },
    })
    expect(result.stages.map(({ stage }) => stage)).toEqual(["BUILD", "ASSURANCE_REVIEW", "REMEDIATION", "REREVIEW"])
    expect(value.state.effects.filter(({ type }) => type === "START")).toHaveLength(2)
    expect(value.state.effects.filter(({ type }) => type === "MESSAGE")).toHaveLength(7)
    expect(value.state.effects.filter(({ type }) => type === "OBSERVE")).toHaveLength(4)
    expect(result.roleBindings.builder.nativeBindingDigest).not.toBe(result.roleBindings.reviewer.nativeBindingDigest)
  })

  it("is reusable for a second opaque work order and lane", () => {
    const value = fixture("WO-MAO-047", "wo-mao-047")
    expect(adaptCodexRoleLifecycle(request(value))).toMatchObject({
      status: "ROLE_LIFECYCLE_PROVEN", workOrderId: "WO-MAO-047", laneId: "LANE-WO-MAO-047",
    })
  })

  it("rejects copied plans and copied or JSON assignment handles before any bridge effect", () => {
    const value = fixture()
    const copiedPlan = structuredClone(value.plan)
    const copiedHandle = structuredClone(value.builder)
    expectWall(() => adaptCodexRoleLifecycle(request(value, { plan: copiedPlan, builderAssignmentHandle: copiedHandle })), "CODEX_ROLE_COORDINATOR_WALL", "HOSTED_CODEX_ASSIGNMENT_HANDLE_WALL")
    expect(value.state.effects).toHaveLength(0)
    expectWall(() => adaptCodexRoleLifecycle(request(value, { builderAssignmentHandle: copiedHandle })), "CODEX_ROLE_COORDINATOR_WALL", "HOSTED_CODEX_ASSIGNMENT_HANDLE_WALL")
    expect(value.state.effects).toHaveLength(0)
  })

  it("rejects cross-plan and cross-lane role handles", () => {
    const left = fixture("WO-MAO-041", "left")
    const right = fixture("WO-MAO-042", "right")
    expectWall(() => adaptCodexRoleLifecycle(request(left, { reviewerAssignmentHandle: right.reviewer })), "CODEX_ROLE_ASSIGNMENT_WALL")
    expect(left.state.effects).toHaveLength(0)
    expect(right.state.effects).toHaveLength(0)
  })

  it("rejects builder self-review and mismatched reservations before native start", () => {
    const selfReview = fixture()
    expectWall(() => adaptCodexRoleLifecycle(request(selfReview, { reviewerAssignmentHandle: selfReview.builder })), "CODEX_ROLE_ASSIGNMENT_WALL")
    expect(selfReview.state.effects).toHaveLength(0)

    const mismatch = fixture("WO-MAO-048", "reservation-mismatch", {
      reviewerReservations: { paths: [{ repository: "bsvalues/terragroq", path: "src/foreign.ts" }], contracts: [], environments: [] },
    })
    expectWall(() => adaptCodexRoleLifecycle(request(mismatch)), "CODEX_ROLE_RESERVATION_WALL")
    expect(mismatch.state.effects).toHaveLength(0)
  })

  it("rejects skipped, reordered, wrong-role, and reused observations", () => {
    const skipped = fixture()
    const ids = { ...skipped.observationIds, build: skipped.observationIds.requestChanges }
    expectWall(() => adaptCodexRoleLifecycle(request(skipped, { observationIds: ids })), "CODEX_ROLE_REPLAY_WALL")

    const reused = fixture("WO-MAO-049", "reuse")
    expectWall(() => adaptCodexRoleLifecycle(request(reused, {
      observationIds: { ...reused.observationIds, remediation: reused.observationIds.build },
    })), "CODEX_ROLE_REPLAY_WALL")

    const wrongRole = fixture("WO-MAO-050", "wrong-role")
    wrongRole.state.events.get(wrongRole.observationIds.build).assignmentId = wrongRole.reviewer.assignmentId
    expectWall(() => adaptCodexRoleLifecycle(request(wrongRole)), "CODEX_ROLE_COORDINATOR_WALL", "HOSTED_CODEX_EVIDENCE_WALL")
  })

  it("rejects terminal BUILD and semantic review/remediation/approval substitutions", () => {
    const terminalBuild = fixture()
    terminalBuild.state.events.get(terminalBuild.observationIds.build).providerState = "SUCCEEDED"
    expectWall(() => adaptCodexRoleLifecycle(request(terminalBuild)), "CODEX_ROLE_COORDINATOR_WALL", "HOSTED_CODEX_EVIDENCE_WALL")

    const noThreads = fixture("WO-MAO-051", "no-change-threads")
    noThreads.state.events.get(noThreads.observationIds.requestChanges).attributes.unresolvedThreads = 0
    expectWall(() => adaptCodexRoleLifecycle(request(noThreads)), "CODEX_ROLE_COORDINATOR_WALL", "HOSTED_CODEX_EVIDENCE_WALL")

    const wrongCycle = fixture("WO-MAO-052", "wrong-cycle")
    wrongCycle.state.events.get(wrongCycle.observationIds.remediation).attributes.remediationCycle = 2
    expectWall(() => adaptCodexRoleLifecycle(request(wrongCycle)), "CODEX_ROLE_COORDINATOR_WALL", "HOSTED_CODEX_EVIDENCE_WALL")

    const unresolved = fixture("WO-MAO-053", "unresolved")
    unresolved.state.events.get(unresolved.observationIds.approval).attributes.unresolvedThreads = 1
    expectWall(() => adaptCodexRoleLifecycle(request(unresolved)), "CODEX_ROLE_COORDINATOR_WALL", "HOSTED_CODEX_EVIDENCE_WALL")
  })

  it("walls wrong provider, response type, and unsanitized/raw evidence", () => {
    for (const [suffix, mutate] of [
      ["provider", (event: any) => { event.providerId = "claude" }],
      ["type", (event: any) => { event.artifactType = "PROVIDER_ARTIFACT" }],
      ["sanitized", (event: any) => { event.sanitized = false }],
      ["raw", (event: any) => { event.rawProviderOutputIncluded = true }],
    ] as const) {
      const value = fixture(`WO-MAO-05${suffix.length}`, suffix)
      mutate(value.state.events.get(value.observationIds.build))
      expectWall(() => adaptCodexRoleLifecycle(request(value)), "CODEX_ROLE_COORDINATOR_WALL", "HOSTED_CODEX_EVIDENCE_WALL")
    }
  })

  it("fails closed when the one-cycle remediation budget is unavailable", () => {
    const value = fixture("WO-MAO-054", "no-budget", { remediationBudget: 0 })
    expectWall(() => adaptCodexRoleLifecycle(request(value)), "CODEX_ROLE_REMEDIATION_BUDGET_WALL")
    expect(value.state.effects.filter(({ type }) => type === "OBSERVE")).toHaveLength(0)
  })

  it("rejects a pair attestation substituted for either native start receipt", () => {
    const value = fixture("WO-MAO-057", "native-substitution")
    value.state.pairWorkerDigestOverride = "f".repeat(64)
    expectWall(() => adaptCodexRoleLifecycle(request(value)), "CODEX_ROLE_INDEPENDENCE_WALL", "START_RECEIPT_NATIVE_BINDING_REQUIRED")
    expect(value.state.effects.filter(({ type }) => type === "OBSERVE")).toHaveLength(0)
  })

  it("replays idempotently, conflicts changed replays, and seals approved terminal state", () => {
    const value = fixture()
    const input = request(value)
    const first = adaptCodexRoleLifecycle(input)
    const effectCount = value.state.effects.length
    expect(adaptCodexRoleLifecycle(input)).toBe(first)
    expect(value.state.effects).toHaveLength(effectCount)
    expectWall(() => adaptCodexRoleLifecycle({ ...input, idempotencyNamespace: "different-lifecycle" }), "CODEX_ROLE_TERMINAL_WALL")
    expect(value.state.effects).toHaveLength(effectCount)
  })

  it("resumes an exact ambiguous side effect without duplicate committed effects", () => {
    const value = fixture("WO-MAO-055", "resume")
    value.state.failNextMessage = "HOST_SIDE_EFFECT_OUTCOME_AMBIGUOUS"
    const input = request(value)
    expectWall(() => adaptCodexRoleLifecycle(input), "CODEX_ROLE_COORDINATOR_WALL", "HOST_SIDE_EFFECT_OUTCOME_AMBIGUOUS")
    expect(value.state.effects.filter(({ type }) => type === "START")).toHaveLength(2)
    const result = adaptCodexRoleLifecycle(input)
    expect(result.status).toBe("ROLE_LIFECYCLE_PROVEN")
    expect(value.state.effects.filter(({ type }) => type === "START")).toHaveLength(2)
    expect(value.state.effects.filter(({ type }) => type === "MESSAGE")).toHaveLength(7)
  })

  it("treats a trusted observation-pending wall as retryable without duplicate effects", () => {
    const value = fixture("WO-MAO-058", "observation-pending")
    const event = value.state.events.get(value.observationIds.build)
    value.state.events.delete(value.observationIds.build)
    const input = request(value)
    expectWall(() => adaptCodexRoleLifecycle(input), "CODEX_ROLE_COORDINATOR_WALL", "HOSTED_CODEX_OBSERVATION_PENDING_WALL")
    expect(value.state.effects.filter(({ type }) => type === "START")).toHaveLength(2)
    expect(value.state.effects.filter(({ type }) => type === "MESSAGE")).toHaveLength(1)
    value.state.events.set(value.observationIds.build, event)
    const result = adaptCodexRoleLifecycle(input)
    expect(result).toMatchObject({ status: "ROLE_LIFECYCLE_PROVEN", retry: { attemptsUsed: 2, maximumAttempts: 3 } })
    expect(value.state.effects.filter(({ type }) => type === "START")).toHaveLength(2)
    expect(value.state.effects.filter(({ type }) => type === "MESSAGE")).toHaveLength(7)
  })

  it("enforces retry-budget exhaustion before another lifecycle effect and cleans up children", () => {
    const value = fixture("WO-MAO-059", "retry-exhausted", { retryBudget: { maxAttempts: 1, backoffSeconds: 0 } })
    value.state.events.delete(value.observationIds.build)
    const input = request(value)
    expectWall(() => adaptCodexRoleLifecycle(input), "CODEX_ROLE_COORDINATOR_WALL", "HOSTED_CODEX_OBSERVATION_PENDING_WALL")
    const effectsBeforeRetry = value.state.effects.filter(({ type }) => type !== "CANCEL").length
    expectWall(() => adaptCodexRoleLifecycle(input), "CODEX_ROLE_RETRY_BUDGET_WALL", "LIFECYCLE_RETRY_BUDGET_EXHAUSTED")
    expect(value.state.effects.filter(({ type }) => type !== "CANCEL")).toHaveLength(effectsBeforeRetry)
    expect(value.state.effects.filter(({ type }) => type === "CANCEL")).toHaveLength(2)
    expect([...value.state.runtime.values()].every(({ state }) => state !== "ACTIVE")).toBe(true)
  })

  it("enforces the attested retry backoff before consuming another attempt", () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date("2026-07-16T00:00:00.000Z"))
    const value = fixture("WO-MAO-060", "retry-backoff", { retryBudget: { maxAttempts: 2, backoffSeconds: 10 } })
    const event = value.state.events.get(value.observationIds.build)
    value.state.events.delete(value.observationIds.build)
    const input = request(value)
    expectWall(() => adaptCodexRoleLifecycle(input), "CODEX_ROLE_COORDINATOR_WALL", "HOSTED_CODEX_OBSERVATION_PENDING_WALL")
    value.state.events.set(value.observationIds.build, event)
    const effectCount = value.state.effects.length
    expectWall(() => adaptCodexRoleLifecycle(input), "CODEX_ROLE_BACKOFF_WALL", "RETRY_NOT_YET_ELIGIBLE")
    expect(value.state.effects).toHaveLength(effectCount)
    vi.advanceTimersByTime(10_000)
    expect(adaptCodexRoleLifecycle(input)).toMatchObject({ retry: { attemptsUsed: 2, backoffSeconds: 10 } })
  })

  it("reconciles ambiguous cleanup through lookup without a second cancel attempt", () => {
    const value = fixture("WO-MAO-061", "cleanup-reconcile")
    value.state.cancelMode = "AMBIGUOUS_ONCE"
    value.state.events.get(value.observationIds.requestChanges).attributes.verdict = "APPROVED"
    const input = request(value)
    expectWall(() => adaptCodexRoleLifecycle(input), "CODEX_ROLE_QUARANTINE_WALL", "CHILD_CLEANUP_RECONCILIATION_REQUIRED")
    expect(value.state.effects.filter(({ type }) => type === "CANCEL_ATTEMPT")).toHaveLength(2)
    const effectCount = value.state.effects.length
    expectWall(() => adaptCodexRoleLifecycle({ ...input, idempotencyNamespace: "conflicting-cleanup" }), "CODEX_ROLE_REPLAY_WALL")
    expect(value.state.effects).toHaveLength(effectCount)
    expectWall(() => adaptCodexRoleLifecycle(input), "CODEX_ROLE_TERMINAL_WALL", "FAILED_LIFECYCLE_IMMUTABLE")
    expect(value.state.effects.filter(({ type }) => type === "CANCEL_ATTEMPT")).toHaveLength(2)
    expect(value.state.effects.filter(({ type }) => type === "CANCEL_LOOKUP")).toHaveLength(2)
    expect([...value.state.runtime.values()].every(({ state }) => state !== "ACTIVE")).toBe(true)
  })

  it("enforces cleanup backoff before an exact reconciliation lookup", () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date("2026-07-16T00:00:00.000Z"))
    const value = fixture("WO-MAO-064", "cleanup-backoff", { retryBudget: { maxAttempts: 2, backoffSeconds: 10 } })
    value.state.cancelMode = "AMBIGUOUS_ONCE"
    value.state.events.get(value.observationIds.requestChanges).attributes.verdict = "APPROVED"
    const input = request(value)
    expectWall(() => adaptCodexRoleLifecycle(input), "CODEX_ROLE_QUARANTINE_WALL", "CHILD_CLEANUP_RECONCILIATION_REQUIRED")
    const effectCount = value.state.effects.length
    expectWall(() => adaptCodexRoleLifecycle(input), "CODEX_ROLE_BACKOFF_WALL", "CLEANUP_RETRY_NOT_YET_ELIGIBLE")
    expect(value.state.effects).toHaveLength(effectCount)
    vi.advanceTimersByTime(10_000)
    expectWall(() => adaptCodexRoleLifecycle(input), "CODEX_ROLE_TERMINAL_WALL", "FAILED_LIFECYCLE_IMMUTABLE")
    expect(value.state.effects.filter(({ type }) => type === "CANCEL_LOOKUP")).toHaveLength(2)
  })

  it("terminal-quarantines permanently ambiguous cleanup at its retry budget", () => {
    const value = fixture("WO-MAO-062", "cleanup-exhaust", { retryBudget: { maxAttempts: 2, backoffSeconds: 0 } })
    value.state.cancelMode = "ALWAYS_AMBIGUOUS"
    value.state.events.get(value.observationIds.requestChanges).attributes.verdict = "APPROVED"
    const input = request(value)
    expectWall(() => adaptCodexRoleLifecycle(input), "CODEX_ROLE_QUARANTINE_WALL", "CHILD_CLEANUP_RECONCILIATION_REQUIRED")
    expectWall(() => adaptCodexRoleLifecycle(input), "CODEX_ROLE_QUARANTINE_WALL", "CHILD_CLEANUP_RETRY_BUDGET_EXHAUSTED")
    const effectCount = value.state.effects.length
    expectWall(() => adaptCodexRoleLifecycle(input), "CODEX_ROLE_QUARANTINE_WALL", "CHILD_CLEANUP_RETRY_BUDGET_EXHAUSTED")
    expect(value.state.effects).toHaveLength(effectCount)
    expect(value.state.effects.filter(({ type }) => type === "CANCEL_ATTEMPT")).toHaveLength(2)
    expect(value.state.effects.filter(({ type }) => type === "CANCEL_LOOKUP")).toHaveLength(2)
  })

  it("cancels both the started builder and prepared reviewer after a partial start failure", () => {
    const value = fixture("WO-MAO-063", "partial-start")
    value.state.failReviewerStart = true
    expectWall(() => adaptCodexRoleLifecycle(request(value)), "CODEX_ROLE_COORDINATOR_WALL", "HOST_SPAWN_REJECTED")
    expect(value.state.effects.filter(({ type }) => type === "START")).toHaveLength(1)
    expect(value.state.effects.filter(({ type }) => type === "CANCEL")).toHaveLength(2)
    expect([...value.state.runtime.values()].every(({ state }) => state === "CANCELLED")).toBe(true)
  })

  it("terminalizes a semantic failure instead of leaving a poisoned RUNNING retry", () => {
    const value = fixture("WO-MAO-056", "failed-semantic")
    value.state.events.get(value.observationIds.requestChanges).attributes.verdict = "APPROVED"
    const input = request(value)
    expectWall(() => adaptCodexRoleLifecycle(input), "CODEX_ROLE_COORDINATOR_WALL")
    expect(value.state.effects.filter(({ type }) => type === "CANCEL")).toHaveLength(2)
    expect([...value.state.runtime.values()].every(({ state }) => state !== "ACTIVE")).toBe(true)
    expectWall(() => adaptCodexRoleLifecycle(input), "CODEX_ROLE_TERMINAL_WALL", "FAILED_LIFECYCLE_IMMUTABLE")
    expectWall(() => adaptCodexRoleLifecycle({ ...input, idempotencyNamespace: "new-attempt" }), "CODEX_ROLE_TERMINAL_WALL")
  })

  it("does not accept caller stages, verdicts, provider responses, or evidence handles", () => {
    const value = fixture()
    for (const field of ["stages", "review", "providerResponse", "evidenceHandle"]) {
      expectWall(() => adaptCodexRoleLifecycle({ ...request(value), [field]: {} }), "CODEX_ROLE_UNKNOWN_FIELD_WALL")
      expect(value.state.effects).toHaveLength(0)
    }
  })

  it("routes summaries only through the coordinator sanitizer", () => {
    const value = fixture()
    expectWall(() => adaptCodexRoleLifecycle(request(value, {
      messageSummaries: { ...(request(value) as any).messageSummaries, buildDirective: "password=hunter2" },
    })), "CODEX_ROLE_COORDINATOR_WALL", "HOSTED_CODEX_MESSAGE_WALL")
  })

  it("publishes only hashes, counts, typed verdicts, and non-sensitive bindings", () => {
    const value = fixture()
    const result = adaptCodexRoleLifecycle(request(value))
    const serialized = JSON.stringify(result)
    for (const forbidden of [
      "Execute the exact reserved build task", "attributes", "summary", "native-builder",
      "native-reviewer", "sessionId", "proofId", "rawProviderOutput\"",
    ]) expect(serialized).not.toContain(forbidden)
    expect(serialized).toContain("APPROVED")
    expect(serialized).toContain("REQUEST_CHANGES")
  })

  it("keeps the JSON CLI typed-walled because opaque current-session capabilities cannot serialize", () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "codex-role-cli-"))
    const inputPath = path.join(directory, "forged.json")
    fs.writeFileSync(inputPath, JSON.stringify(request(fixture())))
    const cli = spawnSync(process.execPath, ["scripts/multi-agent-operator/codex-role-adapters-cli.mjs", inputPath], { encoding: "utf8" })
    expect(cli.status).toBe(2)
    expect(JSON.parse(cli.stdout)).toMatchObject({
      ok: false,
      code: "CODEX_ROLE_CLI_PRIVATE_SESSION_WALL",
      nativeAssignmentsStarted: 0,
      runtimeActivationAllowed: false,
      localIssue357Allowed: false,
      authorityGranted: false,
    })
    fs.rmSync(directory, { recursive: true, force: true })
  })
})
