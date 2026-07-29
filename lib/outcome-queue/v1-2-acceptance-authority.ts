import { hashRecord } from "@/lib/governance/hash"

export const V1_2_ACCEPTANCE_AUTHORITY_SCOPES = [
  "acceptance:v1-2:authority-blocked",
  "acceptance:v1-2:dependency-blocked",
] as const

export const V1_2_ACCEPTANCE_BLOCKED_ACTIONS = [
  "production mutation",
  "TerraFusion",
  "Property Workbench",
  "TerraPilot",
  "county/PACS",
  "protected data",
  "paid overage",
  "destructive action",
  "secret inspection",
  "authority expansion",
  "issue #357",
] as const

const CONTRACTS = {
  "acceptance:v1-2:authority-blocked": {
    dependencyKeys: ["acceptance:v1-2:safety-blocker"],
    objective: "Remain unselected after an exact-scope authority grant is revoked.",
    queueOrder: 100,
    title: "V1.2 revoked-authority nonselection proof",
  },
  "acceptance:v1-2:dependency-blocked": {
    dependencyKeys: ["acceptance:v1-2:safety-blocker"],
    objective: "Exercise pause/resume exactly once while an unfinished dependency prevents selection.",
    queueOrder: 101,
    title: "V1.2 dependency and pause/resume proof",
  },
} as const

type Candidate = {
  outcomeKey: string
  title: string
  objective: string | null
  queueOrder: number
  dependencyKeys: readonly string[]
  riskClass: string
  approvalState: string
  authorityState: string
  authorityLevel: string
  authoritySubject: string
  authorityAction: string
  lifecycleState: string
  activeWorkOrderId: number | null
  executionBinding?: string | null
  leaseHolder?: string | null
  leaseToken?: string | null
  leaseExpiresAt?: unknown
  fencingToken?: number
  acquisitionKey?: string | null
  activatedAt?: unknown
  approvalDecisionId: number | null
  authorityGrantRef: string | null
  terminalAt: unknown
  terminalResult: string | null
  terminalEvidenceId: number | null
  terminalEvidenceRefs: readonly string[]
  terminalKey?: string | null
  supersedesOutcomeKey?: string | null
  supersededByOutcomeKey?: string | null
  version: number
}

type Grant = {
  ref: string | null
  userId: string
  workOrderId: number | null
  grantedBy: string
  grantedTo: string
  authorityLevel: string
  scope: string | null
  allowedActions: readonly string[]
  blockedActions: readonly string[]
  status: string
  expiresAt: Date | null
  revokedAt: unknown
  reason: string | null
  contentHash: string | null
}

type Approval = {
  ref: string | null
  title: string
  status: string
  authority: string
  decision: string
  scope: string | null
  context: string | null
  rationale: string | null
  consequences: string | null
  owner: string | null
  evidence: readonly string[]
  tags: readonly string[]
}

function sameStrings(left: readonly string[], right: readonly string[]) {
  return JSON.stringify([...left].sort()) === JSON.stringify([...right].sort())
}

export function isV12AcceptanceAuthorityScope(
  value: string,
): value is typeof V1_2_ACCEPTANCE_AUTHORITY_SCOPES[number] {
  return V1_2_ACCEPTANCE_AUTHORITY_SCOPES.includes(
    value as typeof V1_2_ACCEPTANCE_AUTHORITY_SCOPES[number],
  )
}

export function v12AcceptanceAuthorityRefs(outcomeKey: string) {
  if (!isV12AcceptanceAuthorityScope(outcomeKey)) return null
  const suffix = outcomeKey.endsWith("authority-blocked")
    ? "AUTHORITY-BLOCKED"
    : "DEPENDENCY-BLOCKED"
  return {
    decisionRef: `ADR-V12-${suffix}`,
    grantRef: `GRANT-V12-${suffix}`,
  }
}

