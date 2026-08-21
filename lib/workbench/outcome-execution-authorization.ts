import { hashRecord } from "@/lib/governance/hash"
import { evaluateOutcomePolicy } from "@/scripts/hermes-bridge/policy.mjs"
import { resolveHermesWorkContract } from "@/scripts/hermes-bridge/work-contract.mjs"

const evaluateCanonicalOutcomePolicy = evaluateOutcomePolicy as unknown as (input: {
  outcome: Record<string, unknown>
  actor: string
  repository: string
  standingAuthority: boolean
}) => { allowed: boolean }

export const WORKBENCH_EXECUTION_AUTHORIZATION_VERSION = "workbench-execution-authorization.v1"
export const WORKBENCH_EXECUTION_GRANT_HOURS = 72

export type AuthorizeWorkbenchOutcomeExecutionInput = Readonly<{
  projectId: number
  threadId: string
  outcomeKey: string
  idempotencyKey: string
  confirmation: "START_WORK"
}>

export type WorkbenchExecutionUnavailableReason =
  | "CONFIRMATION_REQUIRED"
  | "IDEMPOTENCY_CONFLICT"
  | "PROJECT_THREAD_OUTCOME_UNAVAILABLE"
  | "REPOSITORY_UNAVAILABLE"
  | "REPOSITORY_AMBIGUOUS"
  | "AUTHORITY_INELIGIBLE"
  | "POLICY_INELIGIBLE"
  | "UNTRUSTED_INTENT"
  | "OUTCOME_NOT_AUTHORIZABLE"
  | "STALE_VERSION"
  | "PERSISTED_BINDING_INVALID"
  | "WORK_CONTRACT_UNAVAILABLE"

type CommonResult = Readonly<{
  projectId: number
  threadId: string
  outcomeKey: string
  observedAt: string
  executionObserved: boolean
  workOrderObserved: boolean
  leaseObserved: boolean
  dispatchPerformed: false
}>

export type AuthorizeWorkbenchOutcomeExecutionResult =
  | (CommonResult & Readonly<{
      status: "AUTHORIZED_FOR_ACQUISITION" | "ALREADY_AUTHORIZED"
      reason: null
      queueVersion: number
      authorization: Readonly<{
        authorityLevel: "A2_WRITE_OWN"
        scope: string
        allowedAction: "outcome:execute"
        authorizedAt: string
        expiresAt: string
      }>
      authorizationEffect: "granted_by_action"
      currentAuthority: "not_evaluated"
    }>)
  | (CommonResult & Readonly<{
      status: "CONFLICT" | "UNAVAILABLE" | "INELIGIBLE"
      reason: WorkbenchExecutionUnavailableReason
      queueVersion: null
      authorization: null
      authorizationEffect?: never
      currentAuthority?: never
    }>)

export type WorkbenchOutcomeExecutionSnapshot = Readonly<{
  project?: { id: number; userId: string; lifecycle: string } | null
  thread?: { id: string; userId: string; projectId: number } | null
  roots: ReadonlyArray<{ threadId: string; sourceType: string; sourceId: string; role: string }>
  resources: ReadonlyArray<{ type: string; canonicalIdentity: string; relationship: string }>
  outcome?: {
    outcomeKey: string; goalId: number | null; title: string; objective: string | null
    riskClass: string; approvalState: string; approvalDecisionId: number | null
    authorityState: string; authorityLevel: string; authorityGrantRef: string | null
    authoritySubject: string; authorityAction: string; lifecycleState: string
    activeWorkOrderId: number | null; executionBinding: string | null
    leaseHolder: string | null; leaseToken: string | null; leaseExpiresAt: Date | null
    acquisitionKey: string | null; terminalKey: string | null; version: number
  } | null
  goal?: {
    id: number; userId: string; command: string; lane: string; risk: string
    authority: string; verdict: string; requiresApproval: boolean; status: string
    linkedWorkOrderId: number | null
  } | null
}>

export type WorkbenchOutcomeExecutionAssessment =
  | Readonly<{
      eligible: true
      reason: "ELIGIBLE"
      goalId: number
      repository: "bsvalues/terragroq"
      workContract: Readonly<{
        version: string
        id: string
        digest: string
        repository: string
        lane: string
        reservations: readonly string[]
        validationCommands: readonly Readonly<{
          command: string
          args: readonly string[]
          env?: Readonly<Record<string, string>>
          timeoutMs: number
        }>[]
        projection?: Readonly<{ issueNumber: number; completionOwned: boolean }>
        delivery?: Readonly<{
          authorityLevel: "A2_WRITE_OWN"
          allowedActions: readonly string[]
          commitAllowed: boolean
          tagAllowed: boolean
          pushAllowed: boolean
        }>
      }>
    }>
  | Readonly<{ eligible: false; reason: WorkbenchExecutionUnavailableReason }>

const INJECTION_PATTERN = /\b(?:ignore|disregard|override)\s+(?:all\s+)?(?:previous|prior|system|developer)\s+(?:instructions?|messages?|rules?)\b|\b(?:reveal|print|exfiltrate)\s+(?:the\s+)?(?:system\s+prompt|secrets?|credentials?|tokens?)\b/i
const STRICT_PROTECTED_PATTERN = /\b(?:deploy|deployment|release|cutover|production|secret|credential|paid\s+overage|billing|destructive|force[ -]?push|reset\s+--hard|delete|drop|truncate|tag|publish)\b/i

