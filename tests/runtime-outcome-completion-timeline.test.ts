import { describe, expect, it } from "vitest"

import {
  RECENT_OUTCOME_COMPLETION_LIMIT,
  projectRecentOutcomeCompletionTimeline,
  type OutcomeCompletionAcquisitionReceipt,
  type OutcomeCompletionQueueRecord,
} from "../components/runtime/outcome-completion-timeline"

const USER_ID = "user-1"

function outcome(
  overrides: Partial<OutcomeCompletionQueueRecord> = {},
): OutcomeCompletionQueueRecord {
  return {
    id: "outcome-1",
    userId: USER_ID,
    outcomeKey: "goal:one",
    title: "Outcome one",
    queueOrder: 1,
    dependencyKeys: [],
    lifecycleState: "active",
    terminalResult: null,
    terminalEvidenceRefs: [],
    terminalAt: null,
    updatedAt: "2026-07-28T09:00:00.000Z",
    ...overrides,
  }
}

function receipt(
  overrides: Partial<OutcomeCompletionAcquisitionReceipt> = {},
): OutcomeCompletionAcquisitionReceipt {
  return {
    id: "receipt-1",
    userId: USER_ID,
    outcomeKey: "goal:two",
    dependencyKeysAtAcquisition: ["goal:one"],
    firstFencingToken: 4,
    latestFencingToken: 7,
    createdAt: "2026-07-28T10:00:00.000Z",
    updatedAt: "2026-07-28T10:00:00.000Z",
    ...overrides,
  }
}

