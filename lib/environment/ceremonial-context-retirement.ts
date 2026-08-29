import { and, asc, eq, inArray, isNull, sql } from "drizzle-orm"

import { db } from "@/lib/db"
import {
  authorityGrant,
  eventLog,
  governanceEvent,
  workOrder,
} from "@/lib/db/schema"
import { toUtcWallDriver } from "@/lib/db/utc-wall-timestamp"
import { hashRecord } from "@/lib/governance/hash"

const OWNER_USER_ID = "YCAbP6TPTU1sxkpf4gVl5FcX9Nf4lrwZ"
export const CEREMONIAL_CONTEXT_RETIREMENT_OPERATION_ID = "WILLIAMOS_RETIRE_CEREMONIAL_CONTEXT_20260829"
export const CEREMONIAL_CONTEXT_RETIREMENT_REASON = "WORKFLOW_INVERSION_CLEANUP"
const ACTOR = "williamos"

export type CeremonialContextGrant = Readonly<{
  id: number
  userId: string
  ref: string | null
  workOrderId: number | null
  grantedBy: string
  grantedTo: string
  authorityLevel: string
  status: string
  contentHash: string | null
  revokedAt: Date | null
  revokedBy: string | null
  revokeReason: string | null
}>

export type CeremonialContextWorkOrder = Readonly<{
  id: number
  userId: string
  ref: string | null
  authorityGrantId: number | null
  status: string
  updatedAt: Date
  updatedAtVersion?: string
  title: string
  goal: string | null
  scope: string | null
  lane: string | null
  authorityLevel: string
  authorityGranted: string | null
  agent: string | null
  closedAt: Date | null
}>

export type CeremonialContextAudit = Readonly<{
  operationId: string
  reason: string
  retiredAt: string
  mirrorKey: string
  userId: string
  action: "grant-revoked" | "work-order-aborted"
  grantId: number
  workOrderId: number
  entityType: "authority_grant" | "work_order"
  entityId: string
  entityRef: string
  eventType: "AUTHORITY_REVOKED" | "WO_TRANSITION"
  mirrorType: "authority.revoked" | "work_order.transition"
  register: "authority" | "work-orders"
  refId: number
  actor: string
  summary: string
  beforeHash: string
  afterHash: string
}>

export type CeremonialContextRetirementTransaction = Readonly<{
  now: () => Promise<Date>
  lockGrants: (ids: readonly number[]) => Promise<readonly CeremonialContextGrant[]>
  lockWorkOrders: (ids: readonly number[]) => Promise<readonly CeremonialContextWorkOrder[]>
  readAudit: (operationId: string, userId: string) => Promise<Readonly<{
    governance: readonly CeremonialContextAudit[]
    mirrors: readonly CeremonialContextAudit[]
  }>>
  revokeGrant: (expected: CeremonialContextGrant, at: Date) => Promise<boolean>
  abortWorkOrder: (expected: CeremonialContextWorkOrder, at: Date) => Promise<boolean>
  appendGovernance: (events: readonly CeremonialContextAudit[]) => Promise<void>
  appendMirrors: (events: readonly CeremonialContextAudit[]) => Promise<void>
}>

export type CeremonialContextRetirementDependencies = Readonly<{
  transaction: <T>(callback: (transaction: CeremonialContextRetirementTransaction) => Promise<T>) => Promise<T>
}>

export type CeremonialContextRetirementErrorCode =
  | "OWNER_MISMATCH"
  | "TARGET_MISSING"
  | "TARGET_FOREIGN"
  | "TARGET_DRIFTED"
  | "TARGET_MIXED"
  | "AUDIT_INCOMPLETE"
  | "CONCURRENT_CHANGE"

export class CeremonialContextRetirementError extends Error {
  readonly name = "CeremonialContextRetirementError"

  constructor(readonly code: CeremonialContextRetirementErrorCode) {
    super(code)
  }
}

type ExpectedGrant = Readonly<{
  id: number
  userId: string
  ref: string
  workOrderId: number
  grantedBy: string
  grantedTo: "codex"
  authorityLevel: "A8_PUSH"
  status: "active"
  contentHash: string
}>

type ExpectedWorkOrder = Readonly<{
  id: number
  userId: string
  ref: string
  authorityGrantId: number
  status: "active"
  updatedAt: string
  title: string
  goal: "WILLIAMOS_EXPERIENCE_V2"
  scope: string
  lane: "product-delivery"
  authorityLevel: "A8_PUSH"
  authorityGranted: "A8_PUSH"
  agent: "codex"
}>

