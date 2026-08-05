import { createHash } from "node:crypto"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const provenance = vi.hoisted(() => ({ authorization: null as unknown }))
vi.mock("@/scripts/hermes-bridge/primary-authorization-provenance.mjs", () => ({
  isVerifiedPrimaryAuthorization: (value: unknown) => value === provenance.authorization,
}))

import {
  recordVerifiedPrimaryAuthorization,
} from "@/scripts/hermes-bridge/outcome-queue-source.mjs"
import {
  v12CampaignDecision,
  v12CampaignGrant,
} from "@/lib/outcome-queue/v1-2-campaign-authority"

const USER_ID = "primary-user"
const ISSUED_AT = "2026-08-04T20:00:00.000Z"
const EXPIRES_AT = "2026-08-04T21:00:00.000Z"
const NOW = new Date("2026-08-04T20:30:00.000Z")
const SCOPES = [
  "campaign:v1-2:queue-evidence-drilldown",
  "campaign:v1-2:runtime-continuity-status",
] as const

const AUTHORIZATION = {
  version: 1,
  action: "APPROVE",
  identityStatus: "VERIFIED_PRIMARY_CODEX_APP_SERVER",
  accountEmail: "bsvalues@gmail.com",
  threadSource: "user",
  originator: "Codex App Server",
  threadId: "019fcef4-182e-7372-a3db-981cf9dec602",
  turnId: "019fcef4-182e-7372-a3db-981cf9dec603",
  messageId: "item-7191",
  messageSha256: "a".repeat(64),
  sessionMetaSha256: "b".repeat(64),
  nonce: "abcdef01-2345-6789",
  issuedAt: ISSUED_AT,
  expiresAt: EXPIRES_AT,
  scopes: SCOPES.map((outcomeKey, expectedVersion) => ({ outcomeKey, expectedVersion })),
}

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical)
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => [key, canonical(entry)]))
  }
  return value
}

function hash(value: unknown) {
  return createHash("sha256").update(JSON.stringify(canonical(value))).digest("hex")
}

function candidate(outcomeKey: typeof SCOPES[number], version: number) {
  const evidence = outcomeKey === SCOPES[0]
  return {
    id: evidence ? 31 : 32,
    userId: USER_ID,
    outcomeKey,
    goalId: evidence ? 21 : 22,
    goalRef: evidence ? "GOAL-0021" : "GOAL-0022",
    title: evidence
      ? "Add supporting evidence drill-down links to each Goal Console outcome queue row."
      : "Add a compact continuous outcome campaign status panel to the WilliamOS Runtime page.",
    objective: evidence
      ? "Show the linked Goal, Work Order, Evidence, Trace, and Audit records when those durable references exist."
      : "Show the live campaign window, acquisition and settlement sequence, automatic successor handoff, and truthful evidence gaps.",
    queueOrder: evidence ? 1 : 2,
    dependencyKeys: evidence ? [] : [SCOPES[0]],
    riskClass: "R1",
    approvalState: "unapproved",
    approvedBy: null,
    approvedAt: null,
    approvalDecisionId: null,
    authorityState: "unverified",
    authorityLevel: "A2_WRITE_OWN",
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
    version,
    acquisitionKey: null,
    terminalResult: null,
    terminalEvidenceId: null,
    terminalEvidenceRefs: [],
    terminalKey: null,
    supersedesOutcomeKey: null,
    supersededByOutcomeKey: null,
    suggestedAt: ISSUED_AT,
    activatedAt: null,
    terminalAt: null,
    createdAt: ISSUED_AT,
    updatedAt: ISSUED_AT,
  }
}

type ReceiptRow = {
  operation: string
  outcomeKey: string
  requestHash: string
  requestBinding: Record<string, unknown>
  resultBinding: Record<string, unknown>
}

