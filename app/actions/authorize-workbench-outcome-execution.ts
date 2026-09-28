"use server"

import { and, eq, sql } from "drizzle-orm"
import { revalidatePath } from "next/cache"

import { db } from "@/lib/db"
import {
  authorityGrant,
  decision,
  eventLog,
  goal,
  goalOutcomeIntakeReceipt,
  governanceEvent,
  outcomeQueueItem,
  outcomeQueueMutationReceipt,
  project,
  projectResource,
  workbenchThread,
  workbenchThreadSource,
} from "@/lib/db/schema"
import { hashRecord } from "@/lib/governance/hash"
import { getUserId } from "@/lib/session"
import { resolveOrDeriveHermesWorkContract } from "@/scripts/hermes-bridge/work-contract.mjs"
import {
  WORKBENCH_EXECUTION_GRANT_HOURS,
  assessWorkbenchOutcomeExecution,
  buildWorkbenchExecutionAuthorizationRequestHash,
  deterministicWorkbenchExecutionRefs,
  normalizeWorkbenchOutcomeExecutionInput,
  verifyIssue911AcceptanceIntakeProof,
  type AuthorizeWorkbenchOutcomeExecutionInput,
  type AuthorizeWorkbenchOutcomeExecutionResult,
  type WorkbenchExecutionUnavailableReason,
  type WorkbenchOutcomeExecutionSnapshot,
  EXECUTION_PROVISIONED_REPOSITORIES,
} from "@/lib/workbench/outcome-execution-authorization"

const OPERATION = "workbench_execution.authorize"
const BLOCKED_ACTIONS = [
  "production:mutate", "release:create", "secret:access", "spend:increase",
] as const

function hasExactStrings(actual: readonly string[], expected: readonly string[]) {
  return actual.length === expected.length && actual.every((value, index) => value === expected[index])
}

function unavailable(
  input: AuthorizeWorkbenchOutcomeExecutionInput,
  observedAt: string,
  status: "CONFLICT" | "UNAVAILABLE" | "INELIGIBLE",
  reason: WorkbenchExecutionUnavailableReason,
): AuthorizeWorkbenchOutcomeExecutionResult {
  return {
    status, reason, projectId: input.projectId, threadId: input.threadId,
    outcomeKey: input.outcomeKey, observedAt, queueVersion: null, authorization: null,
    executionObserved: false, workOrderObserved: false, leaseObserved: false,
    dispatchPerformed: false,
  }
}

function statusFor(reason: WorkbenchExecutionUnavailableReason) {
  if (reason === "IDEMPOTENCY_CONFLICT") return "CONFLICT" as const
  if (reason === "PROJECT_THREAD_OUTCOME_UNAVAILABLE"
    || reason === "REPOSITORY_UNAVAILABLE" || reason === "REPOSITORY_AMBIGUOUS"
    || reason === "REPOSITORY_EXECUTION_TARGET_UNAVAILABLE") {
    return "UNAVAILABLE" as const
  }
  return "INELIGIBLE" as const
}

type Transaction = Parameters<Parameters<typeof db.transaction>[0]>[0]