const EXPECTED_GRANTS: readonly ExpectedGrant[] = [
  {
    id: 13,
    userId: OWNER_USER_ID,
    ref: "GRANT-0003",
    workOrderId: 17,
    grantedBy: OWNER_USER_ID,
    grantedTo: "codex",
    authorityLevel: "A8_PUSH",
    status: "active",
    contentHash: "f1fe7b9609ad0e6d76bdc018a898339de6d8044722a811c8ba238c667080a59f",
  },
  {
    id: 14,
    userId: OWNER_USER_ID,
    ref: "GRANT-0004",
    workOrderId: 18,
    grantedBy: OWNER_USER_ID,
    grantedTo: "codex",
    authorityLevel: "A8_PUSH",
    status: "active",
    contentHash: "e57e424df2c23c52abcb08541ab7fc39437357f8b99bb614cc1d6c46b663c748",
  },
] as const

const EXPECTED_WORK_ORDERS: readonly ExpectedWorkOrder[] = [
  {
    id: 17,
    userId: OWNER_USER_ID,
    ref: "WO-0001",
    authorityGrantId: 13,
    status: "active",
    updatedAt: "2026-08-29T22:59:04.953Z",
    title: "Experience V2 server-derived work-context hardening",
    goal: "WILLIAMOS_EXPERIENCE_V2",
    scope: "WILLIAMOS_EXPERIENCE_V2 work-context hardening only",
    lane: "product-delivery",
    authorityLevel: "A8_PUSH",
    authorityGranted: "A8_PUSH",
    agent: "codex",
  },
  {
    id: 18,
    userId: OWNER_USER_ID,
    ref: "WO-0002",
    authorityGrantId: 14,
    status: "active",
    updatedAt: "2026-08-29T22:59:08.550Z",
    title: "Experience V2 exact delivery for PRs 1069 through 1071",
    goal: "WILLIAMOS_EXPERIENCE_V2",
    scope: "PR #1069 -> #1070 -> #1071 exact existing changes only",
    lane: "product-delivery",
    authorityLevel: "A8_PUSH",
    authorityGranted: "A8_PUSH",
    agent: "codex",
  },
] as const

function sameDate(value: Date | null, expected: string): boolean {
  return value instanceof Date && Number.isFinite(value.getTime()) && value.toISOString() === expected
}

function activeGrantExact(row: CeremonialContextGrant, expected: ExpectedGrant): boolean {
  return row.id === expected.id
    && row.userId === expected.userId
    && row.ref === expected.ref
    && row.workOrderId === expected.workOrderId
    && row.grantedBy === expected.grantedBy
    && row.grantedTo === expected.grantedTo
    && row.authorityLevel === expected.authorityLevel
    && row.status === expected.status
    && row.contentHash === expected.contentHash
    && row.revokedAt === null
    && row.revokedBy === null
    && row.revokeReason === null
}

function retiredGrantExact(row: CeremonialContextGrant, expected: ExpectedGrant): boolean {
  return row.id === expected.id
    && row.userId === expected.userId
    && row.ref === expected.ref
    && row.workOrderId === expected.workOrderId
    && row.grantedBy === expected.grantedBy
    && row.grantedTo === expected.grantedTo
    && row.authorityLevel === expected.authorityLevel
    && row.status === "revoked"
    && row.contentHash === expected.contentHash
    && row.revokedAt instanceof Date
    && Number.isFinite(row.revokedAt.getTime())
    && row.revokedBy === OWNER_USER_ID
    && row.revokeReason === CEREMONIAL_CONTEXT_RETIREMENT_REASON
}

function workOrderIdentityExact(row: CeremonialContextWorkOrder, expected: ExpectedWorkOrder): boolean {
  return row.id === expected.id
    && row.userId === expected.userId
    && row.ref === expected.ref
    && row.authorityGrantId === expected.authorityGrantId
    && row.title === expected.title
    && row.goal === expected.goal
    && row.scope === expected.scope
    && row.lane === expected.lane
    && row.authorityLevel === expected.authorityLevel
    && row.authorityGranted === expected.authorityGranted
    && row.agent === expected.agent
}

