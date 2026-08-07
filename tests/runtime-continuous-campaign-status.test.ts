import { describe, expect, it } from "vitest"

import {
  CONTINUOUS_CAMPAIGN_OUTCOME_KEYS,
  projectContinuousCampaignStatus,
} from "@/components/runtime/continuous-campaign-status"

const FIRST_OUTCOME_KEY = "campaign:v1-2:queue-evidence-drilldown"
const SUCCESSOR_OUTCOME_KEY = "campaign:v1-2:runtime-continuity-status"
const FIRST_ACQUIRED_AT = "2026-07-28T18:00:00.000Z"
const FIRST_SETTLED_AT = "2026-07-28T18:20:00.000Z"
const SUCCESSOR_ACQUIRED_AT = FIRST_SETTLED_AT
const OBSERVED_AT = "2026-07-28T18:21:00.000Z"

function liveQueueSurface() {
  return {
    generatedAt: OBSERVED_AT,
    rows: [
      {
        outcomeKey: FIRST_OUTCOME_KEY,
        goalRef: "GOAL-0008",
        title: "Add supporting evidence drill-down links to each Goal Console outcome queue row.",
        dependencyKeys: [] as readonly string[],
        lifecycleState: "completed" as const,
        lifecycleLabel: "Completed",
        activatedAt: FIRST_ACQUIRED_AT,
        terminalAt: FIRST_SETTLED_AT,
        terminalResult: "COMPLETE",
        terminalEvidenceId: null,
        terminalEvidenceRefs: [
          "EV-HERMES-81-1-10",
          "pr:481",
          `merge:${"3".repeat(40)}`,
        ] as readonly string[],
      },
      {
        outcomeKey: SUCCESSOR_OUTCOME_KEY,
        goalRef: "GOAL-0009",
        title: "Add a compact continuous outcome campaign status panel to the WilliamOS Runtime page.",
        dependencyKeys: [FIRST_OUTCOME_KEY] as readonly string[],
        lifecycleState: "active" as const,
        lifecycleLabel: "Active",
        activatedAt: SUCCESSOR_ACQUIRED_AT,
        terminalAt: null,
        terminalResult: null,
        terminalEvidenceId: null,
        terminalEvidenceRefs: [] as readonly string[],
      },
    ],
  }
}

function liveTimeline() {
  return {
    truncated: false,
    rows: [
      {
        outcomeId: "81",
        outcomeKey: FIRST_OUTCOME_KEY,
        title: "Add supporting evidence drill-down links to each Goal Console outcome queue row.",
        terminalResult: "COMPLETE",
        completedAt: FIRST_SETTLED_AT,
        mergeEvidence: {
          status: "RECORDED" as const,
          sha: "3".repeat(40),
          prNumber: 481,
        },
        successorEvidence: {
          status: "RECORDED" as const,
          outcomeKey: SUCCESSOR_OUTCOME_KEY,
          title: "Add a compact continuous outcome campaign status panel to the WilliamOS Runtime page.",
          receiptId: "202",
          acquiredAt: SUCCESSOR_ACQUIRED_AT,
          fencingTokenRange: {
            first: 2,
            latest: 2,
          },
        },
      },
    ],
  }
}