async function loadSnapshot(
  transaction: Transaction,
  userId: string,
  input: AuthorizeWorkbenchOutcomeExecutionInput,
): Promise<WorkbenchOutcomeExecutionSnapshot> {
  const projects = await transaction.select({
    id: project.id, userId: project.userId, lifecycle: project.lifecycle,
  }).from(project).where(and(eq(project.userId, userId), eq(project.id, input.projectId))).limit(2)
  const threads = await transaction.select({
    id: workbenchThread.id, userId: workbenchThread.userId, projectId: workbenchThread.projectId,
  }).from(workbenchThread).where(and(
    eq(workbenchThread.userId, userId), eq(workbenchThread.id, input.threadId),
  )).limit(2)
  const roots = await transaction.select({
    threadId: workbenchThreadSource.threadId,
    sourceType: workbenchThreadSource.sourceType,
    sourceId: workbenchThreadSource.sourceId,
    role: workbenchThreadSource.role,
  }).from(workbenchThreadSource).where(and(
    eq(workbenchThreadSource.userId, userId),
    eq(workbenchThreadSource.sourceType, "outcome"),
    eq(workbenchThreadSource.sourceId, input.outcomeKey),
    eq(workbenchThreadSource.role, "root"),
  )).limit(2)
  const resources = await transaction.select({
    type: projectResource.type,
    canonicalIdentity: projectResource.canonicalIdentity,
    relationship: projectResource.relationship,
  }).from(projectResource).where(and(
    eq(projectResource.userId, userId), eq(projectResource.projectId, input.projectId),
    eq(projectResource.type, "repo"), eq(projectResource.relationship, "primary-repo"),
  )).limit(2)
  const outcomes = await transaction.select({
    outcomeKey: outcomeQueueItem.outcomeKey, goalId: outcomeQueueItem.goalId,
    title: outcomeQueueItem.title, objective: outcomeQueueItem.objective,
    riskClass: outcomeQueueItem.riskClass, approvalState: outcomeQueueItem.approvalState,
    approvalDecisionId: outcomeQueueItem.approvalDecisionId,
    authorityState: outcomeQueueItem.authorityState, authorityLevel: outcomeQueueItem.authorityLevel,
    authorityGrantRef: outcomeQueueItem.authorityGrantRef,
    authoritySubject: outcomeQueueItem.authoritySubject, authorityAction: outcomeQueueItem.authorityAction,
    lifecycleState: outcomeQueueItem.lifecycleState, activeWorkOrderId: outcomeQueueItem.activeWorkOrderId,
    executionBinding: outcomeQueueItem.executionBinding, leaseHolder: outcomeQueueItem.leaseHolder,
    leaseToken: outcomeQueueItem.leaseToken, leaseExpiresAt: outcomeQueueItem.leaseExpiresAt,
    acquisitionKey: outcomeQueueItem.acquisitionKey, terminalKey: outcomeQueueItem.terminalKey,
    version: outcomeQueueItem.version, acceptedContractIds: outcomeQueueItem.acceptedContractIds,
  }).from(outcomeQueueItem).where(and(
    eq(outcomeQueueItem.userId, userId), eq(outcomeQueueItem.outcomeKey, input.outcomeKey),
  )).limit(2)
  const goals = outcomes.length === 1 && outcomes[0].goalId !== null
    ? await transaction.select({
        id: goal.id, userId: goal.userId, command: goal.command, lane: goal.lane,
        risk: goal.risk, authority: goal.authority, verdict: goal.verdict,
        requiresApproval: goal.requiresApproval, status: goal.status,
        linkedWorkOrderId: goal.linkedWorkOrderId, acceptedContractIds: goal.acceptedContractIds,
      }).from(goal).where(and(eq(goal.userId, userId), eq(goal.id, outcomes[0].goalId))).limit(2)
    : []
  const intakeReceipts = goals.length === 1
    ? await transaction.select({
        id: goalOutcomeIntakeReceipt.id, userId: goalOutcomeIntakeReceipt.userId,
        idempotencyKey: goalOutcomeIntakeReceipt.idempotencyKey,
        requestHash: goalOutcomeIntakeReceipt.requestHash,
        goalId: goalOutcomeIntakeReceipt.goalId,
        outcomeKey: goalOutcomeIntakeReceipt.outcomeKey,
        acceptedContractIds: goalOutcomeIntakeReceipt.acceptedContractIds,
        resultDigest: goalOutcomeIntakeReceipt.resultDigest,
      }).from(goalOutcomeIntakeReceipt).where(and(
        eq(goalOutcomeIntakeReceipt.userId, userId),
        eq(goalOutcomeIntakeReceipt.goalId, goals[0].id),
        eq(goalOutcomeIntakeReceipt.outcomeKey, input.outcomeKey),
      )).limit(2)
    : []
  return {
    project: projects.length === 1 ? projects[0] : null,
    thread: threads.length === 1 ? threads[0] : null,
    roots,
    resources,
    outcome: outcomes.length === 1 ? outcomes[0] : null,
    goal: goals.length === 1 ? goals[0] : null,
    intakeReceipts,
  }
}

