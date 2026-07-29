import { createHash } from "node:crypto"
import { readFileSync } from "node:fs"
import { describe, expect, it } from "vitest"

import {
  ACCEPTANCE_OUTCOME_KEYS,
  runAcceptanceExercise,
} from "../scripts/hermes-bridge/v1-2-acceptance-exercise.mjs"

function hash(value: unknown) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex")
}

function acceptanceIdempotencyKey(action: string) {
  const campaignDigest = createHash("sha256")
    .update("campaign:v1-2-final")
    .digest("hex")
    .slice(0, 24)
  return `v1-2-acceptance:${campaignDigest}:${action}`
}

type QueueRow = Record<string, unknown> & {
  approvalDecisionId: number | null
  authorityGrantRef: string | null
  dependencyKeys: string[]
  lifecycleState: string
  outcomeKey: string
  queueOrder: number
  version: number
}

type MutationRequest = Record<string, unknown> & {
  action: string
  idempotencyKey: string
  orderedOutcomes?: Array<{ outcomeKey: string }>
  outcomeKey: string
}

type MutationEvidence = {
  receipt: Record<string, unknown> & {
    idempotencyKey: string
    outcomeKey: string
    requestBinding: MutationRequest
    requestHash: string
    resultBinding: Record<string, unknown>
  }
  attempts: Array<Record<string, unknown> & {
    disposition: string
    requestHash: string
    resultDigest: string
  }>
}

function harness({
  authorityReady = false,
  campaignWindow: campaignOpen = true,
  dependencyAuthorityStatus = "active",
  acquiredCandidate = null as string | null,
  failAction = null as string | null,
  unrelatedQueueOrder = null as number | null,
  unsafeTopology = false,
} = {}) {
  const queue: QueueRow[] = []
  const evidence = new Map<string, MutationEvidence>()
  let nextReceiptId = 1
  let nextAttemptId = 1
  const lockState = { commits: 0, rollbacks: 0 }
  if (unrelatedQueueOrder !== null) {
    queue.push({
      approvalDecisionId: null,
      authorityGrantRef: null,
      dependencyKeys: [],
      lifecycleState: "suggested",
      outcomeKey: "goal:unrelated-product-outcome",
      queueOrder: unrelatedQueueOrder,
      version: 1,
    })
  }

  const list = async () => structuredClone(queue)
  const persist = async ({ item }: { item: Record<string, unknown> }) => {
    const row = {
      ...structuredClone(item),
      version: 1,
      approvalDecisionId: null,
      authorityGrantRef: null,
    } as QueueRow
    if (unsafeTopology
      && row.outcomeKey === ACCEPTANCE_OUTCOME_KEYS.authorityBlocked) {
      row.dependencyKeys = []
    }
    if (authorityReady && [
      ACCEPTANCE_OUTCOME_KEYS.authorityBlocked,
      ACCEPTANCE_OUTCOME_KEYS.dependencyBlocked,
    ].includes(row.outcomeKey)) {
      row.approvalState = "approved"
      row.authorityState = "matched"
      row.lifecycleState = "approved"
      row.approvalDecisionId = row.outcomeKey === ACCEPTANCE_OUTCOME_KEYS.authorityBlocked
        ? 91
        : 92
      row.authorityGrantRef = row.outcomeKey === ACCEPTANCE_OUTCOME_KEYS.authorityBlocked
        ? "GRANT-0091"
        : "GRANT-0092"
    }
    queue.push(row)
    return structuredClone(row)
  }
  const readEvidence = async (key: string) => structuredClone(evidence.get(key) ?? null)
  const mutate = async (request: MutationRequest) => {
    if (request.action === failAction) throw new Error("INJECTED_MUTATION_WALL")
    const prior = evidence.get(request.idempotencyKey)
    if (prior) {
      prior.attempts.push({
        id: nextAttemptId++,
        requestHash: prior.receipt.requestHash,
        resultDigest: prior.attempts[0].resultDigest,
        disposition: "REPLAY",
        attemptedAt: "2026-07-29T06:00:02.000Z",
      })
      return { ...prior.receipt.resultBinding, replayed: true }
    }
    const row = queue.find((entry) => entry.outcomeKey === request.outcomeKey)
    if (!row) throw new Error("missing target")
    if (request.action === "reorder") {
      if (!request.orderedOutcomes) throw new Error("missing reorder outcomes")
      request.orderedOutcomes.forEach((entry, index) => {
        const candidate = queue.find((item) => item.outcomeKey === entry.outcomeKey)
        if (candidate && candidate.queueOrder !== index) {
          candidate.queueOrder = index
          candidate.version += 1
        }
      })
    } else if (request.action === "decline") {
      row.lifecycleState = "declined"
      row.version += 1
    } else if (request.action === "supersede") {
      row.lifecycleState = "superseded"
      row.version += 1
    } else if (request.action === "pause") {
      row.lifecycleState = "blocked"
      row.version += 1
    } else if (request.action === "resume") {
      row.lifecycleState = "approved"
      row.version += 1
    }
    const resultBinding = {
      outcome: structuredClone(row),
      affectedOutcomes: [structuredClone(row)],
      successor: null,
    }
    const requestHash = hash(request)
    const resultDigest = hash(resultBinding)
    evidence.set(request.idempotencyKey, {
      receipt: {
        id: nextReceiptId++,
        idempotencyKey: request.idempotencyKey,
        operation: request.action,
        outcomeKey: request.outcomeKey,
        requestHash,
        requestBinding: structuredClone(request),
        resultBinding,
      },
      attempts: [{
        id: nextAttemptId++,
        requestHash,
        resultDigest,
        disposition: "COMMITTED",
        attemptedAt: "2026-07-29T06:00:01.000Z",
      }],
    })
    return { ...resultBinding, replayed: false }
  }

  return {
    acquireExerciseLock: async () => {
      const queueSnapshot = structuredClone(queue)
      const evidenceSnapshot = structuredClone([...evidence.entries()])
      return {
        query: undefined,
        commit: async () => {
          lockState.commits += 1
        },
        rollback: async () => {
          lockState.rollbacks += 1
          queue.splice(0, queue.length, ...structuredClone(queueSnapshot))
          evidence.clear()
          for (const [key, value] of evidenceSnapshot) {
            evidence.set(key, structuredClone(value))
          }
        },
      }
    },
    evidence,
    list,
    lockState,
    mutate,
    persist,
    queue,
    readAuthorityStatus: async (grantRef: string) => {
      if (!authorityReady) return null
      return grantRef === "GRANT-0091" ? "revoked" : dependencyAuthorityStatus
    },
    readAcquisitionCounts: async (keys: string[]) => Object.fromEntries(
      keys.map((key) => [key, key === acquiredCandidate ? 1 : 0]),
    ),
    readCampaignWindow: async () => campaignOpen
      ? {
          acquiredAt: "2026-07-29T06:00:00.000Z",
          activeGrantRef: "GRANT-0100",
          activeOutcomeKey: "goal:GOAL-0008",
          campaignWindowId: "campaign:v1-2-final",
        }
      : null,
    readEvidence,
  }
}

