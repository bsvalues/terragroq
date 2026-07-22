import { describe, expect, it } from "vitest"
import { getHomeCommandCenter } from "@/components/dashboard/home-command-center"
import type { DashboardStats } from "@/components/dashboard/operator-start"
import type { WorkOrder } from "@/lib/db/schema"

const initializedStats: DashboardStats = {
  memory: 3,
  decisions: 2,
  openDecisions: 0,
  doctrines: 2,
  work: 4,
  openWork: 0,
  docs: 5,
}

function workOrder(
  id: number,
  status: WorkOrder["status"],
  title: string,
  updatedAt: string,
  overrides: Partial<WorkOrder> = {},
): WorkOrder {
  return {
    id,
    userId: "user",
    ref: `WO-${String(id).padStart(4, "0")}`,
    title,
    description: null,
    goal: null,
    loop: null,
    scope: null,
    nonGoals: [],
    allowedFiles: [],
    forbiddenFiles: [],
    validators: [],
    stopConditions: [],
    lane: null,
    phase: null,
    status,
    priority: "medium",
    assignee: null,
    authorityLevel: "A0_READ_ONLY",
    authorityGranted: null,
    authorityGrantId: null,
    acceptanceCriteria: [],
    agent: null,
    approvedBy: null,
    approvedAt: null,
    linkedDecisionId: null,
    evidence: [],
    result: null,
    commitRef: null,
    tagRef: null,
    commitAllowed: false,
    tagAllowed: false,
    pushAllowed: false,
    supersedesId: null,
    supersededById: null,
    dueAt: null,
    closedAt: null,
    completedAt: null,
    createdAt: new Date("2026-07-01T00:00:00.000Z"),
    updatedAt: new Date(updatedAt),
    ...overrides,
  }
}