function activeWorkOrderExact(row: CeremonialContextWorkOrder, expected: ExpectedWorkOrder): boolean {
  return workOrderIdentityExact(row, expected)
    && row.status === expected.status
    && sameDate(row.updatedAt, expected.updatedAt)
    && row.closedAt === null
}

function retiredWorkOrderExact(row: CeremonialContextWorkOrder, expected: ExpectedWorkOrder): boolean {
  return workOrderIdentityExact(row, expected)
    && row.status === "aborted"
    && row.updatedAt instanceof Date
    && Number.isFinite(row.updatedAt.getTime())
    && row.closedAt instanceof Date
    && Number.isFinite(row.closedAt.getTime())
    && row.updatedAt.getTime() === row.closedAt.getTime()
}

function expectedAudits(retiredAt: string): readonly CeremonialContextAudit[] {
  return EXPECTED_GRANTS.flatMap((grant, index) => {
    const work = EXPECTED_WORK_ORDERS[index]
    const grantBefore = { status: "active" }
    const grantAfter = {
      status: "revoked",
      revokedBy: OWNER_USER_ID,
      revokeReason: CEREMONIAL_CONTEXT_RETIREMENT_REASON,
      retiredAt,
    }
    const workBefore = { status: "active", updatedAt: work.updatedAt }
    const workAfter = { status: "aborted", retiredAt }
    return [
      {
        operationId: CEREMONIAL_CONTEXT_RETIREMENT_OPERATION_ID,
        reason: CEREMONIAL_CONTEXT_RETIREMENT_REASON,
        retiredAt,
        mirrorKey: `${CEREMONIAL_CONTEXT_RETIREMENT_OPERATION_ID}:grant:${grant.id}`,
        userId: OWNER_USER_ID,
        action: "grant-revoked" as const,
        grantId: grant.id,
        workOrderId: work.id,
        entityType: "authority_grant" as const,
        entityId: String(grant.id),
        entityRef: grant.ref,
        eventType: "AUTHORITY_REVOKED" as const,
        mirrorType: "authority.revoked" as const,
        register: "authority" as const,
        refId: grant.id,
        actor: ACTOR,
        summary: `${grant.ref}: REVOKED — ${CEREMONIAL_CONTEXT_RETIREMENT_REASON}`,
        beforeHash: hashRecord(grantBefore),
        afterHash: hashRecord(grantAfter),
      },
      {
        operationId: CEREMONIAL_CONTEXT_RETIREMENT_OPERATION_ID,
        reason: CEREMONIAL_CONTEXT_RETIREMENT_REASON,
        retiredAt,
        mirrorKey: `${CEREMONIAL_CONTEXT_RETIREMENT_OPERATION_ID}:work-order:${work.id}`,
        userId: OWNER_USER_ID,
        action: "work-order-aborted" as const,
        grantId: grant.id,
        workOrderId: work.id,
        entityType: "work_order" as const,
        entityId: String(work.id),
        entityRef: work.ref,
        eventType: "WO_TRANSITION" as const,
        mirrorType: "work_order.transition" as const,
        register: "work-orders" as const,
        refId: work.id,
        actor: ACTOR,
        summary: `${work.ref}: active -> aborted — ${CEREMONIAL_CONTEXT_RETIREMENT_REASON}`,
        beforeHash: hashRecord(workBefore),
        afterHash: hashRecord(workAfter),
      },
    ]
  })
}

function exactAudit(actual: readonly CeremonialContextAudit[], expected: readonly CeremonialContextAudit[]): boolean {
  if (actual.length !== expected.length) return false
  const byKey = [...actual].sort((left, right) => left.mirrorKey.localeCompare(right.mirrorKey))
  const expectedByKey = [...expected].sort((left, right) => left.mirrorKey.localeCompare(right.mirrorKey))
  return hashRecord(byKey) === hashRecord(expectedByKey)
}

function error(code: CeremonialContextRetirementErrorCode): never {
  throw new CeremonialContextRetirementError(code)
}

const selectGrant = {
  id: authorityGrant.id,
  userId: authorityGrant.userId,
  ref: authorityGrant.ref,
  workOrderId: authorityGrant.workOrderId,
  grantedBy: authorityGrant.grantedBy,
  grantedTo: authorityGrant.grantedTo,
  authorityLevel: authorityGrant.authorityLevel,
  status: authorityGrant.status,
  contentHash: authorityGrant.contentHash,
  revokedAt: authorityGrant.revokedAt,
  revokedBy: authorityGrant.revokedBy,
  revokeReason: authorityGrant.revokeReason,
}

