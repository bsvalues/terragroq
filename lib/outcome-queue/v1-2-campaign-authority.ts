import { createHash } from "node:crypto"

export const V1_2_CAMPAIGN_AUTHORITY_SCOPES = [
  "campaign:v1-2:queue-evidence-drilldown",
  "campaign:v1-2:runtime-continuity-status",
] as const

export const V1_2_CAMPAIGN_BLOCKED_ACTIONS = [
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

export const V1_2_CAMPAIGN_PARENT_ISSUE_URL =
  "https://github.com/bsvalues/terragroq/issues/471"
export const V1_2_CAMPAIGN_PARENT_BODY_SHA256 =
  "3771f688ee4c5d2f7e4ff22dbb09c45062a75d503fea5931912b98d1270db73a"
export const V1_2_CAMPAIGN_PARENT_GOAL = "GOAL-WOS-V1.2-001"
export const V1_2_CAMPAIGN_GRANT_DURATION_MS = 48 * 60 * 60 * 1000
export const V1_2_CAMPAIGN_MATERIALIZER_PROVENANCE_CONTRACT =
  "WILLIAMOS_V1_2_CAMPAIGN_SUGGESTION_V1"
const V1_2_CAMPAIGN_REPOSITORY = "bsvalues/terragroq"
const V1_2_CAMPAIGN_MATERIALIZER =
  "scripts/hermes-bridge/v1-2-continuous-campaign-materializer.mjs"

const MATERIALIZATION_REASON =
  "Suggested from the exact owner-authored and still-open V1.2 parent #471 without approval or authority."
const GOAL_RATIONALE =
  "Suggested as fixed WilliamOS-native R1 work from pinned live parent #471; this record conveys no approval or execution authority."
const GOAL_RECOMMENDED_MOVE =
  "Await an explicit owner approval and independently verified authority match."

const SPECS = {
  "campaign:v1-2:queue-evidence-drilldown": {
    suffix: "EVIDENCE-DRILLDOWN",
    title: "Add supporting evidence drill-down links to each Goal Console outcome queue row.",
    objective: "Show the linked Goal, Work Order, Evidence, Trace, and Audit records when those durable references exist.",
    dependencyKeys: [],
  },
  "campaign:v1-2:runtime-continuity-status": {
    suffix: "CONTINUITY-STATUS",
    title: "Add a compact continuous outcome campaign status panel to the WilliamOS Runtime page.",
    objective: "Show the live campaign window, acquisition and settlement sequence, automatic successor handoff, and truthful evidence gaps.",
    dependencyKeys: ["campaign:v1-2:queue-evidence-drilldown"],
  },
} as const

type CampaignScope = typeof V1_2_CAMPAIGN_AUTHORITY_SCOPES[number]

type Candidate = {
  outcomeKey: string
  goalId: number | null
  goalRef: string | null
  title: string
  objective: string | null
  queueOrder: number
  dependencyKeys: string[]
  riskClass: string
  approvalState: string
  approvedBy: string | null
  approvedAt: Date | null
  approvalDecisionId: number | null
  authorityState: string
  authorityLevel: string
  authorityGrantRef: string | null
  authoritySubject: string
  authorityAction: string
  lifecycleState: string
  lifecycleReason: string | null
  activeWorkOrderId: number | null
  executionBinding: string | null
  leaseHolder: string | null
  leaseToken: string | null
  leaseExpiresAt: Date | null
  fencingToken: number
  version: number
  acquisitionKey: string | null
  terminalResult: string | null
  terminalEvidenceId: number | null
  terminalEvidenceRefs: string[]
  terminalKey: string | null
  supersedesOutcomeKey: string | null
  supersededByOutcomeKey: string | null
  activatedAt: Date | null
  terminalAt: Date | null
  suggestedAt: Date
  createdAt: Date
  updatedAt: Date
}

type MaterializedGoal = {
  id: number
  userId: string
  ref: string | null
  command: string
  lane: string
  mode: string
  risk: string
  authority: string
  verdict: string
  rationale: string | null
  mistakePatterns: string[]
  matchedRules: string[]
  recommendedMove: string | null
  requiresApproval: boolean
  linkedWorkOrderId: number | null
  status: string
  createdAt: Date
  updatedAt: Date
}

type MaterializationGovernanceEvent = {
  id: number
  userId: string
  eventType: string
  entityType: string | null
  entityId: string | null
  actor: string | null
  reason: string | null
  beforeHash: string | null
  afterHash: string | null
  evidenceId: number | null
  metadata: unknown
  createdAt: Date
}

type MaterializationAuditEvent = {
  userId: string
  type: string
  summary: string
  register: string | null
  refId: number | null
  metadata: unknown
  createdAt: Date
}

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical)
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
        .map(([key, entry]) => [key, canonical(entry)]),
    )
  }
  return value
}