export async function authorizeWorkbenchOutcomeExecution(
  rawInput: AuthorizeWorkbenchOutcomeExecutionInput,
): Promise<AuthorizeWorkbenchOutcomeExecutionResult> {
  const input = normalizeWorkbenchOutcomeExecutionInput(rawInput)
  const userId = await getUserId()
  const requestHash = buildWorkbenchExecutionAuthorizationRequestHash(input)

  const result = await db.transaction(async (transaction) => {
    await transaction.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${`${userId}:outcome-queue`}))`)
    await transaction.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${`${userId}:workbench-execution-authorization`}))`)
    const clock = await transaction.execute(sql`SELECT clock_timestamp() AS "now"`)
    const observed = new Date(clock.rows[0]?.now as Date | string)
    if (!Number.isFinite(observed.getTime())) throw new Error("WORKBENCH_EXECUTION_DATABASE_CLOCK_INVALID")
    const observedAt = observed.toISOString()

    const receipts = await transaction.select().from(outcomeQueueMutationReceipt).where(and(
      eq(outcomeQueueMutationReceipt.userId, userId),
      eq(outcomeQueueMutationReceipt.idempotencyKey, input.idempotencyKey),
    )).limit(2)
    if (receipts.length > 1) throw new Error("WORKBENCH_EXECUTION_RECEIPT_DUPLICATED")
    if (receipts[0]) {
      const receipt = receipts[0]
      if (receipt.operation !== OPERATION || receipt.requestHash !== requestHash
        || hashRecord(receipt.requestBinding) !== hashRecord(input)) {
        return unavailable(input, observedAt, "CONFLICT", "IDEMPOTENCY_CONFLICT")
      }
      const binding = receipt.resultBinding as Record<string, unknown>
      const snapshot = await loadSnapshot(transaction, userId, input)
      const outcome = snapshot.outcome
      const decisions = await transaction.select({
        id: decision.id, ref: decision.ref, status: decision.status,
        authority: decision.authority, scope: decision.scope, decision: decision.decision,
        evidence: decision.evidence,
      }).from(decision).where(and(eq(decision.userId, userId), eq(decision.id, Number(binding.decisionId)))).limit(2)
      const grants = await transaction.select({
        id: authorityGrant.id, userId: authorityGrant.userId,
        ref: authorityGrant.ref, status: authorityGrant.status, scope: authorityGrant.scope,
        authorityLevel: authorityGrant.authorityLevel, grantedTo: authorityGrant.grantedTo,
        allowedActions: authorityGrant.allowedActions, blockedActions: authorityGrant.blockedActions,
        workOrderId: authorityGrant.workOrderId, revokedAt: authorityGrant.revokedAt,
        expiresAt: authorityGrant.expiresAt,
      }).from(authorityGrant).where(and(
        eq(authorityGrant.userId, userId), eq(authorityGrant.ref, String(binding.grantRef)),
      )).limit(2)
      const implementationGrants = typeof binding.implementationGrantRef === "string"
        ? await transaction.select({
            id: authorityGrant.id, userId: authorityGrant.userId,
            ref: authorityGrant.ref, status: authorityGrant.status, scope: authorityGrant.scope,
            authorityLevel: authorityGrant.authorityLevel, grantedTo: authorityGrant.grantedTo,
            allowedActions: authorityGrant.allowedActions, blockedActions: authorityGrant.blockedActions,
            workOrderId: authorityGrant.workOrderId, revokedAt: authorityGrant.revokedAt,
            expiresAt: authorityGrant.expiresAt,
          }).from(authorityGrant).where(and(
            eq(authorityGrant.userId, userId),
            eq(authorityGrant.ref, String(binding.implementationGrantRef)),
          )).limit(2)
        : []
      const grant = grants[0]
      const implementationGrant = implementationGrants[0]
      const approval = decisions[0]
      const expiresAt = grant?.expiresAt ? new Date(grant.expiresAt) : null
      const workContract = snapshot.goal && snapshot.outcome
        // Replay must resolve the SAME contract the original authorization used — including a
        // derived lane-policy contract — or the idempotent hash comparison below would spuriously
        // mismatch for every derived authorization.
        ? resolveOrDeriveHermesWorkContract({
            command: snapshot.goal.command,
            title: snapshot.outcome.title,
            objective: snapshot.outcome.objective,
            lane: snapshot.goal.lane,
            risk: snapshot.goal.risk,
            authority: snapshot.goal.authority,
            acceptedContractIds: snapshot.goal.acceptedContractIds,
          })
        : null
      const replayRepository = snapshot.resources.find((resource) => (
        resource.type === "repo" && resource.relationship === "primary-repo"
      ))?.canonicalIdentity
      const storedWorkContract = binding.workContract as Record<string, unknown> | null
      const acceptanceVerification = verifyIssue911AcceptanceIntakeProof(snapshot)
      const delivery = workContract && "delivery" in workContract ? workContract.delivery : null
      const implementationExpiry = implementationGrant?.expiresAt
        ? new Date(implementationGrant.expiresAt)
        : null
      const implementationGraphExact = delivery
        ? implementationGrants.length === 1
          && implementationGrant?.id === binding.implementationGrantId
          && implementationGrant.userId === userId
          && implementationGrant.ref === binding.implementationGrantRef
          && implementationGrant.workOrderId === null
          && implementationGrant.scope === `WO-HERMES-OUTCOME-${snapshot.goal?.id}`
          && implementationGrant.authorityLevel === delivery.authorityLevel
          && implementationGrant.grantedTo === "operator"
          && hasExactStrings(implementationGrant.allowedActions, delivery.allowedActions)
          && hasExactStrings(implementationGrant.blockedActions, BLOCKED_ACTIONS)
          && implementationGrant.status === "active" && implementationGrant.revokedAt === null
          && implementationExpiry?.toISOString() === binding.expiresAt
        : binding.implementationGrantId === undefined
          && binding.implementationGrantRef === undefined
          && implementationGrants.length === 0
      const projectRow = snapshot.project
      const threadRow = snapshot.thread
      const goalRow = snapshot.goal
      const exactGraph = projectRow !== null && projectRow !== undefined
        && projectRow.userId === userId && projectRow.id === input.projectId
        && threadRow !== null && threadRow !== undefined
        && threadRow.userId === userId && threadRow.id === input.threadId
        && threadRow.projectId === input.projectId && snapshot.roots.length === 1
        && snapshot.roots[0].threadId === input.threadId
        && snapshot.roots[0].sourceType === "outcome" && snapshot.roots[0].sourceId === input.outcomeKey
        // Exactly one primary repo is the contract. WHICH repository it is comes from the Project
        // graph and is settled by the authorization, not asserted here -- pinning the literal
        // `bsvalues/terragroq` here is what made every other project permanently ineligible.
        && snapshot.resources.filter((resource) => resource.type === "repo" && resource.relationship === "primary-repo").length === 1
        && outcome !== null && outcome !== undefined && outcome.outcomeKey === input.outcomeKey
        && goalRow !== null && goalRow !== undefined
        && goalRow.userId === userId && outcome.goalId === goalRow.id
        && outcome.approvalDecisionId === binding.decisionId
        && ["approved", "active", "blocked", "completed"].includes(outcome.lifecycleState)
        && approval?.id === binding.decisionId && approval.status === "accepted"
        && approval.authority === "binding" && approval.scope === input.outcomeKey && approval.decision === "APPROVE"
        && grant?.ref === binding.grantRef && grant.workOrderId === null
        && grant.scope === input.outcomeKey && grant.authorityLevel === "A2_WRITE_OWN"
        && grant.grantedTo === "operator" && grant.allowedActions.length === 1
        && grant.allowedActions[0] === "outcome:execute" && expiresAt !== null
        && workContract !== null && storedWorkContract !== null
        && hashRecord(workContract) === hashRecord(storedWorkContract)
        && hashRecord(binding.acceptedContractIds ?? []) === hashRecord(goalRow.acceptedContractIds ?? [])
        && hashRecord(goalRow.acceptedContractIds ?? []) === hashRecord(outcome.acceptedContractIds ?? [])
        && acceptanceVerification !== null
        && (acceptanceVerification.selected
          ? hashRecord(binding.acceptanceIntakeProof) === hashRecord(acceptanceVerification.proof)
          : binding.acceptanceIntakeProof === undefined)
        && approval.evidence.includes(`work-contract:${workContract.id}`)
        && approval.evidence.includes(`work-contract-digest:${workContract.digest}`)
        // A replay must not survive its Project being repointed at another repository. The replay
        // path derives its work contract WITHOUT a repository, so the contract digest cannot catch
        // that -- the hard-coded literal had been enforcing it by accident. Two checks replace it,
        // and neither invalidates authorizations recorded before #1015: the repository must still
        // be one execution is provisioned for, and where a decision recorded one it must match.
        && replayRepository !== undefined
        && EXECUTION_PROVISIONED_REPOSITORIES.includes(replayRepository)
        && approval.evidence.every((entry: string) => (
          !entry.startsWith("repo:") || entry === `repo:${replayRepository}`
        ))
        && (!acceptanceVerification.selected || (
          approval.evidence.includes(`acceptance-intake-receipt:${acceptanceVerification.proof?.receiptId}`)
          && approval.evidence.includes(`acceptance-intake-request:${acceptanceVerification.proof?.requestHash}`)
          && approval.evidence.includes(`acceptance-intake-result:${acceptanceVerification.proof?.resultDigest}`)
          && approval.evidence.includes(`acceptance-intake-key-digest:${acceptanceVerification.proof?.idempotencyKeyDigest}`)
        ))
        && (!delivery
          || approval.evidence.includes(`work-contract-json:${JSON.stringify(workContract)}`))
        && implementationGraphExact
      if (!exactGraph || typeof binding.authorizedAt !== "string" || typeof binding.expiresAt !== "string"
        || expiresAt?.toISOString() !== binding.expiresAt) {
        return unavailable(input, observedAt, "INELIGIBLE", "PERSISTED_BINDING_INVALID")
      }
      const executionObserved = outcome.executionBinding !== null
        || outcome.acquisitionKey !== null || outcome.lifecycleState === "completed"
      const workOrderObserved = outcome.activeWorkOrderId !== null
      const leaseObserved = outcome.leaseHolder !== null && outcome.leaseToken !== null
        && outcome.leaseExpiresAt !== null
        && new Date(outcome.leaseExpiresAt).getTime() > Date.parse(observedAt)
      return {
        status: "ALREADY_AUTHORIZED" as const, reason: null, projectId: input.projectId,
        threadId: input.threadId, outcomeKey: input.outcomeKey, observedAt,
        queueVersion: Number(binding.queueVersion),
        authorization: {
          authorityLevel: "A2_WRITE_OWN" as const, scope: input.outcomeKey,
          allowedAction: "outcome:execute" as const, authorizedAt: binding.authorizedAt,
          expiresAt: binding.expiresAt,
        },
        authorizationEffect: "granted_by_action" as const,
        currentAuthority: "not_evaluated" as const,
        executionObserved, workOrderObserved, leaseObserved,
        dispatchPerformed: false as const,
      }
    }

    const snapshot = await loadSnapshot(transaction, userId, input)
    const assessment = assessWorkbenchOutcomeExecution(input, snapshot)
    if (!assessment.eligible) {
      return unavailable(input, observedAt, statusFor(assessment.reason), assessment.reason)
    }

    const authorizedAt = new Date(observedAt)
    const expiresAt = new Date(authorizedAt.getTime() + WORKBENCH_EXECUTION_GRANT_HOURS * 60 * 60 * 1000)
    const refs = deterministicWorkbenchExecutionRefs(requestHash)
    const [approval] = await transaction.insert(decision).values({
      userId, ref: refs.decisionRef, title: "Authorize Workbench outcome for acquisition",
      context: "Explicit Start work confirmation for the exact Project Thread outcome root.",
      decision: "APPROVE", rationale: "Bounded WilliamOS A2 acquisition eligibility only.",
      consequences: "No work order, lease, process, workspace, command, or dispatch is created.",
      status: "accepted", authority: "binding", owner: userId, scope: input.outcomeKey,
      evidence: [
        `project:${input.projectId}`, `thread:${input.threadId}`, `repo:${assessment.repository}`,
        `work-contract:${assessment.workContract.id}`,
        `work-contract-digest:${assessment.workContract.digest}`,
        `work-contract-json:${JSON.stringify(assessment.workContract)}`,
        ...(assessment.acceptanceIntakeProof ? [
          `acceptance-intake-receipt:${assessment.acceptanceIntakeProof.receiptId}`,
          `acceptance-intake-request:${assessment.acceptanceIntakeProof.requestHash}`,
          `acceptance-intake-result:${assessment.acceptanceIntakeProof.resultDigest}`,
          `acceptance-intake-key-digest:${assessment.acceptanceIntakeProof.idempotencyKeyDigest}`,
        ] : []),
        ...assessment.workContract.reservations.map((reservation) => `reservation:${reservation}`),
        ...assessment.workContract.validationCommands.map((validator) => (
          `validator:${validator.command}:${validator.args.join(" ")}`
        )),
      ],
      tags: ["workbench", "outcome", "explicit-start-work"], locked: true,
      decidedAt: authorizedAt, createdAt: authorizedAt, updatedAt: authorizedAt,
    }).returning({ id: decision.id, ref: decision.ref })
    if (!approval?.id || approval.ref !== refs.decisionRef) throw new Error("WORKBENCH_EXECUTION_DECISION_WRITE_WALL")

    const grantPayload = {
      userId, ref: refs.grantRef, workOrderId: null, grantedBy: userId, grantedTo: "operator",
      authorityLevel: "A2_WRITE_OWN", scope: input.outcomeKey,
      allowedActions: ["outcome:execute"], blockedActions: [...BLOCKED_ACTIONS],
      reason: `Explicit Workbench Start work authorization for ${assessment.workContract.id} (${assessment.workContract.digest}).`,
      status: "active", expiresAt, revokedAt: null, revokedBy: null, revokeReason: null,
      createdAt: authorizedAt,
    }
    const [grant] = await transaction.insert(authorityGrant).values({
      ...grantPayload, contentHash: hashRecord(grantPayload),
    }).returning({ id: authorityGrant.id, ref: authorityGrant.ref })
    if (!grant?.id || grant.ref !== refs.grantRef) throw new Error("WORKBENCH_EXECUTION_GRANT_WRITE_WALL")

    let implementationGrant: { id: number; ref: string } | null = null
    if (assessment.workContract.delivery) {
      const implementationGrantPayload = {
        userId, ref: refs.implementationGrantRef, workOrderId: null,
        grantedBy: userId, grantedTo: "operator",
        authorityLevel: assessment.workContract.delivery.authorityLevel,
        scope: `WO-HERMES-OUTCOME-${assessment.goalId}`,
        allowedActions: [...assessment.workContract.delivery.allowedActions],
        blockedActions: [...BLOCKED_ACTIONS],
        reason: `Pre-registered implementation authority for ${assessment.workContract.id} (${assessment.workContract.digest}).`,
        status: "active", expiresAt, revokedAt: null, revokedBy: null, revokeReason: null,
        createdAt: authorizedAt,
      }
      const [writtenImplementationGrant] = await transaction.insert(authorityGrant).values({
        ...implementationGrantPayload,
        contentHash: hashRecord(implementationGrantPayload),
      }).returning({ id: authorityGrant.id, ref: authorityGrant.ref })
      if (!writtenImplementationGrant?.id
        || writtenImplementationGrant.ref !== refs.implementationGrantRef) {
        throw new Error("WORKBENCH_EXECUTION_IMPLEMENTATION_GRANT_WRITE_WALL")
      }
      implementationGrant = { id: writtenImplementationGrant.id, ref: refs.implementationGrantRef }
    }

    const [updated] = await transaction.update(outcomeQueueItem).set({
      approvalState: "approved", approvedBy: userId, approvedAt: authorizedAt,
      approvalDecisionId: approval.id, authorityState: "matched", authorityGrantRef: refs.grantRef,
      lifecycleState: "approved", lifecycleReason: "WORKBENCH_EXPLICIT_START_WORK",
      version: 1, updatedAt: authorizedAt,
    }).where(and(
      eq(outcomeQueueItem.userId, userId), eq(outcomeQueueItem.outcomeKey, input.outcomeKey),
      eq(outcomeQueueItem.version, 0), eq(outcomeQueueItem.lifecycleState, "suggested"),
      eq(outcomeQueueItem.approvalState, "unapproved"), eq(outcomeQueueItem.authorityState, "unverified"),
    )).returning({ version: outcomeQueueItem.version })
    if (updated?.version !== 1) throw new Error("WORKBENCH_EXECUTION_QUEUE_WRITE_WALL")

    const resultBinding = {
      decisionId: approval.id, decisionRef: refs.decisionRef, grantId: grant.id,
      grantRef: refs.grantRef, queueVersion: 1, authorizedAt: authorizedAt.toISOString(),
      expiresAt: expiresAt.toISOString(),
      ...(implementationGrant ? {
        implementationGrantId: implementationGrant.id,
        implementationGrantRef: implementationGrant.ref,
      } : {}),
      acceptedContractIds: [...(snapshot.goal?.acceptedContractIds ?? [])],
      ...(assessment.acceptanceIntakeProof
        ? { acceptanceIntakeProof: assessment.acceptanceIntakeProof }
        : {}),
      workContract: {
        version: assessment.workContract.version,
        id: assessment.workContract.id,
        digest: assessment.workContract.digest,
        repository: assessment.workContract.repository,
        lane: assessment.workContract.lane,
        reservations: assessment.workContract.reservations,
        validationCommands: assessment.workContract.validationCommands,
        ...(assessment.workContract.projection
          ? { projection: assessment.workContract.projection }
          : {}),
        ...(assessment.workContract.delivery
          ? { delivery: assessment.workContract.delivery }
          : {}),
        ...(assessment.workContract.acceptance
          ? { acceptance: assessment.workContract.acceptance }
          : {}),
      },
    }
    await transaction.insert(outcomeQueueMutationReceipt).values({
      userId, idempotencyKey: input.idempotencyKey, operation: OPERATION,
      outcomeKey: input.outcomeKey, requestHash, requestBinding: input, resultBinding,
      createdAt: authorizedAt,
    })
    await transaction.insert(governanceEvent).values({
      userId, ref: `GEV-${refs.decisionRef}`, eventType: "WORKBENCH_OUTCOME_EXECUTION_AUTHORIZED",
      entityType: "outcome_queue_item", entityId: input.outcomeKey, actor: userId,
      reason: "Explicit Start work confirmation persisted.", afterHash: hashRecord(resultBinding),
      metadata: { projectId: input.projectId, threadId: input.threadId, decisionRef: refs.decisionRef, grantRef: refs.grantRef },
      createdAt: authorizedAt,
    })
    await transaction.insert(eventLog).values({
      userId, type: "workbench.outcome.execution_authorized",
      summary: "Workbench outcome authorized for governed acquisition.",
      register: "outcome_queue", refId: snapshot.outcome?.goalId ?? null,
      metadata: { projectId: input.projectId, threadId: input.threadId, outcomeKey: input.outcomeKey },
      createdAt: authorizedAt,
    })
    return {
      status: "AUTHORIZED_FOR_ACQUISITION" as const, reason: null,
      projectId: input.projectId, threadId: input.threadId, outcomeKey: input.outcomeKey,
      observedAt, queueVersion: 1,
      authorization: {
        authorityLevel: "A2_WRITE_OWN" as const, scope: input.outcomeKey,
        allowedAction: "outcome:execute" as const, authorizedAt: authorizedAt.toISOString(),
        expiresAt: expiresAt.toISOString(),
      },
      authorizationEffect: "granted_by_action" as const,
      currentAuthority: "not_evaluated" as const,
      executionObserved: false as const, workOrderObserved: false as const,
      leaseObserved: false as const, dispatchPerformed: false as const,
    }
  })
  if (result.status === "AUTHORIZED_FOR_ACQUISITION") revalidatePath("/")
  return result
}