const selectWorkOrder = {
  id: workOrder.id,
  userId: workOrder.userId,
  ref: workOrder.ref,
  authorityGrantId: workOrder.authorityGrantId,
  status: workOrder.status,
  updatedAt: sql<string>`to_char(${workOrder.updatedAt}, 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')`,
  updatedAtVersion: sql<string>`${workOrder.updatedAt}::text`,
  title: workOrder.title,
  goal: workOrder.goal,
  scope: workOrder.scope,
  lane: workOrder.lane,
  authorityLevel: workOrder.authorityLevel,
  authorityGranted: workOrder.authorityGranted,
  agent: workOrder.agent,
  closedAt: sql<string | null>`to_char(${workOrder.closedAt}, 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')`,
}

function parseUtcWallText(value: string | null, field: string): Date | null {
  if (value === null) return null
  const parsed = new Date(value)
  if (!Number.isFinite(parsed.getTime())) throw new Error(`CEREMONIAL_CONTEXT_${field}_INVALID`)
  return parsed
}

function auditFromMetadata(value: unknown): CeremonialContextAudit | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null
  const metadata = value as Record<string, unknown>
  if (Object.keys(metadata).sort().join(",") !== "audit,mirrorKey,operationId") return null
  const audit = metadata.audit
  if (!audit || typeof audit !== "object" || Array.isArray(audit)) return null
  const typed = audit as CeremonialContextAudit
  return metadata.operationId === typed.operationId && metadata.mirrorKey === typed.mirrorKey
    ? typed
    : null
}

function invalidAudit(operationId: string, source: string, index: number): CeremonialContextAudit {
  return {
    operationId,
    reason: `INVALID_${source}_AUDIT_ROW`,
    retiredAt: "INVALID",
    mirrorKey: `${operationId}:invalid:${source}:${index}`,
    userId: "INVALID",
    action: "grant-revoked",
    grantId: -1,
    workOrderId: -1,
    entityType: "authority_grant",
    entityId: "INVALID",
    entityRef: "INVALID",
    eventType: "AUTHORITY_REVOKED",
    mirrorType: "authority.revoked",
    register: "authority",
    refId: -1,
    actor: "INVALID",
    summary: "INVALID",
    beforeHash: "INVALID",
    afterHash: "INVALID",
  }
}

