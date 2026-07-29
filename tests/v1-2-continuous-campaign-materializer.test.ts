import { describe, expect, it, vi } from "vitest"

import {
  assertV12CampaignSuggestionOnlySql,
  buildV12CampaignMaterializerProvenance,
  buildV12ContinuousCampaignPlan,
  isExactV12CampaignReplay,
  materializeV12ContinuousCampaign,
  validateV12ParentIssue,
  V1_2_CAMPAIGN_MATERIALIZER_PROVENANCE_CONTRACT,
  V1_2_CONTINUOUS_CAMPAIGN_OUTCOMES,
} from "@/scripts/hermes-bridge/v1-2-continuous-campaign-materializer.mjs"

const now = new Date("2026-07-29T22:00:00.000Z")
const parentBody = `# Controlling Post-V1.1 Product Goal

\`GOAL: GOAL-WOS-V1.2-001\`
\`RELEASE: WilliamOS V1.2\`
\`STATUS: APPROVED_FOR_EXECUTION\`
\`BASELINE: main after PR #470\`
\`PARENT_CLOSE_POLICY: END_TO_END_PRODUCT_ACCEPTANCE_ONLY\`

## Product outcome

WilliamOS keeps approved product work moving after a goal completes. The Primary Operator can maintain an ordered queue of bounded outcomes in WilliamOS; Hermes automatically acquires the next eligible approved outcome, carries it through the existing governed runtime, and returns to the queue without requiring a ChatGPT/Codex handoff or a new owner prompt.

The system may suggest future outcomes, but it must never grant itself authority or execute an unapproved product direction.

## Required product behavior

- one durable outcome queue with priority, dependencies, risk, authority status, readiness, active execution, terminal result, and next-action truth;
- an explicit distinction between suggested, approved, blocked, active, completed, declined, and superseded outcomes;
- deterministic next-eligible selection from approved outcomes only;
- automatic continuation after success, recoverable failure, restart, and cleanup;
- no duplicate acquisition when multiple supervisors or stale leases contend;
- in-place owner decisions only for genuine product, authority, credential, cost, or irreversible-impact boundaries;
- Goal Console and Work Orders show what is active, what is next, why another outcome is not eligible, and when the queue is genuinely empty;
- terminal delivery returns to the queue automatically and preserves evidence, trace, audit, revision, and validation links;
- pause, resume, reorder, decline, and supersede actions are governed, durable, and exactly-once;
- zero routine owner relays between WilliamOS, ChatGPT, Codex, Hermes, and GitHub.

## Execution lanes

1. Durable outcome-queue and eligibility model.
2. Operator queue surface and governed queue mutations.
3. Hermes automatic next-outcome acquisition and continuation.
4. Dependency, risk, authority, concurrency, failure, and restart hardening.
5. Two-outcome resident-host and production acceptance campaign.

Child Work Orders and PRs are checkpoints only. They do not close this parent and do not pause continuation.

## Acceptance

- queue at least two useful bounded WilliamOS-native outcomes;
- complete the first and automatically acquire the second without owner relay;
- prove dependency-blocked and authority-blocked outcomes are not selected;
- prove restart, stale lease, contention, pause/resume, reorder, decline, and supersede behavior without duplication;
- show queue, Goal Console, Work Orders, Evidence, Trace, and Audit agreement;
- pass focused/full tests, lint, build, review, resident-host proof, and production route verification;
- record zero routine owner touches and no blocked scope crossing.

## Continuity and owner-interruption policy

Do not stop at child completion, PR merge, recoverable failure, review, cleanup, or lane boundary. Continue to the next eligible approved Work Order.

Interrupt the owner only for a genuine new product direction, authority, credential, cost, irreversible production impact, or material scope decision not covered by existing policy. Every interruption must name the exact blocked action and minimum decision.

## Completion

Close only after the two-outcome campaign proves automatic continuation from one approved outcome to the next on the resident Hermes host and deployed product.

\`RESULT: PASS / WILLIAMOS_V1_2_CONTINUOUS_APPROVED_OUTCOME_QUEUE_COMPLETE\``