function hash(value: unknown): string {
  return createHash("sha256")
    .update(JSON.stringify(canonical(value)))
    .digest("hex")
}

function sameStrings(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length
    && left.every((value, index) => value === right[index])
}

function sameRecord(left: unknown, right: unknown): boolean {
  return JSON.stringify(canonical(left)) === JSON.stringify(canonical(right))
}

function sameInstant(left: Date, right: Date): boolean {
  return left instanceof Date
    && right instanceof Date
    && left.getTime() === right.getTime()
}

export function isV12CampaignAuthorityScope(value: string): value is CampaignScope {
  return V1_2_CAMPAIGN_AUTHORITY_SCOPES.includes(value as CampaignScope)
}

export function v12CampaignAuthoritySpec(scope: string) {
  return isV12CampaignAuthorityScope(scope) ? SPECS[scope] : null
}

export function isCanonicalV12CampaignCandidate(item: Candidate): boolean {
  const spec = v12CampaignAuthoritySpec(item.outcomeKey)
  return spec !== null
    && Number.isSafeInteger(item.goalId)
    && Number(item.goalId) > 0
    && typeof item.goalRef === "string"
    && /^GOAL-\d{4,}$/.test(item.goalRef)
    && item.title === spec.title
    && item.objective === spec.objective
    && Number.isSafeInteger(item.queueOrder)
    && item.queueOrder >= 0
    && item.queueOrder < 90
    && sameStrings(item.dependencyKeys, spec.dependencyKeys)
    && item.riskClass === "R1"
    && item.approvalState === "unapproved"
    && item.approvedBy === null
    && item.approvedAt === null
    && item.approvalDecisionId === null
    && item.authorityState === "unverified"
    && item.authorityLevel === "A0_READ_ONLY"
    && item.authorityGrantRef === null
    && item.authoritySubject === "operator"
    && item.authorityAction === "outcome:execute"
    && item.lifecycleState === "suggested"
    && item.lifecycleReason === "V1_2_CAMPAIGN_SUGGESTION_REQUIRES_OWNER_APPROVAL"
    && item.activeWorkOrderId === null
    && item.executionBinding === null
    && item.leaseHolder === null
    && item.leaseToken === null
    && item.leaseExpiresAt === null
    && item.fencingToken === 0
    && item.version === 0
    && item.acquisitionKey === null
    && item.terminalResult === null
    && item.terminalEvidenceId === null
    && item.terminalEvidenceRefs.length === 0
    && item.terminalKey === null
    && item.supersedesOutcomeKey === null
    && item.supersededByOutcomeKey === null
    && sameInstant(item.createdAt, item.suggestedAt)
    && sameInstant(item.updatedAt, item.suggestedAt)
    && item.activatedAt === null
    && item.terminalAt === null
}

export function buildV12CampaignMaterializationProvenance(
  userId: string,
  item: Candidate,
) {
  if (!isCanonicalV12CampaignCandidate(item)
    || typeof userId !== "string"
    || userId.trim() === "") {
    throw new Error("V1_2_CAMPAIGN_PROVENANCE_WALL")
  }
  const timestamp = item.suggestedAt.toISOString()
  const claims = {
    contract: V1_2_CAMPAIGN_MATERIALIZER_PROVENANCE_CONTRACT,
    materializer: V1_2_CAMPAIGN_MATERIALIZER,
    repository: V1_2_CAMPAIGN_REPOSITORY,
    parent: {
      issue: 471,
      url: V1_2_CAMPAIGN_PARENT_ISSUE_URL,
      goal: V1_2_CAMPAIGN_PARENT_GOAL,
      bodySha256: V1_2_CAMPAIGN_PARENT_BODY_SHA256,
    },
    userId,
    goal: {
      id: Number(item.goalId),
      ref: item.goalRef,
      command: item.title,
      lane: "read_model",
      mode: "implement",
      risk: "low",
      authority: "A0_READ_ONLY",
      verdict: "requires_approval",
      rationale: GOAL_RATIONALE,
      mistakePatterns: [],
      matchedRules: [],
      recommendedMove: GOAL_RECOMMENDED_MOVE,
      requiresApproval: true,
      linkedWorkOrderId: null,
      status: "classified",
      createdAt: timestamp,
      updatedAt: timestamp,
    },
    outcome: {
      key: item.outcomeKey,
      goalRef: item.goalRef,
      title: item.title,
      objective: item.objective,
      queueOrder: item.queueOrder,
      dependencyKeys: [...item.dependencyKeys],
      riskClass: "R1",
      approvalState: "unapproved",
      approvedBy: null,
      approvedAt: null,
      approvalDecisionId: null,
      authorityState: "unverified",
      authorityLevel: "A0_READ_ONLY",
      authorityGrantRef: null,
      authoritySubject: "operator",
      authorityAction: "outcome:execute",
      lifecycleState: "suggested",
      lifecycleReason: "V1_2_CAMPAIGN_SUGGESTION_REQUIRES_OWNER_APPROVAL",
      activeWorkOrderId: null,
      executionBinding: null,
      leaseHolder: null,
      leaseToken: null,
      leaseExpiresAt: null,
      fencingToken: 0,
      version: 0,
      acquisitionKey: null,
      terminalResult: null,
      terminalEvidenceId: null,
      terminalEvidenceRefs: [],
      terminalKey: null,
      supersedesOutcomeKey: null,
      supersededByOutcomeKey: null,
      suggestedAt: timestamp,
      activatedAt: null,
      terminalAt: null,
      createdAt: timestamp,
      updatedAt: timestamp,
    },
  }
  return { ...claims, contentHash: hash(claims) }
}