export function isCanonicalV12AcceptanceCandidate(
  item: Candidate,
  expectedVersion: number,
) {
  if (!isV12AcceptanceAuthorityScope(item.outcomeKey)) return false
  const contract = CONTRACTS[item.outcomeKey]
  return item.version === expectedVersion
    && item.title === contract.title
    && item.objective === contract.objective
    && item.queueOrder === contract.queueOrder
    && sameStrings(item.dependencyKeys, contract.dependencyKeys)
    && item.riskClass === "R0"
    && item.approvalState === "unapproved"
    && item.authorityState === "unverified"
    && item.authorityLevel === "A0_READ_ONLY"
    && item.authoritySubject === "operator"
    && item.authorityAction === "outcome:execute"
    && item.lifecycleState === "suggested"
    && item.activeWorkOrderId === null
    && (item.executionBinding ?? null) === null
    && (item.leaseHolder ?? null) === null
    && (item.leaseToken ?? null) === null
    && (item.leaseExpiresAt ?? null) === null
    && (item.fencingToken ?? 0) === 0
    && (item.acquisitionKey ?? null) === null
    && (item.activatedAt ?? null) === null
    && item.approvalDecisionId === null
    && item.authorityGrantRef === null
    && item.terminalAt === null
    && item.terminalResult === null
    && item.terminalEvidenceId === null
    && item.terminalEvidenceRefs.length === 0
    && (item.terminalKey ?? null) === null
    && (item.supersedesOutcomeKey ?? null) === null
    && (item.supersededByOutcomeKey ?? null) === null
}

export function isExactV12AcceptanceDecision(
  approval: Approval,
  outcomeKey: string,
) {
  if (!isV12AcceptanceAuthorityScope(outcomeKey)) return false
  const refs = v12AcceptanceAuthorityRefs(outcomeKey)!
  const contract = CONTRACTS[outcomeKey]
  return approval.ref === refs.decisionRef
    && approval.title === `Approve ${contract.title}`
    && approval.status === "accepted"
    && approval.authority === "binding"
    && approval.decision.trim().toUpperCase() === "APPROVE"
    && approval.scope === outcomeKey
    && approval.context === "WO #480 requires a bounded live authority and revocation proof."
    && approval.rationale === "The authenticated Primary explicitly approved this exact A0 acceptance scope."
    && approval.consequences === (outcomeKey.endsWith("authority-blocked")
      ? "The grant will be revoked before the acceptance exercise continues."
      : "The grant permits only the bounded pause/resume acceptance exercise.")
    && approval.owner === "Bill"
    && sameStrings(approval.evidence, ["WO #480", "PR #494"])
    && sameStrings(approval.tags, ["v1.2", "acceptance", "owner-approved"])
}

export function isExactV12AcceptanceGrant(
  grant: Grant,
  outcomeKey: string,
  expectedStatus: "active" | "revoked",
  userId: string,
) {
  const refs = v12AcceptanceAuthorityRefs(outcomeKey)
  const expectedDraft = refs === null ? null : {
    userId,
    ref: refs.grantRef,
    workOrderId: null,
    grantedBy: userId,
    grantedTo: "operator",
    authorityLevel: "A0_READ_ONLY",
    scope: outcomeKey,
    allowedActions: ["outcome:execute"],
    blockedActions: [...V1_2_ACCEPTANCE_BLOCKED_ACTIONS],
    reason: `${refs.decisionRef} authorizes only ${outcomeKey}.`,
    status: "active",
    expiresAt: null,
  }
  return isV12AcceptanceAuthorityScope(outcomeKey)
    && refs !== null
    && expectedDraft !== null
    && grant.ref === refs.grantRef
    && grant.userId === userId
    && grant.workOrderId === null
    && grant.grantedBy === userId
    && grant.grantedTo === "operator"
    && grant.authorityLevel === "A0_READ_ONLY"
    && grant.scope === outcomeKey
    && sameStrings(grant.allowedActions, ["outcome:execute"])
    && sameStrings(grant.blockedActions, V1_2_ACCEPTANCE_BLOCKED_ACTIONS)
    && grant.status === expectedStatus
    && grant.expiresAt === null
    && grant.reason === expectedDraft.reason
    && grant.contentHash === hashRecord(expectedDraft)
    && (expectedStatus === "revoked"
      ? grant.revokedAt !== null
      : grant.revokedAt === null)
}