export function normalizeWorkbenchOutcomeExecutionInput(
  value: AuthorizeWorkbenchOutcomeExecutionInput,
): AuthorizeWorkbenchOutcomeExecutionInput {
  if (!Number.isSafeInteger(value?.projectId) || value.projectId <= 0) {
    throw new Error("WORKBENCH_EXECUTION_INPUT_INVALID")
  }
  const threadId = value.threadId?.trim()
  const outcomeKey = value.outcomeKey?.trim()
  const idempotencyKey = value.idempotencyKey?.trim()
  if (!threadId || threadId.length > 200 || !outcomeKey || outcomeKey.length > 300) {
    throw new Error("WORKBENCH_EXECUTION_INPUT_INVALID")
  }
  if (!idempotencyKey || !/^[A-Za-z0-9][A-Za-z0-9._:-]{7,199}$/.test(idempotencyKey)) {
    throw new Error("WORKBENCH_EXECUTION_IDEMPOTENCY_KEY_INVALID")
  }
  if (value.confirmation !== "START_WORK") {
    throw new Error("WORKBENCH_EXECUTION_CONFIRMATION_REQUIRED")
  }
  return { ...value, threadId, outcomeKey, idempotencyKey }
}

export function buildWorkbenchExecutionAuthorizationRequestHash(
  input: AuthorizeWorkbenchOutcomeExecutionInput,
): string {
  return hashRecord({ contract: WORKBENCH_EXECUTION_AUTHORIZATION_VERSION, ...input })
}

export function assessWorkbenchOutcomeExecution(
  input: AuthorizeWorkbenchOutcomeExecutionInput,
  snapshot: WorkbenchOutcomeExecutionSnapshot,
): WorkbenchOutcomeExecutionAssessment {
  const { project, thread, roots, resources, outcome, goal } = snapshot
  if (!project || !thread || project.userId !== thread.userId
    || project.id !== input.projectId || project.lifecycle !== "active"
    || thread.id !== input.threadId || thread.projectId !== project.id
    || roots.length !== 1 || roots[0].threadId !== input.threadId || roots[0].role !== "root"
    || roots[0].sourceType !== "outcome" || roots[0].sourceId !== input.outcomeKey
    || !outcome || outcome.outcomeKey !== input.outcomeKey || !goal
    || outcome.goalId !== goal.id || goal.userId !== project.userId) {
    return { eligible: false, reason: "PROJECT_THREAD_OUTCOME_UNAVAILABLE" }
  }

  const primaryRepos = resources.filter((resource) => (
    resource.type === "repo" && resource.relationship === "primary-repo"
  ))
  if (primaryRepos.length > 1) return { eligible: false, reason: "REPOSITORY_AMBIGUOUS" }
  if (primaryRepos.length !== 1 || primaryRepos[0].canonicalIdentity !== "bsvalues/terragroq") {
    return { eligible: false, reason: "REPOSITORY_UNAVAILABLE" }
  }
  if (goal.authority !== "A2_WRITE_OWN" || outcome.authorityLevel !== "A2_WRITE_OWN"
    || outcome.authoritySubject !== "operator" || outcome.authorityAction !== "outcome:execute") {
    return { eligible: false, reason: "AUTHORITY_INELIGIBLE" }
  }
  if (outcome.version !== 0) return { eligible: false, reason: "STALE_VERSION" }
  if (outcome.lifecycleState !== "suggested" || outcome.approvalState !== "unapproved"
    || outcome.approvalDecisionId !== null || outcome.authorityState !== "unverified"
    || outcome.authorityGrantRef !== null || outcome.activeWorkOrderId !== null
    || outcome.executionBinding !== null || outcome.leaseHolder !== null || outcome.leaseToken !== null
    || outcome.leaseExpiresAt !== null || outcome.acquisitionKey !== null || outcome.terminalKey !== null
    || goal.linkedWorkOrderId !== null) {
    return { eligible: false, reason: "OUTCOME_NOT_AUTHORIZABLE" }
  }
  const text = `${goal.command}\n${outcome.title}\n${outcome.objective ?? ""}`
  if (INJECTION_PATTERN.test(text)) return { eligible: false, reason: "UNTRUSTED_INTENT" }
  if (STRICT_PROTECTED_PATTERN.test(text)) return { eligible: false, reason: "POLICY_INELIGIBLE" }

  const workContract = resolveHermesWorkContract({
    command: goal.command,
    title: outcome.title,
    objective: outcome.objective,
    lane: goal.lane,
    risk: goal.risk,
    authority: goal.authority,
  })
  const policy = evaluateCanonicalOutcomePolicy({
    outcome: {
      command: goal.command,
      title: outcome.title,
      description: outcome.objective,
      // The pre-registered operator-objective contract is evidence-only. The legacy
      // policy has no such lane, so evaluate its bounded repository effect as docs.
      lane: workContract?.lane === "operator-objective" ? "docs" : goal.lane,
      risk: goal.risk,
      riskClass: outcome.riskClass,
      authority: goal.authority,
      verdict: goal.verdict,
      requiresApproval: goal.requiresApproval,
      status: goal.status,
    },
    actor: "bsvalues",
    repository: primaryRepos[0].canonicalIdentity,
    standingAuthority: true,
  })
  if (!policy.allowed) return { eligible: false, reason: "POLICY_INELIGIBLE" }
  if (!workContract) return { eligible: false, reason: "WORK_CONTRACT_UNAVAILABLE" }
  return {
    eligible: true, reason: "ELIGIBLE", goalId: goal.id,
    repository: "bsvalues/terragroq", workContract,
  }
}

export function deterministicWorkbenchExecutionRefs(requestHash: string) {
  const suffix = requestHash.slice(0, 24).toUpperCase()
  return {
    decisionRef: `WB-EXEC-DEC-${suffix}`,
    grantRef: `WB-EXEC-GRANT-${suffix}`,
    implementationGrantRef: `WB-EXEC-IMPL-GRANT-${suffix}`,
  }
}