const parentIssue = {
  number: 471,
  state: "open",
  user: { login: "bsvalues", type: "User" },
  title: "GOAL-WOS-V1.2-001 — Continuous Approved Outcome Queue",
  html_url: "https://github.com/bsvalues/terragroq/issues/471",
  body: parentBody,
}

function replayRows(
  plan: ReturnType<typeof buildV12ContinuousCampaignPlan>,
  userId = "primary-1",
) {
  return plan.map((item, index) => {
    const goalId = index + 20
    const provenanceEventId = index + 40
    const provenance = buildV12CampaignMaterializerProvenance({
      userId,
      goalId,
      item,
    })
    return {
      userId,
      goalId,
      outcomeKey: item.outcomeKey,
      goalRef: item.goalRef,
      materializedGoalRef: item.goalRef,
      goalCommand: item.title,
      goalLane: "read_model",
      goalMode: "implement",
      goalRisk: "low",
      goalAuthority: "A0_READ_ONLY",
      goalVerdict: "requires_approval",
      goalRationale: provenance.goal.rationale,
      goalMistakePatterns: [],
      goalMatchedRules: [],
      goalRecommendedMove: provenance.goal.recommendedMove,
      goalRequiresApproval: true,
      goalLinkedWorkOrderId: null,
      goalStatus: "classified",
      goalCreatedAt: item.suggestedAt,
      goalUpdatedAt: item.suggestedAt,
      title: item.title,
      objective: item.objective,
      queueOrder: item.queueOrder,
      dependencyKeys: item.dependencyKeys,
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
      suggestedAt: item.suggestedAt,
      executionBinding: null,
      leaseHolder: null,
      leaseToken: null,
      leaseExpiresAt: null,
      fencingToken: 0,
      version: 0,
      acquisitionKey: null,
      activeWorkOrderId: null,
      terminalResult: null,
      terminalEvidenceId: null,
      terminalEvidenceRefs: [],
      terminalKey: null,
      supersedesOutcomeKey: null,
      supersededByOutcomeKey: null,
      activatedAt: null,
      terminalAt: null,
      createdAt: item.suggestedAt,
      updatedAt: item.suggestedAt,
      provenanceEventCount: 1,
      provenanceEventId,
      provenanceEventType: "V1_2_CHILD_OUTCOME_SUGGESTED",
      provenanceEntityType: "outcome_queue_item",
      provenanceEntityId: item.outcomeKey,
      provenanceActor: "hermes",
      provenanceReason: "Suggested from the exact owner-authored and still-open V1.2 parent #471 without approval or authority.",
      provenanceRef: null,
      provenanceBeforeHash: null,
      provenanceAfterHash: provenance.contentHash,
      provenanceEvidenceId: null,
      provenanceMetadata: provenance,
      provenanceCreatedAt: item.suggestedAt,
      provenanceLogCount: 1,
      provenanceLogId: index + 50,
      provenanceLogType: "outcome.suggested",
      provenanceLogSummary: `${item.goalRef} suggested from pinned live V1.2 parent #471; owner approval remains required.`,
      provenanceLogRegister: "outcome-queue",
      provenanceLogRefId: goalId,
      provenanceLogMetadata: {
        governanceEventId: provenanceEventId,
        outcomeKey: item.outcomeKey,
        parentIssue: "https://github.com/bsvalues/terragroq/issues/471",
        provenanceContract: provenance.contract,
        provenanceHash: provenance.contentHash,
      },
      provenanceLogCreatedAt: item.suggestedAt,
    }
  })
}

type MockDatabaseOptions = {
  existingRows?: ReturnType<typeof replayRows>
  allocationCollision?: { goals: number; queue_rows: number }
  failCreatedVerification?: boolean
}