describe("projectRecentOutcomeCompletionTimeline", () => {
  it("records unique merge proof and the earliest dependency-linked acquired successor", () => {
    const mergeSha = "a".repeat(40)
    const predecessor = outcome({
      lifecycleState: "completed",
      terminalResult: "MERGED_AND_VERIFIED",
      terminalEvidenceRefs: [`merge:${mergeSha}`, "pr:475", `merge:${mergeSha}`],
      terminalAt: "2026-07-28T09:30:00.000Z",
    })
    const successorB = outcome({
      id: "outcome-successor-b",
      outcomeKey: "goal:successor-b",
      title: "Successor B",
      dependencyKeys: [predecessor.outcomeKey],
    })
    const successorA = outcome({
      id: "outcome-successor-a",
      outcomeKey: "goal:successor-a",
      title: "Successor A",
      dependencyKeys: [predecessor.outcomeKey],
    })

    const result = projectRecentOutcomeCompletionTimeline(
      USER_ID,
      [predecessor, successorB, successorA],
      [
        receipt({
          id: "receipt-b",
          outcomeKey: successorB.outcomeKey,
          firstFencingToken: 20,
          latestFencingToken: 21,
        }),
        receipt({
          id: "receipt-a-late-id",
          outcomeKey: successorA.outcomeKey,
          firstFencingToken: 10,
          latestFencingToken: 12,
        }),
        receipt({
          id: "receipt-a",
          outcomeKey: successorA.outcomeKey,
          firstFencingToken: 8,
          latestFencingToken: 9,
        }),
        receipt({
          id: "receipt-a-later-time",
          outcomeKey: successorA.outcomeKey,
          createdAt: "2026-07-28T11:00:00.000Z",
        }),
      ],
    )

    expect(result).toEqual({
      rows: [
        {
          outcomeId: predecessor.id,
          outcomeKey: predecessor.outcomeKey,
          title: predecessor.title,
          terminalResult: "MERGED_AND_VERIFIED",
          completedAt: "2026-07-28T09:30:00.000Z",
          mergeEvidence: {
            status: "RECORDED",
            sha: mergeSha,
            prNumber: 475,
          },
          successorEvidence: {
            status: "RECORDED",
            outcomeKey: successorA.outcomeKey,
            title: successorA.title,
            receiptId: "receipt-a",
            acquiredAt: "2026-07-28T10:00:00.000Z",
            fencingTokenRange: {
              first: 8,
              latest: 9,
            },
          },
        },
      ],
      truncated: false,
    })
    expect(JSON.stringify(result)).not.toContain("acquisitionKey")
  })

  it("keeps PR metadata visible without treating it as merge or successor proof", () => {
    const predecessor = outcome({
      lifecycleState: "completed",
      terminalResult: null,
      terminalEvidenceRefs: ["pr:32", "pr:0", "merge:not-a-sha"],
      terminalAt: null,
    })

    expect(
      projectRecentOutcomeCompletionTimeline(USER_ID, [predecessor], []),
    ).toEqual({
      rows: [
        expect.objectContaining({
          terminalResult: null,
          completedAt: null,
          mergeEvidence: {
            status: "MISSING",
            sha: null,
            prNumber: 32,
          },
          successorEvidence: {
            status: "MISSING",
            outcomeKey: null,
            title: null,
            receiptId: null,
            acquiredAt: null,
            fencingTokenRange: null,
          },
        }),
      ],
      truncated: false,
    })
  })

  it("fails closed when any dependency-linked acquisition predates completion", () => {
    const predecessor = outcome({
      lifecycleState: "completed",
      terminalAt: "2026-07-28T10:00:00.000Z",
    })
    const earlySuccessor = outcome({
      id: "outcome-early",
      outcomeKey: "goal:early",
      dependencyKeys: [predecessor.outcomeKey],
    })
    const validSuccessor = outcome({
      id: "outcome-valid",
      outcomeKey: "goal:valid",
      dependencyKeys: [predecessor.outcomeKey],
    })

    const result = projectRecentOutcomeCompletionTimeline(
      USER_ID,
      [predecessor, validSuccessor, earlySuccessor],
      [
        receipt({
          id: "receipt-valid",
          outcomeKey: validSuccessor.outcomeKey,
          createdAt: "2026-07-28T10:01:00.000Z",
        }),
        receipt({
          id: "receipt-early",
          outcomeKey: earlySuccessor.outcomeKey,
          createdAt: "2026-07-28T09:59:59.999Z",
        }),
      ],
    )

    expect(result.rows[0].successorEvidence).toEqual({
      status: "CONFLICTING",
      outcomeKey: null,
      title: null,
      receiptId: null,
      acquiredAt: null,
      fencingTokenRange: null,
    })
  })

  it("does not bind a current dependency absent from the acquisition snapshot", () => {
    const predecessor = outcome({
      lifecycleState: "completed",
      terminalAt: "2026-07-28T10:00:00.000Z",
    })
    const mutatedSuccessor = outcome({
      id: "outcome-mutated",
      outcomeKey: "goal:mutated",
      dependencyKeys: [predecessor.outcomeKey],
    })

    const result = projectRecentOutcomeCompletionTimeline(
      USER_ID,
      [predecessor, mutatedSuccessor],
      [receipt({
        outcomeKey: mutatedSuccessor.outcomeKey,
        dependencyKeysAtAcquisition: [],
        createdAt: "2026-07-28T10:01:00.000Z",
      })],
    )

    expect(result.rows[0].successorEvidence).toEqual({
      status: "CONFLICTING",
      outcomeKey: null,
      title: null,
      receiptId: null,
      acquiredAt: null,
      fencingTokenRange: null,
    })
  })

  it("ignores nondependent acquisitions and records owned by other users", () => {
    const predecessor = outcome({
      lifecycleState: "completed",
      terminalAt: "2026-07-28T10:00:00.000Z",
    })
    const nondependent = outcome({
      id: "outcome-arbitrary",
      outcomeKey: "goal:arbitrary",
    })
    const otherUsersSuccessor = outcome({
      id: "outcome-other-user-successor",
      userId: "user-2",
      outcomeKey: "goal:other-user-successor",
      dependencyKeys: [predecessor.outcomeKey],
    })
    const noOwnedReceipt = outcome({
      id: "outcome-no-owned-receipt",
      outcomeKey: "goal:no-owned-receipt",
      dependencyKeys: [predecessor.outcomeKey],
    })
    const otherUsersCompletion = outcome({
      id: "outcome-other-user-completion",
      userId: "user-2",
      outcomeKey: "goal:other-user-completion",
      lifecycleState: "completed",
      terminalAt: "2026-07-28T12:00:00.000Z",
    })

    const result = projectRecentOutcomeCompletionTimeline(
      USER_ID,
      [
        otherUsersCompletion,
        predecessor,
        nondependent,
        otherUsersSuccessor,
        noOwnedReceipt,
      ],
      [
        receipt({
          outcomeKey: nondependent.outcomeKey,
          dependencyKeysAtAcquisition: [],
        }),
        receipt({
          id: "receipt-other-user-successor",
          userId: "user-2",
          outcomeKey: otherUsersSuccessor.outcomeKey,
        }),
        receipt({
          id: "receipt-other-user",
          userId: "user-2",
          outcomeKey: noOwnedReceipt.outcomeKey,
        }),
      ],
    )

    expect(result.rows).toHaveLength(1)
    expect(result.rows[0]).toMatchObject({
      outcomeId: predecessor.id,
      successorEvidence: { status: "MISSING" },
    })
  })

  it("orders completions by newest terminal time with a descending numeric id tie-break", () => {
    const rows = [
      outcome({
        id: "2",
        outcomeKey: "goal:b",
        lifecycleState: "completed",
        terminalAt: "2026-07-28T10:00:00.000Z",
      }),
      outcome({
        id: "1",
        outcomeKey: "goal:old",
        lifecycleState: "completed",
        terminalAt: "2026-07-28T09:00:00.000Z",
      }),
      outcome({
        id: "10",
        outcomeKey: "goal:a",
        lifecycleState: "completed",
        terminalAt: "2026-07-28T10:00:00.000Z",
      }),
      outcome({
        id: "11",
        outcomeKey: "goal:new",
        lifecycleState: "completed",
        terminalAt: "2026-07-28T11:00:00.000Z",
      }),
      outcome({
        id: "12",
        outcomeKey: "goal:active",
        terminalAt: "2026-07-28T12:00:00.000Z",
      }),
    ]

    const result = projectRecentOutcomeCompletionTimeline(USER_ID, rows, [])

    expect(result.rows.map((row) => row.outcomeId)).toEqual([
      "11",
      "10",
      "2",
      "1",
    ])
    expect(result.truncated).toBe(false)
  })

  it("uses the correct tied sixth-row sentinel with production-style numeric ids", () => {
    const rows = Array.from({ length: RECENT_OUTCOME_COMPLETION_LIMIT + 1 }, (_, index) =>
      outcome({
        id: String(index + 1),
        outcomeKey: `goal:${index}`,
        lifecycleState: "completed",
        terminalAt: "2026-07-28T10:00:00.000Z",
      }),
    )
    const rowsBefore = JSON.parse(JSON.stringify(rows))

    const result = projectRecentOutcomeCompletionTimeline(USER_ID, rows, [])

    expect(RECENT_OUTCOME_COMPLETION_LIMIT).toBe(5)
    expect(result.rows).toHaveLength(RECENT_OUTCOME_COMPLETION_LIMIT)
    expect(result.rows.map((row) => row.outcomeId)).toEqual([
      "6",
      "5",
      "4",
      "3",
      "2",
    ])
    expect(result.truncated).toBe(true)
    expect(rows).toEqual(rowsBefore)
  })

  it("does not mutate outcome, evidence, dependency, or receipt inputs", () => {
    const predecessor = outcome({
      lifecycleState: "completed",
      terminalEvidenceRefs: [`merge:${"c".repeat(40)}`, "pr:8"],
      terminalAt: "2026-07-28T10:00:00.000Z",
    })
    const successor = outcome({
      id: "outcome-successor",
      outcomeKey: "goal:successor",
      dependencyKeys: ["goal:unrelated", predecessor.outcomeKey],
    })
    const outcomes = [successor, predecessor]
    const receipts = [
      receipt({ id: "receipt-z", outcomeKey: successor.outcomeKey }),
      receipt({ id: "receipt-a", outcomeKey: successor.outcomeKey }),
    ]
    const outcomesBefore = JSON.parse(JSON.stringify(outcomes))
    const receiptsBefore = JSON.parse(JSON.stringify(receipts))

    projectRecentOutcomeCompletionTimeline(USER_ID, outcomes, receipts, 1)

    expect(outcomes).toEqual(outcomesBefore)
    expect(receipts).toEqual(receiptsBefore)
  })

  it("marks distinct merge SHAs as conflicting while retaining a unique PR number", () => {
    const predecessor = outcome({
      lifecycleState: "completed",
      terminalEvidenceRefs: [
        `merge:${"a".repeat(40)}`,
        `merge:${"b".repeat(40)}`,
        "pr:91",
      ],
      terminalAt: "2026-07-28T10:00:00.000Z",
    })

    const result = projectRecentOutcomeCompletionTimeline(USER_ID, [predecessor], [])

    expect(result.rows[0].mergeEvidence).toEqual({
      status: "CONFLICTING",
      sha: null,
      prNumber: 91,
    })
  })

  it("marks distinct PR numbers as conflicting even with one merge SHA", () => {
    const mergeSha = "d".repeat(40)
    const predecessor = outcome({
      lifecycleState: "completed",
      terminalEvidenceRefs: [
        `merge:${mergeSha}`,
        "pr:91",
        "pr:92",
      ],
      terminalAt: "2026-07-28T10:00:00.000Z",
    })

    const result = projectRecentOutcomeCompletionTimeline(USER_ID, [predecessor], [])

    expect(result.rows[0].mergeEvidence).toEqual({
      status: "CONFLICTING",
      sha: mergeSha,
      prNumber: null,
    })
  })
})