const productionDependencies: CeremonialContextRetirementDependencies = {
  transaction: async (callback) => db.transaction(async (transaction) => callback({
    now: async () => {
      const result = await transaction.execute(sql`SELECT clock_timestamp() AS "now"`)
      const at = new Date(result.rows[0]?.now as Date | string)
      if (!Number.isFinite(at.getTime())) throw new Error("CEREMONIAL_CONTEXT_DATABASE_CLOCK_INVALID")
      return at
    },
    lockGrants: async (ids) => transaction.select(selectGrant)
      .from(authorityGrant)
      .where(inArray(authorityGrant.id, [...ids]))
      .orderBy(asc(authorityGrant.id))
      .for("update"),
    lockWorkOrders: async (ids) => {
      const rows = await transaction.select(selectWorkOrder)
        .from(workOrder)
        .where(inArray(workOrder.id, [...ids]))
        .orderBy(asc(workOrder.id))
        .for("update")
      return rows.map((row) => ({
        ...row,
        updatedAt: parseUtcWallText(row.updatedAt, "UPDATED_AT")!,
        closedAt: parseUtcWallText(row.closedAt, "CLOSED_AT"),
      }))
    },
    readAudit: async (operationId, userId) => {
      const governanceRows = await transaction.select({
        userId: governanceEvent.userId,
        eventType: governanceEvent.eventType,
        entityType: governanceEvent.entityType,
        entityId: governanceEvent.entityId,
        actor: governanceEvent.actor,
        reason: governanceEvent.reason,
        beforeHash: governanceEvent.beforeHash,
        afterHash: governanceEvent.afterHash,
        metadata: governanceEvent.metadata,
      }).from(governanceEvent).where(and(
        eq(governanceEvent.userId, userId),
        sql`${governanceEvent.metadata}->>'operationId' = ${operationId}`,
      ),
      ).orderBy(asc(governanceEvent.id))
      const mirrorRows = await transaction.select({
        userId: eventLog.userId,
        type: eventLog.type,
        summary: eventLog.summary,
        register: eventLog.register,
        refId: eventLog.refId,
        metadata: eventLog.metadata,
      }).from(eventLog).where(and(
        eq(eventLog.userId, userId),
        sql`${eventLog.metadata}->>'operationId' = ${operationId}`,
      ),
      ).orderBy(asc(eventLog.id))
      return {
        governance: governanceRows.map((row, index) => {
          const audit = auditFromMetadata(row.metadata)
          return audit ? {
            ...audit,
            userId: row.userId,
            eventType: row.eventType,
            entityType: row.entityType,
            entityId: row.entityId,
            actor: row.actor,
            reason: row.reason,
            beforeHash: row.beforeHash,
            afterHash: row.afterHash,
          } as CeremonialContextAudit : invalidAudit(operationId, "governance", index)
        }),
        mirrors: mirrorRows.map((row, index) => {
          const audit = auditFromMetadata(row.metadata)
          return audit ? {
            ...audit,
            userId: row.userId,
            mirrorType: row.type,
            summary: row.summary,
            register: row.register,
            refId: row.refId,
          } as CeremonialContextAudit : invalidAudit(operationId, "mirror", index)
        }),
      }
    },
    revokeGrant: async (expected, at) => {
      const [updated] = await transaction.update(authorityGrant).set({
        status: "revoked",
        revokedAt: at,
        revokedBy: OWNER_USER_ID,
        revokeReason: CEREMONIAL_CONTEXT_RETIREMENT_REASON,
      }).where(and(
        eq(authorityGrant.id, expected.id),
        eq(authorityGrant.userId, expected.userId),
        eq(authorityGrant.ref, expected.ref!),
        eq(authorityGrant.workOrderId, expected.workOrderId!),
        eq(authorityGrant.grantedBy, expected.grantedBy),
        eq(authorityGrant.grantedTo, expected.grantedTo),
        eq(authorityGrant.authorityLevel, expected.authorityLevel),
        eq(authorityGrant.status, "active"),
        eq(authorityGrant.contentHash, expected.contentHash!),
        isNull(authorityGrant.revokedAt),
        isNull(authorityGrant.revokedBy),
        isNull(authorityGrant.revokeReason),
      )).returning({ id: authorityGrant.id })
      return updated?.id === expected.id
    },
    abortWorkOrder: async (expected, at) => {
      const [updated] = await transaction.update(workOrder).set({
        status: "aborted",
        closedAt: at,
        updatedAt: at,
      }).where(and(
        eq(workOrder.id, expected.id),
        eq(workOrder.userId, expected.userId),
        eq(workOrder.ref, expected.ref!),
        eq(workOrder.authorityGrantId, expected.authorityGrantId!),
        eq(workOrder.status, "active"),
        sql`${workOrder.updatedAt} = ${(expected.updatedAtVersion ?? toUtcWallDriver(expected.updatedAt))}::timestamp`,
        eq(workOrder.title, expected.title),
        eq(workOrder.goal, expected.goal!),
        eq(workOrder.scope, expected.scope!),
        eq(workOrder.lane, expected.lane!),
        eq(workOrder.authorityLevel, expected.authorityLevel),
        eq(workOrder.authorityGranted, expected.authorityGranted!),
        eq(workOrder.agent, expected.agent!),
        isNull(workOrder.closedAt),
      )).returning({ id: workOrder.id })
      return updated?.id === expected.id
    },
    appendGovernance: async (events) => {
      await transaction.insert(governanceEvent).values(events.map((event) => ({
        userId: event.userId,
        eventType: event.eventType,
        entityType: event.entityType,
        entityId: event.entityId,
        actor: event.actor,
        reason: event.reason,
        beforeHash: event.beforeHash,
        afterHash: event.afterHash,
        metadata: { operationId: event.operationId, mirrorKey: event.mirrorKey, audit: event },
      })))
    },
    appendMirrors: async (events) => {
      await transaction.insert(eventLog).values(events.map((event) => ({
        userId: event.userId,
        type: event.mirrorType,
        summary: event.summary,
        register: event.register,
        refId: event.refId,
        metadata: { operationId: event.operationId, mirrorKey: event.mirrorKey, audit: event },
      })))
    },
  }), { isolationLevel: "serializable" }),
}