function queryHarness({
  receipts = [],
  rows = SCOPES.map((scope, version) => candidate(scope, version)),
  failAudit = false,
  missingReplayGrant = false,
}: {
  receipts?: ReceiptRow[]
  rows?: Array<Record<string, unknown>>
  failAudit?: boolean
  missingReplayGrant?: boolean
} = {}) {
  const commands: string[] = []
  const receiptInserts: unknown[][] = []
  const replayResults = receipts.map((entry) => entry.resultBinding)
  const replayQueueRows = replayResults.length === SCOPES.length
    ? SCOPES.map((scope, expectedVersion) => {
      const result = replayResults.find((entry) => entry.outcomeKey === scope)!
      return {
        ...candidate(scope, expectedVersion),
        approvalState: "approved",
        approvedBy: USER_ID,
        approvedAt: ISSUED_AT,
        approvalDecisionId: result.decisionId,
        authorityState: "matched",
        authorityGrantRef: result.grantRef,
        lifecycleState: "approved",
        lifecycleReason: "PRIMARY_CODEX_CONVERSATION_AUTHORIZATION",
        version: result.version,
      }
    })
    : rows
  let decisionId = 70
  let grantId = 80
  const client = {
    release: vi.fn(),
    query: vi.fn(async (sql: string, params: unknown[] = []) => {
      const normalized = sql.replace(/\s+/g, " ").trim()
      commands.push(normalized)
      if (["BEGIN", "COMMIT", "ROLLBACK"].includes(normalized)) return { rows: [] }
      if (normalized.startsWith("SELECT pg_advisory_xact_lock")) return { rows: [] }
      if (normalized.includes('FROM "user"')) return { rows: [{ id: USER_ID, email: AUTHORIZATION.accountEmail }] }
      if (normalized.includes('FROM "outcome_queue_mutation_receipt"')) return { rows: receipts }
      if (normalized.includes('FROM "outcome_queue_item" AS q')) return { rows: replayQueueRows }
      if (normalized.startsWith('SELECT * FROM "decision"')) {
        return {
          rows: replayResults.map((result) => ({
            id: result.decisionId,
            userId: USER_ID,
            ...v12CampaignDecision(result.outcomeKey as typeof SCOPES[number]),
          })),
        }
      }
      if (normalized.startsWith('SELECT * FROM "authority_grant"')) {
        return {
          rows: replayResults.map((result, index) => ({
            id: 81 + index,
            ...v12CampaignGrant(
              result.outcomeKey as typeof SCOPES[number],
              USER_ID,
              new Date(ISSUED_AT),
            ),
          })).slice(0, missingReplayGrant ? 1 : undefined),
        }
      }
      if (normalized.startsWith("SELECT EXISTS")) return { rows: [{ decision: false, grant: false }] }
      if (normalized.startsWith('INSERT INTO "decision"')) {
        const scope = params[10] as typeof SCOPES[number]
        return { rows: [{ id: ++decisionId, userId: USER_ID, ...v12CampaignDecision(scope) }] }
      }
      if (normalized.startsWith('INSERT INTO "authority_grant"')) {
        const scope = params[4] as typeof SCOPES[number]
        return {
          rows: [{
            id: ++grantId,
            ...v12CampaignGrant(scope, USER_ID, new Date(params[11] as string)),
          }],
        }
      }
      if (normalized.startsWith('UPDATE "outcome_queue_item"')) {
        return {
          rows: [{
            outcomeKey: params[2],
            version: Number(params[7]) + 1,
            approvalDecisionId: params[5],
            authorityGrantRef: params[6],
          }],
        }
      }
      if (normalized.startsWith('INSERT INTO "governance_event"')) {
        if (failAudit) throw Object.assign(new Error("audit failed"), { code: "AUDIT_FAILED" })
        return { rows: [] }
      }
      if (normalized.startsWith('INSERT INTO "event_log"')) return { rows: [] }
      if (normalized.startsWith('INSERT INTO "outcome_queue_mutation_receipt"')) {
        receiptInserts.push(params)
        return { rows: [] }
      }
      throw new Error(`Unhandled SQL in Primary Authorization test fake: ${normalized}`)
    }),
  }
  const pool = { connect: vi.fn().mockResolvedValue(client) }
  return { client, commands, pool, receiptInserts }
}

async function record(harness: ReturnType<typeof queryHarness>, authorization = AUTHORIZATION, now = NOW) {
  provenance.authorization = authorization
  vi.setSystemTime(now)
  return recordVerifiedPrimaryAuthorization({ query: harness.pool, authorization })
}

function replayRows(harness: ReturnType<typeof queryHarness>): ReceiptRow[] {
  return harness.receiptInserts.map((params) => ({
    operation: "primary_authorization.approve",
    outcomeKey: params[2] as string,
    requestHash: params[3] as string,
    requestBinding: JSON.parse(params[4] as string),
    resultBinding: JSON.parse(params[5] as string),
  }))
}