describe("V1.2 live acceptance exercise", () => {
  it("uses the canonical queue lock and savepoints for atomic live mutations", () => {
    const source = readFileSync(
      new URL("../scripts/hermes-bridge/v1-2-acceptance-exercise.mjs", import.meta.url),
      "utf8",
    )
    expect(source).toContain("`${userId}:outcome-queue`")
    expect(source).toContain("FOR UPDATE")
    expect(source).toContain("SAVEPOINT ${savepoint}")
    expect(source).toContain("ROLLBACK TO SAVEPOINT ${current}")
    expect(source).toContain("query: locked.query")
  })

  it("records safe suggestion mutations and stops at exact owner authority", async () => {
    const adapter = harness()
    const result = await runAcceptanceExercise({
      userId: "primary-1",
      ...adapter,
    })

    expect(result.status).toBe("OWNER_AUTHORITY_REQUIRED")
    expect(result.mutations).toEqual([])
    expect(result.requiredAuthority.dependencyCandidate).toMatchObject({
      action: "outcome:execute",
      level: "A0_READ_ONLY",
      scope: ACCEPTANCE_OUTCOME_KEYS.dependencyBlocked,
    })
    expect(result.requiredAuthority.revokedAuthorityCandidate).toMatchObject({
      action: "outcome:execute",
      level: "A0_READ_ONLY",
      scope: ACCEPTANCE_OUTCOME_KEYS.authorityBlocked,
    })
    for (const key of [
      ACCEPTANCE_OUTCOME_KEYS.authorityBlocked,
      ACCEPTANCE_OUTCOME_KEYS.dependencyBlocked,
      ACCEPTANCE_OUTCOME_KEYS.supersede,
    ]) {
      expect(adapter.queue.find((row) => row.outcomeKey === key)?.dependencyKeys)
        .toContain(ACCEPTANCE_OUTCOME_KEYS.safetyBlocker)
    }
    expect(adapter.evidence.size).toBe(0)
  })

  it("completes pause and resume only after exact authority is present", async () => {
    const adapter = harness({ authorityReady: true })
    const result = await runAcceptanceExercise({
      userId: "primary-1",
      ...adapter,
    })

    expect(result.status).toBe("PASS")
    expect(result.mutations.map((entry) => entry.action).sort()).toEqual([
      "DECLINE",
      "PAUSE",
      "REORDER",
      "RESUME",
      "SUPERSEDE",
    ])
    expect([...adapter.evidence.values()].every(
      (entry) => entry.attempts.length === 2,
    )).toBe(true)
    expect(adapter.lockState).toEqual({ commits: 1, rollbacks: 0 })

    const replayedRun = await runAcceptanceExercise({
      userId: "primary-1",
      ...adapter,
    })
    expect(replayedRun.status).toBe("PASS")
    expect([...adapter.evidence.values()].every(
      (entry) => entry.attempts.length === 2,
    )).toBe(true)
    expect(adapter.lockState).toEqual({ commits: 2, rollbacks: 0 })
  })

  it("does not run retroactive mutation drills after the useful campaign closes", async () => {
    const adapter = harness({ authorityReady: true, campaignWindow: false })
    const result = await runAcceptanceExercise({
      userId: "primary-1",
      ...adapter,
    })

    expect(result).toMatchObject({
      status: "NEW_CONTINUOUS_CAMPAIGN_REQUIRED",
      mutations: [],
    })
    expect(adapter.evidence.size).toBe(0)
  })

  it("does not pause when the dependency candidate grant is not active", async () => {
    const adapter = harness({
      authorityReady: true,
      dependencyAuthorityStatus: "expired",
    })
    const result = await runAcceptanceExercise({
      userId: "primary-1",
      ...adapter,
    })

    expect(result.status).toBe("OWNER_AUTHORITY_REQUIRED")
    expect(adapter.evidence.size).toBe(0)
  })

  it("fails closed when retained acceptance candidates lack the safety sentinel", async () => {
    const adapter = harness({ unsafeTopology: true })
    await expect(runAcceptanceExercise({
      userId: "primary-1",
      ...adapter,
    })).rejects.toThrow(
      `V1_2_ACCEPTANCE_TOPOLOGY_WALL:${ACCEPTANCE_OUTCOME_KEYS.authorityBlocked}`,
    )
    expect(adapter.evidence.size).toBe(0)
  })

  it("fails closed if any acceptance-only candidate was acquired", async () => {
    const adapter = harness({
      acquiredCandidate: ACCEPTANCE_OUTCOME_KEYS.authorityBlocked,
    })
    await expect(runAcceptanceExercise({
      userId: "primary-1",
      ...adapter,
    })).rejects.toThrow(
      `V1_2_ACCEPTANCE_SAFETY_WALL:${ACCEPTANCE_OUTCOME_KEYS.authorityBlocked}`,
    )
    expect(adapter.evidence.size).toBe(0)
  })

  it("rolls the complete exercise back when a later mutation fails", async () => {
    const adapter = harness({ authorityReady: true, failAction: "decline" })
    await expect(runAcceptanceExercise({
      userId: "primary-1",
      ...adapter,
    })).rejects.toThrow("INJECTED_MUTATION_WALL")

    expect(adapter.lockState).toEqual({ commits: 0, rollbacks: 1 })
    expect(adapter.evidence.size).toBe(0)
    expect(adapter.queue.find(
      (row) => row.outcomeKey === ACCEPTANCE_OUTCOME_KEYS.dependencyBlocked,
    )?.lifecycleState).toBe("approved")
  })

  it.each([
    ["invalid disposition", [{
      disposition: "PENDING",
      requestHash: "request-hash",
      resultDigest: "result-digest",
    }, {
      disposition: "REPLAY",
      requestHash: "request-hash",
      resultDigest: "result-digest",
    }]],
    ["mismatched replay digest", [{
      disposition: "COMMITTED",
      requestHash: "request-hash",
      resultDigest: "result-digest",
    }, {
      disposition: "REPLAY",
      requestHash: "request-hash",
      resultDigest: "other-digest",
    }]],
    ["missing attempts", []],
  ])("rolls back malformed pause replay evidence: %s", async (_label, attempts) => {
    const adapter = harness({ authorityReady: true })
    const key = acceptanceIdempotencyKey("pause")
    adapter.evidence.set(key, {
      receipt: {
        idempotencyKey: key,
        outcomeKey: ACCEPTANCE_OUTCOME_KEYS.dependencyBlocked,
        requestBinding: {
          action: "pause",
          expectedVersion: 1,
          idempotencyKey: key,
          outcomeKey: ACCEPTANCE_OUTCOME_KEYS.dependencyBlocked,
          reason: "V1.2 acceptance pause exercise",
        },
        requestHash: "request-hash",
        resultBinding: {
          affectedOutcomes: [],
          outcome: {
            outcomeKey: ACCEPTANCE_OUTCOME_KEYS.dependencyBlocked,
            version: 2,
          },
          successor: null,
        },
      },
      attempts: attempts.map((attempt, index) => ({
        ...attempt,
        attemptedAt: `2026-07-29T06:00:0${index + 1}.000Z`,
      })),
    })

    await expect(runAcceptanceExercise({
      userId: "primary-1",
      ...adapter,
    })).rejects.toThrow("V1_2_PAUSE_REPLAY_WALL")
    expect(adapter.lockState).toEqual({ commits: 0, rollbacks: 1 })
  })

  it("refuses to renumber an unrelated product outcome during the reorder drill", async () => {
    const adapter = harness({ authorityReady: true, unrelatedQueueOrder: 50 })
    await expect(runAcceptanceExercise({
      userId: "primary-1",
      ...adapter,
    })).rejects.toThrow("V1_2_REORDER_ISOLATION_WALL")

    expect(adapter.lockState).toEqual({ commits: 0, rollbacks: 1 })
    expect(adapter.queue.find(
      (row) => row.outcomeKey === "goal:unrelated-product-outcome",
    )?.queueOrder).toBe(50)
  })
})