export function isExactV12CampaignMaterialization(input: {
  userId: string
  item: Candidate
  goal: MaterializedGoal
  governance: MaterializationGovernanceEvent
  audit: MaterializationAuditEvent
}): boolean {
  const { userId, item, goal, governance, audit } = input
  if (typeof userId !== "string"
    || userId.trim() === ""
    || !isCanonicalV12CampaignCandidate(item)) {
    return false
  }
  const provenance = {
    ...buildV12CampaignMaterializationProvenance(userId, item),
  }
  const expectedAuditMetadata = {
    governanceEventId: governance.id,
    outcomeKey: item.outcomeKey,
    parentIssue: V1_2_CAMPAIGN_PARENT_ISSUE_URL,
    provenanceContract: V1_2_CAMPAIGN_MATERIALIZER_PROVENANCE_CONTRACT,
    provenanceHash: provenance.contentHash,
  }
  return goal.id === item.goalId
    && goal.userId === userId
    && goal.ref === item.goalRef
    && goal.command === item.title
    && goal.lane === "read_model"
    && goal.mode === "implement"
    && goal.risk === "low"
    && goal.authority === "A0_READ_ONLY"
    && goal.verdict === "requires_approval"
    && goal.rationale === GOAL_RATIONALE
    && sameStrings(goal.mistakePatterns, [])
    && sameStrings(goal.matchedRules, [])
    && goal.recommendedMove === GOAL_RECOMMENDED_MOVE
    && goal.requiresApproval === true
    && goal.linkedWorkOrderId === null
    && goal.status === "classified"
    && sameInstant(goal.createdAt, item.suggestedAt)
    && sameInstant(goal.updatedAt, item.suggestedAt)
    && governance.userId === userId
    && governance.eventType === "V1_2_CHILD_OUTCOME_SUGGESTED"
    && governance.entityType === "outcome_queue_item"
    && governance.entityId === item.outcomeKey
    && governance.actor === "hermes"
    && governance.reason === MATERIALIZATION_REASON
    && governance.beforeHash === null
    && governance.afterHash === provenance.contentHash
    && governance.evidenceId === null
    && sameRecord(governance.metadata, provenance)
    && sameInstant(governance.createdAt, item.suggestedAt)
    && audit.userId === userId
    && audit.type === "outcome.suggested"
    && audit.summary
      === `${item.goalRef} suggested from pinned live V1.2 parent #471; owner approval remains required.`
    && audit.register === "outcome-queue"
    && audit.refId === item.goalId
    && sameRecord(audit.metadata, expectedAuditMetadata)
    && sameInstant(audit.createdAt, item.suggestedAt)
}

export function v12CampaignAuthorityRefs(scope: string) {
  const spec = v12CampaignAuthoritySpec(scope)
  return spec
    ? {
        decisionRef: `ADR-V12-${spec.suffix}`,
        grantRef: `GRANT-V12-${spec.suffix}`,
      }
    : null
}

export function v12CampaignDecision(scope: CampaignScope) {
  const spec = SPECS[scope]
  return {
    ref: `ADR-V12-${spec.suffix}`,
    title: `Approve ${spec.title}`,
    context: "The Primary reviewed one fixed WilliamOS-native product proposal for the #471 continuous V1.2 campaign.",
    decision: "APPROVE",
    rationale: "This exact R1 read-model outcome is useful product work inside #471 and requires explicit Primary approval before Hermes may acquire it.",
    consequences: "Hermes may execute only this exact queued outcome. The second outcome remains dependency-blocked until the first completes, and every #471 blocked boundary remains enforced.",
    status: "accepted",
    authority: "binding",
    owner: "William",
    scope,
    evidence: [
      V1_2_CAMPAIGN_PARENT_ISSUE_URL,
      `issue-body-sha256:${V1_2_CAMPAIGN_PARENT_BODY_SHA256}`,
      "https://github.com/bsvalues/terragroq/issues/480",
    ],
    tags: ["v1.2", "continuous-campaign", "primary-approved"],
    locked: true,
  } as const
}