function createMockDatabase(options: MockDatabaseOptions = {}) {
  const statements: string[] = []
  const rows = [...(options.existingRows ?? [])]
  let goalId = 20
  let governanceId = 40

  const client = {
    query: vi.fn(async (sqlValue: string, params: unknown[] = []) => {
      const sql = String(sqlValue)
      statements.push(sql)
      if (sql === "BEGIN" || sql === "COMMIT" || sql === "ROLLBACK") return { rows: [] }
      if (sql.includes('SELECT id FROM "user"')) return { rows: [{ id: "primary-1" }] }
      if (sql.includes("pg_advisory_xact_lock")) return { rows: [] }
      if (sql.includes('FROM "outcome_queue_item" q')) {
        if (options.failCreatedVerification && rows.length === 2) {
          return { rows: rows.slice(0, 1) }
        }
        return { rows: [...rows] }
      }
      if (sql.includes("regexp_match(ref")) return { rows: [{ value: 7 }] }
      if (sql.includes('max("queueOrder")')) return { rows: [{ value: 11 }] }
      if (sql.includes("AS goals") && sql.includes("AS queue_rows")) {
        return {
          rows: [options.allocationCollision ?? { goals: 0, queue_rows: 0 }],
        }
      }
      if (sql.includes("INSERT INTO goal")) {
        goalId += 1
        return { rows: [{ id: goalId }] }
      }
      if (sql.includes('INSERT INTO "outcome_queue_item"')) {
        const plan = buildV12ContinuousCampaignPlan({
          userId: "primary-1",
          firstGoalNumber: 8,
          firstQueueOrder: 12,
          now,
        })
        const outcomeKey = String(params[1])
        const item = plan.find((candidate) => candidate.outcomeKey === outcomeKey)
        if (!item) throw new Error("unexpected outcome")
        rows.push({
          ...replayRows([item] as ReturnType<typeof buildV12ContinuousCampaignPlan>)[0],
          goalId: Number(params[2]),
          provenanceEventCount: 0,
          provenanceEventId: null,
          provenanceLogCount: 0,
          provenanceLogId: null,
        })
        return { rows: [] }
      }
      if (sql.includes("INSERT INTO governance_event")) {
        governanceId += 1
        const outcomeKey = String(params[1])
        const row = rows.find((candidate) => candidate.outcomeKey === outcomeKey)
        if (!row) throw new Error("missing outcome for governance event")
        Object.assign(row, {
          provenanceEventCount: 1,
          provenanceEventId: governanceId,
          provenanceEventType: "V1_2_CHILD_OUTCOME_SUGGESTED",
          provenanceEntityType: "outcome_queue_item",
          provenanceEntityId: outcomeKey,
          provenanceActor: "hermes",
          provenanceReason: params[2],
          provenanceRef: null,
          provenanceBeforeHash: null,
          provenanceAfterHash: params[3],
          provenanceEvidenceId: null,
          provenanceMetadata: JSON.parse(String(params[4])),
          provenanceCreatedAt: now.toISOString(),
        })
        return { rows: [{ id: governanceId }] }
      }
      if (sql.includes("INSERT INTO event_log")) {
        const metadata = JSON.parse(String(params[3]))
        const row = rows.find((candidate) => candidate.outcomeKey === metadata.outcomeKey)
        if (!row) throw new Error("missing outcome for event log")
        Object.assign(row, {
          provenanceLogCount: 1,
          provenanceLogId: governanceId + 10,
          provenanceLogType: "outcome.suggested",
          provenanceLogSummary: params[1],
          provenanceLogRegister: "outcome-queue",
          provenanceLogRefId: Number(params[2]),
          provenanceLogMetadata: metadata,
          provenanceLogCreatedAt: now.toISOString(),
        })
        return { rows: [] }
      }
      throw new Error(`Unexpected SQL: ${sql}`)
    }),
    release: vi.fn(),
  }
  const pool = {
    connect: vi.fn(async () => client),
    end: vi.fn(),
  }
  return { client, pool, rows, statements }
}

function materializeWith(pool: ReturnType<typeof createMockDatabase>["pool"]) {
  return materializeV12ContinuousCampaign({
    databaseUrl: "postgres://test",
    fetchImpl: vi.fn(async () => ({
      ok: true,
      json: async () => parentIssue,
    })),
    now,
    pool,
    ensureSchema: vi.fn(async () => undefined),
  })
}