export type CeremonialContextRetirementResult = Readonly<{
  status: "RETIRED" | "ALREADY_RETIRED"
  operationId: typeof CEREMONIAL_CONTEXT_RETIREMENT_OPERATION_ID
  grantIds: readonly [13, 14]
  workOrderIds: readonly [17, 18]
}>

const result = (status: CeremonialContextRetirementResult["status"]): CeremonialContextRetirementResult => ({
  status,
  operationId: CEREMONIAL_CONTEXT_RETIREMENT_OPERATION_ID,
  grantIds: [13, 14],
  workOrderIds: [17, 18],
})

function sharedRetirementInstant(
  grants: readonly CeremonialContextGrant[],
  works: readonly CeremonialContextWorkOrder[],
): string | null {
  const instants = [
    ...grants.map((grant) => grant.revokedAt?.toISOString() ?? ""),
    ...works.map((work) => work.closedAt?.toISOString() ?? ""),
    ...works.map((work) => work.updatedAt.toISOString()),
  ]
  return instants.length > 0 && instants.every((value) => value === instants[0])
    ? instants[0]
    : null
}

export async function retireCeremonialContexts(
  input: Readonly<{ userId: string }>,
  dependencies: CeremonialContextRetirementDependencies = productionDependencies,
): Promise<CeremonialContextRetirementResult> {
  if (input.userId !== OWNER_USER_ID) error("OWNER_MISMATCH")

  return dependencies.transaction(async (transaction) => {
    const grants = await transaction.lockGrants(EXPECTED_GRANTS.map(({ id }) => id))
    const works = await transaction.lockWorkOrders(EXPECTED_WORK_ORDERS.map(({ id }) => id))
    if (grants.length !== EXPECTED_GRANTS.length || works.length !== EXPECTED_WORK_ORDERS.length) {
      error("TARGET_MISSING")
    }
    if ([...grants, ...works].some((row) => row.userId !== OWNER_USER_ID)) error("TARGET_FOREIGN")

    const orderedGrants = [...grants].sort((left, right) => left.id - right.id)
    const orderedWorks = [...works].sort((left, right) => left.id - right.id)
    const active = orderedGrants.every((row, index) => activeGrantExact(row, EXPECTED_GRANTS[index]))
      && orderedWorks.every((row, index) => activeWorkOrderExact(row, EXPECTED_WORK_ORDERS[index]))
    const retired = orderedGrants.every((row, index) => retiredGrantExact(row, EXPECTED_GRANTS[index]))
      && orderedWorks.every((row, index) => retiredWorkOrderExact(row, EXPECTED_WORK_ORDERS[index]))
    const eachRecognized = orderedGrants.every((row, index) =>
      activeGrantExact(row, EXPECTED_GRANTS[index]) || retiredGrantExact(row, EXPECTED_GRANTS[index]))
      && orderedWorks.every((row, index) =>
        activeWorkOrderExact(row, EXPECTED_WORK_ORDERS[index]) || retiredWorkOrderExact(row, EXPECTED_WORK_ORDERS[index]))
    if (!active && !retired) error(eachRecognized ? "TARGET_MIXED" : "TARGET_DRIFTED")

    const audits = await transaction.readAudit(CEREMONIAL_CONTEXT_RETIREMENT_OPERATION_ID, OWNER_USER_ID)
    if (retired) {
      const retiredAt = sharedRetirementInstant(orderedGrants, orderedWorks)
      if (!retiredAt) error("TARGET_DRIFTED")
      const expected = expectedAudits(retiredAt)
      if (!exactAudit(audits.governance, expected) || !exactAudit(audits.mirrors, expected)) {
        error("AUDIT_INCOMPLETE")
      }
      return result("ALREADY_RETIRED")
    }
    if (audits.governance.length > 0 || audits.mirrors.length > 0) error("AUDIT_INCOMPLETE")

    const at = await transaction.now()
    const expected = expectedAudits(at.toISOString())
    for (const grant of orderedGrants) {
      if (!await transaction.revokeGrant(grant, at)) error("CONCURRENT_CHANGE")
    }
    for (const work of orderedWorks) {
      if (!await transaction.abortWorkOrder(work, at)) error("CONCURRENT_CHANGE")
    }
    await transaction.appendGovernance(expected)
    await transaction.appendMirrors(expected)
    return result("RETIRED")
  })
}