describe("Primary Authorization Bridge atomic store", () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(NOW)
  })

  afterEach(() => vi.useRealTimers())

  it("rejects an unbranded authorization before opening a transaction", async () => {
    const harness = queryHarness()
    provenance.authorization = null
    await expect(recordVerifiedPrimaryAuthorization({
      query: harness.pool,
      authorization: { ...AUTHORIZATION },
    })).rejects.toMatchObject({ code: "PRIMARY_AUTHORIZATION_PROVENANCE_WALL" })
    expect(harness.pool.connect).not.toHaveBeenCalled()
  })

  it("atomically records exactly both fixed campaign scopes and their audit bindings", async () => {
    const harness = queryHarness()

    const result = await record(harness)

    expect(result).toEqual({
      status: "RECORDED",
      userId: USER_ID,
      authorizationDigest: expect.stringMatching(/^[a-f0-9]{64}$/),
      outcomes: [
        {
          authorizationDigest: expect.stringMatching(/^[a-f0-9]{64}$/),
          outcomeKey: SCOPES[0],
          version: 1,
          decisionId: 71,
          decisionRef: "ADR-V12-EVIDENCE-DRILLDOWN",
          grantRef: "GRANT-V12-EVIDENCE-DRILLDOWN-20260804T200000000Z",
        },
        {
          authorizationDigest: expect.stringMatching(/^[a-f0-9]{64}$/),
          outcomeKey: SCOPES[1],
          version: 2,
          decisionId: 72,
          decisionRef: "ADR-V12-CONTINUITY-STATUS",
          grantRef: "GRANT-V12-CONTINUITY-STATUS-20260804T200000000Z",
        },
      ],
    })
    expect(result.outcomes.every(
      (outcome) => outcome.authorizationDigest === result.authorizationDigest,
    )).toBe(true)
    expect(harness.commands[0]).toBe("BEGIN")
    expect(harness.commands.at(-1)).toBe("COMMIT")
    expect(harness.commands).not.toContain("ROLLBACK")
    expect(harness.commands.filter((sql) => sql.startsWith('INSERT INTO "decision"'))).toHaveLength(2)
    expect(harness.commands.filter((sql) => sql.startsWith('INSERT INTO "authority_grant"'))).toHaveLength(2)
    expect(harness.commands.filter((sql) => sql.startsWith('UPDATE "outcome_queue_item"'))).toHaveLength(2)
    expect(harness.commands.filter((sql) => sql.startsWith('INSERT INTO "governance_event"'))).toHaveLength(2)
    expect(harness.commands.filter((sql) => sql.startsWith('INSERT INTO "event_log"'))).toHaveLength(2)
    expect(harness.receiptInserts).toHaveLength(2)
    const governanceCall = harness.client.query.mock.calls.find(
      ([sql]) => String(sql).replace(/\s+/g, " ").trim().startsWith('INSERT INTO "governance_event"'),
    )
    expect(governanceCall?.[1]?.[5]).toBe(NOW.toISOString())
    expect(JSON.parse(String(governanceCall?.[1]?.[4]))).toMatchObject({
      ownerConsentIssuedAt: ISSUED_AT,
      recordedAt: NOW.toISOString(),
    })
    expect(harness.receiptInserts.every((params) => params[6] === NOW.toISOString())).toBe(true)
    expect(harness.receiptInserts.map((params) => params[1])).toEqual([
      `primary-authorization:${AUTHORIZATION.nonce}:${SCOPES[0]}`,
      `primary-authorization:${AUTHORIZATION.nonce}:${SCOPES[1]}`,
    ])
    expect(harness.receiptInserts.map((params) => JSON.parse(params[4] as string))).toEqual(
      result.outcomes.map((outcome, expectedVersion) => ({
        authorizationDigest: result.authorizationDigest,
        outcomeKey: outcome.outcomeKey,
        expectedVersion,
      })),
    )
    expect(harness.client.release).toHaveBeenCalledOnce()
  })

  it("returns an exact replay without creating any new authority records", async () => {
    const initial = queryHarness()
    const recorded = await record(initial)
    const replay = queryHarness({ receipts: replayRows(initial) })

    await expect(record(replay)).resolves.toEqual({
      status: "REPLAYED",
      userId: USER_ID,
      authorizationDigest: recorded.authorizationDigest,
      outcomes: recorded.outcomes,
    })
    expect(replay.commands.at(-1)).toBe("COMMIT")
    expect(replay.commands.some((sql) => sql.startsWith('INSERT INTO "decision"'))).toBe(false)
    expect(replay.commands.some((sql) => sql.includes('FROM "outcome_queue_item" AS q'))).toBe(true)
  })

  it("rejects partial and request-conflicting replays and rolls back", async () => {
    const initial = queryHarness()
    await record(initial)
    const exact = replayRows(initial)
    const cases = [
      [exact.slice(0, 1), "partial"],
      [[exact[0], { ...exact[1], operation: "other.operation" }], "conflicting operation"],
    ] as const

    for (const [receipts, label] of cases) {
      const harness = queryHarness({ receipts: [...receipts] })
      await expect(record(harness), label).rejects.toMatchObject({
        code: "PRIMARY_AUTHORIZATION_REPLAY_WALL",
      })
      expect(harness.commands.at(-1)).toBe("ROLLBACK")
      expect(harness.commands).not.toContain("COMMIT")
      expect(harness.client.release).toHaveBeenCalledOnce()
    }
  })

  it("rejects a replay with a conflicting result binding", async () => {
    const initial = queryHarness()
    await record(initial)
    const exact = replayRows(initial)
    const harness = queryHarness({
      receipts: [exact[0], {
        ...exact[1],
        resultBinding: { ...exact[1].resultBinding, version: 999, grantRef: "GRANT-CONFLICT" },
      }],
    })

    await expect(record(harness)).rejects.toMatchObject({
      code: "PRIMARY_AUTHORIZATION_REPLAY_WALL",
    })
    expect(harness.commands.at(-1)).toBe("ROLLBACK")
    expect(harness.commands).not.toContain("COMMIT")
    expect(harness.client.release).toHaveBeenCalledOnce()
  })

  it("rejects an exact receipt replay when persisted authority state is incomplete", async () => {
    const initial = queryHarness()
    await record(initial)
    const harness = queryHarness({ receipts: replayRows(initial), missingReplayGrant: true })

    await expect(record(harness)).rejects.toMatchObject({
      code: "PRIMARY_AUTHORIZATION_REPLAY_STATE_WALL",
    })
    expect(harness.commands.at(-1)).toBe("ROLLBACK")
  })

  it("rejects a stale candidate row before writing either scope", async () => {
    const staleRows = SCOPES.map((scope, version) => candidate(scope, version))
    staleRows[1].version = 99
    const harness = queryHarness({ rows: staleRows })

    await expect(record(harness)).rejects.toMatchObject({
      code: "PRIMARY_AUTHORIZATION_STALE_WALL",
    })
    expect(harness.commands.at(-1)).toBe("ROLLBACK")
    expect(harness.commands.some((sql) => sql.startsWith('INSERT INTO "decision"'))).toBe(false)
    expect(harness.client.release).toHaveBeenCalledOnce()
  })

  it("rolls back the transaction when the audit insert fails", async () => {
    const harness = queryHarness({ failAudit: true })

    await expect(record(harness)).rejects.toMatchObject({ code: "AUDIT_FAILED" })
    expect(harness.commands).toContainEqual(expect.stringMatching(/^INSERT INTO "decision"/))
    expect(harness.commands).toContainEqual(expect.stringMatching(/^INSERT INTO "authority_grant"/))
    expect(harness.commands).toContainEqual(expect.stringMatching(/^UPDATE "outcome_queue_item"/))
    expect(harness.commands.at(-1)).toBe("ROLLBACK")
    expect(harness.commands).not.toContain("COMMIT")
    expect(harness.client.release).toHaveBeenCalledOnce()
  })

  it("rejects expired consent before opening a transaction", async () => {
    const harness = queryHarness()

    await expect(record(harness, AUTHORIZATION, new Date(EXPIRES_AT))).rejects.toMatchObject({
      code: "PRIMARY_AUTHORIZATION_EXPIRED",
    })
    expect(harness.pool.connect).not.toHaveBeenCalled()
    expect(harness.commands).toEqual([])
  })

  it("binds replay request hashes to the exact digest, scope, and version", async () => {
    const harness = queryHarness()
    const result = await record(harness)

    for (const [index, params] of harness.receiptInserts.entries()) {
      const binding = {
        authorizationDigest: result.authorizationDigest,
        outcomeKey: SCOPES[index],
        expectedVersion: index,
      }
      expect(params[3]).toBe(hash(binding))
      expect(JSON.parse(params[4] as string)).toEqual(binding)
    }
  })
})