describe("V1.2 continuous campaign materializer", () => {
  it("accepts only the exact open owner-authored parent issue", () => {
    expect(validateV12ParentIssue(parentIssue)).toBe(true)
    expect(validateV12ParentIssue({ ...parentIssue, state: "closed" })).toBe(false)
    expect(validateV12ParentIssue({
      ...parentIssue,
      user: { login: "someone-else", type: "User" },
    })).toBe(false)
    expect(validateV12ParentIssue({
      ...parentIssue,
      body: `${parentBody}\nExpanded authority.`,
    })).toBe(false)
  })

  it("builds exactly two fixed suggestions in the reserved queue partition", () => {
    const plan = buildV12ContinuousCampaignPlan({
      userId: "primary-1",
      firstGoalNumber: 8,
      firstQueueOrder: 12,
      now,
    })
    expect(plan).toHaveLength(2)
    expect(plan.map((item) => item.outcomeKey)).toEqual(
      V1_2_CONTINUOUS_CAMPAIGN_OUTCOMES.map((item) => item.outcomeKey),
    )
    expect(plan.map((item) => item.goalRef)).toEqual(["GOAL-0008", "GOAL-0009"])
    expect(plan.map((item) => item.queueOrder)).toEqual([12, 13])
    expect(plan[0].dependencyKeys).toEqual([])
    expect(plan[1].dependencyKeys).toEqual([plan[0].outcomeKey])
    expect(plan.every((item) => item.queueOrder < 90)).toBe(true)
  })

  it("publishes a deterministic materializer provenance contract without authority", () => {
    const plan = buildV12ContinuousCampaignPlan({
      userId: "primary-1",
      firstGoalNumber: 8,
      firstQueueOrder: 12,
      now,
    })
    const first = buildV12CampaignMaterializerProvenance({
      userId: "primary-1",
      goalId: 20,
      item: plan[0],
    })
    const replay = buildV12CampaignMaterializerProvenance({
      userId: "primary-1",
      goalId: 20,
      item: structuredClone(plan[0]),
    })

    expect(first).toEqual(replay)
    expect(first.contract).toBe(V1_2_CAMPAIGN_MATERIALIZER_PROVENANCE_CONTRACT)
    expect(first.contentHash).toMatch(/^[a-f0-9]{64}$/)
    expect(first.outcome).toMatchObject({
      approvalState: "unapproved",
      approvedBy: null,
      approvalDecisionId: null,
      authorityState: "unverified",
      authorityGrantRef: null,
      lifecycleState: "suggested",
    })
    expect(buildV12CampaignMaterializerProvenance({
      userId: "primary-1",
      goalId: 20,
      item: { ...plan[0], queueOrder: 13 },
    }).contentHash).not.toBe(first.contentHash)
  })

  it("fails closed when either fixed queue row would cross order 90", () => {
    const base = {
      userId: "primary-1",
      firstGoalNumber: 8,
      firstQueueOrder: 12,
      now,
    }
    expect(() => buildV12ContinuousCampaignPlan({ ...base, userId: "" }))
      .toThrow("V1_2_CAMPAIGN_PRIMARY_IDENTITY_WALL")
    expect(() => buildV12ContinuousCampaignPlan({ ...base, firstGoalNumber: 0 }))
      .toThrow("V1_2_CAMPAIGN_GOAL_REF_WALL")
    expect(() => buildV12ContinuousCampaignPlan({ ...base, firstQueueOrder: 89 }))
      .toThrow("V1_2_CAMPAIGN_QUEUE_ORDER_WALL")
    expect(() => buildV12ContinuousCampaignPlan({ ...base, now: new Date("invalid") }))
      .toThrow("V1_2_CAMPAIGN_TIME_WALL")
  })

  it("accepts only an exact pristine suggestion replay", () => {
    const plan = buildV12ContinuousCampaignPlan({
      userId: "primary-1",
      firstGoalNumber: 8,
      firstQueueOrder: 12,
      now,
    })
    const rows = replayRows(plan)
    expect(isExactV12CampaignReplay(rows, plan, "primary-1")).toBe(true)
    expect(isExactV12CampaignReplay(
      rows.map((row, index) => index === 0
        ? { ...row, approvalState: "approved" }
        : row),
      plan,
      "primary-1",
    )).toBe(false)
    expect(isExactV12CampaignReplay(
      rows.map((row, index) => index === 1
        ? { ...row, authorityGrantRef: "GRANT-FORGED" }
        : row),
      plan,
      "primary-1",
    )).toBe(false)
  })

  it.each([
    ["authority level", { authorityLevel: "A1_REPOSITORY" }],
    ["authority subject", { authoritySubject: "codex" }],
    ["authority action", { authorityAction: "outcome:merge" }],
    ["execution binding", { executionBinding: "binding-forged" }],
    ["lease token", { leaseToken: "lease-forged" }],
    ["fencing token", { fencingToken: 1 }],
    ["acquisition key", { acquisitionKey: "acquire-forged" }],
    ["active work order", { activeWorkOrderId: 88 }],
    ["terminal result", { terminalResult: "PASS" }],
    ["terminal evidence id", { terminalEvidenceId: 77 }],
    ["terminal evidence refs", { terminalEvidenceRefs: ["EV-FORGED"] }],
    ["terminal key", { terminalKey: "terminal-forged" }],
    ["supersedes key", { supersedesOutcomeKey: "outcome:old" }],
    ["superseded-by key", { supersededByOutcomeKey: "outcome:new" }],
    ["activation time", { activatedAt: now.toISOString() }],
  ])("rejects replay corruption in %s", (_field, corruption) => {
    const plan = buildV12ContinuousCampaignPlan({
      userId: "primary-1",
      firstGoalNumber: 8,
      firstQueueOrder: 12,
      now,
    })
    const rows = replayRows(plan)
    rows[0] = { ...rows[0], ...corruption }
    expect(isExactV12CampaignReplay(rows, plan, "primary-1")).toBe(false)
  })

  it.each([
    'INSERT INTO "decision" ("userId") VALUES ($1)',
    'INSERT INTO public."authority_grant" ("userId") VALUES ($1) ON CONFLICT DO UPDATE SET "status" = EXCLUDED."status"',
    'UPDATE "decision" SET "status" = \'accepted\'',
    'UPDATE ONLY "authority_grant" SET "status" = \'active\'',
    'UPDATE public.authority_grant SET status = \'active\'',
    'DELETE FROM "decision" WHERE id = $1',
    'DELETE FROM ONLY "authority_grant" WHERE id = $1',
    'DELETE FROM public."authority_grant" WHERE id = $1',
    'MERGE INTO "authority_grant" AS target USING source ON true WHEN MATCHED THEN UPDATE SET status = \'active\'',
    'TRUNCATE TABLE "decision"',
    'TRUNCATE public.safe_table, public."authority_grant"',
    'ALTER TABLE "authority_grant" ADD COLUMN forged text',
    'DROP TABLE IF EXISTS public."decision"',
  ])("rejects authority mutation SQL: %s", (sql) => {
    expect(() => assertV12CampaignSuggestionOnlySql(sql))
      .toThrow("V1_2_CAMPAIGN_AUTHORITY_MUTATION_WALL")
  })

  it("accepts suggestion, goal, governance, and event-log SQL", () => {
    expect(assertV12CampaignSuggestionOnlySql(
      'INSERT INTO "outcome_queue_item" ("outcomeKey") VALUES ($1)',
    )).toBe(true)
    expect(assertV12CampaignSuggestionOnlySql(
      'SELECT * FROM "decision" JOIN "authority_grant" ON true',
    )).toBe(true)
  })

  it.each([
    ["missing audit event", { provenanceEventCount: 0 }],
    ["duplicate audit event", { provenanceEventCount: 2 }],
    ["wrong audit hash", { provenanceAfterHash: "0".repeat(64) }],
    ["mutated materialized goal ref", { materializedGoalRef: "GOAL-9999" }],
    ["mutated governance ref", { provenanceRef: "FORGED" }],
    ["mutated governance evidence", { provenanceEvidenceId: 99 }],
    ["mutated audit metadata", { provenanceMetadata: { forged: true } }],
    ["missing event log", { provenanceLogCount: 0 }],
    ["duplicate event log", { provenanceLogCount: 2 }],
    ["mutated event-log metadata", { provenanceLogMetadata: { forged: true } }],
  ])("rejects materializer provenance corruption: %s", (_field, corruption) => {
    const plan = buildV12ContinuousCampaignPlan({
      userId: "primary-1",
      firstGoalNumber: 8,
      firstQueueOrder: 12,
      now,
    })
    const rows = replayRows(plan)
    rows[0] = { ...rows[0], ...corruption }
    expect(isExactV12CampaignReplay(rows, plan, "primary-1")).toBe(false)
  })

  it("commits an atomic suggestion pair with audit events and no authority SQL", async () => {
    const database = createMockDatabase()
    await expect(materializeWith(database.pool)).resolves.toMatchObject({
      status: "CREATED",
      outcomes: [
        { outcomeKey: V1_2_CONTINUOUS_CAMPAIGN_OUTCOMES[0].outcomeKey, queueOrder: 12 },
        { outcomeKey: V1_2_CONTINUOUS_CAMPAIGN_OUTCOMES[1].outcomeKey, queueOrder: 13 },
      ],
    })
    expect(database.rows).toHaveLength(2)
    expect(database.rows.every((row) => (
      row.approvalState === "unapproved"
      && row.approvedBy == null
      && row.approvalDecisionId == null
      && row.authorityState === "unverified"
      && row.authorityGrantRef == null
      && row.lifecycleState === "suggested"
    ))).toBe(true)
    expect(database.statements.filter((sql) => sql === "COMMIT")).toHaveLength(1)
    expect(database.statements).not.toContain("ROLLBACK")
    expect(database.statements.filter((sql) => (
      sql.includes("INSERT INTO governance_event")
    ))).toHaveLength(2)
    expect(database.statements.filter((sql) => (
      sql.includes("INSERT INTO event_log")
    ))).toHaveLength(2)
    expect(() => database.statements.forEach(assertV12CampaignSuggestionOnlySql))
      .not.toThrow()
  })

  it("commits an exact idempotent replay without creating more records", async () => {
    const plan = buildV12ContinuousCampaignPlan({
      userId: "primary-1",
      firstGoalNumber: 8,
      firstQueueOrder: 12,
      now,
    })
    const database = createMockDatabase({ existingRows: replayRows(plan) })
    await expect(materializeWith(database.pool)).resolves.toMatchObject({
      status: "REPLAYED",
    })
    expect(database.statements.filter((sql) => sql.includes("INSERT INTO"))).toHaveLength(0)
    expect(database.statements.filter((sql) => sql === "COMMIT")).toHaveLength(1)
    expect(database.statements).not.toContain("ROLLBACK")
  })

  it("rolls back a partial replay before any insert", async () => {
    const plan = buildV12ContinuousCampaignPlan({
      userId: "primary-1",
      firstGoalNumber: 8,
      firstQueueOrder: 12,
      now,
    })
    const database = createMockDatabase({
      existingRows: replayRows(plan).slice(0, 1),
    })
    await expect(materializeWith(database.pool))
      .rejects.toThrow("V1_2_CAMPAIGN_REPLAY_WALL")
    expect(database.statements.filter((sql) => sql.includes("INSERT INTO"))).toHaveLength(0)
    expect(database.statements).toContain("ROLLBACK")
    expect(database.statements).not.toContain("COMMIT")
  })

  it("rolls back an allocation collision before creating either outcome", async () => {
    const database = createMockDatabase({
      allocationCollision: { goals: 1, queue_rows: 0 },
    })
    await expect(materializeWith(database.pool))
      .rejects.toThrow("V1_2_CAMPAIGN_ALLOCATION_COLLISION_WALL")
    expect(database.statements.filter((sql) => sql.includes("INSERT INTO"))).toHaveLength(0)
    expect(database.statements).toContain("ROLLBACK")
    expect(database.statements).not.toContain("COMMIT")
  })

  it("rolls back when post-insert verification cannot observe the full pair", async () => {
    const database = createMockDatabase({ failCreatedVerification: true })
    await expect(materializeWith(database.pool))
      .rejects.toThrow("V1_2_CAMPAIGN_ATOMICITY_WALL")
    expect(database.statements.filter((sql) => (
      sql.includes('INSERT INTO "outcome_queue_item"')
    ))).toHaveLength(2)
    expect(database.statements).toContain("ROLLBACK")
    expect(database.statements).not.toContain("COMMIT")
  })
})