function grantGeneration(issuedAt: Date): string {
  return issuedAt.toISOString().replaceAll(/[-:.]/g, "")
}

export function v12CampaignGrant(scope: CampaignScope, userId: string, issuedAt: Date) {
  if (!(issuedAt instanceof Date) || !Number.isFinite(issuedAt.getTime())) {
    throw new Error("V1_2_CAMPAIGN_GRANT_TIME_WALL")
  }
  const refs = v12CampaignAuthorityRefs(scope)!
  const expiresAt = new Date(issuedAt.getTime() + V1_2_CAMPAIGN_GRANT_DURATION_MS)
  const draft = {
    userId,
    ref: `${refs.grantRef}-${grantGeneration(issuedAt)}`,
    workOrderId: null,
    grantedBy: userId,
    grantedTo: "operator",
    authorityLevel: "A0_READ_ONLY",
    scope,
    allowedActions: ["outcome:execute"],
    blockedActions: [...V1_2_CAMPAIGN_BLOCKED_ACTIONS],
    reason: `${refs.decisionRef} authorizes only ${scope}.`,
    status: "active",
    expiresAt: expiresAt.toISOString(),
    createdAt: issuedAt.toISOString(),
    revokedAt: null,
    revokedBy: null,
    revokeReason: null,
  } as const
  return { ...draft, contentHash: hash(draft) }
}

export function exactV12CampaignDecision(
  value: Record<string, unknown>,
  scope: string,
): boolean {
  if (!isV12CampaignAuthorityScope(scope)) return false
  const expected = v12CampaignDecision(scope)
  return value.ref === expected.ref
    && value.title === expected.title
    && value.context === expected.context
    && value.decision === expected.decision
    && value.rationale === expected.rationale
    && value.consequences === expected.consequences
    && value.status === expected.status
    && value.authority === expected.authority
    && value.owner === expected.owner
    && value.scope === expected.scope
    && Array.isArray(value.evidence)
    && sameStrings(value.evidence as string[], expected.evidence)
    && Array.isArray(value.tags)
    && sameStrings(value.tags as string[], expected.tags)
    && value.locked === true
}

export function exactV12CampaignGrant(
  value: Record<string, unknown>,
  scope: string,
  userId: string,
  now: Date,
  options: { allowExpired?: boolean } = {},
): boolean {
  if (!isV12CampaignAuthorityScope(scope)) return false
  if (typeof userId !== "string"
    || userId.trim() === ""
    || !(now instanceof Date)
    || !(value.createdAt instanceof Date)
    || !(value.expiresAt instanceof Date)
    || !Number.isFinite(value.createdAt.getTime())
    || !Number.isFinite(value.expiresAt.getTime())
    || !Number.isFinite(now.getTime())
    || value.createdAt.getTime() > now.getTime()
    || (!options.allowExpired && value.expiresAt.getTime() <= now.getTime())) {
    return false
  }
  const expected = v12CampaignGrant(scope, userId, value.createdAt)
  return value.userId === userId
    && value.ref === expected.ref
    && value.workOrderId == null
    && value.grantedBy === userId
    && value.grantedTo === expected.grantedTo
    && value.authorityLevel === expected.authorityLevel
    && value.scope === scope
    && Array.isArray(value.allowedActions)
    && sameStrings(value.allowedActions as string[], expected.allowedActions)
    && Array.isArray(value.blockedActions)
    && sameStrings(value.blockedActions as string[], expected.blockedActions)
    && value.reason === expected.reason
    && (
      value.status === "active"
      || (
        options.allowExpired === true
        && value.status === "expired"
        && value.expiresAt.getTime() <= now.getTime()
      )
    )
    && value.expiresAt.getTime() === Date.parse(expected.expiresAt)
    && value.createdAt.getTime() === Date.parse(expected.createdAt)
    && value.revokedAt == null
    && value.revokedBy == null
    && value.revokeReason == null
    && value.contentHash === expected.contentHash
}

export function exactV12CampaignRevokedGrant(
  value: Record<string, unknown>,
  scope: string,
  userId: string,
  revokedAt: Date,
  reason: string,
): boolean {
  if (!(revokedAt instanceof Date)
    || !(value.revokedAt instanceof Date)
    || !Number.isFinite(value.revokedAt.getTime())
    || !Number.isFinite(revokedAt.getTime())
    || !sameInstant(value.revokedAt, revokedAt)
    || value.status !== "revoked"
    || value.revokedBy !== userId
    || value.revokeReason !== reason) {
    return false
  }
  return exactV12CampaignGrant({
    ...value,
    status: "active",
    revokedAt: null,
    revokedBy: null,
    revokeReason: null,
  }, scope, userId, revokedAt, { allowExpired: true })
}