describe("WilliamOS Home Command Center", () => {
  it("separates current work, blockers, and the newest completed outcomes", () => {
    const home = getHomeCommandCenter(initializedStats, [
      workOrder(1, "active", "Ship the owner briefing", "2026-07-08T12:00:00.000Z"),
      workOrder(2, "active", "Verify the queue", "2026-07-07T12:00:00.000Z"),
      workOrder(3, "review", "Review delivery evidence", "2026-07-09T12:00:00.000Z"),
      workOrder(4, "approved", "Prepare the next lane", "2026-07-10T12:00:00.000Z"),
      workOrder(5, "blocked", "Resolve the policy gate", "2026-07-06T12:00:00.000Z", {
        stopConditions: ["Owner authority is not recorded."],
      }),
      workOrder(6, "blocked", "Restore required evidence", "2026-07-08T12:00:00.000Z"),
      workOrder(7, "blocked", "Clear the reservation", "2026-07-07T12:00:00.000Z"),
      workOrder(8, "blocked", "Wait for the dependency", "2026-07-05T12:00:00.000Z"),
      workOrder(9, "closed", "Home shell foundation", "2026-07-02T12:00:00.000Z", {
        result: "PASS",
        completedAt: new Date("2026-07-10T12:00:00.000Z"),
      }),
      workOrder(10, "aborted", "Retired adapter lane", "2026-07-09T12:00:00.000Z", {
        closedAt: new Date("2026-07-09T12:00:00.000Z"),
      }),
      workOrder(11, "closed", "Evidence surface", "2026-07-08T12:00:00.000Z", {
        result: "PASS",
      }),
      workOrder(12, "closed", "Older completion", "2026-07-01T12:00:00.000Z", {
        result: "PASS",
        completedAt: new Date("2026-07-03T12:00:00.000Z"),
      }),
      workOrder(13, "draft", "Unapproved idea", "2026-07-11T12:00:00.000Z"),
    ])

    expect(home.workRadar).toMatchObject({
      eyebrow: "Operational radar",
      title: "Now, held, landed",
    })
    expect(home.workRadar.activeWork.count).toBe(4)
    expect(home.workRadar.activeWork.items.map((item) => item.ref)).toEqual([
      "WO-0001",
      "WO-0002",
      "WO-0003",
    ])
    expect(home.workRadar.activeWork.items.every((item) => item.href === "/work-orders")).toBe(true)

    expect(home.workRadar.blockers.count).toBe(4)
    expect(home.workRadar.blockers.items.map((item) => item.ref)).toEqual([
      "WO-0006",
      "WO-0007",
      "WO-0005",
    ])
    expect(home.workRadar.blockers.items[2]).toMatchObject({
      status: "blocked",
      detail: "Owner authority is not recorded.",
    })

    expect(home.workRadar.recentOutcomes.count).toBe(4)
    expect(home.workRadar.recentOutcomes.items.map((item) => item.ref)).toEqual([
      "WO-0009",
      "WO-0010",
      "WO-0011",
    ])
    expect(home.workRadar.recentOutcomes.items.map((item) => item.result)).toEqual([
      "PASS",
        "ABORTED",
      "PASS",
    ])
    expect(home.workRadar.recentOutcomes.items.every((item) => item.href === "/work-orders")).toBe(true)
  })

  it("provides useful independent empty states for the operational radar", () => {
    const home = getHomeCommandCenter(initializedStats, [])

    expect(home.workRadar.activeWork).toMatchObject({
      count: 0,
      items: [],
      emptyState: "No active work is requesting attention.",
    })
    expect(home.workRadar.blockers).toMatchObject({
      count: 0,
      items: [],
      emptyState: "No Work Order blockers are recorded.",
    })
    expect(home.workRadar.recentOutcomes).toMatchObject({
      count: 0,
      items: [],
      emptyState: "Completed outcomes will appear here with their recorded result.",
    })
  })

  it("frames Home as the Primary Operator command center", () => {
    const home = getHomeCommandCenter(initializedStats)

    expect(home.title).toBe("WilliamOS Home")
    expect(home.eyebrow).toBe("Primary Operator Command Center")
    expect(home.description).toContain("private command environment")
    expect(home.thesis).toContain("Primary briefing")
    expect(home.primaryAction).toEqual({
      label: "Review next move",
      href: "/work-orders",
    })
  })

  it("answers attention, stable, and blocked briefing questions", () => {
    const home = getHomeCommandCenter({
      ...initializedStats,
      openWork: 2,
      openDecisions: 1,
    })

    expect(home.briefing).toMatchObject({
      status: "Attention",
      summary: "Operator attention required",
    })
    expect(home.lanes).toEqual([
      expect.objectContaining({
        label: "Attention",
        value: "2 work orders",
        href: "/work-orders",
        tone: "attention",
      }),
      expect.objectContaining({
        label: "Stable",
        value: "systems visible",
        href: "/runtime",
        tone: "stable",
      }),
      expect.objectContaining({
        label: "Blocked",
        value: "1 decision",
        href: "/decisions",
        tone: "authority",
      }),
    ])
  })

  it("reports a ready briefing when nothing is blocking Home", () => {
    const home = getHomeCommandCenter(initializedStats)

    expect(home.briefing).toMatchObject({
      status: "Ready",
      summary: "No active work is blocking Home",
    })
    expect(home.lanes.find((lane) => lane.label === "Attention")).toMatchObject({
      value: "clear",
      href: "/goal-console",
    })
    expect(home.lanes.find((lane) => lane.label === "Blocked")).toMatchObject({
      value: "none",
    })
  })

  it("surfaces the unified WilliamOS command areas", () => {
    const home = getHomeCommandCenter(initializedStats)
    const labels = home.statusCards.map((card) => card.label)

    expect(labels).toEqual([
      "Active Work",
      "Ready Next",
      "Blocked Decisions",
      "Evidence Required",
      "Systems",
      "Local Status",
      "Local Operations",
      "Completed Phase",
      "Next Batch",
      "Authority Gates",
      "Council",
      "Worker Dock",
      "Agent Forge",
      "Active Project",
    ])
    expect(home.statusCards.find((card) => card.label === "Council")).toMatchObject({
      value: "Advisory",
      href: "/brain-council",
    })
    expect(home.statusCards.find((card) => card.label === "Worker Dock")).toMatchObject({
      value: "Inactive",
      href: "/brain-council",
    })
    expect(home.statusCards.find((card) => card.label === "Agent Forge")).toMatchObject({
      value: "Proposal-only",
      href: "/agent-forge",
    })
    expect(home.statusCards.find((card) => card.label === "Active Project")).toMatchObject({
      value: "TerraFusion OS",
      href: "/projects",
    })
    expect(home.statusCards.find((card) => card.label === "Local Operations")).toMatchObject({
      value: "Manual-ready",
      href: "/runtime",
    })
    expect(home.statusCards.find((card) => card.label === "Local Status")).toMatchObject({
      value: "Stable",
      href: "/runtime",
    })
    expect(home.statusCards.find((card) => card.label === "Local Status")?.description).toContain(
      "route status, host-loopback checks, and operator-run wrappers stay separated",
    )
    expect(home.statusCards.find((card) => card.label === "Next Batch")).toMatchObject({
      value: "Shell / WOE",
      href: "/work-orders",
    })
    expect(home.statusCards.find((card) => card.label === "Authority Gates")).toMatchObject({
      value: "Closed",
      href: "/decisions",
    })
  })

  it("shows Brain Council, Hermes, Evidence, and Access Grants posture without activation", () => {
    const home = getHomeCommandCenter(initializedStats)

    expect(home.systemPosture).toEqual([
      expect.objectContaining({
        label: "Brain Council",
        posture: "Advisory",
        href: "/brain-council",
      }),
      expect.objectContaining({
        label: "Hermes Worker Dock",
        posture: "Inactive",
        href: "/brain-council",
      }),
      expect.objectContaining({
        label: "Evidence",
        posture: "Read-only",
        href: "/audit",
      }),
      expect.objectContaining({
        label: "Access Grants",
        posture: "Disabled",
        href: "/operator",
      }),
      expect.objectContaining({
        label: "Local Status",
        posture: "Read-only",
        href: "/runtime",
      }),
    ])
  })

  it("shows authority blockers and attention model without granting control", () => {
    const home = getHomeCommandCenter(initializedStats)

    expect(home.authorityPanel.title).toBe("Authority / Blocked Decisions")
    expect(home.authorityPanel.blockers.map((blocker) => blocker.label)).toEqual([
      "Local runtime control",
      "Metadata expansion",
      "Execution authority",
      "External mutation",
    ])
    expect(home.attentionModel).toEqual([
      "Stable systems",
      "Ready next work",
      "Blocked decisions",
      "Recent completed phase",
      "Local runtime status",
      "Evidence links",
    ])
  })

  it("routes active work to work order review", () => {
    const home = getHomeCommandCenter({
      ...initializedStats,
      openWork: 2,
    })

    expect(home.nextMove).toMatchObject({
      label: "Review active work orders",
      href: "/work-orders",
    })
    expect(home.statusCards.find((card) => card.label === "Active Work")).toMatchObject({
      value: "2 active",
      href: "/work-orders",
    })
  })

  it("routes zero active work to goal classification", () => {
    const home = getHomeCommandCenter({
      ...initializedStats,
      openWork: 0,
    })

    expect(home.nextMove).toMatchObject({
      label: "Classify the next objective",
      href: "/goal-console",
      reason: "No active work is blocking the Primary Operator briefing.",
    })
    expect(home.statusCards.find((card) => card.label === "Active Work")).toMatchObject({
      value: "none",
      href: "/goal-console",
    })
  })

  it("routes proposed decisions to authority review before new goals", () => {
    const home = getHomeCommandCenter({
      ...initializedStats,
      openWork: 0,
      openDecisions: 2,
    })

    expect(home.nextMove).toMatchObject({
      label: "Resolve blocked decisions",
      href: "/decisions",
      reason: "Proposed decisions are waiting on Primary authority before new work starts.",
    })
    expect(home.briefing.status).toBe("Attention")
  })

  it("does not grant execution, autonomy, authority, or production-write behavior", () => {
    const home = getHomeCommandCenter(initializedStats)

    expect(home.safety).toEqual({
      readOnly: true,
      startsHermes: false,
      activatesBrainCouncil: false,
      executesWorkOrders: false,
      deploys: false,
      writesProduction: false,
      changesAuthority: false,
      commandRunnerAdded: false,
      dockerMetadataAdded: false,
      backupScanAdded: false,
      portChecksAdded: false,
      lanExposureEnabled: false,
    })
  })

  it("keeps the Home local status card consistent with manual-only runtime semantics", () => {
    const home = getHomeCommandCenter(initializedStats)
    const localStatus = home.statusCards.find((card) => card.label === "Local Status")
    const localPosture = home.systemPosture.find((card) => card.label === "Local Status")
    const text = [localStatus?.description, localPosture?.description].join(" ")

    expect(localStatus).toMatchObject({
      value: "Stable",
      href: "/runtime",
    })
    expect(text).toContain("route status")
    expect(text).toContain("host-loopback checks")
    expect(text).toContain("operator-run wrappers")
    expect(text).toContain("metadata and controls remain blocked")
    expect(text).not.toContain("start")
    expect(text).not.toContain("restart")
    expect(text).not.toContain("enable persistence")
    expect(text).not.toContain("LAN exposure enabled")
  })
})