describe("projectContinuousCampaignStatus", () => {
  it("projects the live campaign sequence without inventing window or automation proof", () => {
    expect(CONTINUOUS_CAMPAIGN_OUTCOME_KEYS).toEqual([
      FIRST_OUTCOME_KEY,
      SUCCESSOR_OUTCOME_KEY,
    ])

    const status = projectContinuousCampaignStatus(
      liveQueueSurface(),
      liveTimeline(),
    )

    expect(status.phase.state).toBe("LIVE")
    expect(status.window).toMatchObject({
      status: "MISSING",
      startedAt: FIRST_ACQUIRED_AT,
      observedAt: OBSERVED_AT,
      settledAt: null,
    })
    expect(status.steps.map((step) => ({
      status: step.status,
      at: step.at,
    }))).toEqual([
      { status: "RECORDED", at: FIRST_ACQUIRED_AT },
      { status: "RECORDED", at: FIRST_SETTLED_AT },
      { status: "RECORDED", at: SUCCESSOR_ACQUIRED_AT },
      { status: "PENDING", at: null },
    ])
    expect(status.handoff).toMatchObject({
      acquisitionStatus: "RECORDED",
      automationStatus: "MISSING",
      receiptId: "202",
      acquiredAt: SUCCESSOR_ACQUIRED_AT,
      fencingTokenRange: {
        first: 2,
        latest: 2,
      },
    })
    expect(status.evidenceStatus).toBe("MISSING")
    expect(status.gaps).toEqual(expect.arrayContaining([
      expect.objectContaining({
        code: "CAMPAIGN_WINDOW_IDENTITY_MISSING",
        status: "MISSING",
      }),
      expect.objectContaining({
        code: "AUTOMATIC_HANDOFF_PROOF_MISSING",
        status: "MISSING",
      }),
    ]))
  })

  it("fails closed when successor timing and dependency linkage conflict", () => {
    const queueSurface = liveQueueSurface()
    const timeline = liveTimeline()
    const earlyAcquisition = "2026-07-28T18:19:59.999Z"
    const conflictingQueueSurface = {
      ...queueSurface,
      rows: [
        queueSurface.rows[0],
        {
          ...queueSurface.rows[1],
          dependencyKeys: [] as readonly string[],
          activatedAt: earlyAcquisition,
        },
      ],
    }
    const conflictingTimeline = {
      ...timeline,
      rows: [{
        ...timeline.rows[0],
        successorEvidence: {
          ...timeline.rows[0].successorEvidence,
          acquiredAt: earlyAcquisition,
        },
      }],
    }

    const status = projectContinuousCampaignStatus(
      conflictingQueueSurface,
      conflictingTimeline,
    )

    expect(status.handoff.acquisitionStatus).toBe("CONFLICTING")
    expect(status.handoff.automationStatus).toBe("CONFLICTING")
    expect(status.steps[2]).toMatchObject({
      status: "CONFLICTING",
      at: earlyAcquisition,
    })
    expect(status.evidenceStatus).toBe("CONFLICTING")
    expect(status.gaps).toEqual(expect.arrayContaining([
      expect.objectContaining({ status: "CONFLICTING" }),
    ]))
    expect(status.gaps.map((gap) => gap.detail).join(" ")).toMatch(
      /dependency|predecessor|timing/i,
    )
  })

  it("reports a queue-local timing conflict even when bounded timeline evidence is absent", () => {
    const queueSurface = liveQueueSurface()
    const status = projectContinuousCampaignStatus({
      ...queueSurface,
      rows: [
        queueSurface.rows[0],
        {
          ...queueSurface.rows[1],
          activatedAt: "2026-07-28T18:19:59.999Z",
        },
      ],
    }, {
      truncated: true,
      rows: [],
    })

    expect(status.handoff).toMatchObject({
      acquisitionStatus: "CONFLICTING",
      automationStatus: "CONFLICTING",
    })
    expect(status.handoff.detail).toMatch(/persisted queue.*timing/i)
  })

  it("does not call mixed queue and timeline observations a durable conflict", () => {
    const queueSurface = liveQueueSurface()
    const status = projectContinuousCampaignStatus({
      ...queueSurface,
      rows: [
        queueSurface.rows[0],
        {
          ...queueSurface.rows[1],
          activatedAt: "2026-07-28T18:20:05.001Z",
        },
      ],
    }, liveTimeline())

    expect(status.handoff).toMatchObject({
      acquisitionStatus: "MISSING",
      automationStatus: "MISSING",
    })
    expect(status.handoff.detail).toMatch(/not snapshot-bound/i)
  })

  it("rejects blank terminal evidence references", () => {
    const queueSurface = liveQueueSurface()
    const status = projectContinuousCampaignStatus({
      ...queueSurface,
      rows: [
        {
          ...queueSurface.rows[0],
          terminalEvidenceRefs: ["", "   "],
        },
        queueSurface.rows[1],
      ],
    }, liveTimeline())

    expect(status.steps[1]).toMatchObject({
      status: "MISSING",
    })
    expect(status.steps[1].detail).toMatch(/missing.*evidence reference/i)
  })

  it("accepts a valid terminal evidence id without evidence references", () => {
    const queueSurface = liveQueueSurface()
    const status = projectContinuousCampaignStatus({
      ...queueSurface,
      rows: [
        {
          ...queueSurface.rows[0],
          terminalEvidenceId: 77,
          terminalEvidenceRefs: [],
        },
        queueSurface.rows[1],
      ],
    }, liveTimeline())

    expect(status.steps[1]).toMatchObject({
      status: "RECORDED",
    })
  })

  it("accepts bounded clock skew between queue activation and receipt insertion", () => {
    const queueSurface = liveQueueSurface()
    const status = projectContinuousCampaignStatus({
      ...queueSurface,
      rows: [
        queueSurface.rows[0],
        {
          ...queueSurface.rows[1],
          activatedAt: "2026-07-28T18:20:04.999Z",
        },
      ],
    }, liveTimeline())

    expect(status.handoff.acquisitionStatus).toBe("RECORDED")
  })

  it("reports a missing successor as missing when the completion row is absent", () => {
    const queueSurface = liveQueueSurface()
    const status = projectContinuousCampaignStatus({
      ...queueSurface,
      rows: [queueSurface.rows[0]],
    }, {
      truncated: false,
      rows: [],
    })

    expect(status.handoff).toMatchObject({
      acquisitionStatus: "MISSING",
      automationStatus: "MISSING",
    })
  })

  it("does not treat a truncated completion window as proof that no acquisition receipt exists", () => {
    const queueSurface = liveQueueSurface()
    const truncatedTimeline = {
      ...liveTimeline(),
      truncated: true,
      rows: [],
    }

    const acquiredStatus = projectContinuousCampaignStatus(
      queueSurface,
      truncatedTimeline,
    )

    expect(acquiredStatus.handoff).toMatchObject({
      acquisitionStatus: "MISSING",
      automationStatus: "MISSING",
      receiptId: null,
      fencingTokenRange: null,
    })
    expect(acquiredStatus.handoff.detail).toMatch(
      /bounded completion timeline is truncated[^.]*proof is not exposed/i,
    )
    expect(acquiredStatus.handoff.detail).toMatch(
      /does not show that no receipt exists/i,
    )
    expect(acquiredStatus.gaps).toEqual(expect.arrayContaining([
      expect.objectContaining({
        code: "SUCCESSOR_ACQUISITION_EVIDENCE_MISSING",
        status: "MISSING",
      }),
    ]))
    expect(acquiredStatus.gaps).not.toEqual(expect.arrayContaining([
      expect.objectContaining({ code: "AUTOMATIC_HANDOFF_PROOF_MISSING" }),
    ]))

    const pendingStatus = projectContinuousCampaignStatus(
      {
        ...queueSurface,
        rows: [
          queueSurface.rows[0],
          {
            ...queueSurface.rows[1],
            lifecycleState: "ready",
            lifecycleLabel: "Ready",
            activatedAt: null,
          },
        ],
      },
      truncatedTimeline,
    )

    expect(pendingStatus.handoff).toMatchObject({
      acquisitionStatus: "PENDING",
      automationStatus: "PENDING",
      receiptId: null,
      fencingTokenRange: null,
    })
    expect(pendingStatus.handoff.detail).toMatch(
      /does not show that no receipt exists/i,
    )
    expect(pendingStatus.gaps.map((gap) => gap.code)).not.toContain(
      "SUCCESSOR_ACQUISITION_EVIDENCE_MISSING",
    )
    expect(pendingStatus.gaps.map((gap) => gap.code)).not.toContain(
      "AUTOMATIC_HANDOFF_PROOF_MISSING",
    )
  })

  it("keeps the campaign live when successor terminal references are absent or blank-only", () => {
    const queueSurface = liveQueueSurface()
    const successorSettledAt = "2026-07-28T18:40:00.000Z"

    for (const terminalEvidenceRefs of [
      [] as readonly string[],
      ["", "   "] as readonly string[],
    ]) {
      const status = projectContinuousCampaignStatus(
        {
          ...queueSurface,
          rows: [
            queueSurface.rows[0],
            {
              ...queueSurface.rows[1],
              lifecycleState: "completed",
              lifecycleLabel: "Completed",
              terminalAt: successorSettledAt,
              terminalResult: "COMPLETE",
              terminalEvidenceRefs,
            },
          ],
        },
        liveTimeline(),
      )

      expect(status.steps[3]).toMatchObject({
        id: "successor-settlement",
        status: "MISSING",
        at: successorSettledAt,
      })
      expect(status.phase.state).toBe("LIVE")
      expect(status.window.settledAt).toBeNull()
      expect(status.gaps).toEqual(expect.arrayContaining([
        expect.objectContaining({
          code: "SUCCESSOR_SETTLEMENT_MISSING",
          status: "MISSING",
        }),
      ]))
    }
  })

  it("rejects malformed recorded successor receipt evidence", () => {
    const timeline = liveTimeline()
    const validEvidence = timeline.rows[0].successorEvidence
    const malformedEvidence = [
      { ...validEvidence, receiptId: "   " },
      { ...validEvidence, acquiredAt: null },
      { ...validEvidence, acquiredAt: "not-a-timestamp" },
      {
        ...validEvidence,
        fencingTokenRange: { first: 3, latest: 2 },
      },
      {
        ...validEvidence,
        fencingTokenRange: { first: 1.5, latest: 2 },
      },
      {
        ...validEvidence,
        fencingTokenRange: {
          first: 2,
          latest: Number.MAX_SAFE_INTEGER + 1,
        },
      },
    ]

    for (const successorEvidence of malformedEvidence) {
      const status = projectContinuousCampaignStatus(
        liveQueueSurface(),
        {
          ...timeline,
          rows: [{
            ...timeline.rows[0],
            successorEvidence,
          }],
        },
      )

      expect(status.handoff.acquisitionStatus).toBe("CONFLICTING")
      expect(status.handoff.automationStatus).toBe("CONFLICTING")
      expect(status.handoff.acquisitionStatus).not.toBe("RECORDED")
      expect(status.steps[2].status).toBe("CONFLICTING")
      expect(status.evidenceStatus).toBe("CONFLICTING")
    }
  })

  it("does not mutate persisted queue or completion evidence inputs", () => {
    const queueSurface = liveQueueSurface()
    const timeline = liveTimeline()
    const queueBefore = structuredClone(queueSurface)
    const timelineBefore = structuredClone(timeline)

    projectContinuousCampaignStatus(queueSurface, timeline)

    expect(queueSurface).toEqual(queueBefore)
    expect(timeline).toEqual(timelineBefore)
  })
})
